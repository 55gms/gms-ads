import { ChartLine, Download, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLoaderData, useNavigation, useSearchParams } from 'react-router';
import { api, get } from '../lib/api.js';
import { clock, ctr, delta, num, pct, relativeTime, short, sizeLabel } from '../lib/format.js';
import { useDebounced, useNow } from '../lib/hooks.js';
import { readRange, writeRange } from '../lib/range.js';
import { loadReport, readFilters } from '../lib/reports.js';
import { Button } from '../ui/Button.jsx';
import { LineChart } from '../ui/Chart.jsx';
import { DateRangePicker } from '../ui/DateRangePicker.jsx';
import { Input, Select } from '../ui/Field.jsx';
import { Card, EmptyState, PageHeader, StatCard } from '../ui/Misc.jsx';
import { Pagination, Table } from '../ui/Table.jsx';

const PAGE_SIZE = 25;

export async function analyticsLoader({ request }) {
  const searchParams = new URL(request.url).searchParams;
  const range = readRange(searchParams, '30d');
  const filters = readFilters(searchParams);
  const sort = searchParams.get('sort') || 'impressions';
  const dir = searchParams.get('dir') || 'desc';
  const page = Number(searchParams.get('page')) || 1;
  const search = searchParams.get('search') || '';
  const report = await loadReport(range, filters);
  const [domains, campaigns, creatives, sizes] = await Promise.all([
    get(api('/stats/domains'), { ...report.params, sort, dir, page, pageSize: PAGE_SIZE, search }),
    get(api('/campaigns')),
    get(api('/creatives')),
    get(api('/settings/sizes')),
  ]);
  return { range, filters, report, domains, sort: { key: sort, dir }, search, campaigns: campaigns.campaigns, creatives: creatives.creatives, sizes: sizes.sizes };
}

// Stats arrive in hourly batches, so say how fresh they are and when the
// next batch is due.
function Freshness({ lastBatchAt }) {
  const now = useNow();
  const next = new Date(Math.ceil((now + 1) / 3_600_000) * 3_600_000);
  return (
    <p className="copy-13 text-gray-900" aria-live="polite">
      {lastBatchAt ? `Updated ${relativeTime(lastBatchAt, now).toLowerCase()}` : 'No batches received yet'} · next batch around {clock(next)}
    </p>
  );
}

export function Analytics() {
  const { range, filters, report, domains, sort, search, campaigns, creatives, sizes } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const loading = navigation.state === 'loading' && navigation.location?.pathname === '/analytics';
  const { current, previous } = report.summary;

  const setParam = (changes) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setSearchParams(next, { replace: true });
  };

  // The search box updates the URL after typing pauses.
  const [query, setQuery] = useState(search);
  const debounced = useDebounced(query, 300);
  useEffect(() => {
    if (debounced !== search) setParam({ search: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const creativeOptions = filters.campaignId ? creatives.filter((c) => c.campaign_id === filters.campaignId) : creatives;
  const exportHref = `${api('/stats/export.csv')}?${new URLSearchParams(report.params).toString()}`;
  const hasFilters = Object.keys(filters).length > 0;

  return (
    <>
      <PageHeader
        title="Analytics"
        description={<Freshness lastBatchAt={report.summary.lastBatchAt} />}
        actions={
          <>
            <DateRangePicker key={JSON.stringify(range)} value={range} onChange={(next) => setSearchParams(writeRange(searchParams, next), { replace: true })} />
            <Button as="a" href={exportHref} download icon={Download}>
              Export CSV
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <Select aria-label="Campaign" value={filters.campaignId || ''} onChange={(e) => setParam({ campaignId: e.target.value, creativeId: '' })}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Creative" value={filters.creativeId || ''} onChange={(e) => setParam({ creativeId: e.target.value })}>
          <option value="">All creatives</option>
          {creativeOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {sizeLabel(c.size)} · {c.alt_text || c.campaign_name || c.id.slice(0, 8)}
            </option>
          ))}
        </Select>
        <Select aria-label="Size" value={filters.sizeId || ''} onChange={(e) => setParam({ sizeId: e.target.value })}>
          <option value="">All sizes</option>
          {sizes.map((s) => (
            <option key={s.id} value={s.id}>
              {sizeLabel(`${s.width}x${s.height}`)}
            </option>
          ))}
        </Select>
        <Input
          key={filters.domain || ''}
          aria-label="Domain"
          placeholder="Exact domain"
          mono
          defaultValue={filters.domain || ''}
          onKeyDown={(e) => e.key === 'Enter' && setParam({ domain: e.currentTarget.value.trim().toLowerCase() })}
          onBlur={(e) => e.target.value.trim().toLowerCase() !== (filters.domain || '') && setParam({ domain: e.target.value.trim().toLowerCase() })}
        />
        {hasFilters && (
          <Button variant="tertiary" icon={X} onClick={() => setParam({ campaignId: '', creativeId: '', sizeId: '', domain: '' })}>
            Clear filters
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Impressions" loading={loading} value={current.impressions} format={short} exact={num(current.impressions)} delta={delta(current.impressions, previous.impressions)} />
        <StatCard label="Clicks" loading={loading} value={current.clicks} format={short} exact={num(current.clicks)} delta={delta(current.clicks, previous.clicks)} />
        <StatCard label="CTR" loading={loading} value={ctr(current.clicks, current.impressions)} format={pct} exact={pct(ctr(current.clicks, current.impressions), 3)} delta={delta(ctr(current.clicks, current.impressions), ctr(previous.clicks, previous.impressions))} />
      </div>

      <Card title="Over time" description={`${report.resolved.label} · the current ${report.resolved.granularity} is still filling and is drawn dashed`} className="mt-6">
        <LineChart points={report.points} granularity={report.resolved.granularity} rangeKey={JSON.stringify([range, filters])} drawIn />
      </Card>

      <div className="mt-8 mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="heading-16">By domain</h2>
        <div className="relative w-full sm:w-72">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-700" />
          <Input aria-label="Search domains" placeholder="Search domains" className="pl-9" mono value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <Table
        caption="Impressions, clicks, and CTR by domain"
        loading={loading}
        rows={domains.rows}
        rowKey="domain"
        sort={sort}
        onSort={(next) => setParam({ sort: next.key, dir: next.dir })}
        columns={[
          { key: 'domain', header: 'Domain', sortable: true, mono: true },
          { key: 'impressions', header: 'Impressions', align: 'right', sortable: true, render: (r) => num(r.impressions) },
          { key: 'clicks', header: 'Clicks', align: 'right', sortable: true, render: (r) => num(r.clicks) },
          { key: 'ctr', header: 'CTR', align: 'right', sortable: true, render: (r) => pct(ctr(r.clicks, r.impressions)) },
        ]}
        empty={<EmptyState icon={ChartLine} title={search || hasFilters ? 'No domains match' : 'No data in this range'} description={search || hasFilters ? 'Try a different search or clear the filters.' : 'Stats appear after the edge sends its hourly batch.'} />}
        footer={<Pagination page={domains.page} pageSize={domains.pageSize} total={domains.total} onPage={(page) => setParam({ page: String(page) })} />}
      />
    </>
  );
}
