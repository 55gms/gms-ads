import crypto from 'node:crypto';
import { COOKIES, parseCookies } from '../auth/cookies.js';
import { verifyAccessToken } from '../auth/jwt.js';
import { config } from '../config.js';
import { query } from '../db/pool.js';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function cookies(req, _res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  next();
}

// Loads the user on every request so role and status changes apply at once,
// not when the access token next expires.
export const requireUser = asyncHandler(async (req, _res, next) => {
  const claims = verifyAccessToken(req.cookies[COOKIES.access]);
  if (!claims) throw new HttpError(401, 'unauthenticated', 'Sign in to continue');
  const { rows } = await query('SELECT id, email, name, avatar, role, status, created_at FROM users WHERE id = $1', [claims.sub]);
  const user = rows[0];
  if (!user || user.status === 'disabled') throw new HttpError(401, 'unauthenticated', 'Sign in to continue');
  req.user = user;
  next();
});

export function requireActive(req, _res, next) {
  if (req.user.status !== 'active') return next(new HttpError(403, 'pending', 'Your account is waiting for approval'));
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'forbidden', 'You do not have permission to do that'));
  next();
};

// viewer is read-only: any state-changing admin request needs owner or admin.
export function writersOnly(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!['owner', 'admin'].includes(req.user.role)) return next(new HttpError(403, 'forbidden', 'Your role is read-only'));
  next();
}

const publicOrigin = new URL(config.publicBaseUrl).origin;

// Double-submit token plus an Origin check on every cookie-authenticated
// state-changing request.
export function csrf(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && origin !== publicOrigin) return next(new HttpError(403, 'csrf', 'Cross-site request blocked'));
  const cookie = req.cookies[COOKIES.csrf] || '';
  const header = String(req.headers['x-csrf-token'] || '');
  const a = Buffer.from(cookie);
  const b = Buffer.from(header);
  if (!cookie || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(new HttpError(403, 'csrf', 'Session check failed. Reload the page and try again.'));
  }
  next();
}
