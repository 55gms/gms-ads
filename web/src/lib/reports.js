import { api, get } from './api.js';
import { timezone } from './format.js';
import { buckets, rangeParams, resolveRange } from './range.js';

const FILTERS = ['campaignId', 'creativeId', 'sizeId', 'domain'];

export function readFilters(searchParams) {
  const out = {};
  for (const key of FILTERS) if (searchParams.get(key)) out[key] = searchParams.get(key);
  return out;
}

// Fills every bucket in the range (missing ones are zero) and flags the
// bucket that is still collecting data.
export function toPoints(resolved, series, now = Date.now()) {
  const minute = (t) => Math.round(new Date(t).getTime() / 60_000);
  const byTime = new Map(series.points.map((p) => [minute(p.t), p]));
  const step = resolved.granularity === 'hour' ? 3_600_000 : 86_400_000;
  return buckets(resolved).map((t) => {
    const hit = byTime.get(minute(t));
    return { t, impressions: hit?.impressions || 0, clicks: hit?.clicks || 0, incomplete: t.getTime() + step > now };
  });
}

export async function loadReport(range, filters = {}) {
  const resolved = resolveRange(range);
  const params = { ...rangeParams(resolved), ...filters, tz: timezone() };
  const [summary, series] = await Promise.all([get(api('/stats/summary'), params), get(api('/stats/timeseries'), { ...params, granularity: resolved.granularity })]);
  return { resolved, params, summary, points: toPoints(resolved, series) };
}
