import express, { Router } from 'express';
import { isUuid } from '../../shared/validators.js';
import { query } from '../db/pool.js';
import { asyncHandler } from '../middleware/auth.js';
import { batchLimiter, manifestLimiter, publicLimiter } from '../middleware/rateLimit.js';
import { requireSiteKey } from '../middleware/siteKey.js';
import { imageUrlFor } from '../services/creatives.js';
import { ingestBatch } from '../services/ingest.js';
import { buildManifest, touchInstance } from '../services/manifest.js';

export const v1Router = Router();

// Public: browsers load creatives through this stable URL, wherever the
// image actually lives.
v1Router.get(
  '/creatives/:id/image',
  publicLimiter,
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'not_found', message: 'Not found' });
    const { rows } = await query('SELECT source, external_url, file_path FROM creatives WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found', message: 'Not found' });
    res.set('Cache-Control', 'public, max-age=300');
    res.redirect(302, imageUrlFor(rows[0]));
  })
);

// Server-to-server only from here on: per-site API key, no CORS.
v1Router.get(
  '/manifest',
  requireSiteKey,
  manifestLimiter,
  asyncHandler(async (req, res) => {
    const instance = typeof req.query.instance === 'string' ? req.query.instance : null;
    const instances = await touchInstance(req.siteKey.id, instance);
    const manifest = await buildManifest({ siteKey: req.siteKey, instances });
    const etag = `"${manifest.version}"`;
    res.set({ ETag: etag, 'Cache-Control': 'private, no-cache' });
    const given = (req.headers['if-none-match'] || '').split(',').map((s) => s.trim().replace(/^W\//, ''));
    if (given.includes(etag)) return res.status(304).end();
    res.json(manifest);
  })
);

v1Router.post(
  '/events/batch',
  requireSiteKey,
  batchLimiter,
  // gzip bodies are inflated by the JSON parser; the limit applies after inflation.
  express.json({ limit: '10mb', inflate: true }),
  asyncHandler(async (req, res) => {
    res.json(await ingestBatch(req.body, req.siteKey));
  })
);
