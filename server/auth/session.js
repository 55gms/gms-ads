// App session: short-lived access JWT plus a rotating refresh token whose
// SHA-256 hash is stored in Postgres.

import crypto from 'node:crypto';
import { config } from '../config.js';
import { query, tx } from '../db/pool.js';
import { COOKIES, clearCookie, setCookie } from './cookies.js';
import { signAccessToken } from './jwt.js';

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function setSessionCookies(res, user, refreshToken) {
  setCookie(res, COOKIES.access, signAccessToken({ sub: user.id }), { maxAgeSeconds: config.accessTtlSeconds });
  // The refresh token is only ever sent to /auth.
  setCookie(res, COOKIES.refresh, refreshToken, { maxAgeSeconds: config.refreshTtlSeconds, path: '/auth' });
  ensureCsrfCookie(res, null, true);
}

export function ensureCsrfCookie(res, current, force = false) {
  if (current && !force) return current;
  const token = crypto.randomBytes(24).toString('base64url');
  setCookie(res, COOKIES.csrf, token, { maxAgeSeconds: config.refreshTtlSeconds, httpOnly: false });
  return token;
}

export function clearSessionCookies(res) {
  clearCookie(res, COOKIES.access);
  clearCookie(res, COOKIES.refresh, { path: '/auth' });
  clearCookie(res, COOKIES.csrf, { httpOnly: false });
}

async function insertRefreshToken(db, userId, familyId) {
  const token = crypto.randomBytes(48).toString('base64url');
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [userId, hashToken(token), familyId, config.refreshTtlSeconds]
  );
  return token;
}

export async function startSession(res, user) {
  const token = await insertRefreshToken({ query }, user.id, crypto.randomUUID());
  setSessionCookies(res, user, token);
}

// Rotates on every use. Presenting a token that was already rotated means it
// leaked or was replayed, so the whole family is revoked.
export async function rotateSession(res, presented) {
  if (!presented) return { ok: false, reason: 'missing' };
  const result = await tx(async (db) => {
    const { rows } = await db.query(
      `SELECT rt.id, rt.user_id, rt.family_id, rt.revoked_at, rt.expires_at, u.status
         FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1 FOR UPDATE OF rt`,
      [hashToken(presented)]
    );
    const row = rows[0];
    if (!row) return { ok: false, reason: 'unknown' };
    if (row.revoked_at) {
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
      return { ok: false, reason: 'reuse', userId: row.user_id };
    }
    if (row.expires_at <= new Date() || row.status === 'disabled') {
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
      return { ok: false, reason: 'expired' };
    }
    await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
    const token = await insertRefreshToken(db, row.user_id, row.family_id);
    return { ok: true, userId: row.user_id, token };
  });
  if (!result.ok) {
    clearSessionCookies(res);
    return result;
  }
  setSessionCookies(res, { id: result.userId }, result.token);
  return result;
}

export async function endSession(res, presented) {
  if (presented) {
    await query(
      `UPDATE refresh_tokens SET revoked_at = now()
        WHERE revoked_at IS NULL
          AND family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
      [hashToken(presented)]
    );
  }
  clearSessionCookies(res);
}

export const revokeUserSessions = (userId) =>
  query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);

export const pruneRefreshTokens = () =>
  query("DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'");
