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
  video: {
    // Kill switch for every video and rewarded route. Image ads never depend on it.
    enabled: env.VIDEO_ENABLED !== 'false',
    maxUploadBytes: Number(env.VIDEO_MAX_UPLOAD_BYTES || 500 * 1024 * 1024),
    maxDurationSeconds: Number(env.VIDEO_MAX_DURATION_SECONDS || 120),
    externalHosts: env.EXTERNAL_VIDEO_HOSTS === undefined ? ['cdn.jsdelivr.net'] : list(env.EXTERNAL_VIDEO_HOSTS),
    sessionTtlSeconds: Number(env.REWARD_SESSION_TTL_SECONDS || 15 * 60),
    // Open sessions one viewer may hold at once, across tabs.
    maxOpenSessions: Number(env.REWARD_MAX_OPEN_SESSIONS || 4),
    maxSessionsPerHour: Number(env.REWARD_MAX_SESSIONS_PER_HOUR || 60),
    maxGrantsPerHour: Number(env.REWARD_MAX_GRANTS_PER_HOUR || 30),
    playbackTokenTtlSeconds: Number(env.PLAYBACK_TOKEN_TTL_SECONDS || 2 * 60 * 60),
  },
  bunny: {
    libraryId: env.BUNNY_STREAM_LIBRARY_ID || '',
    apiKey: env.BUNNY_STREAM_API_KEY || '',
    // Pull zone host of the library, e.g. vz-abc123-456.b-cdn.net.
    cdnHost: (env.BUNNY_STREAM_CDN_HOST || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    // CDN token authentication key; when set, playback URLs are signed.
    tokenKey: env.BUNNY_STREAM_TOKEN_KEY || '',
    // The library's read-only API key: Bunny signs webhooks with it.
    webhookKey: env.BUNNY_STREAM_WEBHOOK_KEY || '',
    collectionId: env.BUNNY_STREAM_COLLECTION_ID || '',
    apiBase: env.BUNNY_STREAM_API_BASE || 'https://video.bunnycdn.com',
  },
  // Signs reward grants so a game backend can check one without a database call.
  keysReward: derive('reward'),
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
