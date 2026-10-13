// Video asset lifecycle: uploading -> uploaded -> processing -> ready, or
// failed. State changes come from the Bunny webhook when it is configured and
// from a slow poller either way, so a lost webhook only delays readiness.

import { config } from '../../config.js';
import { query } from '../../db/pool.js';
import { logger } from '../../logger.js';
import { tusUpload } from './bunny.js';
import { videoStorage } from './storage.js';

const SYNC_COLUMNS = ['status', 'encode_progress', 'duration_seconds', 'width', 'height', 'available_resolutions', 'has_mp4_fallback', 'thumbnail_file', 'error'];
// Uploads Bunny never received are cleaned up after this long.
const ORPHAN_AFTER = '48 hours';

export async function getAsset(creativeId) {
  const { rows } = await query('SELECT * FROM video_assets WHERE creative_id = $1', [creativeId]);
  return rows[0] || null;
}

// Pulls the provider's view of one asset and stores it. Returns the row.
export async function syncAsset(asset) {
  if (asset.status === 'archived') return asset;
  let fresh;
  try {
    fresh = await videoStorage(asset.provider).sync(asset);
  } catch (err) {
    await query('UPDATE video_assets SET sync_attempts = sync_attempts + 1, last_synced_at = now() WHERE creative_id = $1', [asset.creative_id]);
    logger.warn('video sync failed', { creativeId: asset.creative_id, error: err.message });
    return asset;
  }
  if (!fresh) return asset;
  // A video still "uploading" on Bunny's side but marked uploaded here means
  // the browser said it finished; keep the more advanced local state.
  if (fresh.status === 'uploading' && asset.status === 'uploaded') fresh.status = 'uploaded';
  if (fresh.status === 'ready' && !(fresh.duration_seconds > 0)) fresh.status = 'processing';
  if (fresh.status === 'ready' && fresh.duration_seconds > config.video.maxDurationSeconds) {
    fresh.status = 'failed';
    fresh.error = `Video is ${Math.round(fresh.duration_seconds)}s long; the limit is ${config.video.maxDurationSeconds}s`;
  }
  const values = SYNC_COLUMNS.map((c) => fresh[c] ?? null);
  const sets = SYNC_COLUMNS.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const { rows } = await query(
    `UPDATE video_assets SET ${sets}, sync_attempts = 0, last_synced_at = now(), updated_at = now()
      WHERE creative_id = $1 AND status <> 'archived' RETURNING *`,
    [asset.creative_id, ...values]
  );
  const row = rows[0] || asset;
  if (row.status === 'ready' && row.width && row.height) {
    await query('UPDATE creatives SET width = $2, height = $3 WHERE id = $1', [row.creative_id, row.width, row.height]);
  }
  return row;
}

export async function syncByProviderId(provider, providerVideoId) {
  const { rows } = await query('SELECT * FROM video_assets WHERE provider = $1 AND provider_video_id = $2', [provider, providerVideoId]);
  return rows[0] ? syncAsset(rows[0]) : null;
}

export function uploadTicket(asset) {
  return tusUpload(asset.provider_video_id, { ttlSeconds: 6 * 60 * 60 });
}

// One pass of the poller: assets still moving, oldest first, backing off on
// repeated failures. Orphaned uploads are failed and removed from Bunny.
export async function pollPending({ limit = 20 } = {}) {
  const { rows } = await query(
    `SELECT * FROM video_assets
      WHERE status IN ('uploading', 'uploaded', 'processing')
        AND (last_synced_at IS NULL OR last_synced_at < now() - make_interval(secs => least(3600, 30 * power(2, least(sync_attempts, 7)))))
      ORDER BY updated_at LIMIT $1`,
    [limit]
  );
  for (const asset of rows) await syncAsset(asset);

  const orphans = await query(
    `UPDATE video_assets SET status = 'failed', error = 'The upload never finished', updated_at = now()
      WHERE status = 'uploading' AND created_at < now() - interval '${ORPHAN_AFTER}' RETURNING *`
  );
  for (const asset of orphans.rows) {
    await videoStorage(asset.provider)
      .remove(asset)
      .catch((err) => logger.warn('orphan cleanup failed', { creativeId: asset.creative_id, error: err.message }));
  }
  return { synced: rows.length, orphans: orphans.rowCount };
}

let pollTimer = null;
export function startVideoPoller(intervalMs = 60_000) {
  if (pollTimer || !config.video.enabled) return;
  const run = () => pollPending().catch((err) => logger.error('video poll failed', { error: err.message }));
  pollTimer = setInterval(run, intervalMs);
  pollTimer.unref();
  run();
}

export function stopVideoPoller() {
  clearInterval(pollTimer);
  pollTimer = null;
}

export async function playbackFor(asset) {
  return videoStorage(asset.provider).playback(asset);
}
