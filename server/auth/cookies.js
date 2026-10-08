import crypto from 'node:crypto';
import { config } from '../config.js';

export const COOKIES = {
  access: 'ads_at',
  refresh: 'ads_rt',
  csrf: 'ads_csrf',
  attemptPrefix: 'ads_oidc_',
};

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (name in out) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      /* ignore malformed values */
    }
  }
  return out;
}

const base = () => ({ secure: config.cookieSecure, sameSite: 'lax', path: '/' });

export function setCookie(res, name, value, { maxAgeSeconds, httpOnly = true, path = '/' } = {}) {
  res.cookie(name, value, { ...base(), httpOnly, path, maxAge: maxAgeSeconds * 1000 });
}

export function clearCookie(res, name, { httpOnly = true, path = '/' } = {}) {
  res.clearCookie(name, { ...base(), httpOnly, path });
}

// AES-256-GCM sealed JSON, used for the short-lived OIDC attempt cookie.
export function seal(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.keys.cookie, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unseal(value) {
  try {
    const raw = Buffer.from(value, 'base64url');
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', config.keys.cookie, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const body = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
}
