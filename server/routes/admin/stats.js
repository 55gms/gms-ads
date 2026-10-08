import { Router } from 'express';
import { isUuid } from '../../../shared/validators.js';
import { query } from '../../db/pool.js';
import { HttpError, asyncHandler } from '../../middleware/auth.js';

const DAY = 24 * 60 * 60 * 1000;
const TZ_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

// Reads the shared report filters and returns a WHERE clause over
// stats_hourly (aliased s) with its parameters.
function filters(q, { shiftMs = 0 } = {}) {
  const to = q.to ? Date.parse(q.to) : Date.now();
  const from = q.from ? Date.parse(q.from) : to - 7 * DAY;
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) throw new HttpError(400, 'bad_range', 'Pick a valid date range');
  if (to - from > 800 * DAY) throw new HttpError(400, 'bad_range', 'Date range is too long');
  const params = [new Date(from - shiftMs), new Date(to - shiftMs)];
  const where = ['s.hour >= $1', 's.hour < $2'];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (isUuid(q.campaignId)) add('s.campaign_id = ?', q.campaignId);
  if (isUuid(q.creativeId)) add('s.creative_id = ?', q.creativeId);
  if (isUuid(q.sizeId)) add('s.creative_id IN (SELECT id FROM creatives WHERE size_id = ?)', q.sizeId);
  if (typeof q.domain === 'string' && q.domain) add('s.domain = ?', q.domain.toLowerCase().slice(0, 253));
  const tz = typeof q.tz === 'string' && TZ_RE.test(q.tz) ? q.tz : 'UTC';
  return { where: where.join(' AND '), params, from, to, tz };
}

const totals = async (f) =>
  (await query(`SELECT coalesce(sum(impressions), 0) AS impressions, coalesce(sum(clicks), 0) AS clicks FROM stats_hourly s WHERE ${f.where}`, f.params)).rows[0];

const csvCell = (value) => {
  let s = String(value ?? '');
  // Neutralise spreadsheet formulas in exported text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const statsRouter = Router();

// Totals for the range and for the period of equal length just before it.
statsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const current = filters(req.query);
    const previous = filters(req.query, { shiftMs: current.to - current.from });
    const [now, before, active, fresh] = await Promise.all([
      totals(current),
      totals(previous),
      query(
        `SELECT count(*)::int AS n FROM campaigns
          WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())`
      ),
      query("SELECT max(received_at) AS last_batch_at FROM ingest_batches WHERE status = 'accepted'"),
    ]);
    res.json({
      current: now,
      previous: before,
      range: { from: new Date(current.from), to: new Date(current.to) },
      previousRange: { from: new Date(previous.params[0]), to: new Date(previous.params[1]) },
      activeCampaigns: active.rows[0].n,
      lastBatchAt: fresh.rows[0].last_batch_at,
    });
  })
);

statsRouter.get(
  '/timeseries',
  asyncHandler(async (req, res) => {
    const f = filters(req.query);
    const unit = req.query.granularity === 'hour' ? 'hour' : 'day';
    f.params.push(f.tz);
    const tz = `$${f.params.length}`;
    // Buckets follow the viewer's timezone so "today" means their today.
    const { rows } = await query(
      `SELECT date_trunc('${unit}', s.hour AT TIME ZONE ${tz}) AT TIME ZONE ${tz} AS t,
              sum(impressions) AS impressions, sum(clicks) AS clicks
         FROM stats_hourly s WHERE ${f.where} GROUP BY 1 ORDER BY 1`,
      f.params
    );
    res.json({ granularity: unit, points: rows, range: { from: new Date(f.from), to: new Date(f.to) } });
  })
);

const DOMAIN_SORTS = {
  domain: 'domain',
  impressions: 'impressions',
  clicks: 'clicks',
  ctr: 'CASE WHEN sum(impressions) > 0 THEN sum(clicks)::float / sum(impressions) ELSE 0 END',
};

statsRouter.get(
  '/domains',
  asyncHandler(async (req, res) => {
    const f = filters(req.query);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(5, Number.parseInt(req.query.pageSize, 10) || 25));
    const sort = DOMAIN_SORTS[req.query.sort] || DOMAIN_SORTS.impressions;
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      f.params.push(`%${req.query.search.trim().toLowerCase().slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`);
      f.where += ` AND s.domain LIKE $${f.params.length}`;
    }
    const [count, list] = await Promise.all([
      query(`SELECT count(DISTINCT s.domain)::int AS n FROM stats_hourly s WHERE ${f.where}`, f.params),
      query(
        `SELECT s.domain, sum(impressions) AS impressions, sum(clicks) AS clicks
           FROM stats_hourly s WHERE ${f.where}
          GROUP BY s.domain ORDER BY ${sort} ${dir}, s.domain ASC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        f.params
      ),
    ]);
    res.json({ rows: list.rows, total: count.rows[0].n, page, pageSize });
  })
);

statsRouter.get(
  '/campaigns',
  asyncHandler(async (req, res) => {
    const f = filters(req.query);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 5));
    const { rows } = await query(
      `SELECT s.campaign_id, coalesce(c.name, 'Deleted campaign') AS name, c.status,
              sum(s.impressions) AS impressions, sum(s.clicks) AS clicks
         FROM stats_hourly s LEFT JOIN campaigns c ON c.id = s.campaign_id
        WHERE ${f.where} GROUP BY s.campaign_id, c.name, c.status
        ORDER BY impressions DESC LIMIT ${limit}`,
      f.params
    );
    res.json({ rows });
  })
);

statsRouter.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const f = filters(req.query);
    f.params.push(f.tz);
    const tz = `$${f.params.length}`;
    const { rows } = await query(
      `SELECT to_char(date_trunc('day', s.hour AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS day, s.domain,
              coalesce(c.name, 'Deleted campaign') AS campaign,
              sum(s.impressions) AS impressions, sum(s.clicks) AS clicks
         FROM stats_hourly s LEFT JOIN campaigns c ON c.id = s.campaign_id
        WHERE ${f.where} GROUP BY 1, s.domain, c.name ORDER BY 1, s.domain, c.name
        LIMIT 500000`,
      f.params
    );
    const lines = ['date,domain,campaign,impressions,clicks,ctr'];
    for (const r of rows) {
      const ctr = r.impressions > 0 ? ((r.clicks / r.impressions) * 100).toFixed(2) : '0.00';
      lines.push([r.day, r.domain, r.campaign, r.impressions, r.clicks, `${ctr}%`].map(csvCell).join(','));
    }
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="55gms-ads-report.csv"' });
    res.send(`${lines.join('\n')}\n`);
  })
);

// Progress through first-run setup, shown on the Overview page.
statsRouter.get(
  '/setup',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT (SELECT count(*)::int FROM domains) AS domains,
              (SELECT count(*)::int FROM campaigns) AS campaigns,
              (SELECT count(*)::int FROM site_keys WHERE revoked_at IS NULL) AS keys,
              (SELECT count(*)::int FROM ingest_batches WHERE status = 'accepted') AS batches`
    );
    res.json(rows[0]);
  })
);
