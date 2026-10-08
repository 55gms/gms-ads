import { Calendar, Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cx } from '../lib/cx.js';
import { PRESETS, resolveRange, toDateInput } from '../lib/range.js';
import { Button } from './Button.jsx';
import { Field, Input } from './Field.jsx';
import { Popover } from './Floating.jsx';

// Presets plus a custom range. `value` is { preset } or
// { preset: 'custom', from, to }. Opens as a bottom sheet on small screens.
export function DateRangePicker({ value, onChange }) {
  const resolved = resolveRange(value);
  const [from, setFrom] = useState(value.from || toDateInput(resolved.from));
  const [to, setTo] = useState(value.to || toDateInput(new Date()));
  const invalid = !from || !to || to < from;

  return (
    <Popover
      placement="bottom-end"
      mobileSheet
      className="w-72 max-md:w-auto"
      trigger={(props) => (
        <Button {...props} icon={Calendar} trailingIcon={ChevronDown} className="tabular">
          {resolved.label}
        </Button>
      )}
    >
      {({ close }) => (
        <div>
          <ul className="p-1" aria-label="Presets">
            {PRESETS.map((preset) => {
              const active = value.preset === preset.value;
              return (
                <li key={preset.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ preset: preset.value });
                      close();
                    }}
                    className={cx('flex h-9 w-full items-center justify-between rounded-sm px-2 copy-14 ease-hover hover:bg-gray-alpha-200 max-md:h-11', active && 'font-medium')}
                  >
                    {preset.label}
                    {active && <Check size={16} strokeWidth={1.5} aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <form
            className="border-t border-gray-400 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (invalid) return;
              onChange({ preset: 'custom', from, to });
              close();
            }}
          >
            <p className="mb-2 copy-13 font-medium text-gray-900">Custom</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From">{(props) => <Input {...props} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />}</Field>
              <Field label="To">{(props) => <Input {...props} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />}</Field>
            </div>
            {to && from && to < from && <p role="alert" className="mt-2 copy-13 text-red-text">End date is before the start date</p>}
            <Button type="submit" variant="primary" size="sm" className="mt-3 w-full">
              Apply range
            </Button>
          </form>
        </div>
      )}
    </Popover>
  );
}
