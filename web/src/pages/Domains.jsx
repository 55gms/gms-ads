import { Ellipsis, Globe, ListPlus, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLoaderData, useNavigation, useRevalidator, useSearchParams } from 'react-router';
import { api, del, errorMessage, get, patch, post } from '../lib/api.js';
import { num } from '../lib/format.js';
import { useDebounced } from '../lib/hooks.js';
import { useCanWrite } from '../lib/session.js';
import { toast } from '../lib/stores.js';
import { Badge } from '../ui/Badge.jsx';
import { Button, IconButton } from '../ui/Button.jsx';
import { Switch } from '../ui/Controls.jsx';
import { Field, Input, Textarea } from '../ui/Field.jsx';
import { Menu } from '../ui/Floating.jsx';
import { EmptyState, PageHeader, RelativeTime } from '../ui/Misc.jsx';
import { ConfirmModal, Modal } from '../ui/Overlay.jsx';
import { Pagination, Table } from '../ui/Table.jsx';

export async function domainsLoader({ request }) {
  const params = new URL(request.url).searchParams;
  const sort = params.get('sort') || 'hostname';
  const dir = params.get('dir') || 'asc';
  const search = params.get('search') || '';
  const data = await get(api('/domains'), { search, sort, dir, page: Number(params.get('page')) || 1, pageSize: 50 });
  return { ...data, sort: { key: sort, dir }, search };
}

function ImportModal({ open, onClose, onImported }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const count = text.split(/[\s,;]+/).filter(Boolean).length;

  const close = () => {
    setResult(null);
    setError('');
    onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!count) return setError('Paste at least one hostname');
    setSaving(true);
    setError('');
    try {
      const data = await post(api('/domains/import'), { hostnames: text });
      onImported();
      if (data.invalid.length) setResult(data);
      else {
        setText('');
        close();
      }
      toast.success(`Added ${num(data.added)} ${data.added === 1 ? 'domain' : 'domains'}${data.skipped ? `, ${num(data.skipped)} already listed` : ''}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add domains"
      description="Paste hostnames separated by new lines, spaces, or commas. Use *.example.com to cover every subdomain."
      width="max-w-lg"
      footer={
        <>
          <Button onClick={close} disabled={saving}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          <Button variant="primary" type="submit" form="import-form" loading={saving}>
            Add {count > 0 ? num(count) : ''} {count === 1 ? 'domain' : 'domains'}
          </Button>
        </>
      }
    >
      <form id="import-form" onSubmit={submit} noValidate>
        <Field label="Hostnames" error={error} hint="Up to 5,000 at a time. Duplicates are skipped.">
          {(props) => <Textarea {...props} data-autofocus mono rows={10} spellCheck={false} placeholder={'example.com\ngames.example.org\n*.55gms.com'} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      </form>
      {result?.invalid.length > 0 && (
        <div role="alert" className="mt-4 rounded-sm border border-amber-border bg-amber-soft p-3 copy-13 text-amber-text">
          <p className="font-medium">{result.invalid.length} entries were not valid hostnames and were skipped</p>
          <p className="mt-1 font-mono break-all">{result.invalid.join(', ')}</p>
        </div>
      )}
    </Modal>
  );
}

export function Domains() {
  const data = useLoaderData();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const canWrite = useCanWrite();
  const [searchParams, setSearchParams] = useSearchParams();
  const [overrides, setOverrides] = useState({});
  const [deleting, setDeleting] = useState(null);
  const loading = navigation.state === 'loading' && navigation.location?.pathname === '/domains';
  const importOpen = searchParams.has('import');

  const setParam = (changes) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const [query, setQuery] = useState(data.search);
  const debounced = useDebounced(query, 300);
  useEffect(() => {
    if (debounced !== data.search) setParam({ search: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // Optimistic toggle with rollback on failure.
  const toggle = async (domain, enabled) => {
    setOverrides((prev) => ({ ...prev, [domain.id]: enabled }));
    try {
      await patch(api(`/domains/${domain.id}`), { enabled });
      await revalidator.revalidate();
    } catch (error) {
      toast.error(errorMessage(error, `Could not update ${domain.hostname}`));
    } finally {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[domain.id];
        return next;
      });
    }
  };

  const remove = async () => {
    try {
      await del(api(`/domains/${deleting.id}`));
      await revalidator.revalidate();
      toast.success(`Removed ${deleting.hostname}`);
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  };

  const columns = [
    {
      key: 'hostname',
      header: 'Domain',
      sortable: true,
      mono: true,
      render: (d) => (
        <span className="flex items-center gap-2">
          {d.hostname}
          {d.hostname.startsWith('*.') && <Badge className="font-sans">Wildcard</Badge>}
        </span>
      ),
    },
    { key: 'impressions', header: 'Impressions, 30d', align: 'right', sortable: true, render: (d) => num(d.impressions) },
    { key: 'clicks', header: 'Clicks, 30d', align: 'right', sortable: true, render: (d) => num(d.clicks) },
    { key: 'created_at', header: 'Added', sortable: true, render: (d) => <RelativeTime value={d.created_at} className="text-gray-900" /> },
    {
      key: 'enabled',
      header: 'Serving',
      width: 88,
      render: (d) => {
        const enabled = overrides[d.id] ?? d.enabled;
        return canWrite ? <Switch checked={enabled} onChange={(next) => toggle(d, next)} label={`Serve ads on ${d.hostname}`} /> : <span className="text-gray-900">{enabled ? 'On' : 'Off'}</span>;
      },
    },
    canWrite && {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 56,
      align: 'right',
      hideOnMobile: false,
      render: (d) => <Menu label={`Actions for ${d.hostname}`} items={[{ label: 'Remove', icon: Trash2, danger: true, onSelect: () => setDeleting(d) }]} trigger={(props) => <IconButton {...props} icon={Ellipsis} label={`Actions for ${d.hostname}`} />} />,
    },
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title="Domains"
        description="Ads serve on every host that loads the embed. New hosts appear here once they report traffic; switch one off to stop serving on it."
        actions={
          canWrite && (
            <Button variant="primary" icon={ListPlus} onClick={() => setParam({ import: '1' })}>
              Add domains
            </Button>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-700" />
          <Input aria-label="Search domains" placeholder="Search domains" className="pl-9" mono value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <p className="copy-13 text-gray-900 tabular">
          {num(data.total)} {data.total === 1 ? 'domain' : 'domains'}
        </p>
      </div>
      <Table
        caption="Registered domains"
        columns={columns}
        rows={data.domains}
        loading={loading && data.domains.length === 0}
        sort={data.sort}
        onSort={(next) => setParam({ sort: next.key, dir: next.dir })}
        empty={
          data.search ? (
            <EmptyState icon={Search} title="No domains match" description={`Nothing found for “${data.search}”.`} />
          ) : (
            <EmptyState icon={Globe} title="No domains yet" description="Hosts appear here after they first report traffic. Add one ahead of time to target it or switch it off." action={canWrite ? { label: 'Add domains', icon: Plus, onClick: () => setParam({ import: '1' }) } : undefined} />
          )
        }
        footer={<Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(page) => setParam({ page: String(page) })} />}
      />

      <ImportModal open={importOpen} onClose={() => setParam({ import: '' })} onImported={() => revalidator.revalidate()} />
      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Remove domain"
        description="Ads stop serving on this hostname and it is removed from campaign targeting. Past stats are kept."
        confirmText={deleting?.hostname}
        confirmLabel="Remove domain"
      />
    </>
  );
}
