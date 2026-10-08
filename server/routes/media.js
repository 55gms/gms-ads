import { Router } from 'express';
import { asyncHandler } from '../middleware/auth.js';
import { storage } from '../storage/index.js';

const NAME_RE = /^([a-f0-9]{64})\.(png|jpe?g|webp|gif|avif)$/;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };

function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some((part) => part.trim().replace(/^W\//, '') === etag);
}

export const mediaRouter = Router();

// Immutable, content-addressed creative files. Only names of the exact shape
// <sha256>.<ext> are looked up, which also rules out path traversal.
mediaRouter.get(
  '/creatives/:name',
  asyncHandler(async (req, res) => {
    const match = NAME_RE.exec(req.params.name);
    if (!match) return res.status(404).json({ error: 'not_found', message: 'Not found' });
    const [, sha, ext] = match;

    let key = `creatives/${sha}.${ext}`;
    let type = MIME[ext];
    let etag = `"${sha}"`;
    // Serve the WebP variant to browsers that accept it. GIFs keep their animation.
    const negotiable = ext !== 'webp' && ext !== 'gif';
    if (negotiable && /\bimage\/webp\b/.test(req.headers.accept || '') && (await storage.exists(`creatives/${sha}.webp`))) {
      key = `creatives/${sha}.webp`;
      type = MIME.webp;
      etag = `"${sha}-webp"`;
    }

    const file = await storage.get(key);
    if (!file) return res.status(404).json({ error: 'not_found', message: 'Not found' });

    res.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: etag,
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': "default-src 'none'",
      ...(negotiable ? { Vary: 'Accept' } : {}),
    });
    if (etagMatches(req.headers['if-none-match'], etag)) return res.status(304).end();
    res.set('Content-Length', String(file.size));
    if (req.method === 'HEAD') return res.end();
    file.stream().on('error', () => res.destroy()).pipe(res);
  })
);
