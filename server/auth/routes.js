import { Router } from 'express';
import { safeReturnPath } from '../../shared/validators.js';
import { config } from '../config.js';
import { tx } from '../db/pool.js';
import { logger } from '../logger.js';
import { asyncHandler, csrf } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { COOKIES } from './cookies.js';
import { beginLogin, completeLogin, endSessionUrl } from './oidc.js';
import { endSession, rotateSession, startSession } from './session.js';

const FIRST_USER_LOCK = 5519002;

// Users are keyed on (iss, sub). The first account becomes owner; later ones
// wait for approval unless their verified email is listed in ADMIN_EMAILS.
async function upsertUser(claims) {
  return tx(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock($1)', [FIRST_USER_LOCK]);
    const profile = [claims.email || null, claims.name || claims.preferred_username || null, claims.picture || null];
    const existing = await db.query(
      `UPDATE users SET email = $3, name = $4, avatar = $5, last_login_at = now()
        WHERE iss = $1 AND sub = $2 RETURNING *`,
      [claims.iss, claims.sub, ...profile]
    );
    if (existing.rows[0]) return existing.rows[0];
    const { rows: count } = await db.query('SELECT count(*)::int AS n FROM users');
    let role = 'viewer';
    let status = 'pending';
    if (count[0].n === 0) {
      role = 'owner';
      status = 'active';
    } else if (claims.email && claims.email_verified === true && config.adminEmails.includes(claims.email.toLowerCase())) {
      role = 'admin';
      status = 'active';
    }
    const created = await db.query(
      `INSERT INTO users (iss, sub, email, name, avatar, role, status, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING *`,
      [claims.iss, claims.sub, ...profile, role, status]
    );
    await db.query(`INSERT INTO audit_log (user_id, action, entity_type, entity_id, detail) VALUES ($1, 'user.joined', 'user', $1, $2)`, [
      created.rows[0].id,
      JSON.stringify({ role, status }),
    ]);
    return created.rows[0];
  });
}

export const authRouter = Router();
authRouter.use(authLimiter);

authRouter.get(
  '/login',
  asyncHandler(async (req, res) => {
    const url = await beginLogin(res, safeReturnPath(req.query.returnTo));
    res.redirect(302, url.href);
  })
);

authRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    try {
      const { claims, returnTo } = await completeLogin(req, res);
      const user = await upsertUser(claims);
      if (user.status === 'disabled') return res.redirect(302, '/login?error=disabled');
      // A fresh refresh-token family and new cookies replace any earlier session.
      await startSession(res, user);
      res.redirect(302, safeReturnPath(returnTo));
    } catch (err) {
      if (!err.expose) throw err;
      logger.warn('sign-in rejected', { reason: err.message });
      res.redirect(302, `/login?error=${encodeURIComponent(err.message)}`);
    }
  })
);

authRouter.post(
  '/refresh',
  csrf,
  asyncHandler(async (req, res) => {
    const result = await rotateSession(res, req.cookies[COOKIES.refresh]);
    if (!result.ok) {
      if (result.reason === 'reuse') logger.warn('refresh token reuse detected; session family revoked', { userId: result.userId });
      return res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue' });
    }
    res.json({ ok: true });
  })
);

authRouter.post(
  '/logout',
  csrf,
  asyncHandler(async (req, res) => {
    await endSession(res, req.cookies[COOKIES.refresh]);
    res.json({ ok: true, redirect: (await endSessionUrl()) || '/login' });
  })
);
