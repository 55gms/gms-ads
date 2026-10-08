// Builds the manifest the edge serves from: active campaigns, their
// creatives and targeting, and the budget each edge instance may still spend.

import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { imageUrlFor } from './creatives.js';

const INSTANCE_WINDOW = '5 minutes';

// Registers the calling instance and returns how many are currently active.
// Budgets are global, so every key's instances count.
export async function touchInstance(siteKeyId, instanceId) {
  if (instanceId) {
    await query(
      `INSERT INTO edge_instances (site_key_id, instance_id) VALUES ($1, $2)
       ON CONFLICT (site_key_id, instance_id) DO UPDATE SET last_seen_at = now()`,
      [siteKeyId, instanceId.slice(0, 100)]
    );
  }
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM edge_instances e JOIN site_keys k ON k.id = e.site_key_id
      WHERE k.revoked_at IS NULL AND e.last_seen_at > now() - interval '${INSTANCE_WINDOW}'`
  );
  return Math.max(1, rows[0].n);
}

export async function buildManifest({ siteKey, instances = 1 }) {
  const [campaigns, creatives, targets, usage, domains] = await Promise.all([
    query(
      `SELECT id, name, weight, starts_at, ends_at, click_url, targeting_mode, total_impression_cap, daily_impression_cap
         FROM campaigns WHERE status = 'active' AND (ends_at IS NULL OR ends_at > now()) ORDER BY id`
    ),
    query(
      `SELECT cr.*, s.width AS size_width, s.height AS size_height
         FROM creatives cr JOIN ad_sizes s ON s.id = cr.size_id JOIN campaigns c ON c.id = cr.campaign_id
        WHERE cr.status = 'active' AND c.status = 'active' ORDER BY cr.id`
    ),
    query(
      `SELECT cd.campaign_id, d.hostname FROM campaign_domains cd JOIN domains d ON d.id = cd.domain_id
        ORDER BY cd.campaign_id, d.hostname`
    ),
    query(
      `SELECT s.campaign_id, sum(s.impressions) AS total,
              sum(s.impressions) FILTER (WHERE s.hour >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today
         FROM stats_hourly s JOIN campaigns c ON c.id = s.campaign_id
        WHERE c.status = 'active' AND (c.total_impression_cap IS NOT NULL OR c.daily_impression_cap IS NOT NULL)
        GROUP BY s.campaign_id`
    ),
    query('SELECT hostname FROM domains WHERE NOT enabled ORDER BY hostname'),
  ]);

  const used = new Map(usage.rows.map((r) => [r.campaign_id, r]));
  const share = (cap, spent) => (cap == null ? null : Math.max(0, Math.floor((cap - (spent || 0)) / instances)));
  const allowed = siteKey.allowedDomains;

  const body = {
    siteKeyId: siteKey.id,
    instances,
    // Ads serve on every host except the ones switched off here.
    blockedDomains: domains.rows.map((d) => d.hostname),
    // Patterns this API key is limited to; null means any host.
    allowedDomains: allowed && allowed.length ? allowed : null,
    campaigns: campaigns.rows
      .map((c) => ({
        id: c.id,
        name: c.name,
        weight: c.weight,
        startsAt: c.starts_at ? c.starts_at.toISOString() : null,
        endsAt: c.ends_at ? c.ends_at.toISOString() : null,
        clickUrl: c.click_url,
        targeting: {
          mode: c.targeting_mode,
          domains: targets.rows.filter((t) => t.campaign_id === c.id).map((t) => t.hostname),
        },
        // Remaining impressions for this instance; null means uncapped.
        // Daily budgets reset at 00:00 UTC.
        budget: {
          total: share(c.total_impression_cap, used.get(c.id)?.total),
          daily: share(c.daily_impression_cap, used.get(c.id)?.today),
        },
        creatives: creatives.rows
          .filter((cr) => cr.campaign_id === c.id)
          .map((cr) => ({
            id: cr.id,
            size: `${cr.size_width}x${cr.size_height}`,
            width: cr.width,
            height: cr.height,
            imageUrl: imageUrlFor(cr),
            alt: cr.alt_text,
          })),
      }))
      .filter((c) => c.creatives.length > 0),
  };

  // The version covers everything except the timestamp, so an unchanged
  // manifest keeps its ETag and answers 304.
  const version = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32);
  return { version, generatedAt: new Date().toISOString(), ...body };
}
