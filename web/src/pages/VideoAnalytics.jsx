import { Film, X } from 'lucide-react';
import { Link, useLoaderData, useNavigation, useSearchParams } from 'react-router';
import { api, get } from '../lib/api.js';
import { FORMAT_LABELS } from '../lib/campaign.js';
import { cx } from '../lib/cx.js';
import { num, pct, short, timezone } from '../lib/format.js';
import { buckets, rangeParams, readRange, resolveRange, writeRange } from '../lib/range.js';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { LineChart } from '../ui/Chart.jsx';
import { DateRangePicker } from '../ui/DateRangePicker.jsx';
import { Select } from '../ui/Field.jsx';
import { Card, EmptyState, PageHeader, StatCard } from '../ui/Misc.jsx';
import { Segmented } from '../ui/Tabs.jsx';
import { Table } from '../ui/Table.jsx';

const FILTERS = ['campaignId', 'format', 'provider', 'gameId'];
const SERIES = [
  { key: 'starts', label: 'Starts', color: 'var(--ds-blue)' },
  { key: 'completes', label: 'Completions', color: 'var(--ds-purple)' },
];
const COMPLETION = { label: 'Completion rate', num: 'completes', den: 'starts' };
const BY = [
  { value: 'provider', label: 'Provider' },
  { value: 'campaign', label: 'Campaign' },
  { value: 'format', label: 'Format' },
  { value: 'game', label: 'Game' },
];
const PROVIDER_LABELS = { first_party: '55GMS campaigns', google_h5: 'Google H5 Games Ads', vast: 'VAST tag' };

// Each rate over the denominator its event actually has.
const rate = (n, d) => (d > 0 ? (n / d) * 100 : 0);

export async function videoAnalyticsLoader({ request }) {
  const sp = new URL(request.url).searchParams;
  const range = readRange(sp, '7d');
  const resolved = resolveRange(range);
  const filters = Object.fromEntries(FILTERS.filter((k) => sp.get(k)).map((k) => [k, sp.get(k)]));
  const by = BY.some((b) => b.value === sp.get('by')) ? sp.get('by') : 'provider';
  const params = { ...rangeParams(resolved), ...filters, tz: timezone() };
  const [summary, series, breakdown, campaigns] = await Promise.all([
    get(api('/stats/video/summary'), params),
    get(api('/stats/video/timeseries'), { ...params, granularity: resolved.granularity }),
    get(api('/stats/video/breakdown'), { ...params, by }),
    get(api('/campaigns')),
  ]);
  const minute = (t) => Math.round(new Date(t).getTime() / 60_000);
  const byTime = new Map(series.points.map((p) => [minute(p.t), p]));
  const step = resolved.granularity === 'hour' ? 3_600_000 : 86_400_000;
  const points = buckets(resolved).map((t) => {
    const hit = byTime.get(minute(t));
    return { t, starts: hit?.starts || 0, completes: hit?.completes || 0, incomplete: t.getTime() + step > Date.now() };
  });
  return { range, resolved, filters, by, totals: summary.totals, points, rows: breakdown.rows, campaigns: campaigns.campaigns.filter((c) => c.formats.some((f) => f.startsWith('video'))) };
}

export function AnalyticsTabs({ active }) {
  return (
    <nav aria-label="Report" className="mb-6 inline-flex rounded-sm bg-gray-100 p-0.5">
      {[
        { to: '/analytics', label: 'Display', key: 'display' },
        { to: '/analytics/video', label: 'Video', key: 'video' },
      ].map((tab) => (
        <Link
          key={tab.key}
          to={tab.to}
          aria-current={active === tab.key ? 'page' : undefined}
          className={cx('inline-flex h-8 items-center rounded-[4px] px-3 copy-13 font-medium ease-hover', active === tab.key ? 'border border-gray-400 bg-background-100 text-gray-1000' : 'text-gray-900 hover:text-gray-1000')}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function VideoAnalytics() {
  const { range, resolved, filters, by, totals, points, rows, campaigns } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const loading = navigation.state === 'loading' && navigation.location?.pathname === '/analytics/video';
  const setParam = (changes) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    setSearchParams(next, { replace: true });
  };
  const t = totals;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Video events are recorded as they happen. Provider rows are events reported by that provider's own player, not revenue."
        actions={<DateRangePicker key={JSON.stringify(range)} value={range} onChange={(next) => setSearchParams(writeRange(searchParams, next), { replace: true })} />}
      />
      <AnalyticsTabs active="video" />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
        <Select aria-label="Campaign" value={filters.campaignId || ''} onChange={(e) => setParam({ campaignId: e.target.value })}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Format" value={filters.format || ''} onChange={(e) => setParam({ format: e.target.value })}>
          <option value="">All video formats</option>
          {['video_embedded', 'video_fullscreen', 'video_rewarded'].map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABELS[f]}
            </option>
          ))}
        </Select>
        <Select aria-label="Provider" value={filters.provider || ''} onChange={(e) => setParam({ provider: e.target.value })}>
          <option value="">All providers</option>
          {Object.entries(PROVIDER_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        {Object.keys(filters).length > 0 && (
          <Button variant="tertiary" icon={X} onClick={() => setParam({ campaignId: '', format: '', provider: '', gameId: '' })}>
            Clear filters
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Impressions" loading={loading} value={t.impressions} format={short} exact={`${num(t.impressions)} · fill rate ${pct(rate(t.fills, t.requests))} of ${num(t.requests)} requests`} />
        <StatCard label="Starts" loading={loading} value={t.starts} format={short} exact={`${num(t.starts)} playbacks started by viewers`} />
        <StatCard label="Completion rate" loading={loading} value={rate(t.completes, t.starts)} format={pct} exact={`${num(t.completes)} of ${num(t.starts)} starts`} />
        <StatCard label="Rewards granted" loading={loading} value={t.rewards} format={short} exact={`${num(t.rewards)} grants`} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-gray-400 px-4 py-3 copy-13 md:grid-cols-6">
        {[
          ['Skip rate', pct(rate(t.skips, t.starts)), 'of starts'],
          ['Error rate', pct(rate(t.errors, t.starts + t.errors)), 'of plays'],
          ['CTR', pct(rate(t.clicks, t.impressions)), 'of impressions'],
          ['Reward rate', pct(rate(t.rewards, t.starts)), 'of starts'],
          ['Quartiles', `${num(t.q1)} / ${num(t.midpoints)} / ${num(t.q3)}`, '25 / 50 / 75%'],
          ['Fill rate', pct(rate(t.fills, t.requests)), 'of requests'],
        ].map(([label, value, note]) => (
          <div key={label}>
            <dt className="text-gray-900">{label}</dt>
            <dd className="font-mono tabular">{value}</dd>
            <dd className="copy-12 text-gray-700">{note}</dd>
          </div>
        ))}
      </dl>

      <Card title="Starts and completions" description={`${resolved.label} · the current ${resolved.granularity} is still filling and is drawn dashed`} className="mt-6">
        <LineChart points={points} granularity={resolved.granularity} rangeKey={JSON.stringify([range, filters])} series={SERIES} ratio={COMPLETION} drawIn />
      </Card>

      <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="heading-16">Breakdown</h2>
        <Segmented label="Group by" size="sm" value={by} options={BY} onChange={(value) => setParam({ by: value })} />
      </div>
      <Table
        caption="Video events by group"
        loading={loading}
        rows={rows.map((r) => ({ ...r, id: `${r.key}` }))}
        columns={[
          {
            key: 'label',
            header: BY.find((b) => b.value === by).label,
            render: (r) =>
              by === 'provider' ? (
                <span className="flex items-center gap-2">
                  {PROVIDER_LABELS[r.label] || r.label}
                  {r.label !== 'first_party' && <Badge tone="purple">Provider-reported</Badge>}
                </span>
              ) : by === 'format' ? (
                FORMAT_LABELS[r.label] || r.label
              ) : (
                r.label
              ),
          },
          { key: 'requests', header: 'Requests', align: 'right', render: (r) => num(r.requests) },
          { key: 'impressions', header: 'Impressions', align: 'right', render: (r) => num(r.impressions) },
          { key: 'starts', header: 'Starts', align: 'right', render: (r) => num(r.starts) },
          { key: 'completion', header: 'Completion', align: 'right', render: (r) => pct(rate(r.completes, r.starts)) },
          { key: 'skips', header: 'Skip rate', align: 'right', render: (r) => pct(rate(r.skips, r.starts)) },
          { key: 'ctr', header: 'CTR', align: 'right', render: (r) => pct(rate(r.clicks, r.impressions)) },
          { key: 'rewards', header: 'Rewards', align: 'right', render: (r) => num(r.rewards) },
          { key: 'errors', header: 'Errors', align: 'right', render: (r) => num(r.errors) },
        ]}
        empty={<EmptyState icon={Film} title="No video events in this range" description="Events appear as soon as viewers request and play video ads." />}
      />
    </>
  );
}
