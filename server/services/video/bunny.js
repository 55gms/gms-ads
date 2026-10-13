// Bunny Stream client. Only this module knows Bunny's API, status codes,
// upload signing, webhook signing, and CDN URL layout; the rest of the app
// talks to it through the video storage interface in ./storage.js.
//
// Docs: https://bunny.net/docs/stream (Create/Get/Delete video, TUS uploads,
// webhooks) and https://bunny.net/docs/cdn/security/token-authentication/advanced.md

import crypto from 'node:crypto';
import { config } from '../../config.js';

export class BunnyError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.name = 'BunnyError';
    // Always a bad gateway to our caller; the upstream code is kept for logs.
    this.status = 502;
    this.upstreamStatus = status;
    this.retryable = retryable;
    this.expose = true;
  }
}

export function bunnyConfigured(cfg = config.bunny) {
  return Boolean(cfg.libraryId && cfg.apiKey && cfg.cdnHost);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Bounded retries on timeouts, 429, and 5xx, honouring Retry-After.
export function createBunnyClient(cfg = config.bunny, { fetch = globalThis.fetch, timeoutMs = 15_000, retries = 3, baseDelayMs = 500 } = {}) {
  const base = `${cfg.apiBase.replace(/\/+$/, '')}/library/${encodeURIComponent(cfg.libraryId)}`;

  async function call(method, path, body) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(base + path, {
          method,
          headers: { AccessKey: cfg.apiKey, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
          redirect: 'error',
        });
        if (res.ok) {
          const text = await res.text();
          return text ? JSON.parse(text) : {};
        }
        if (res.status === 404) throw new BunnyError('Video not found on Bunny Stream', { status: 404 });
        const retryable = res.status === 429 || res.status >= 500;
        lastError = new BunnyError(`Bunny Stream returned ${res.status}`, { status: res.status, retryable });
        if (!retryable) throw lastError;
        const after = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : baseDelayMs * 2 ** attempt);
      } catch (err) {
        if (err instanceof BunnyError && !err.retryable) throw err;
        lastError = err instanceof BunnyError ? err : new BunnyError(err.name === 'AbortError' ? 'Bunny Stream timed out' : 'Bunny Stream is unreachable', { retryable: true });
        if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  return {
    createVideo: (title) => call('POST', '/videos', { title, ...(cfg.collectionId ? { collectionId: cfg.collectionId } : {}) }),
    getVideo: (videoId) => call('GET', `/videos/${encodeURIComponent(videoId)}`),
    deleteVideo: (videoId) => call('DELETE', `/videos/${encodeURIComponent(videoId)}`),
  };
}

// Pre-signed TUS upload headers. The browser uploads straight to Bunny; the
// API key never leaves the server, only this time-limited signature does.
export function tusUpload(videoId, { now = Date.now(), ttlSeconds = 6 * 60 * 60, cfg = config.bunny } = {}) {
  const expire = Math.floor(now / 1000) + ttlSeconds;
  const signature = crypto.createHash('sha256').update(`${cfg.libraryId}${cfg.apiKey}${expire}${videoId}`).digest('hex');
  return {
    endpoint: `${cfg.apiBase.replace(/\/+$/, '')}/tusupload`,
    headers: { AuthorizationSignature: signature, AuthorizationExpire: String(expire), VideoId: videoId, LibraryId: String(cfg.libraryId) },
    expiresAt: new Date(expire * 1000).toISOString(),
  };
}

// Get Video `status` (VideoModelStatus) to our lifecycle.
// 0 Created, 1 Uploaded, 2 Processing, 3 Transcoding, 4 Finished, 5 Error,
// 6 UploadFailed, 7 JitSegmenting, 8 JitPlaylistsCreated.
export function mapVideoStatus(video) {
  switch (Number(video.status)) {
    case 0:
      return 'uploading';
    case 1:
      return 'uploaded';
    case 2:
    case 3:
    case 7:
      return 'processing';
    case 4:
    case 8:
      return 'ready';
    case 5:
    case 6:
      return 'failed';
    default:
      return 'processing';
  }
}

// Webhook `Status` uses a different numbering from Get Video. Only used to
// decide whether a refetch is worthwhile; the refetch is authoritative.
export const WEBHOOK_STATUS = { 0: 'queued', 1: 'processing', 2: 'encoding', 3: 'finished', 4: 'resolution_finished', 5: 'failed', 6: 'upload_started', 7: 'upload_finished', 8: 'upload_failed' };

// X-BunnyStream-Signature: lowercase hex HMAC-SHA256 of the raw body, keyed
// with the library's read-only API key.
export function verifyWebhook(rawBody, headers, key = config.bunny.webhookKey) {
  if (!key || !Buffer.isBuffer(rawBody)) return false;
  if (headers['x-bunnystream-signature-version'] !== 'v1') return false;
  if (String(headers['x-bunnystream-signature-algorithm'] || '').toLowerCase() !== 'hmac-sha256') return false;
  const given = String(headers['x-bunnystream-signature'] || '');
  if (!/^[a-f0-9]{64}$/.test(given)) return false;
  const expected = crypto.createHmac('sha256', key).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// Advanced (HMAC-SHA256) CDN token in path form, signed for the video's
// directory, so the playlist and every segment under it validate without
// rewriting the playlist:
//   https://host/bcdn_token=HS256-...&expires=...&token_path=%2F<id>%2F/<id>/playlist.m3u8
export function signCdnPath(path, { host = config.bunny.cdnHost, key = config.bunny.tokenKey, ttlSeconds, now = Date.now(), directory } = {}) {
  if (!key) return `https://${host}${path}`;
  const expires = Math.floor(now / 1000) + ttlSeconds;
  const signingPath = directory || path;
  const signingData = directory ? `token_path=${directory}` : '';
  const hash = crypto.createHmac('sha256', key).update(`${signingPath}${expires}${signingData}`).digest('base64url');
  const params = `bcdn_token=HS256-${hash}&expires=${expires}${directory ? `&token_path=${encodeURIComponent(directory)}` : ''}`;
  return `https://${host}/${params}${path}`;
}

// Playback URLs for a ready Bunny asset. MP4 fallback is preferred when the
// library has it on: it needs no HLS library in the browser.
export function bunnyPlayback(asset, { now = Date.now(), cfg = config.bunny, ttlSeconds = config.video.playbackTokenTtlSeconds } = {}) {
  const id = asset.provider_video_id;
  const dir = `/${id}/`;
  const sign = (file) => signCdnPath(`${dir}${file}`, { host: cfg.cdnHost, key: cfg.tokenKey, ttlSeconds, now, directory: dir });
  const resolutions = String(asset.available_resolutions || '')
    .split(',')
    .map((r) => Number.parseInt(r, 10))
    .filter((n) => n > 0 && n <= 720)
    .sort((a, b) => b - a);
  return {
    hls: sign('playlist.m3u8'),
    mp4: asset.has_mp4_fallback && resolutions.length ? sign(`play_${resolutions[0]}p.mp4`) : null,
    poster: asset.poster_url || (asset.thumbnail_file ? sign(asset.thumbnail_file) : null),
  };
}
