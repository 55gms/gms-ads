import { rateLimit } from 'express-rate-limit';

const options = (windowMs, limit, extra = {}) => ({
  windowMs,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests. Try again shortly.' },
  ...extra,
});

// Tight on sign-in and token routes.
export const authLimiter = rateLimit(options(15 * 60 * 1000, 60));
export const adminLimiter = rateLimit(options(60 * 1000, 300));
export const uploadLimiter = rateLimit(options(60 * 1000, 30));
export const publicLimiter = rateLimit(options(60 * 1000, 600));

// Server-to-server routes are limited per site key, not per IP.
const perKey = (req) => req.siteKey.id;
export const manifestLimiter = rateLimit(options(60 * 1000, 120, { keyGenerator: perKey }));
export const batchLimiter = rateLimit(options(60 * 1000, 60, { keyGenerator: perKey }));
