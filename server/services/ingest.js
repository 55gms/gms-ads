// Hourly batch ingestion. A batch is validated as a whole, then added to
// stats_hourly in one transaction. Replays of an accepted batchId change
// nothing and return the original result.

import { hostMatchesAny } from '../../shared/selection.js';
import { isUuid } from '../../shared/validators.js';
import { query, tx } from '../db/pool.js';

const HOUR = 60 * 60 * 1000;
const MAX_ROWS = 200_000;
const MAX_COUNT = 10_000_000;
const MAX_REPORTED_ERRORS = 100;
const CHUNK = 5000;

export class BatchRejected extends Error {
  constructor(message, details) {
    super(message);
    this.status = 422;
    this.code = 'batch_rejected';
    this.expose = true;
    this.details = details;
  }
}

const result = (row, replayed) => ({
  batchId: row.batch_id,
  status: row.status,
  rows: row.row_count,
  impressions: row.impressions,
  clicks: row.clicks,
  receivedAt: row.received_at.toISOString(),
  replayed,
});

const validCount = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_COUNT;

function validateEnvelope(body, siteKey) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: ['Body must be a JSON object'] };
  const start = typeof body.periodStart === 'string' ? Date.parse(body.periodStart) : NaN;
  const end = typeof body.periodEnd === 'string' ? Date.parse(body.periodEnd) : NaN;
  if (Number.isNaN(start)) errors.push('periodStart must be an ISO timestamp');
  if (Number.isNaN(end)) errors.push('periodEnd must be an ISO timestamp');
  if (!Number.isNaN(start) && !Number.isNaN(end) && end <= start) errors.push('periodEnd must be after periodStart');
  if (body.siteKeyId != null && body.siteKeyId !== siteKey.id) errors.push('siteKeyId does not match the API key used');
  if (!Array.isArray(body.rows)) errors.push('rows must be an array');
  else if (body.rows.length > MAX_ROWS) errors.push(`rows must contain at most ${MAX_ROWS} entries`);
  return { errors, start, end };
}

async function validateRows(rows, { start, end, siteKey, now }) {
  const [campaigns, creatives, domains] = await Promise.all([
    query('SELECT id FROM campaigns'),
    query('SELECT id FROM creatives'),
    query('SELECT hostname FROM domains'),
  ]);
  const campaignIds = new Set(campaigns.rows.map((r) => r.id));
  const creativeIds = new Set(creatives.rows.map((r) => r.id));
  const exact = new Set();
  const wildcards = [];
  for (const { hostname } of domains.rows) {
    if (hostname.startsWith('*.')) wildcards.push(hostname);
    else exact.add(hostname);
  }
  const domainCache = new Map();
  const domainOk = (host) => {
    let ok = domainCache.get(host);
    if (ok === undefined) {
      const registered = exact.has(host) || hostMatchesAny(wildcards, host);
      const permitted = !siteKey.allowedDomains || hostMatchesAny(siteKey.allowedDomains, host);
      ok = registered ? (permitted ? true : 'domain is not allowed for this API key') : 'domain is not registered';
      domainCache.set(host, ok);
    }
    return ok;
  };

  const bad = [];
  let badCount = 0;
  const merged = new Map();
  rows.forEach((row, index) => {
    const problems = [];
    if (!row || typeof row !== 'object') problems.push('row must be an object');
    else {
      const hour = typeof row.hour === 'string' ? Date.parse(row.hour) : NaN;
      if (Number.isNaN(hour)) problems.push('hour must be an ISO timestamp');
      else if (hour % HOUR !== 0) problems.push('hour must be aligned to the hour');
      else if (hour < start || hour >= end) problems.push('hour is outside the batch period');
      else if (hour > now) problems.push('hour is in the future');
      if (!isUuid(row.campaignId) || !campaignIds.has(row.campaignId)) problems.push('unknown campaign');
      if (!isUuid(row.creativeId) || !creativeIds.has(row.creativeId)) problems.push('unknown creative');
      if (typeof row.domain !== 'string' || row.domain.length > 253) problems.push('domain must be a hostname');
      else {
        const ok = domainOk(row.domain.toLowerCase());
        if (ok !== true) problems.push(ok);
      }
      if (!validCount(row.impressions)) problems.push('impressions must be a whole number from 0 to 10,000,000');
      if (!validCount(row.clicks)) problems.push('clicks must be a whole number from 0 to 10,000,000');
      if (!problems.length) {
        const iso = new Date(hour).toISOString();
        const key = `${row.campaignId}|${row.creativeId}|${row.domain.toLowerCase()}|${iso}`;
        const current = merged.get(key);
        // The same key twice in one batch is summed; one statement cannot
        // upsert the same row twice.
        if (current) {
          current.impressions += row.impressions;
          current.clicks += row.clicks;
        } else {
          merged.set(key, {
            campaignId: row.campaignId,
            creativeId: row.creativeId,
            domain: row.domain.toLowerCase(),
            hour: iso,
            impressions: row.impressions,
            clicks: row.clicks,
          });
        }
      }
    }
    if (problems.length) {
      badCount += 1;
      if (bad.length < MAX_REPORTED_ERRORS) bad.push({ index, errors: problems });
    }
  });
  return { bad, badCount, rows: [...merged.values()] };
}

async function recordRejection(body, siteKey, details) {
  if (!isUuid(body?.batchId)) return;
  const date = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
  await query(
    `INSERT INTO ingest_batches (batch_id, site_key_id, period_start, period_end, row_count, status, errors)
     VALUES ($1, $2, $3, $4, $5, 'rejected', $6)
     ON CONFLICT (batch_id) DO UPDATE SET received_at = now(), errors = EXCLUDED.errors, row_count = EXCLUDED.row_count
       WHERE ingest_batches.status = 'rejected'`,
    [body.batchId, siteKey.id, date(body.periodStart), date(body.periodEnd), Array.isArray(body.rows) ? body.rows.length : 0, JSON.stringify(details)]
  );
}

export async function ingestBatch(body, siteKey, now = Date.now()) {
  if (!isUuid(body?.batchId)) throw new BatchRejected('batchId must be a UUID', { errors: ['batchId must be a UUID'] });

  const prior = await query("SELECT * FROM ingest_batches WHERE batch_id = $1 AND status = 'accepted'", [body.batchId]);
  if (prior.rows[0]) return result(prior.rows[0], true);

  const envelope = validateEnvelope(body, siteKey);
  if (envelope.errors.length) {
    const details = { errors: envelope.errors };
    await recordRejection(body, siteKey, details);
    throw new BatchRejected('Batch is malformed', details);
  }
  const checked = await validateRows(body.rows, { start: envelope.start, end: envelope.end, siteKey, now });
  if (checked.badCount) {
    const details = { badRowCount: checked.badCount, badRows: checked.bad };
    await recordRejection(body, siteKey, details);
    throw new BatchRejected(`Batch rejected: ${checked.badCount} of ${body.rows.length} rows are invalid`, details);
  }

  let impressions = 0;
  let clicks = 0;
  for (const row of checked.rows) {
    impressions += row.impressions;
    clicks += row.clicks;
  }

  return tx(async (db) => {
    // Claims the batchId. A concurrent or repeated delivery finds the
    // accepted row and returns it without touching the stats.
    const claimed = await db.query(
      `INSERT INTO ingest_batches (batch_id, site_key_id, period_start, period_end, row_count, impressions, clicks, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'accepted')
       ON CONFLICT (batch_id) DO UPDATE SET
         site_key_id = EXCLUDED.site_key_id, period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
         row_count = EXCLUDED.row_count, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
         status = 'accepted', errors = NULL, received_at = now()
       WHERE ingest_batches.status = 'rejected'
       RETURNING *`,
      [body.batchId, siteKey.id, new Date(envelope.start), new Date(envelope.end), checked.rows.length, impressions, clicks]
    );
    if (!claimed.rows[0]) {
      const existing = await db.query('SELECT * FROM ingest_batches WHERE batch_id = $1', [body.batchId]);
      return result(existing.rows[0], true);
    }
    for (let i = 0; i < checked.rows.length; i += CHUNK) {
      const chunk = checked.rows.slice(i, i + CHUNK);
      await db.query(
        `INSERT INTO stats_hourly (campaign_id, creative_id, domain, hour, impressions, clicks)
         SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::timestamptz[], $5::bigint[], $6::bigint[])
         ON CONFLICT (campaign_id, creative_id, domain, hour) DO UPDATE SET
           impressions = stats_hourly.impressions + EXCLUDED.impressions,
           clicks = stats_hourly.clicks + EXCLUDED.clicks`,
        [
          chunk.map((r) => r.campaignId),
          chunk.map((r) => r.creativeId),
          chunk.map((r) => r.domain),
          chunk.map((r) => r.hour),
          chunk.map((r) => r.impressions),
          chunk.map((r) => r.clicks),
        ]
      );
    }
    return result(claimed.rows[0], false);
  });
}

export const pruneIngestBatches = () => query("DELETE FROM ingest_batches WHERE received_at < now() - interval '90 days'");
