import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Later files do not override earlier ones or the real environment.
for (const name of ['.env.local', '.env']) {
  const file = path.join(rootDir, name);
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const env = process.env;
const list = (value) => (value || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const isProd = env.NODE_ENV === 'production';

function sessionSecret() {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return env.SESSION_SECRET;
  if (isProd) throw new Error('SESSION_SECRET must be set to at least 32 characters in production');
  // Development convenience: stable across restarts, never used in production.
  const file = path.join(rootDir, '.session-secret.local');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('base64url'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

const secret = sessionSecret();
const derive = (label) => Buffer.from(crypto.hkdfSync('sha256', secret, 'gms-ads', label, 32));

const port = Number(isProd ? env.PORT || 3000 : env.API_PORT || 3001);
const publicBaseUrl = (env.PUBLIC_BASE_URL || `http://localhost:${isProd ? port : 3000}`).replace(/\/+$/, '');

export const config = {
  isProd,
  port,
  publicBaseUrl,
  trustProxy: Number(env.TRUST_PROXY || 0),
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE !== 'false' : true,
  logLevel: env.LOG_LEVEL || 'info',
  databaseUrl: env.DATABASE_URL || null,
  pgSsl: env.PGSSLMODE === 'require',
  keys: { jwt: derive('jwt'), cookie: derive('cookie') },
  accessTtlSeconds: 15 * 60,
  refreshTtlSeconds: 30 * 24 * 60 * 60,
  authometry: {
    issuer: env.AUTHOMETRY_ISSUER || 'https://authometry.ch3n.cc',
    clientId: env.AUTHOMETRY_CLIENT_ID || '',
    clientSecret: env.AUTHOMETRY_CLIENT_SECRET || '',
    providerLogout: env.AUTHOMETRY_PROVIDER_LOGOUT === 'true',
  },
  adminEmails: list(env.ADMIN_EMAILS),
  mediaDir: path.resolve(env.MEDIA_DIR || (isProd ? '/data/media' : path.join(rootDir, 'data/media'))),
  externalImageHosts: env.EXTERNAL_IMAGE_HOSTS === undefined ? ['cdn.jsdelivr.net'] : list(env.EXTERNAL_IMAGE_HOSTS),
  maxUploadBytes: 2 * 1024 * 1024,
  embed: {
    repo: env.EMBED_REPO || '55gms/gms-ads',
    version: env.EMBED_VERSION || '',
    sri: env.EMBED_SRI || '',
  },
};

// Fall back to the committed build manifest when the env vars are not set.
if (!config.embed.version || !config.embed.sri) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'embed/dist/manifest.json'), 'utf8'));
    config.embed.version ||= manifest.version;
    config.embed.sri ||= manifest.integrity;
  } catch {
    /* snippet page shows a notice instead */
  }
}
