import { cx } from '../lib/cx.js';

const TONES = {
  gray: 'bg-gray-100 text-gray-900 border-gray-400',
  blue: 'bg-blue-soft text-blue-text border-blue-border',
  green: 'bg-green-soft text-green-text border-green-border',
  amber: 'bg-amber-soft text-amber-text border-amber-border',
  red: 'bg-red-soft text-red-text border-red-border',
  purple: 'bg-purple-soft text-purple-text border-purple-border',
};

export function Badge({ tone = 'gray', children, className }) {
  return <span className={cx('inline-flex h-5 items-center rounded-full border px-2 copy-12 font-medium whitespace-nowrap', TONES[tone], className)}>{children}</span>;
}

const STATES = {
  active: { label: 'Active', dot: 'bg-green', tone: 'green' },
  scheduled: { label: 'Scheduled', dot: 'bg-amber', tone: 'amber' },
  paused: { label: 'Paused', dot: 'bg-amber', tone: 'amber' },
  ended: { label: 'Ended', dot: 'bg-red', tone: 'red' },
  draft: { label: 'Draft', dot: 'bg-gray-600', tone: 'gray' },
  accepted: { label: 'Accepted', dot: 'bg-green', tone: 'green' },
  rejected: { label: 'Rejected', dot: 'bg-red', tone: 'red' },
  pending: { label: 'Pending', dot: 'bg-amber', tone: 'amber' },
  disabled: { label: 'Disabled', dot: 'bg-gray-600', tone: 'gray' },
  revoked: { label: 'Revoked', dot: 'bg-red', tone: 'red' },
};

// 8px dot plus label. Only "active" pulses; every other state is static.
export function StatusDot({ state, label, className }) {
  const meta = STATES[state] || STATES.draft;
  return (
    <span className={cx('inline-flex items-center gap-2 copy-13 whitespace-nowrap', className)}>
      <span className="relative grid h-2 w-2 place-items-center">
        {state === 'active' && <span data-motion="loop" className="absolute inset-0 animate-pulse-ring rounded-full bg-green" />}
        <span className={cx('relative h-2 w-2 rounded-full', meta.dot)} />
      </span>
      {label || meta.label}
    </span>
  );
}

export function StatusBadge({ state }) {
  const meta = STATES[state] || STATES.draft;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function SourceBadge({ source }) {
  return source === 'external' ? <Badge tone="purple">jsDelivr</Badge> : <Badge tone="blue">Upload</Badge>;
}

export function RoleBadge({ role }) {
  return <Badge tone={role === 'owner' ? 'blue' : 'gray'}>{role[0].toUpperCase() + role.slice(1)}</Badge>;
}
