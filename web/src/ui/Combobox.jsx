import { Check, X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { cx } from '../lib/cx.js';
import { Floating } from './Floating.jsx';

const ROW = 36;
const VISIBLE = 8;
const MAX_CHIPS = 24;

// Searchable multi-select. The option list is windowed, so thousands of
// options (all 1,500 domains) stay fast. `options` is [{ value, label }].
export function Combobox({ options, value, onChange, placeholder = 'Search', emptyText = 'No matches', mono, ...inputProps }) {
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const selected = useMemo(() => new Set(value), [value]);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (option) => {
    if (!option) return;
    onChange(selected.has(option.value) ? value.filter((v) => v !== option.value) : [...value, option.value]);
  };

  const moveTo = (index) => {
    const next = Math.max(0, Math.min(filtered.length - 1, index));
    setActive(next);
    const list = listRef.current;
    if (!list) return;
    if (next * ROW < list.scrollTop) list.scrollTop = next * ROW;
    else if ((next + 1) * ROW > list.scrollTop + list.clientHeight) list.scrollTop = (next + 1) * ROW - list.clientHeight;
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else moveTo(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveTo(active - 1);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      toggle(filtered[active]);
    } else if (event.key === 'Backspace' && !query && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  const start = Math.max(0, Math.floor(scrollTop / ROW) - 2);
  const end = Math.min(filtered.length, start + VISIBLE + 4);
  const chips = value.slice(0, MAX_CHIPS);

  return (
    <>
      <div
        ref={boxRef}
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-10 w-full flex-wrap items-center gap-1 rounded-sm border border-gray-400 bg-background-100 p-1 ease-hover hover:border-gray-500 focus-within:border-gray-500 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue"
      >
        {chips.map((v) => (
          <span key={v} className={cx('inline-flex h-7 items-center gap-1 rounded-[4px] bg-gray-100 pr-1 pl-2 copy-13', mono && 'font-mono')}>
            {byValue.get(v)?.label || 'Removed'}
            <button
              type="button"
              aria-label={`Remove ${byValue.get(v)?.label || 'item'}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((x) => x !== v));
              }}
              className="grid h-5 w-5 place-items-center rounded-[4px] text-gray-900 ease-hover hover:bg-gray-alpha-300 hover:text-gray-1000"
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </span>
        ))}
        {value.length > MAX_CHIPS && <span className="px-1 copy-13 text-gray-900">+{value.length - MAX_CHIPS} more</span>}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
          value={query}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            if (listRef.current) listRef.current.scrollTop = 0;
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cx('h-7 min-w-24 flex-1 bg-transparent px-2 copy-14 outline-none focus-visible:shadow-none', mono && 'font-mono')}
          {...inputProps}
        />
      </div>
      <Floating anchorRef={boxRef} open={open} onClose={() => setOpen(false)} matchWidth className="overflow-hidden">
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          style={{ maxHeight: ROW * VISIBLE }}
          className="overflow-auto"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-3 copy-13 text-gray-900">{emptyText}</p>
          ) : (
            <div style={{ height: filtered.length * ROW, position: 'relative' }}>
              {filtered.slice(start, end).map((option, i) => {
                const index = start + i;
                const isSelected = selected.has(option.value);
                return (
                  <div
                    key={option.value}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    style={{ position: 'absolute', top: index * ROW, height: ROW, left: 0, right: 0 }}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(option)}
                    className={cx('flex cursor-pointer items-center justify-between gap-2 px-3 copy-14', index === active && 'bg-gray-alpha-200', mono && 'font-mono copy-13')}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected && <Check size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-blue-text" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="border-t border-gray-400 bg-background-200 px-3 py-1.5 copy-12 text-gray-900 tabular">
          {value.length} selected · {filtered.length} shown
        </div>
      </Floating>
    </>
  );
}
