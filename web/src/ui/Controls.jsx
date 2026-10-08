import { Check } from 'lucide-react';
import { useId } from 'react';
import { cx } from '../lib/cx.js';

export function Switch({ checked, onChange, label, disabled, className }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // The 44px touch target is the padding box; the track is the inner span.
      className={cx('inline-flex shrink-0 items-center rounded-full disabled:opacity-50 max-md:py-3', className)}
    >
      <span className={cx('relative h-5 w-9 rounded-full ease-hover', checked ? 'bg-blue' : 'bg-gray-500')}>
        <span
          className={cx(
            'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-background-100 shadow-[0_1px_2px_var(--ds-gray-alpha-400)]',
            'transition-transform duration-[120ms] ease-out',
            checked && 'translate-x-4'
          )}
        />
      </span>
    </button>
  );
}

export function Checkbox({ checked, onChange, children, disabled, className }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('inline-flex items-center gap-2 copy-14 max-md:min-h-11', disabled && 'cursor-not-allowed opacity-50', className)}>
      <span className="relative grid h-4 w-4 shrink-0 place-items-center">
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="peer absolute inset-0 appearance-none rounded-[4px] border border-gray-500 bg-background-100 ease-hover checked:border-gray-1000 checked:bg-gray-1000 hover:border-gray-700" />
        <Check size={12} strokeWidth={3} aria-hidden="true" className="pointer-events-none relative scale-50 text-background-100 opacity-0 transition-[opacity,transform] duration-[120ms] ease-out peer-checked:scale-100 peer-checked:opacity-100" />
      </span>
      {children}
    </label>
  );
}

// Radio group. `options` is [{ value, label, description }].
export function RadioGroup({ label, value, onChange, options, className }) {
  const name = useId();
  return (
    <fieldset className={cx('flex flex-col gap-1', className)}>
      {label && <legend className="mb-1.5 copy-13 font-medium text-gray-900">{label}</legend>}
      {options.map((option) => (
        <label key={option.value} className="flex items-start gap-2 py-1 copy-14 max-md:min-h-11 max-md:items-center">
          <span className="relative mt-0.5 grid h-4 w-4 shrink-0 place-items-center max-md:mt-0">
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="peer absolute inset-0 appearance-none rounded-full border border-gray-500 bg-background-100 ease-hover checked:border-gray-1000 hover:border-gray-700" />
            <span className="relative h-2 w-2 scale-0 rounded-full bg-gray-1000 transition-transform duration-[120ms] ease-out peer-checked:scale-100" />
          </span>
          <span>
            {option.label}
            {option.description && <span className="block copy-13 text-gray-900">{option.description}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function Slider({ value, onChange, min = 1, max = 100, step = 1, className, ...props }) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ '--fill': fill }}
      className={cx('slider w-full rounded-full max-md:h-11', className)}
      {...props}
    />
  );
}
