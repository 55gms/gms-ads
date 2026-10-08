import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { HttpError, asyncHandler } from './auth.js';

export const KEY_PREFIX = 'gms_live_';
export const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

export function generateSiteKey() {
  const key = KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
  return { key, hash: hashKey(key), prefix: key.slice(0, KEY_PREFIX.length + 6) };
}

// `Authorization: Bearer <key>` for the 55GMS edge. Keys are looked up by
// their SHA-256 hash and compared in constant time.
export const requireSiteKey = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!presented.startsWith(KEY_PREFIX) || presented.length > 200) throw new HttpError(401, 'invalid_key', 'Missing or invalid API key');
  const hash = hashKey(presented);
  const { rows } = await query(
    'SELECT id, name, key_hash, allowed_domains, revoked_at, last_used_at FROM site_keys WHERE key_hash = $1',
    [hash]
  );
  const key = rows[0];
  const stored = Buffer.from(key ? key.key_hash : '0'.repeat(64));
  const match = crypto.timingSafeEqual(stored, Buffer.from(hash));
  if (!key || !match) throw new HttpError(401, 'invalid_key', 'Missing or invalid API key');
  if (key.revoked_at) throw new HttpError(401, 'revoked_key', 'This API key was revoked');
  // At most one write per minute per key.
  if (!key.last_used_at || Date.now() - key.last_used_at.getTime() > 60_000) {
    query('UPDATE site_keys SET last_used_at = now() WHERE id = $1', [key.id]).catch(() => {});
  }
  req.siteKey = { id: key.id, name: key.name, allowedDomains: key.allowed_domains };
  next();
});
