// External ad providers. Each row holds public configuration only: the
// AdSense publisher ID and a VAST tag URL are visible to any browser that
// runs them anyway. No provider needs a server-side secret today; one that
// does should read it from the environment, never from this table.

import * as v from '../../../shared/validators.js';
import { query } from '../../db/pool.js';
import { HttpError } from '../../middleware/auth.js';
import { invalidateVideoCache } from './sessions.js';

// What each provider type can actually do. The dashboard shows these, and
// formats outside a type's capabilities cannot be switched on.
export const CAPABILITIES = {
  first_party: {
    formats: ['video_embedded', 'video_fullscreen', 'video_rewarded'],
    rewarded: true,
    userInitiated: true,
    serverVerifiedReward: true,
    reliableCompletion: true,
    configurableSkip: true,
    note: 'Campaigns from this dashboard. Completion is checked against server time.',
  },
  google_h5: {
    formats: ['video_fullscreen', 'video_rewarded'],
    rewarded: true,
    userInitiated: true,
    serverVerifiedReward: false,
    reliableCompletion: true,
    configurableSkip: false,
    display: true,
    note: 'Runs only on the sites listed here. With a display slot set, Google fills every banner slot on those sites instead of campaigns. Video uses the Ad Placement API (adBreak), which needs separate H5 Games Ads approval: interstitials only at natural breaks, Google decides skipping and frequency, and rewards rely on adViewed in the browser, which cannot be verified server-side.',
  },
  vast: {
    formats: ['video_embedded', 'video_fullscreen', 'video_rewarded'],
    rewarded: true,
    userInitiated: true,
    serverVerifiedReward: false,
    reliableCompletion: false,
    configurableSkip: false,
    note: "A VAST 2-4 linear tag played in the 55GMS player. Skip follows the ad's skipoffset. Only use rewarded if the demand partner allows it. Tracking pixels are fired as given and never altered.",
  },
};

const MAX_PROVIDER_DOMAINS = 200;

// Accepts an array or pasted text, one hostname pattern per line or comma.
function readDomains(raw) {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : [];
  const out = [];
  for (const part of parts) {
    if (part === '') continue;
    const host = v.cleanHostname(part);
    if (!host) v.fail('domains', `Not a hostname: ${String(part).slice(0, 60)}`);
    if (!out.includes(host)) out.push(host);
  }
  if (out.length > MAX_PROVIDER_DOMAINS) v.fail('domains', `At most ${MAX_PROVIDER_DOMAINS} sites`);
  return out;
}

function readConfig(type, raw = {}) {
  if (type === 'google_h5') {
    const client = v.str(raw, 'client', { required: false, max: 40 });
    if (client && !/^ca-pub-\d{10,20}$/.test(client)) v.fail('client', 'Use the publisher ID, such as ca-pub-1234567890123456');
    const frequencyHint = v.str(raw, 'frequencyHint', { required: false, max: 8 }) || '30s';
    if (!/^\d{1,4}s$/.test(frequencyHint)) v.fail('frequencyHint', 'Use seconds, such as 30s');
    const channel = v.str(raw, 'channel', { required: false, max: 20 });
    if (channel && !/^\d+$/.test(channel)) v.fail('channel', 'Channel IDs are numbers');
    const displaySlot = v.str(raw, 'displaySlot', { required: false, max: 20 });
    if (displaySlot && !/^\d{6,20}$/.test(displaySlot)) v.fail('displaySlot', 'Use the data-ad-slot number from the AdSense unit');
    return { client, testMode: raw.testMode !== false, frequencyHint, channel, displaySlot, domains: readDomains(raw.domains) };
  }
  if (type === 'vast') {
    const tagUrl = v.httpsUrl(raw, 'tagUrl', { required: false });
    return { tagUrl };
  }
  return {};
}

const isConfigured = (type, cfg) => (type === 'google_h5' ? Boolean(cfg.client) : type === 'vast' ? Boolean(cfg.tagUrl) : true);

const present = (row) => ({
  id: row.id,
  type: row.type,
  name: row.name,
  enabled: row.enabled,
  formats: row.formats,
  priority: row.priority,
  config: row.config,
  status: row.status,
  statusMessage: row.status_message,
  updatedAt: row.updated_at,
  capabilities: CAPABILITIES[row.type],
});

export async function listProviders() {
  const { rows } = await query('SELECT * FROM ad_providers ORDER BY priority, id');
  return rows.map(present);
}

export async function updateProvider(id, body) {
  const { rows } = await query('SELECT * FROM ad_providers WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'not_found', 'Provider not found');
  const caps = CAPABILITIES[row.type];
  const next = { enabled: row.enabled, formats: row.formats, priority: row.priority, config: row.config };
  if (body.enabled !== undefined) next.enabled = v.bool(body, 'enabled');
  if (body.priority !== undefined) next.priority = v.int(body, 'priority', { min: 1, max: 1000 });
  if (body.formats !== undefined) {
    if (!Array.isArray(body.formats) || !body.formats.every((f) => caps.formats.includes(f))) v.fail('formats', `Supported formats: ${caps.formats.join(', ')}`);
    next.formats = [...new Set(body.formats)];
  }
  if (body.config !== undefined) next.config = readConfig(row.type, body.config && typeof body.config === 'object' ? body.config : {});
  const configured = isConfigured(row.type, next.config);
  if (next.enabled && !configured) v.fail('enabled', 'Finish the configuration before enabling this provider');
  const status = configured ? 'ok' : 'unconfigured';
  const updated = await query(
    `UPDATE ad_providers SET enabled = $2, formats = $3, priority = $4, config = $5, status = $6, status_message = NULL, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, next.enabled, next.formats, next.priority, JSON.stringify(next.config), status]
  );
  invalidateVideoCache();
  return present(updated.rows[0]);
}

// What browsers need to run the enabled providers. Served through the edge.
export async function publicProviderConfig() {
  const { rows } = await query("SELECT id, type, formats, priority, config FROM ad_providers WHERE enabled AND status = 'ok' ORDER BY priority, id");
  return rows.map((r) => ({ id: r.id, type: r.type, formats: r.formats, priority: r.priority, config: r.config }));
}

// The display unit the edge hands to ads.js on approved sites, or null.
export async function googleDisplayConfig() {
  const { rows } = await query("SELECT config FROM ad_providers WHERE type = 'google_h5' AND enabled AND status = 'ok' ORDER BY priority, id LIMIT 1");
  const cfg = rows[0]?.config;
  if (!cfg?.client || !cfg.displaySlot || !cfg.domains?.length) return null;
  return { client: cfg.client, slot: cfg.displaySlot, domains: cfg.domains };
}
