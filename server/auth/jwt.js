// HS256 access tokens. Kept local because the app only signs and verifies its
// own tokens with one symmetric key.

import crypto from 'node:crypto';
import { config } from '../config.js';

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const mac = (data) => crypto.createHmac('sha256', config.keys.jwt).update(data).digest();

export function signAccessToken(claims, ttlSeconds = config.accessTtlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds })).toString('base64url');
  const data = `${HEADER}.${payload}`;
  return `${data}.${mac(data).toString('base64url')}`;
}

export function verifyAccessToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  // The header is compared verbatim, so no other algorithm is ever accepted.
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  const given = Buffer.from(parts[2], 'base64url');
  const expected = mac(`${parts[0]}.${parts[1]}`);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
