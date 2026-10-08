import { ChevronDown } from 'lucide-react';
import { useId } from 'react';
import { cx } from '../lib/cx.js';

// Label above, helper or error below. Children receive the ids through a
// render prop so every control is correctly associated.
export function Field({ label, hint, error, optional, className, children }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="copy-13 font-medium text-gray-900">
          {label}
          {optional && <span className="ml-1 font-normal text-gray-700">Optional</span>}
        </label>
      )}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={`${id}-error`} role="alert" className="copy-13 text-red-text">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="copy-13 text-gray-900">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const CONTROL =
  'w-full rounded-sm border bg-background-100 text-gray-1000 copy-14 ease-hover ' +
  'border-gray-400 hover:border-gray-500 focus:border-gray-500 aria-[invalid=true]:border-red ' +
  'disabled:bg-gray-100 disabled:text-gray-600 disabled:hover:border-gray-400';

// Input with optional prefix/suffix slots such as "https://" or "px".
export function Input({ prefix, suffix, className, mono, ...props }) {
  if (!prefix && !suffix) return <input className={cx(CONTROL, 'h-10 px-3', mono && 'font-mono', className)} {...props} />;
  return (
    <div
      className={cx(
        'flex h-10 w-full items-stretch overflow-hidden rounded-sm border border-gray-400 bg-background-100 ease-hover hover:border-gray-500',
        'focus-within:border-gray-500 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue has-[[aria-invalid=true]]:border-red',
        className
      )}
    >
      {prefix && <span className="flex items-center border-r border-gray-400 bg-background-200 px-3 copy-13 text-gray-900">{prefix}</span>}
      <input className={cx('min-w-0 flex-1 bg-transparent px-3 copy-14 text-gray-1000 outline-none focus-visible:shadow-none', mono && 'font-mono')} {...props} />
      {suffix && <span className="flex items-center border-l border-gray-400 bg-background-200 px-3 copy-13 text-gray-900">{suffix}</span>}
    </div>
  );
}

export function Textarea({ className, mono, rows = 4, ...props }) {
  return <textarea rows={rows} className={cx(CONTROL, 'min-h-20 resize-y px-3 py-2', mono && 'font-mono copy-13', className)} {...props} />;
}

export function Select({ className, children, size = 'md', ...props }) {
  return (
    <div className={cx('relative', className)}>
      <select className={cx(CONTROL, 'appearance-none pr-9 pl-3', size === 'sm' ? 'h-8 copy-13 max-md:h-11' : 'h-10')} {...props}>
        {children}
      </select>
      <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-900" />
    </div>
  );
}
