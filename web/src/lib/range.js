// Date ranges for reports, kept in the URL as ?range=7d or
// ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD (local dates, inclusive).

import { rangeLabel } from './format.js';

export const PRESETS = [
  { value: 'today', label: 'Today', days: 1 },
  { value: '7d', label: 'Last 7 days', short: '7d', days: 7 },
  { value: '30d', label: 'Last 30 days', short: '30d', days: 30 },
  { value: '90d', label: 'Last 90 days', short: '90d', days: 90 },
];

const HOUR = 3_600_000;
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const parseLocalDate = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
export const toDateInput = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function readRange(searchParams, fallback = '7d') {
  const preset = searchParams.get('range') || fallback;
  if (preset === 'custom') return { preset, from: searchParams.get('from') || '', to: searchParams.get('to') || '' };
  return { preset: PRESETS.some((p) => p.value === preset) ? preset : fallback };
}

export function writeRange(searchParams, range) {
  const next = new URLSearchParams(searchParams);
  next.set('range', range.preset);
  next.delete('from');
  next.delete('to');
  next.delete('page');
  if (range.preset === 'custom') {
    next.set('from', range.from);
    next.set('to', range.to);
  }
  return next;
}

// Resolves a range to concrete instants. `to` is the end of the current hour
// so repeated loads within the hour share a cache key.
export function resolveRange(range, now = new Date()) {
  const endOfHour = new Date(Math.ceil((now.getTime() + 1) / HOUR) * HOUR);
  if (range.preset === 'custom') {
    const from = parseLocalDate(range.from);
    const last = parseLocalDate(range.to);
    if (from && last && last >= from) {
      const to = new Date(Math.min(addDays(last, 1).getTime(), endOfHour.getTime()));
      const days = Math.round((addDays(last, 1) - from) / 86_400_000);
      return { from, to, granularity: days <= 2 ? 'hour' : 'day', label: rangeLabel(from, addDays(last, 1)), days };
    }
  }
  const preset = PRESETS.find((p) => p.value === range.preset) || PRESETS[1];
  const from = addDays(startOfDay(now), -(preset.days - 1));
  return { from, to: endOfHour, granularity: preset.days === 1 ? 'hour' : 'day', label: preset.label, days: preset.days };
}

export const rangeParams = (resolved) => ({ from: resolved.from.toISOString(), to: resolved.to.toISOString() });

// Every bucket start between from and to, so charts can show gaps as zero.
export function buckets(resolved) {
  const out = [];
  if (resolved.granularity === 'hour') {
    for (let t = resolved.from.getTime(); t < resolved.to.getTime(); t += HOUR) out.push(new Date(t));
  } else {
    for (let d = startOfDay(resolved.from); d < resolved.to; d = addDays(d, 1)) out.push(d);
  }
  return out;
}
