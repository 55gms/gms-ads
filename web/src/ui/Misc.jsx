import { ArrowDownRight, ArrowUpRight, Check, Copy, Minus } from 'lucide-react';
import { useRef, useState } from 'react';
import { cx } from '../lib/cx.js';
import { absoluteTime, relativeTime } from '../lib/format.js';
import { useCountUp, useNow } from '../lib/hooks.js';
import { Button } from './Button.jsx';
import { Tooltip } from './Floating.jsx';

// Bordered container. Header: title left, actions right. Footer sits on the
// sunken background behind a border.
export function Card({ title, description, actions, footer, children, className, padded = true }) {
  return (
    <section className={cx('rounded-md border border-gray-400 bg-background-100', className)}>
      {(title || actions) && (
        <header className="flex min-h-14 items-center justify-between gap-4 border-b border-gray-400 px-4 py-2 md:px-6">
          <div className="min-w-0">
            <h2 className="heading-16 truncate">{title}</h2>
            {description && <p className="copy-13 text-gray-900">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(padded && 'p-4 md:p-6')}>{children}</div>
      {footer && <footer className="rounded-b-md border-t border-gray-400 bg-background-200 px-4 py-3 copy-13 text-gray-900 md:px-6">{footer}</footer>}
    </section>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pt-8 pb-6 md:pt-10">
      <div className="min-w-0">
        <h1 className="heading-32">{title}</h1>
        {description && <div className="mt-1 copy-14 text-gray-900">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className, ...props }) {
  return <div aria-hidden="true" className={cx('skeleton', className)} {...props} />;
}

export function Avatar({ name, src, size = 28 }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || '?').trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  return (
    <span style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full border border-gray-alpha-300 bg-gray-200 font-medium text-gray-900">
      {src && !failed ? <img src={src} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setFailed(true)} /> : initials}
    </span>
  );
}

// The copy icon morphs to a check for 1.5s and "Copied" is announced.
export function CopyButton({ value, label = 'Copy', className }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-sm text-gray-900 ease-hover hover:bg-gray-alpha-200 hover:text-gray-1000 max-md:h-11 max-md:w-11', className)}
    >
      <Icon key={copied ? 'check' : 'copy'} data-motion size={16} strokeWidth={1.5} aria-hidden="true" className={cx('animate-check', copied && 'text-green-text')} />
      <span className="sr-only" role="status">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  );
}

export function CodeBlock({ code, label, className }) {
  return (
    <div className={cx('relative rounded-md border border-gray-400 bg-background-200', className)}>
      {label && <div className="border-b border-gray-400 px-4 py-2 copy-12 text-gray-900">{label}</div>}
      <pre tabIndex={0} className="overflow-x-auto p-4 pr-14 font-mono text-[13px] leading-5 text-gray-1000">
        <code>{code}</code>
      </pre>
      <CopyButton value={code} label="Copy code" className={cx('absolute right-2', label ? 'top-11' : 'top-2')} />
    </div>
  );
}

// Icon, one-line title, one-line description, one primary action.
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center text-center">
      {Icon && (
        <span className="mb-4 grid h-10 w-10 place-items-center rounded-md border border-gray-400 bg-background-100 text-gray-900">
          <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
        </span>
      )}
      <h3 className="heading-16">{title}</h3>
      {description && <p className="mt-1 copy-14 text-gray-900">{description}</p>}
      {action && (
        <Button variant="primary" size="sm" className="mt-4" icon={action.icon} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

// Cap progress: fills from zero on mount, amber from 80%, red at 100%.
export function Progress({ value, max, label, className }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const tone = ratio >= 1 ? 'bg-red' : ratio >= 0.8 ? 'bg-amber' : 'bg-gray-1000';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cx('h-1.5 w-full overflow-hidden rounded-full bg-gray-300', className)}
    >
      <div data-motion style={{ transform: `scaleX(${ratio})` }} className={cx('h-full w-full origin-left animate-fill rounded-full transition-transform duration-[300ms] ease-out', tone)} />
    </div>
  );
}

// Change against the previous period: arrow plus colour, never colour alone.
export function Delta({ value, className }) {
  if (value === null || value === undefined) return <span className={cx('copy-13 text-gray-700', className)}>No earlier data</span>;
  const flat = Math.abs(value) < 0.05;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cx('inline-flex items-center gap-0.5 copy-13 font-medium tabular', flat ? 'text-gray-900' : value > 0 ? 'text-green-text' : 'text-red-text', className)}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">{flat ? 'No change' : value > 0 ? 'Up' : 'Down'}</span>
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

// Large stat that counts from the previous value to the new one.
export function CountUp({ value, format }) {
  const shown = useCountUp(value);
  return <>{format(shown)}</>;
}

export function StatCard({ label, value, format, exact, delta, loading, footnote }) {
  return (
    <div className="rounded-md border border-gray-400 bg-background-100 p-4 md:p-6">
      <p className="copy-13 text-gray-900">{label}</p>
      {loading ? (
        <>
          <Skeleton className="mt-2 h-10 w-28" />
          <Skeleton className="mt-2 h-[18px] w-20" />
        </>
      ) : (
        <>
          <Tooltip content={exact} placement="top-center">
            <p className="mt-2 animate-fade-in text-[32px] leading-10 font-semibold tracking-[-0.04em] tabular md:text-[40px] md:leading-[48px]">
              <CountUp value={value} format={format} />
            </p>
          </Tooltip>
          <div className="mt-1 flex h-[18px] items-center gap-2">
            {delta !== undefined && <Delta value={delta} />}
            {footnote && <span className="copy-13 text-gray-700">{footnote}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// "3m ago" with the exact local timestamp in a tooltip.
export function RelativeTime({ value, className }) {
  const now = useNow();
  if (!value) return <span className={cx('text-gray-700', className)}>Never</span>;
  return (
    <Tooltip content={absoluteTime(value)}>
      <time dateTime={new Date(value).toISOString()} className={cx('whitespace-nowrap', className)}>
        {relativeTime(value, now)}
      </time>
    </Tooltip>
  );
}
