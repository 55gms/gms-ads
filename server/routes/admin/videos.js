import { Router } from 'express';
import * as v from '../../../shared/validators.js';
import { config } from '../../config.js';
import { query, tx } from '../../db/pool.js';
import { HttpError, asyncHandler } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rateLimit.js';
import { audit } from '../../services/audit.js';
import { checkUrlShape, resolvePublic } from '../../services/urlGuard.js';
import { getAsset, playbackFor, syncAsset, uploadTicket } from '../../services/video/assets.js';
import { createBunnyClient } from '../../services/video/bunny.js';
import { storageStatus, videoStorage } from '../../services/video/storage.js';
import { invalidateVideoCache } from '../../services/video/sessions.js';

const PLACEMENTS = ['video_embedded', 'video_fullscreen', 'video_rewarded'];
const VIDEO_TYPES = /^video\/(mp4|webm|quicktime|x-matroska|x-msvideo|mpeg|ogg|3gpp)$/;

const SELECT = `
  SELECT cr.id, cr.campaign_id, cr.title, cr.status AS creative_status, cr.created_at, c.name AS campaign_name, a.*
    FROM creatives cr JOIN video_assets a ON a.creative_id = cr.id LEFT JOIN campaigns c ON c.id = cr.campaign_id
   WHERE cr.kind = 'video'`;

async function present(row) {
  // Preview URLs are short-lived signed links, only for videos that can play.
  const playback = row.status === 'ready' ? await playbackFor(row) : null;
  return {
    id: row.id,
    kind: 'video',
    title: row.title,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name ?? null,
    provider: row.provider,
    status: row.status,
    encode_progress: row.encode_progress,
    duration_seconds: row.duration_seconds,
    width: row.width,
    height: row.height,
    available_resolutions: row.available_resolutions,
    placements: row.placements,
    error: row.error,
    external_url: row.external_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
    preview: playback,
  };
}

const one = async (id) => {
  const { rows } = await query(`${SELECT} AND cr.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Video not found');
  return present(rows[0]);
};

const idParam = (req) => {
  if (!v.isUuid(req.params.id)) throw new HttpError(404, 'not_found', 'Video not found');
  return req.params.id;
};

function placements(body) {
  if (body.placements === undefined) return undefined;
  if (!Array.isArray(body.placements) || !body.placements.length || !body.placements.every((p) => PLACEMENTS.includes(p))) {
    v.fail('placements', 'Pick at least one video placement');
  }
  return [...new Set(body.placements)];
}

export const videosRouter = Router();

videosRouter.use((_req, _res, next) => next(config.video.enabled ? undefined : new HttpError(503, 'video_disabled', 'Video ads are switched off (VIDEO_ENABLED=false)')));

videosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const { rows } = await query(
      `${SELECT} AND ($1::text IS NULL OR a.status = $1) AND ($2 OR a.status <> 'archived') ORDER BY cr.created_at DESC`,
      [status, status === 'archived']
    );
    res.json({ videos: await Promise.all(rows.map(present)), storage: storageStatus(), limits: { maxUploadBytes: config.video.maxUploadBytes, maxDurationSeconds: config.video.maxDurationSeconds } });
  })
);

videosRouter.get('/:id', asyncHandler(async (req, res) => res.json({ video: await one(idParam(req)) })));

// Step 1 of an upload: create the Bunny video and the creative, then hand the
// browser a signed TUS ticket. The file goes straight to Bunny.
videosRouter.post(
  '/',
  uploadLimiter,
  asyncHandler(async (req, res) => {
    if (!videoStorage('bunny').available()) throw new HttpError(503, 'bunny_unconfigured', 'Bunny Stream is not configured. Set the BUNNY_STREAM_* variables, or add a video by URL.');
    const title = v.str(req.body, 'title', { min: 1, max: 120 });
    const campaignId = v.uuid(req.body, 'campaignId', { required: false });
    const fileSize = v.int(req.body, 'fileSize', { min: 1 });
    const fileType = v.str(req.body, 'fileType', { max: 60 });
    if (fileSize > config.video.maxUploadBytes) v.fail('fileSize', `Videos can be at most ${Math.round(config.video.maxUploadBytes / 1024 / 1024)} MB`);
    if (!VIDEO_TYPES.test(fileType)) v.fail('fileType', 'Upload an MP4, WebM, MOV, or MKV video');
    const place = placements(req.body) || PLACEMENTS;

    const video = await createBunnyClient().createVideo(title);
    if (!video?.guid) throw new HttpError(502, 'bunny_error', 'Bunny Stream did not return a video ID');
    const creative = await tx(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO creatives (campaign_id, kind, source, title, width, height, mime, bytes, created_by)
         VALUES ($1, 'video', 'stream', $2, 0, 0, $3, $4, $5) RETURNING *`,
        [campaignId, title, fileType, fileSize, req.user.id]
      );
      await db.query(
        `INSERT INTO video_assets (creative_id, provider, provider_video_id, status, placements, upload_expires_at)
         VALUES ($1, 'bunny', $2, 'uploading', $3, now() + interval '6 hours')`,
        [rows[0].id, video.guid, place]
      );
      return rows[0];
    });
    const asset = await getAsset(creative.id);
    audit(req, 'video.created', 'creative', creative.id, { title, bytes: fileSize, provider: 'bunny' });
    res.status(201).json({ video: await one(creative.id), upload: { ...uploadTicket(asset), metadata: { filetype: fileType, title } } });
  })
);

// A fresh ticket for resuming an interrupted upload of the same video.
videosRouter.post(
  '/:id/upload-ticket',
  asyncHandler(async (req, res) => {
    const asset = await getAsset(idParam(req));
    if (!asset || asset.provider !== 'bunny') throw new HttpError(404, 'not_found', 'Video not found');
    if (asset.status !== 'uploading') throw new HttpError(409, 'not_uploading', 'This video is no longer uploading');
    res.json({ upload: uploadTicket(asset) });
  })
);

// Step 2: the browser finished its TUS upload. Bunny is then asked directly.
videosRouter.post(
  '/:id/uploaded',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    await query("UPDATE video_assets SET status = 'uploaded', updated_at = now() WHERE creative_id = $1 AND status = 'uploading'", [id]);
    const asset = await getAsset(id);
    if (!asset) throw new HttpError(404, 'not_found', 'Video not found');
    await syncAsset(asset);
    res.json({ video: await one(id) });
  })
);

videosRouter.post(
  '/:id/sync',
  asyncHandler(async (req, res) => {
    const asset = await getAsset(idParam(req));
    if (!asset) throw new HttpError(404, 'not_found', 'Video not found');
    await syncAsset(asset);
    invalidateVideoCache();
    res.json({ video: await one(asset.creative_id) });
  })
);

// A progressive file on an allowlisted https host. Duration is entered by the
// admin, because completion checks are measured against it.
videosRouter.post(
  '/external',
  uploadLimiter,
  asyncHandler(async (req, res) => {
    const title = v.str(req.body, 'title', { min: 1, max: 120 });
    const url = v.str(req.body, 'url', { max: 2000 });
    const posterUrl = v.str(req.body, 'posterUrl', { required: false, max: 2000 });
    const duration = Number(req.body.durationSeconds);
    if (!(duration >= 1 && duration <= config.video.maxDurationSeconds)) v.fail('durationSeconds', `Enter the length in seconds, 1 to ${config.video.maxDurationSeconds}`);
    const width = v.int(req.body, 'width', { min: 16, max: 7680, required: false }) || 1280;
    const height = v.int(req.body, 'height', { min: 16, max: 4320, required: false }) || 720;
    const campaignId = v.uuid(req.body, 'campaignId', { required: false });
    const place = placements(req.body) || PLACEMENTS;
    const hosts = config.video.externalHosts;
    let clean;
    try {
      clean = checkUrlShape(url, { allowedHosts: hosts });
      if (!/\.(mp4|webm)$/i.test(clean.pathname)) v.fail('url', 'Link a .mp4 or .webm file');
      await resolvePublic(clean.hostname);
      if (posterUrl) checkUrlShape(posterUrl, { allowedHosts: [...hosts, ...config.externalImageHosts] });
    } catch (err) {
      if (err.fields) throw err;
      v.fail('url', err.message);
    }
    const creative = await tx(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO creatives (campaign_id, kind, source, title, external_url, width, height, mime, bytes, created_by)
         VALUES ($1, 'video', 'external', $2, $3, $4, $5, $6, 0, $7) RETURNING *`,
        [campaignId, title, clean.toString(), width, height, clean.pathname.endsWith('.webm') ? 'video/webm' : 'video/mp4', req.user.id]
      );
      await db.query(
        `INSERT INTO video_assets (creative_id, provider, external_url, status, duration_seconds, width, height, poster_url, placements, has_mp4_fallback)
         VALUES ($1, 'external', $2, 'ready', $3, $4, $5, $6, $7, true)`,
        [rows[0].id, clean.toString(), duration, width, height, posterUrl || null, place]
      );
      return rows[0];
    });
    invalidateVideoCache();
    audit(req, 'video.linked', 'creative', creative.id, { url: clean.toString() });
    res.status(201).json({ video: await one(creative.id) });
  })
);

videosRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const place = placements(req.body);
    await tx(async (db) => {
      const sets = [];
      const params = [id];
      if (req.body.title !== undefined) {
        params.push(v.str(req.body, 'title', { min: 1, max: 120 }));
        sets.push(`title = $${params.length}`);
      }
      if (req.body.campaignId !== undefined) {
        params.push(v.uuid(req.body, 'campaignId', { required: false }));
        sets.push(`campaign_id = $${params.length}`);
      }
      if (sets.length) {
        const { rowCount } = await db.query(`UPDATE creatives SET ${sets.join(', ')} WHERE id = $1 AND kind = 'video'`, params);
        if (!rowCount) throw new HttpError(404, 'not_found', 'Video not found');
      }
      if (place) await db.query('UPDATE video_assets SET placements = $2, updated_at = now() WHERE creative_id = $1', [id, place]);
      if (!sets.length && !place) throw new HttpError(400, 'empty', 'Nothing to update');
    });
    invalidateVideoCache();
    audit(req, 'video.updated', 'creative', id);
    res.json({ video: await one(id) });
  })
);

// Archived videos stop serving but keep their row, file, and stats.
videosRouter.post(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { rowCount } = await query("UPDATE video_assets SET status = 'archived', updated_at = now() WHERE creative_id = $1", [id]);
    if (!rowCount) throw new HttpError(404, 'not_found', 'Video not found');
    await query("UPDATE creatives SET status = 'archived' WHERE id = $1", [id]);
    invalidateVideoCache();
    audit(req, 'video.archived', 'creative', id);
    res.json({ video: await one(id) });
  })
);

// Archiving keeps no earlier state, so an unarchived video starts over: a
// linked file is ready again, and a Bunny video is processing until the next
// sync (run here, else by the poller) reports what Bunny has.
videosRouter.post(
  '/:id/unarchive',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { rows } = await query(
      `UPDATE video_assets SET status = CASE WHEN provider = 'external' THEN 'ready' ELSE 'processing' END,
              error = NULL, sync_attempts = 0, last_synced_at = NULL, updated_at = now()
        WHERE creative_id = $1 AND status = 'archived' RETURNING *`,
      [id]
    );
    if (!rows[0]) {
      await one(id);
      throw new HttpError(409, 'not_archived', 'This video is not archived');
    }
    await query("UPDATE creatives SET status = 'active' WHERE id = $1", [id]);
    if (rows[0].provider === 'bunny') await syncAsset(rows[0]);
    invalidateVideoCache();
    audit(req, 'video.unarchived', 'creative', id);
    res.json({ video: await one(id) });
  })
);

videosRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const asset = await getAsset(id);
    if (!asset) throw new HttpError(404, 'not_found', 'Video not found');
    // Provider copy first: a failed delete there leaves the row to retry.
    await videoStorage(asset.provider).remove(asset);
    await query("DELETE FROM creatives WHERE id = $1 AND kind = 'video'", [id]);
    invalidateVideoCache();
    audit(req, 'video.deleted', 'creative', id, { provider: asset.provider });
    res.json({ ok: true });
  })
);
