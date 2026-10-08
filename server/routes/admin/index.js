import express, { Router } from 'express';
import { COOKIES } from '../../auth/cookies.js';
import { ensureCsrfCookie } from '../../auth/session.js';
import { config } from '../../config.js';
import { query } from '../../db/pool.js';
import { asyncHandler, csrf, requireActive, requireUser, writersOnly } from '../../middleware/auth.js';
import { adminLimiter } from '../../middleware/rateLimit.js';
import { campaignsRouter } from './campaigns.js';
import { creativesRouter } from './creatives.js';
import { domainsRouter } from './domains.js';
import { settingsRouter } from './settings.js';
import { statsRouter } from './stats.js';

export const adminRouter = Router();

adminRouter.use(adminLimiter, requireUser, csrf);

// Available to pending users too, so the SPA can show the waiting screen.
adminRouter.get('/me', (req, res) => {
  ensureCsrfCookie(res, req.cookies[COOKIES.csrf]);
  res.json({
    user: req.user,
    config: {
      publicBaseUrl: config.publicBaseUrl,
      embed: config.embed,
      externalImageHosts: config.externalImageHosts,
      maxUploadBytes: config.maxUploadBytes,
    },
  });
});

// Everything below needs an approved account; viewers are read-only.
adminRouter.use(requireActive, writersOnly, express.json({ limit: '1mb' }));

// Command menu search across campaigns, creatives, and domains.
adminRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase().slice(0, 80) : '';
    if (!q) return res.json({ campaigns: [], creatives: [], domains: [] });
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const [campaigns, creatives, domains] = await Promise.all([
      query('SELECT id, name, status FROM campaigns WHERE lower(name) LIKE $1 ORDER BY updated_at DESC LIMIT 6', [like]),
      query(
        `SELECT cr.id, cr.alt_text, s.width, s.height FROM creatives cr JOIN ad_sizes s ON s.id = cr.size_id
          WHERE cr.status = 'active' AND (lower(cr.alt_text) LIKE $1 OR (s.width || 'x' || s.height) LIKE $1)
          ORDER BY cr.created_at DESC LIMIT 6`,
        [like]
      ),
      query('SELECT id, hostname FROM domains WHERE hostname LIKE $1 ORDER BY hostname LIMIT 8', [like]),
    ]);
    res.json({ campaigns: campaigns.rows, creatives: creatives.rows, domains: domains.rows });
  })
);

adminRouter.use('/campaigns', campaignsRouter);
adminRouter.use('/creatives', creativesRouter);
adminRouter.use('/domains', domainsRouter);
adminRouter.use('/stats', statsRouter);
adminRouter.use('/settings', settingsRouter);
