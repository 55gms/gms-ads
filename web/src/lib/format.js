const integer = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dateYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const hourOnly = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });

export const num = (n) => integer.format(Math.round(n || 0));
export const short = (n) => ((n || 0) < 10_000 ? integer.format(Math.round(n || 0)) : compact.format(n));
export const ctr = (clicks, impressions) => (impressions > 0 ? (clicks / impressions) * 100 : 0);
export const pct = (value, digits = 2) => `${(value || 0).toFixed(digits)}%`;

// "728x90" -> "728×90" with a true multiplication sign.
export const sizeLabel = (size) => String(size || '').replace(/x/i, '×');

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const absoluteTime = (value) => (value ? dateTime.format(new Date(value)) : '');
export const shortDate = (value) => dateOnly.format(new Date(value));
export const longDate = (value) => dateYear.format(new Date(value));
export const clock = (value) => timeOnly.format(new Date(value));
export const hourLabel = (value) => hourOnly.format(new Date(value));

export function relativeTime(value, now = Date.now()) {
  if (!value) return 'Never';
  const seconds = Math.round((now - new Date(value).getTime()) / 1000);
  if (seconds < 0) return 'Just now';
  if (seconds < 45) return 'Just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 86_400 * 30) return `${Math.round(seconds / 86_400)}d ago`;
  return longDate(value);
}

// Date ranges use an en dash: "Oct 1 – Oct 7".
export const rangeLabel = (from, to) => `${shortDate(from)} – ${shortDate(new Date(new Date(to).getTime() - 1))}`;

// Percentage change between two periods, or null when there is no baseline.
export function delta(current, previous) {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}

// datetime-local <-> ISO helpers, in the admin's local timezone.
export function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

export const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// Subsequence match with a score; lower is better, null means no match.
export function fuzzy(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const at = t.indexOf(q);
  if (at !== -1) return at;
  let score = 100;
  let from = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, from);
    if (found === -1) return null;
    score += found - from;
    from = found + 1;
  }
  return score;
}
