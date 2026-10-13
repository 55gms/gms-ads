// /api/v1/video/* — real-time video and rewarded endpoints, called by the
// 55GMS edge with its site key. Browsers never reach these directly: the edge
// adds the viewer key and verified Premium status from its own session.
// /api/v1/webhooks/bunny — Bunny Stream status callbacks, HMAC-verified.

import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';
import { HttpError, asyncHandler } from '../middleware/auth.js';
import { requireSiteKey } from '../middleware/siteKey.js';
import { logger } from '../logger.js';
import { verifyWebhook } from '../services/video/bunny.js';
import { syncByProviderId } from '../services/video/assets.js';
import { publicProviderConfig } from '../services/video/providers.js';
import { availability, claimReward, clickSession, createSession, recordEvents, redeemGrant } from '../services/video/sessions.js';

const perKey = (limit) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => req.siteKey.id,
    message: { error: 'rate_limited', message: 'Too many requests. Try again shortly.' },
  });

export const videoRouter = Router();

const json = express.json({ limit: '32kb' });
const enabled = (_req, _res, next) => next(config.video.enabled ? undefined : new HttpError(503, 'video_disabled', 'Video ads are switched off'));

videoRouter.get(
  '/video/config',
  requireSiteKey,
  perKey(120),
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'private, max-age=60');
    res.json({ enabled: config.video.enabled, providers: config.video.enabled ? await publicProviderConfig() : [] });
  })
);

videoRouter.post('/video/availability', requireSiteKey, perKey(6000), enabled, json, asyncHandler(async (req, res) => res.json(await availability(req.body, req.siteKey))));
videoRouter.post('/video/sessions', requireSiteKey, perKey(6000), enabled, json, asyncHandler(async (req, res) => res.json(await createSession(req.body, req.siteKey))));
videoRouter.post('/video/events', requireSiteKey, perKey(30000), enabled, json, asyncHandler(async (req, res) => res.json(await recordEvents(req.body))));
videoRouter.post('/video/click', requireSiteKey, perKey(6000), enabled, json, asyncHandler(async (req, res) => res.json(await clickSession(req.body))));
videoRouter.post('/video/rewards/claim', requireSiteKey, perKey(6000), enabled, json, asyncHandler(async (req, res) => res.json(await claimReward(req.body))));
// For game backends that want server-side proof: confirms and consumes a grant once.
videoRouter.post('/rewards/redeem', requireSiteKey, perKey(6000), json, asyncHandler(async (req, res) => res.json(await redeemGrant(req.body))));

// Raw body: the signature covers the exact bytes Bunny sent.
videoRouter.post(
  '/webhooks/bunny',
  express.raw({ type: '*/*', limit: '16kb' }),
  asyncHandler(async (req, res) => {
    if (!verifyWebhook(req.body, req.headers)) throw new HttpError(401, 'bad_signature', 'Invalid webhook signature');
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      throw new HttpError(400, 'bad_body', 'Body is not JSON');
    }
    if (String(payload.VideoLibraryId) !== String(config.bunny.libraryId) || typeof payload.VideoGuid !== 'string') {
      throw new HttpError(400, 'bad_body', 'Unknown library or video');
    }
    // The webhook only says "something changed"; the API is the source of truth.
    const asset = await syncByProviderId('bunny', payload.VideoGuid);
    logger.info('bunny webhook', { video: payload.VideoGuid, webhookStatus: payload.Status, status: asset?.status ?? 'unknown video' });
    res.json({ ok: true });
  })
);
