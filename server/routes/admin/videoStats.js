// Video reporting from video_stats_hourly. Rates use their own denominators:
// completion and skip rates are per start, CTR per impression, fill rate per
// request. Provider rows are reported events from that provider's client SDK,
// not money, and are kept apart from first-party campaign rows.

import { Router } from 'express';
import { isUuid } from '../../../shared/validators.js';
import { query } from '../../db/pool.js';
import { HttpError, asyncHandler } from '../../middleware/auth.js';

const DAY = 24 * 60 * 60 * 1000;
const TZ_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
const FORMATS = ['video_embedded', 'video_fullscreen', 'video_rewarded'];
const COUNTS = ['requests', 'fills', 'impressions', 'starts', 'q1', 'midpoints', 'q3', 'completes', 'skips', 'errors', 'clicks', 'rewards'];
const SUMS = COUNTS.map((c) => `coalesce(sum(${c}), 0) AS ${c}`).join(', ');

function filters(q) {
  const to = q.to ? Date.parse(q.to) : Date.now();
  const from = q.from ? Date.parse(q.from) : to - 7 * DAY;
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) throw new HttpError(400, 'bad_range', 'Pick a valid date range');
  if (to - from > 800 * DAY) throw new HttpError(400, 'bad_range', 'Date range is too long');
  const params = [new Date(from), new Date(to)];
  const where = ['s.hour >= $1', 's.hour < $2'];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (isUuid(q.campaignId)) add('s.campaign_id = ?', q.campaignId);
  if (FORMATS.includes(q.format)) add('s.format = ?', q.format);
  if (typeof q.provider === 'string' && /^[a-z0-9_]{2,40}$/.test(q.provider)) add('s.provider = ?', q.provider);
  if (typeof q.gameId === 'string' && q.gameId) add('s.game_id = ?', q.gameId.slice(0, 64));
  const tz = typeof q.tz === 'string' && TZ_RE.test(q.tz) ? q.tz : 'UTC';
  return { where: where.join(' AND '), params, from, to, tz };
}

const GROUPS = {
  provider: { select: 's.provider AS key, s.provider AS label', group: 's.provider' },
  format: { select: 's.format AS key, s.format AS label', group: 's.format' },
  game: { select: "s.game_id AS key, coalesce(nullif(s.game_id, ''), 'Not a game') AS label", group: 's.game_id' },
  campaign: {
    select: "s.campaign_id AS key, coalesce(c.name, CASE WHEN s.campaign_id IS NULL THEN 'No campaign (no fill or provider)' ELSE 'Deleted campaign' END) AS label",
    group: 's.campaign_id, c.name',
    join: 'LEFT JOIN campaigns c ON c.id = s.campaign_id',
  },
};

export const videoStatsRouter = Router();

videoStatsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const f = filters(req.query);
    const { rows } = await query(`SELECT ${SUMS} FROM video_stats_hourly s WHERE ${f.where}`, f.params);
    res.json({ totals: rows[0], range: { from: new Date(f.from), to: new Date(f.to) } });
  })
);

videoStatsRouter.get(
  '/timeseries',
  asyncHandler(async (req, res) => {
    const f = filters(req.query);
    const unit = req.query.granularity === 'hour' ? 'hour' : 'day';
    f.params.push(f.tz);
    const tz = `$${f.params.length}::text`;
    const { rows } = await query(
      `SELECT date_trunc('${unit}', s.hour AT TIME ZONE ${tz}) AT TIME ZONE ${tz} AS t, ${SUMS}
         FROM video_stats_hourly s WHERE ${f.where} GROUP BY 1 ORDER BY 1`,
      f.params
    );
    res.json({ granularity: unit, points: rows });
  })
);

videoStatsRouter.get(
  '/breakdown',
  asyncHandler(async (req, res) => {
    const group = GROUPS[req.query.by] || GROUPS.provider;
    const f = filters(req.query);
    const { rows } = await query(
      `SELECT ${group.select}, ${SUMS} FROM video_stats_hourly s ${group.join || ''}
        WHERE ${f.where} GROUP BY ${group.group} ORDER BY starts DESC, requests DESC LIMIT 100`,
      f.params
    );
    res.json({ by: req.query.by in GROUPS ? req.query.by : 'provider', rows });
  })
);
