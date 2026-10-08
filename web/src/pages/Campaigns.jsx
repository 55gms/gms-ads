import { CirclePause, CirclePlay, CircleStop, Copy, Ellipsis, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLoaderData, useNavigation, useRevalidator, useSearchParams } from 'react-router';
import { expectedShares } from '../../../edge/lib/selection.js';
import { api, del, errorMessage, get, patch, post } from '../lib/api.js';
import { campaignState, scheduleLabel } from '../lib/campaign.js';
import { ctr, num, pct, shortDate, sizeLabel } from '../lib/format.js';
import { useCanWrite } from '../lib/session.js';
import { toast } from '../lib/stores.js';
import { StatusDot } from '../ui/Badge.jsx';
import { Button, IconButton } from '../ui/Button.jsx';
import { Menu, Tooltip } from '../ui/Floating.jsx';
import { Card, EmptyState, PageHeader, Progress } from '../ui/Misc.jsx';
import { ConfirmModal } from '../ui/Overlay.jsx';
import { Table } from '../ui/Table.jsx';
import { CampaignSheet } from './CampaignSheet.jsx';

export async function campaignsLoader() {
  const [campaigns, creatives, domains] = await Promise.all([get(api('/campaigns')), get(api('/creatives')), get(api('/domains/all'))]);
  return { campaigns: campaigns.campaigns, creatives: creatives.creatives, domains: domains.domains };
}

function Caps({ campaign }) {
  const rows = [
    campaign.total_impression_cap && { label: 'Total', used: campaign.impressions, cap: campaign.total_impression_cap },
    campaign.daily_impression_cap && { label: 'Today', used: campaign.impressions_today, cap: campaign.daily_impression_cap },
  ].filter(Boolean);
  if (!rows.length) return <span className="text-gray-700">No cap</span>;
  return (
    <div className="flex min-w-36 flex-col gap-1.5">
      {rows.map((row) => (
        <Tooltip key={row.label} content={`${row.label}: ${num(row.used)} of ${num(row.cap)} impressions`} className="w-full">
          <div className="w-full">
            <div className="mb-1 flex justify-between gap-2 copy-12 text-gray-900 tabular">
              <span>{row.label}</span>
              <span>
                {num(row.used)} / {num(row.cap)}
              </span>
            </div>
            <Progress value={row.used} max={row.cap} label={`${row.label} impression cap`} />
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

// Expected split of traffic per size among campaigns that are running now,
// from their weights. Targeting and caps shift the real numbers.
function Shares({ campaigns }) {
  const running = campaigns.filter((c) => campaignState(c) === 'active' && c.creatives.length);
  const sizes = [...new Set(running.flatMap((c) => c.creatives.map((cr) => cr.size)))].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
  if (!sizes.length) return null;
  const names = new Map(running.map((c) => [c.id, c.name]));
  return (
    <Card title="Expected share of traffic" description="Per size, from the weights of campaigns running now" padded={false} className="mt-6">
      <ul>
        {sizes.map((size) => (
          <li key={size} className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-gray-400 px-4 py-3 last:border-0 md:px-6">
            <span className="w-20 font-mono copy-13">{sizeLabel(size)}</span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
              {expectedShares(running, size).map(({ campaignId, share }) => (
                <span key={campaignId} className="copy-13 text-gray-900">
                  {names.get(campaignId)} <span className="font-medium text-gray-1000 tabular">{pct(share * 100, 0)}</span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Campaigns() {
  const data = useLoaderData();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const canWrite = useCanWrite();
  const [searchParams, setSearchParams] = useSearchParams();
  // Optimistic status changes, layered over loader data until it catches up.
  const [overrides, setOverrides] = useState({});
  const [deleting, setDeleting] = useState(null);

  const campaigns = useMemo(() => data.campaigns.map((c) => (overrides[c.id] ? { ...c, ...overrides[c.id] } : c)), [data.campaigns, overrides]);
  const editingId = searchParams.get('edit');
  const sheetOpen = searchParams.has('new') || Boolean(editingId);
  const editing = editingId ? data.campaigns.find((c) => c.id === editingId) : null;

  // The sheet keeps showing what it opened with while its exit animation
  // plays, and gets fresh form state every time it opens.
  const [held, setHeld] = useState({ id: 'new', campaign: null, n: 0, open: false });
  const target = editingId || 'new';
  if (sheetOpen !== held.open || (sheetOpen && (held.id !== target || held.campaign !== editing))) {
    setHeld({
      id: sheetOpen ? target : held.id,
      campaign: sheetOpen ? editing : held.campaign,
      n: sheetOpen && !held.open ? held.n + 1 : held.n,
      open: sheetOpen,
    });
  }

  const openSheet = (id) => setSearchParams(id ? { edit: id } : { new: '1' });
  const closeSheet = () => setSearchParams({}, { replace: true });

  const clearOverride = (id) =>
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  // Applies the new status at once, rolls back with a toast if the request
  // fails, and offers Undo for five seconds.
  const setStatus = async (campaign, status, message) => {
    const previous = campaign.status;
    setOverrides((prev) => ({ ...prev, [campaign.id]: { status } }));
    try {
      await patch(api(`/campaigns/${campaign.id}`), { status });
      await revalidator.revalidate();
      if (message) toast.undo(message, () => setStatus({ ...campaign, status }, previous));
    } catch (error) {
      toast.error(errorMessage(error, `Could not update ${campaign.name}`));
    } finally {
      clearOverride(campaign.id);
    }
  };

  const duplicate = async (campaign) => {
    try {
      const { campaign: copy } = await post(api(`/campaigns/${campaign.id}/duplicate`));
      await revalidator.revalidate();
      toast.success(`Created ${copy.name} as a draft`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async () => {
    try {
      await del(api(`/campaigns/${deleting.id}`));
      await revalidator.revalidate();
      toast.success(`Deleted ${deleting.name}`);
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  };

  const actions = (c) => {
    const state = campaignState(c);
    return [
      { label: 'Edit', icon: Pencil, onSelect: () => openSheet(c.id) },
      c.status === 'active' && { label: 'Pause', icon: CirclePause, onSelect: () => setStatus(c, 'paused', `Paused ${c.name}`) },
      (c.status === 'paused' || c.status === 'draft') && { label: c.status === 'draft' ? 'Activate' : 'Resume', icon: CirclePlay, onSelect: () => setStatus(c, 'active', c.status === 'draft' ? `Activated ${c.name}` : `Resumed ${c.name}`) },
      { label: 'Duplicate', icon: Copy, onSelect: () => duplicate(c) },
      state !== 'ended' && { label: 'End', icon: CircleStop, onSelect: () => setStatus(c, 'ended', `Ended ${c.name}`) },
      null,
      { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setDeleting(c) },
    ];
  };

  const columns = [
    {
      key: 'name',
      header: 'Campaign',
      render: (c) => (
        <div className="flex min-w-40 flex-col gap-0.5">
          <span className="font-medium">{c.name}</span>
          <StatusDot state={campaignState(c)} className="text-gray-900" />
        </div>
      ),
    },
    { key: 'weight', header: 'Weight', align: 'right', render: (c) => c.weight },
    { key: 'schedule', header: 'Schedule', render: (c) => <span className="whitespace-nowrap">{scheduleLabel(c, shortDate)}</span> },
    { key: 'caps', header: 'Caps', wide: true, render: (c) => <Caps campaign={c} /> },
    { key: 'impressions', header: 'Impressions', align: 'right', render: (c) => num(c.impressions) },
    { key: 'clicks', header: 'Clicks', align: 'right', render: (c) => num(c.clicks) },
    { key: 'ctr', header: 'CTR', align: 'right', render: (c) => pct(ctr(c.clicks, c.impressions)) },
    canWrite && {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 56,
      align: 'right',
      render: (c) => <Menu label={`Actions for ${c.name}`} items={actions(c)} trigger={(props) => <IconButton {...props} icon={Ellipsis} label={`Actions for ${c.name}`} />} />,
    },
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Several campaigns can run at once. Weight sets each one's share of traffic."
        actions={
          canWrite && (
            <Button variant="primary" icon={Plus} onClick={() => openSheet()}>
              New campaign
            </Button>
          )
        }
      />
      <Table
        caption="Campaigns"
        columns={columns}
        rows={campaigns}
        loading={navigation.state === 'loading' && data.campaigns.length === 0}
        empty={
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            description="A campaign pairs creatives with a click URL, a schedule, and optional caps."
            action={canWrite ? { label: 'Create campaign', icon: Plus, onClick: () => openSheet() } : undefined}
          />
        }
      />
      <Shares campaigns={campaigns} />

      <CampaignSheet
        key={`${held.id}-${held.n}`}
        open={sheetOpen}
        campaign={held.campaign}
        creatives={data.creatives}
        domains={data.domains}
        onClose={closeSheet}
        onSaved={async (saved, created) => {
          await revalidator.revalidate();
          closeSheet();
          toast.success(created ? `Created ${saved.name}` : `Saved ${saved.name}`);
        }}
      />
      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete campaign"
        description="This permanently removes the campaign and its settings. Its creatives stay in your library and its past stats stay in reports."
        confirmText={deleting?.name}
        confirmLabel="Delete campaign"
      />
    </>
  );
}
