// Real-time video sessions and reward grants. Unlike image stats, which
// arrive as hourly aggregates, every rewarded decision is made here per
// session, against server time, inside a transaction.
//
// Trust boundary: these functions are reached only through site-key
// authenticated routes, i.e. from the 55GMS edge. The edge decides the viewer
// key and Premium status from its own session; nothing the browser claims
// about Premium is ever forwarded.

import crypto from 'node:crypto';
import { hostMatchesAny, isHostname } from '../../../shared/selection.js';
import { isUuid } from '../../../shared/validators.js';
import { config } from '../../config.js';
import { query, tx } from '../../db/pool.js';
import { HttpError } from '../../middleware/auth.js';
import { playbackFor } from './assets.js';
import { FORMATS, applyEvent, grantDecision, playbackPolicy } from './policy.js';
import { selectVideo } from './selection.js';

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const VIEWER_RE = /^[A-Za-z0-9_-]{16,128}$/;
const CACHE_MS = 30_000;
const EXTERNAL_PROVIDERS = ['google_h5', 'vast'];

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const bad = (message) => new HttpError(400, 'invalid_request', message);

function slug(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !SLUG_RE.test(value)) throw bad(`${field} must be 1-64 letters, digits, or _ . : -`);
  return value;
}

// --- Candidate cache ---------------------------------------------------------

let cache = null;

export function invalidateVideoCache() {
  cache = null;
}

async function loadCandidates() {
  const [campaigns, creatives, targets, usage, blocked, providers] = await Promise.all([
    query(
      `SELECT id, name, weight, starts_at, ends_at, click_url, targeting_mode, total_impression_cap, daily_impression_cap,
              formats, skip_after_seconds, reward_watch_percent, premium_skip_seconds
         FROM campaigns
        WHERE status = 'active' AND (ends_at IS NULL OR ends_at > now())
          AND formats && ARRAY['video_embedded', 'video_fullscreen', 'video_rewarded']::text[]`
    ),
    query(
      `SELECT cr.id, cr.campaign_id, cr.title, a.*
         FROM creatives cr JOIN video_assets a ON a.creative_id = cr.id
        WHERE cr.kind = 'video' AND cr.status = 'active' AND a.status = 'ready' AND cr.campaign_id IS NOT NULL`
    ),
    query('SELECT cd.campaign_id, d.hostname FROM campaign_domains cd JOIN domains d ON d.id = cd.domain_id'),
    // Budgets count viewable image impressions plus video starts.
    query(
      `SELECT campaign_id, sum(n) AS total, sum(n) FILTER (WHERE hour >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today
         FROM (SELECT campaign_id, hour, impressions AS n FROM stats_hourly
               UNION ALL SELECT campaign_id, hour, starts AS n FROM video_stats_hourly WHERE campaign_id IS NOT NULL) u
        GROUP BY campaign_id`
    ),
    query('SELECT hostname FROM domains WHERE NOT enabled'),
    query('SELECT id, type, enabled, formats, priority, config, status FROM ad_providers ORDER BY priority, id'),
  ]);
  const used = new Map(usage.rows.map((r) => [r.campaign_id, r]));
  return {
    at: Date.now(),
    blocked: blocked.rows.map((r) => r.hostname),
    providers: providers.rows,
    // Starts counted since this snapshot, so caps hold between reloads.
    startedSince: new Map(),
    campaigns: campaigns.rows.map((c) => ({
      id: c.id,
      name: c.name,
      weight: c.weight,
      startsAt: c.starts_at?.toISOString() ?? null,
      endsAt: c.ends_at?.toISOString() ?? null,
      clickUrl: c.click_url,
      formats: c.formats,
      policy: { skip_after_seconds: c.skip_after_seconds, reward_watch_percent: c.reward_watch_percent, premium_skip_seconds: c.premium_skip_seconds },
      caps: { total: c.total_impression_cap, daily: c.daily_impression_cap, usedTotal: used.get(c.id)?.total || 0, usedToday: used.get(c.id)?.today || 0 },
      targeting: { mode: c.targeting_mode, domains: targets.rows.filter((t) => t.campaign_id === c.id).map((t) => t.hostname) },
      creatives: creatives.rows.filter((cr) => cr.campaign_id === c.id),
    })),
  };
}

async function candidates() {
  if (!cache || Date.now() - cache.at > CACHE_MS) cache = await loadCandidates();
  return cache;
}

function remainingFor(snapshot) {
  return (campaign) => {
    const extra = snapshot.startedSince.get(campaign.id) || 0;
    let left = Infinity;
    if (campaign.caps.total != null) left = Math.min(left, campaign.caps.total - campaign.caps.usedTotal - extra);
    if (campaign.caps.daily != null) left = Math.min(left, campaign.caps.daily - campaign.caps.usedToday - extra);
    return left;
  };
}

// --- Stats -----------------------------------------------------------------

const STAT_COLUMNS = new Set(['requests', 'fills', 'impressions', 'starts', 'q1', 'midpoints', 'q3', 'completes', 'skips', 'errors', 'clicks', 'rewards']);

export async function bumpStats(db, key, columns) {
  const cols = [...new Set(columns)].filter((c) => STAT_COLUMNS.has(c));
  if (!cols.length) return;
  const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  await db.query(
    `INSERT INTO video_stats_hourly (hour, provider, format, campaign_id, creative_id, game_id, domain, ${cols.join(', ')})
     VALUES ($1, $2, $3, $4, $5, $6, $7, ${cols.map(() => '1').join(', ')})
     ON CONFLICT (hour, provider, format,
       coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
       coalesce(creative_id, '00000000-0000-0000-0000-000000000000'::uuid), game_id, domain)
     DO UPDATE SET ${cols.map((c) => `${c} = video_stats_hourly.${c} + 1`).join(', ')}`,
    [hour, key.provider, key.format, key.campaign_id || null, key.creative_id || null, key.game_id || '', key.domain || '']
  );
}

// --- Sessions ----------------------------------------------------------------

function readRequest(body, siteKey) {
  if (!body || typeof body !== 'object') throw bad('Body must be a JSON object');
  const format = body.format;
  if (!FORMATS.includes(format)) throw bad(`format must be one of ${FORMATS.join(', ')}`);
  const domain = typeof body.domain === 'string' ? body.domain.toLowerCase() : '';
  if (!isHostname(domain)) throw bad('domain must be a hostname');
  if (siteKey.allowedDomains?.length && !hostMatchesAny(siteKey.allowedDomains, domain)) throw new HttpError(403, 'domain_not_allowed', 'Domain is not allowed for this API key');
  const viewer = body.viewer || {};
  if (typeof viewer.key !== 'string' || !VIEWER_RE.test(viewer.key)) throw bad('viewer.key is required');
  const provider = body.provider ?? 'auto';
  if (provider !== 'auto' && !EXTERNAL_PROVIDERS.includes(provider)) throw bad('provider must be auto, google_h5, or vast');
  return {
    format,
    domain,
    provider,
    gameId: slug(body.gameId, 'gameId'),
    placement: slug(body.placement, 'placement'),
    rewardId: slug(body.rewardId, 'rewardId'),
    viewerKey: viewer.key,
    premium: viewer.premium === true,
  };
}

// Embedded slots fill on page view, so they are excluded from both limits;
// the limits are about ads a viewer opens, rewarded ones above all.
async function checkViewerLimits(viewerKey, format) {
  if (format === 'video_embedded') return;
  const { rows } = await query(
    `SELECT count(*)::int AS hour,
            count(*) FILTER (WHERE state IN ('created', 'started') AND expires_at > now())::int AS open
       FROM ad_sessions WHERE viewer_key = $1 AND format <> 'video_embedded' AND created_at > now() - interval '1 hour'`,
    [viewerKey]
  );
  if (rows[0].hour >= config.video.maxSessionsPerHour) throw new HttpError(429, 'rate_limited', 'Too many ads requested. Try again later.');
  if (rows[0].open >= config.video.maxOpenSessions) throw new HttpError(429, 'too_many_open', 'Finish or close the ads already open first.');
}

// Google may only run on sites its AdSense account is approved for, so an
// empty list means nowhere. Other providers are not tied to a site.
function providerServesDomain(provider, domain) {
  if (provider.type !== 'google_h5') return true;
  return hostMatchesAny(provider.config?.domains || [], domain);
}

function enabledProviders(snapshot, format, domain) {
  return snapshot.providers.filter(
    (p) => p.enabled && p.status === 'ok' && p.formats.includes(format) && p.type !== 'first_party' && providerServesDomain(p, domain)
  );
}

const newToken = () => crypto.randomBytes(32).toString('base64url');

async function insertSession(db, fields) {
  const token = newToken();
  const { rows } = await db.query(
    `INSERT INTO ad_sessions (token_hash, provider, format, campaign_id, creative_id, site_key_id, domain, game_id, placement, reward_id,
                              viewer_key, premium, duration_seconds, required_seconds, skip_after_seconds, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now() + make_interval(secs => $16)) RETURNING *`,
    [
      sha256(token),
      fields.provider,
      fields.format,
      fields.campaignId || null,
      fields.creativeId || null,
      fields.siteKeyId,
      fields.domain,
      fields.gameId,
      fields.placement,
      fields.rewardId,
      fields.viewerKey,
      fields.premium,
      fields.duration ?? null,
      fields.required ?? null,
      fields.skipAfter ?? null,
      config.video.sessionTtlSeconds,
    ]
  );
  return { token, session: rows[0] };
}

// Availability without creating a session: is there any first-party fill or
// an enabled provider for this format and domain right now?
export async function availability(body, siteKey) {
  if (!config.video.enabled) return { available: false, firstParty: false, providers: [] };
  const format = FORMATS.includes(body?.format) ? body.format : 'video_rewarded';
  const domain = typeof body?.domain === 'string' ? body.domain.toLowerCase() : '';
  if (!isHostname(domain)) throw bad('domain must be a hostname');
  const snapshot = await candidates();
  if (hostMatchesAny(snapshot.blocked, domain) || (siteKey.allowedDomains?.length && !hostMatchesAny(siteKey.allowedDomains, domain))) {
    return { available: false, firstParty: false, providers: [] };
  }
  const firstParty = Boolean(selectVideo(snapshot.campaigns, { format, domain, remaining: remainingFor(snapshot) }));
  const providers = enabledProviders(snapshot, format, domain).map((p) => p.id);
  return { available: firstParty || providers.length > 0, firstParty, providers };
}

export async function createSession(body, siteKey) {
  if (!config.video.enabled) throw new HttpError(503, 'video_disabled', 'Video ads are switched off');
  const req = readRequest(body, siteKey);
  const snapshot = await candidates();
  const statKey = { provider: req.provider === 'auto' ? 'first_party' : req.provider, format: req.format, game_id: req.gameId, domain: req.domain };
  if (hostMatchesAny(snapshot.blocked, req.domain)) return { fill: false, reason: 'domain_off', fallbacks: [] };
  await checkViewerLimits(req.viewerKey, req.format);

  if (req.provider !== 'auto') {
    // A provider-backed session only records what the provider reports.
    const provider = enabledProviders(snapshot, req.format, req.domain).find((p) => p.id === req.provider);
    if (!provider) throw new HttpError(409, 'provider_unavailable', 'That provider is not enabled for this format');
    return tx(async (db) => {
      const { token, session } = await insertSession(db, { ...req, siteKeyId: siteKey.id });
      await bumpStats(db, statKey, ['requests', 'fills']);
      return { fill: true, token, sessionId: session.id, provider: provider.id, format: req.format, expiresAt: session.expires_at, premium: req.premium, policy: { providerRules: true } };
    });
  }

  const pick = selectVideo(snapshot.campaigns, { format: req.format, domain: req.domain, remaining: remainingFor(snapshot) });
  if (!pick) {
    await bumpStats({ query }, statKey, ['requests']);
    return { fill: false, reason: 'no_fill', fallbacks: enabledProviders(snapshot, req.format, req.domain).map((p) => p.id) };
  }

  const { campaign, creative } = pick;
  const duration = Number(creative.duration_seconds);
  const policy = playbackPolicy({ format: req.format, premium: req.premium, durationSeconds: duration, campaign: campaign.policy });
  const sources = await playbackFor(creative);
  const result = await tx(async (db) => {
    const { token, session } = await insertSession(db, {
      ...req,
      provider: 'first_party',
      siteKeyId: siteKey.id,
      campaignId: campaign.id,
      creativeId: creative.creative_id,
      duration,
      required: policy.requiredSeconds,
      skipAfter: policy.skipAfterSeconds,
    });
    await bumpStats(db, { ...statKey, campaign_id: campaign.id, creative_id: creative.creative_id }, ['requests', 'fills']);
    return { token, session };
  });
  snapshot.startedSince.set(campaign.id, (snapshot.startedSince.get(campaign.id) || 0) + 1);
  return {
    fill: true,
    token: result.token,
    sessionId: result.session.id,
    provider: 'first_party',
    format: req.format,
    expiresAt: result.session.expires_at,
    premium: req.premium,
    ad: {
      advertiser: campaign.name,
      title: creative.title || '',
      durationSeconds: duration,
      width: creative.width,
      height: creative.height,
      poster: sources.poster,
      mp4: sources.mp4,
      hls: sources.hls,
      hasClickThrough: Boolean(campaign.clickUrl),
    },
    policy,
  };
}

async function lockSession(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw new HttpError(404, 'unknown_session', 'Unknown or expired session');
  const { rows } = await db.query('SELECT * FROM ad_sessions WHERE token_hash = $1 FOR UPDATE', [sha256(token)]);
  if (!rows[0]) throw new HttpError(404, 'unknown_session', 'Unknown or expired session');
  return rows[0];
}

const SESSION_COLUMNS = ['state', 'started_at', 'ended_at', 'milestones', 'position_seconds', 'reward_eligible'];

// Applies a list of client events in order, in one transaction. Rejected
// events are reported back but never change state or stats.
export async function recordEvents(body, now = () => Date.now()) {
  const events = Array.isArray(body?.events) ? body.events.slice(0, 12) : [];
  if (!events.length) throw bad('events must be a non-empty array');
  return tx(async (db) => {
    let session = await lockSession(db, body.token);
    const results = [];
    const counts = [];
    for (const raw of events) {
      const event = { type: typeof raw?.type === 'string' ? raw.type : '', position: Number(raw?.position) };
      const outcome = applyEvent(session, event, now());
      results.push(outcome.accept ? { type: event.type, ok: true } : { type: event.type, ok: false, reason: outcome.reason });
      if (!outcome.accept) continue;
      session = { ...session, ...outcome.changes };
      counts.push(...outcome.count);
    }
    const cols = SESSION_COLUMNS.filter((c) => session[c] !== undefined);
    await db.query(`UPDATE ad_sessions SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [session.id, ...cols.map((c) => session[c])]);
    // 'rewards' is counted when a grant is actually minted, not here.
    await bumpStats(db, session, counts.filter((c) => c !== 'rewards'));
    return { state: session.state, rewardEligible: session.reward_eligible, results };
  });
}

// Records the click and returns where it goes. First-party only.
export async function clickSession(body) {
  const result = await recordEvents({ token: body?.token, events: [{ type: 'click' }] });
  const { rows } = await query(
    `SELECT c.click_url FROM ad_sessions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.token_hash = $1`,
    [sha256(String(body.token))]
  );
  if (!rows[0]) throw new HttpError(404, 'no_click', 'This ad has no destination');
  return { url: rows[0].click_url, state: result.state };
}

// --- Grants ------------------------------------------------------------------

export function signGrant(grant) {
  const payload = [grant.id, grant.session_id, grant.game_id || '', grant.reward_id || '', grant.method, new Date(grant.created_at).toISOString()].join('|');
  return crypto.createHmac('sha256', config.keysReward).update(payload).digest('base64url');
}

const presentGrant = (grant, replayed) => ({
  granted: true,
  replayed,
  grant: {
    id: grant.id,
    gameId: grant.game_id,
    rewardId: grant.reward_id,
    method: grant.method,
    issuedAt: new Date(grant.created_at).toISOString(),
    signature: signGrant(grant),
  },
});

// Mints at most one grant per session. The session row is locked and the
// grant has a unique session_id, so concurrent claims, retries, and other
// tabs all get the same grant back.
export async function claimReward(body, now = Date.now()) {
  const idem = typeof body?.idempotencyKey === 'string' ? body.idempotencyKey.slice(0, 100) : null;
  return tx(async (db) => {
    const session = await lockSession(db, body?.token);
    const existing = await db.query('SELECT * FROM reward_grants WHERE session_id = $1', [session.id]);
    if (existing.rows[0]) return presentGrant(existing.rows[0], true);
    const decision = grantDecision(session, now);
    if (!decision.ok) return { granted: false, reason: decision.reason };
    const recent = await db.query("SELECT count(*)::int AS n FROM reward_grants WHERE viewer_key = $1 AND created_at > now() - interval '1 hour'", [session.viewer_key]);
    if (recent.rows[0].n >= config.video.maxGrantsPerHour) return { granted: false, reason: 'rate_limited' };
    const { rows } = await db.query(
      `INSERT INTO reward_grants (session_id, game_id, viewer_key, reward_id, method, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [session.id, session.game_id, session.viewer_key, session.reward_id, decision.method, idem]
    );
    await bumpStats(db, session, ['rewards']);
    return presentGrant(rows[0], false);
  });
}

// For game backends: confirms a grant is genuine and marks it used, once.
export async function redeemGrant(body) {
  if (!isUuid(body?.grantId) || typeof body?.signature !== 'string') throw bad('grantId and signature are required');
  const { rows } = await query('SELECT * FROM reward_grants WHERE id = $1', [body.grantId]);
  const grant = rows[0];
  const expected = grant ? Buffer.from(signGrant(grant)) : Buffer.alloc(43);
  const given = Buffer.from(body.signature);
  if (!grant || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HttpError(404, 'unknown_grant', 'Unknown grant');
  const updated = await query("UPDATE reward_grants SET state = 'redeemed', redeemed_at = now() WHERE id = $1 AND state = 'issued' RETURNING *", [grant.id]);
  if (!updated.rows[0]) return { redeemed: false, reason: grant.state === 'redeemed' ? 'already_redeemed' : grant.state };
  return { redeemed: true, gameId: grant.game_id, rewardId: grant.reward_id, method: grant.method };
}

export const pruneSessions = () => query("DELETE FROM ad_sessions WHERE created_at < now() - interval '90 days'");
