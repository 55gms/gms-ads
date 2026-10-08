import { Check, Globe, Megaphone } from 'lucide-react';
import { Link, useLoaderData, useNavigation, useSearchParams } from 'react-router';
import { api, get } from '../lib/api.js';
import { cx } from '../lib/cx.js';
import { absoluteTime, ctr, delta, num, pct, rangeLabel, short } from '../lib/format.js';
import { readRange, writeRange } from '../lib/range.js';
import { loadReport } from '../lib/reports.js';
import { StatusDot } from '../ui/Badge.jsx';
import { LineChart } from '../ui/Chart.jsx';
import { Card, EmptyState, PageHeader, StatCard } from '../ui/Misc.jsx';
import { Table } from '../ui/Table.jsx';
import { Segmented } from '../ui/Tabs.jsx';

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

export async function overviewLoader({ request }) {
  const range = readRange(new URL(request.url).searchParams);
  const report = await loadReport(range);
  const [campaigns, domains, setup] = await Promise.all([
    get(api('/stats/campaigns'), { ...report.params, limit: 5 }),
    get(api('/stats/domains'), { ...report.params, pageSize: 5 }),
    get(api('/stats/setup')),
  ]);
  return { range, report, topCampaigns: campaigns.rows, topDomains: domains.rows, setup };
}

// First-run checklist: three steps, ticked as each is done.
function Setup({ setup }) {
  const steps = [
    { done: setup.domains > 0, title: 'Add a domain', text: 'Register the hostnames that are allowed to show ads.', to: '/domains?import=1', action: 'Add domains' },
    { done: setup.campaigns > 0, title: 'Create a campaign', text: 'Upload a creative and set where its clicks go.', to: '/campaigns?new=1', action: 'Create campaign' },
    { done: setup.batches > 0, title: 'Install the snippet', text: 'Mount the edge module and paste the script tag. This completes when the first hourly batch arrives.', to: '/snippet', action: 'Open setup guide' },
  ];
  if (steps.every((step) => step.done)) return null;
  const next = steps.findIndex((step) => !step.done);
  return (
    <Card title="Get started" description={`${steps.filter((s) => s.done).length} of 3 steps done`} padded={false} className="mb-6">
      <ol>
        {steps.map((step, i) => (
          <li key={step.title} className="flex flex-wrap items-center gap-4 border-b border-gray-400 px-4 py-4 last:border-0 md:px-6">
            <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full border copy-12 font-medium tabular', step.done ? 'border-green-border bg-green-soft text-green-text' : 'border-gray-400 text-gray-900')}>
              {step.done ? <Check size={14} strokeWidth={2} aria-label="Done" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cx('copy-14 font-medium', step.done && 'text-gray-900')}>{step.title}</p>
              <p className="copy-13 text-gray-900">{step.text}</p>
            </div>
            {!step.done && (
              <Link to={step.to} viewTransition className={cx('inline-flex h-8 items-center rounded-sm border px-3 copy-13 font-medium ease-hover max-md:min-h-11', i === next ? 'border-gray-1000 bg-gray-1000 text-background-100 hover:opacity-85' : 'border-gray-400 hover:bg-gray-100')}>
                {step.action}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function Overview() {
  const { range, report, topCampaigns, topDomains, setup } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const loading = navigation.state === 'loading' && navigation.location?.pathname === '/';
  const { current, previous, previousRange, range: period } = report.summary;
  const periodText = `${rangeLabel(period.from, period.to)}, compared with ${rangeLabel(previousRange.from, previousRange.to)}`;
  const exact = (n) => `${num(n)} · ${periodText}`;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Viewable impressions and clicks across every domain."
        actions={<Segmented label="Period" value={range.preset} options={RANGES} onChange={(preset) => setSearchParams(writeRange(searchParams, { preset }), { replace: true })} />}
      />
      <Setup setup={setup} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Impressions" loading={loading} value={current.impressions} format={short} exact={exact(current.impressions)} delta={delta(current.impressions, previous.impressions)} />
        <StatCard label="Clicks" loading={loading} value={current.clicks} format={short} exact={exact(current.clicks)} delta={delta(current.clicks, previous.clicks)} />
        <StatCard
          label="CTR"
          loading={loading}
          value={ctr(current.clicks, current.impressions)}
          format={pct}
          exact={`${pct(ctr(current.clicks, current.impressions), 3)} · ${periodText}`}
          delta={delta(ctr(current.clicks, current.impressions), ctr(previous.clicks, previous.impressions))}
        />
        <StatCard label="Active campaigns" loading={loading} value={report.summary.activeCampaigns} format={num} exact={`Running now · ${absoluteTime(new Date())}`} footnote="Running now" />
      </div>

      <Card title="Traffic" description={report.resolved.label} className="mt-6">
        <LineChart points={report.points} granularity={report.resolved.granularity} rangeKey={range.preset} drawIn />
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 heading-16">Top campaigns</h2>
          <Table
            caption="Top campaigns by impressions"
            loading={loading}
            skeletonRows={5}
            rows={topCampaigns}
            rowKey="campaign_id"
            columns={[
              { key: 'name', header: 'Campaign', render: (r) => <span className="flex flex-col"><span className="font-medium">{r.name}</span>{r.status && <StatusDot state={r.status} className="text-gray-900" />}</span> },
              { key: 'impressions', header: 'Impressions', align: 'right', render: (r) => num(r.impressions) },
              { key: 'clicks', header: 'Clicks', align: 'right', render: (r) => num(r.clicks) },
              { key: 'ctr', header: 'CTR', align: 'right', render: (r) => pct(ctr(r.clicks, r.impressions)) },
            ]}
            empty={<EmptyState icon={Megaphone} title="No campaign traffic yet" description="Numbers appear after the first hourly batch." />}
          />
        </div>
        <div>
          <h2 className="mb-3 heading-16">Top domains</h2>
          <Table
            caption="Top domains by impressions"
            loading={loading}
            skeletonRows={5}
            rows={topDomains}
            rowKey="domain"
            columns={[
              { key: 'domain', header: 'Domain', mono: true },
              { key: 'impressions', header: 'Impressions', align: 'right', render: (r) => num(r.impressions) },
              { key: 'clicks', header: 'Clicks', align: 'right', render: (r) => num(r.clicks) },
              { key: 'ctr', header: 'CTR', align: 'right', render: (r) => pct(ctr(r.clicks, r.impressions)) },
            ]}
            empty={<EmptyState icon={Globe} title="No domain traffic yet" description="Each domain is listed once it serves an ad." />}
          />
        </div>
      </div>
    </>
  );
}
