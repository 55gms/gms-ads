import { Ban, KeyRound, Plus, ScrollText, ServerCog, Trash2, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLoaderData, useRevalidator, useSearchParams } from 'react-router';
import { api, del, errorMessage, fieldErrors, get, patch, post } from '../lib/api.js';
import { cx } from '../lib/cx.js';
import { absoluteTime, num, sizeLabel } from '../lib/format.js';
import { useCanWrite, useSession } from '../lib/session.js';
import { toast } from '../lib/stores.js';
import { Badge, RoleBadge, StatusDot } from '../ui/Badge.jsx';
import { Button, IconButton } from '../ui/Button.jsx';
import { Field, Input, Select } from '../ui/Field.jsx';
import { Avatar, CodeBlock, EmptyState, PageHeader, RelativeTime } from '../ui/Misc.jsx';
import { ConfirmModal, Modal } from '../ui/Overlay.jsx';
import { Pagination, Table } from '../ui/Table.jsx';

const SECTIONS = [
  { to: 'members', label: 'Members' },
  { to: 'sizes', label: 'Ad sizes' },
  { to: 'keys', label: 'API keys' },
  { to: 'ingestion', label: 'Ingestion' },
  { to: 'audit', label: 'Audit log' },
];

export const membersLoader = () => get(api('/settings/users'));
export const sizesLoader = () => get(api('/settings/sizes'));
export const keysLoader = () => get(api('/settings/keys'));
export const ingestLoader = () => get(api('/settings/ingest'));
export const auditLoader = ({ request }) => get(api('/settings/audit'), { page: Number(new URL(request.url).searchParams.get('page')) || 1 });

export function Settings() {
  return (
    <>
      <PageHeader title="Settings" description="Team access, ad sizes, edge credentials, and the record of what changed." />
      <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
        <nav aria-label="Settings sections" className="edge-fade -mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-col md:overflow-visible md:px-0 md:[mask-image:none]">
          {SECTIONS.map((section) => (
            <NavLink
              key={section.to}
              to={section.to}
              className={({ isActive }) => cx('flex h-9 shrink-0 items-center rounded-sm px-3 copy-14 ease-hover max-md:h-11', isActive ? 'bg-gray-100 font-medium text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000')}
            >
              {section.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </>
  );
}

function SectionHeader({ title, description, action }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="heading-20">{title}</h2>
        <p className="mt-1 copy-14 text-gray-900">{description}</p>
      </div>
      {action}
    </div>
  );
}

// --- Members -----------------------------------------------------------------

export function Members() {
  const { users } = useLoaderData();
  const { user: me } = useSession();
  const revalidator = useRevalidator();
  const canWrite = useCanWrite();

  const update = async (user, changes, message) => {
    try {
      await patch(api(`/settings/users/${user.id}`), changes);
      await revalidator.revalidate();
      toast.success(message);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const editable = (user) => canWrite && user.id !== me.id && (me.role === 'owner' || user.role !== 'owner');

  return (
    <>
      <SectionHeader title="Members" description="New sign-ins wait here until an owner or admin approves them. Viewers can read reports but not change anything." />
      <Table
        caption="Team members"
        rows={users}
        columns={[
          {
            key: 'name',
            header: 'Member',
            render: (u) => (
              <span className="flex items-center gap-3">
                <Avatar name={u.name || u.email} src={u.avatar} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {u.name || 'Unnamed'}
                    {u.id === me.id && <span className="ml-2 font-normal text-gray-700">You</span>}
                  </span>
                  <span className="block truncate text-gray-900">{u.email}</span>
                </span>
              </span>
            ),
          },
          {
            key: 'role',
            header: 'Role',
            render: (u) =>
              editable(u) && u.status === 'active' ? (
                <Select size="sm" aria-label={`Role for ${u.name || u.email}`} className="w-28" value={u.role} onChange={(e) => update(u, { role: e.target.value }, `${u.name || u.email} is now ${e.target.value}`)}>
                  {me.role === 'owner' && <option value="owner">Owner</option>}
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </Select>
              ) : (
                <RoleBadge role={u.role} />
              ),
          },
          { key: 'status', header: 'Status', render: (u) => <StatusDot state={u.status} /> },
          { key: 'last_login_at', header: 'Last sign-in', render: (u) => <RelativeTime value={u.last_login_at} className="text-gray-900" /> },
          canWrite && {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            wide: true,
            render: (u) =>
              !editable(u) ? null : u.status === 'pending' ? (
                <span className="flex justify-end gap-2 max-md:justify-start">
                  <Button size="sm" variant="primary" icon={UserCheck} onClick={() => update(u, { status: 'active', role: 'viewer' }, `Approved ${u.name || u.email} as viewer`)}>
                    Approve
                  </Button>
                  <Button size="sm" onClick={() => update(u, { status: 'active', role: 'admin' }, `Approved ${u.name || u.email} as admin`)}>
                    Approve as admin
                  </Button>
                </span>
              ) : u.status === 'active' ? (
                <Button size="sm" variant="tertiary" icon={Ban} onClick={() => update(u, { status: 'disabled' }, `Disabled ${u.name || u.email}`)}>
                  Disable
                </Button>
              ) : (
                <Button size="sm" onClick={() => update(u, { status: 'active' }, `Enabled ${u.name || u.email}`)}>
                  Enable
                </Button>
              ),
          },
        ].filter(Boolean)}
      />
    </>
  );
}

// --- Ad sizes ----------------------------------------------------------------

export function Sizes() {
  const { sizes } = useLoaderData();
  const revalidator = useRevalidator();
  const canWrite = useCanWrite();
  const [form, setForm] = useState({ width: '', height: '', name: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const add = async (event) => {
    event.preventDefault();
    const next = {};
    for (const field of ['width', 'height']) if (!/^[1-9]\d{0,3}$/.test(form[field])) next[field] = 'Enter 1 to 4000';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await post(api('/settings/sizes'), { width: Number(form.width), height: Number(form.height), name: form.name });
      setForm({ width: '', height: '', name: '' });
      await revalidator.revalidate();
      toast.success(`Added ${form.width}×${form.height}`);
    } catch (error) {
      setErrors(error.response?.status === 409 ? { width: 'That size already exists' } : fieldErrors(error));
      if (error.response?.status !== 409) toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (size) => {
    try {
      await del(api(`/settings/sizes/${size.id}`));
      await revalidator.revalidate();
      toast.success(`Removed ${size.width}×${size.height}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <SectionHeader title="Ad sizes" description="Standard IAB sizes are built in. Add a custom size when a placement needs one." />
      {canWrite && (
        <form onSubmit={add} noValidate className="mb-4 grid grid-cols-2 items-start gap-3 rounded-md border border-gray-400 p-4 md:grid-cols-[120px_120px_minmax(0,1fr)_auto]">
          <Field label="Width" error={errors.width}>
            {(props) => <Input {...props} inputMode="numeric" suffix="px" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />}
          </Field>
          <Field label="Height" error={errors.height}>
            {(props) => <Input {...props} inputMode="numeric" suffix="px" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />}
          </Field>
          <Field label="Name" optional className="max-md:col-span-2">
            {(props) => <Input {...props} maxLength={60} placeholder="Sidebar tile" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <Button type="submit" icon={Plus} loading={saving} className="mt-[26px] max-md:col-span-2 max-md:mt-0">
            Add size
          </Button>
        </form>
      )}
      <Table
        caption="Ad sizes"
        rows={sizes}
        columns={[
          { key: 'size', header: 'Size', mono: true, render: (s) => sizeLabel(`${s.width}x${s.height}`) },
          { key: 'name', header: 'Name' },
          { key: 'type', header: 'Type', render: (s) => <Badge tone={s.is_custom ? 'blue' : 'gray'}>{s.is_custom ? 'Custom' : 'IAB'}</Badge> },
          { key: 'creative_count', header: 'Creatives', align: 'right', render: (s) => num(s.creative_count) },
          canWrite && {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            width: 56,
            align: 'right',
            render: (s) => (s.is_custom && s.creative_count === 0 ? <IconButton icon={Trash2} label={`Remove ${s.width}×${s.height}`} onClick={() => remove(s)} /> : null),
          },
        ].filter(Boolean)}
      />
    </>
  );
}

// --- API keys ----------------------------------------------------------------

export function ApiKeys() {
  const { keys } = useLoaderData();
  const revalidator = useRevalidator();
  const canWrite = useCanWrite();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState(null);
  const [revoking, setRevoking] = useState(null);

  const create = async (event) => {
    event.preventDefault();
    if (!name.trim()) return setError('Name the key so you can tell it apart later');
    setSaving(true);
    try {
      const data = await post(api('/settings/keys'), { name: name.trim() });
      setSecret(data.secret);
      setName('');
      setError('');
      await revalidator.revalidate();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const closeCreate = () => {
    setCreating(false);
    setSecret(null);
    setError('');
  };

  const revoke = async () => {
    try {
      await post(api(`/settings/keys/${revoking.id}/revoke`));
      await revalidator.revalidate();
      toast.success(`Revoked ${revoking.name}`);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <>
      <SectionHeader
        title="API keys"
        description="Server-to-server credentials for the 55GMS edge. To rotate, create a new key, deploy it, then revoke the old one."
        action={
          canWrite && (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              Create key
            </Button>
          )
        }
      />
      <Table
        caption="API keys"
        rows={keys}
        columns={[
          {
            key: 'name',
            header: 'Key',
            render: (k) => (
              <span className="flex flex-col">
                <span className="font-medium">{k.name}</span>
                <span className="font-mono text-gray-900">{k.prefix}…</span>
              </span>
            ),
          },
          { key: 'status', header: 'Status', render: (k) => <StatusDot state={k.revoked_at ? 'revoked' : 'active'} label={k.revoked_at ? 'Revoked' : k.instances ? `Active · ${k.instances} ${k.instances === 1 ? 'instance' : 'instances'}` : 'Active'} /> },
          { key: 'last_used_at', header: 'Last used', render: (k) => <RelativeTime value={k.last_used_at} className="text-gray-900" /> },
          { key: 'last_batch_at', header: 'Last batch', render: (k) => <RelativeTime value={k.last_batch_at} className="text-gray-900" /> },
          { key: 'created_at', header: 'Created', render: (k) => <RelativeTime value={k.created_at} className="text-gray-900" /> },
          canWrite && {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (k) =>
              k.revoked_at ? null : (
                <Button size="sm" variant="tertiary" className="text-red-text" onClick={() => setRevoking(k)}>
                  Revoke
                </Button>
              ),
          },
        ].filter(Boolean)}
        empty={<EmptyState icon={KeyRound} title="No API keys yet" description="The edge module needs a key to fetch the manifest and send stats." action={canWrite ? { label: 'Create key', icon: Plus, onClick: () => setCreating(true) } : undefined} />}
      />

      <Modal
        open={creating}
        onClose={closeCreate}
        title={secret ? 'Copy your key now' : 'Create API key'}
        description={secret ? 'This is the only time the full key is shown. Store it as ADS_API_KEY on the 55GMS server.' : 'Name it after where it runs, such as “55GMS production”.'}
        width="max-w-lg"
        footer={
          secret ? (
            <Button variant="primary" onClick={closeCreate}>
              I have copied it
            </Button>
          ) : (
            <>
              <Button onClick={closeCreate} disabled={saving}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" form="key-form" loading={saving}>
                Create key
              </Button>
            </>
          )
        }
      >
        {secret ? (
          <CodeBlock code={secret} />
        ) : (
          <form id="key-form" onSubmit={create} noValidate>
            <Field label="Name" error={error}>
              {(props) => <Input {...props} data-autofocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
          </form>
        )}
      </Modal>
      <ConfirmModal
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        onConfirm={revoke}
        title="Revoke API key"
        description="Any edge instance using this key stops receiving the manifest and can no longer send stats. This cannot be undone."
        confirmText={revoking?.name}
        confirmLabel="Revoke key"
      />
    </>
  );
}

// --- Ingestion ---------------------------------------------------------------

export function Ingestion() {
  const { batches } = useLoaderData();
  const [detail, setDetail] = useState(null);
  const [lastDetail, setLastDetail] = useState(null);
  if (detail && detail !== lastDetail) setLastDetail(detail);
  const shown = detail || lastDetail;

  return (
    <>
      <SectionHeader title="Ingestion" description="The most recent hourly batches from the edge. Records older than 90 days are removed; stats are kept." />
      <Table
        caption="Recent batches"
        rows={batches}
        rowKey="batch_id"
        columns={[
          { key: 'received_at', header: 'Received', render: (b) => <RelativeTime value={b.received_at} /> },
          { key: 'status', header: 'Status', render: (b) => <StatusDot state={b.status} /> },
          { key: 'key_name', header: 'Key', render: (b) => b.key_name || <span className="text-gray-700">Deleted key</span> },
          { key: 'period', header: 'Period', mono: true, wide: true, render: (b) => (b.period_start ? `${absoluteTime(b.period_start)} – ${absoluteTime(b.period_end)}` : '—') },
          { key: 'row_count', header: 'Rows', align: 'right', render: (b) => num(b.row_count) },
          { key: 'impressions', header: 'Impressions', align: 'right', render: (b) => num(b.impressions) },
          { key: 'clicks', header: 'Clicks', align: 'right', render: (b) => num(b.clicks) },
          {
            key: 'errors',
            header: <span className="sr-only">Details</span>,
            align: 'right',
            render: (b) =>
              b.status === 'rejected' ? (
                <Button size="sm" variant="tertiary" onClick={() => setDetail(b)}>
                  View errors
                </Button>
              ) : null,
          },
        ]}
        empty={<EmptyState icon={ServerCog} title="No batches yet" description="The edge sends one at the top of each hour. You can also trigger a flush from the 55GMS server." />}
      />
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Rejected batch" description={shown ? `Batch ${shown.batch_id} was refused as a whole, so no counts from it were added.` : ''} width="max-w-2xl" footer={<Button onClick={() => setDetail(null)}>Close</Button>}>
        {shown && <CodeBlock lang="json" code={JSON.stringify(shown.errors, null, 2)} />}
      </Modal>
    </>
  );
}

// --- Audit log ---------------------------------------------------------------

const describe = (entry) => {
  const d = entry.detail || {};
  return d.name || d.hostname || d.email || d.size || d.url || (d.added !== undefined ? `${d.added} added` : '') || entry.entity_id || '';
};

export function AuditLog() {
  const { entries, total, page, pageSize } = useLoaderData();
  const [, setSearchParams] = useSearchParams();
  return (
    <>
      <SectionHeader title="Audit log" description="Who changed what, newest first." />
      <Table
        caption="Audit log"
        rows={entries}
        columns={[
          { key: 'created_at', header: 'When', render: (e) => <RelativeTime value={e.created_at} /> },
          { key: 'user', header: 'Who', render: (e) => e.user_name || e.user_email || <span className="text-gray-700">System</span> },
          { key: 'action', header: 'Action', mono: true },
          { key: 'detail', header: 'Subject', wide: true, render: (e) => <span className="break-all">{describe(e)}</span> },
        ]}
        empty={<EmptyState icon={ScrollText} title="Nothing recorded yet" description="Changes to campaigns, creatives, domains, keys, and members appear here." />}
        footer={<Pagination page={page} pageSize={pageSize} total={total} onPage={(next) => setSearchParams({ page: String(next) })} />}
      />
    </>
  );
}
