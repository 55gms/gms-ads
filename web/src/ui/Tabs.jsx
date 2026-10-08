import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { cx } from '../lib/cx.js';

function useRects(count, deps) {
  const refs = useRef([]);
  const [rects, setRects] = useState([]);
  useLayoutEffect(() => {
    const measure = () => setRects(refs.current.slice(0, count).map((el) => (el ? { left: el.offsetLeft, width: el.offsetWidth } : null)));
    measure();
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, ...deps]);
  return [refs, rects];
}

// Page navigation: a 2px underline slides between tabs, and a soft rounded
// highlight follows the pointer. Only transform and opacity are animated.
export function NavTabs({ tabs, onPrefetch }) {
  const { pathname } = useLocation();
  const active = tabs.findIndex((tab) => (tab.to === '/' ? pathname === '/' : pathname.startsWith(tab.to)));
  const [hovered, setHovered] = useState(-1);
  const [refs, rects] = useRects(tabs.length, [pathname]);
  const underline = rects[active];
  const highlight = rects[hovered];

  return (
    <nav aria-label="Sections" className="edge-fade -mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 md:[mask-image:none]">
      <div className="relative flex h-12 items-center" onMouseLeave={() => setHovered(-1)}>
        <span
          aria-hidden="true"
          style={{ width: highlight?.width, transform: `translateX(${highlight?.left ?? rects[active]?.left ?? 0}px)`, opacity: highlight ? 1 : 0 }}
          className="pointer-events-none absolute top-2 left-0 h-8 rounded-sm bg-gray-alpha-200 transition-[transform,opacity] duration-[200ms] ease-out"
        />
        {tabs.map((tab, i) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            viewTransition
            ref={(el) => {
              refs.current[i] = el;
            }}
            onMouseEnter={() => {
              setHovered(i);
              onPrefetch?.(tab);
            }}
            onFocus={() => onPrefetch?.(tab)}
            className={({ isActive }) =>
              cx('relative flex h-8 shrink-0 items-center rounded-sm px-3 copy-14 ease-hover max-md:h-11', isActive ? 'text-gray-1000' : 'text-gray-900 hover:text-gray-1000')
            }
          >
            {tab.label}
          </NavLink>
        ))}
        {underline && (
          <span
            aria-hidden="true"
            style={{ transform: `translateX(${underline.left}px) scaleX(${underline.width / 100})` }}
            className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-[100px] origin-left bg-gray-1000 transition-transform duration-[200ms] ease-out"
          />
        )}
      </div>
    </nav>
  );
}

// In-page segmented control. `options` is [{ value, label }].
export function Segmented({ value, onChange, options, label, size = 'md', className }) {
  const index = options.findIndex((option) => option.value === value);
  const [refs, rects] = useRects(options.length, [options.map((o) => o.label).join('|')]);
  const pill = rects[index];

  const onKeyDown = (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cx('relative inline-flex rounded-sm bg-gray-100 p-0.5', className)}>
      {pill && (
        <span
          aria-hidden="true"
          style={{ width: pill.width, transform: `translateX(${pill.left - 2}px)` }}
          className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-[4px] border border-gray-400 bg-background-100 transition-transform duration-[200ms] ease-out"
        />
      )}
      {options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          ref={(el) => {
            refs.current[i] = el;
          }}
          onClick={() => onChange(option.value)}
          className={cx(
            'relative z-[1] inline-flex items-center justify-center gap-1.5 rounded-[4px] px-3 copy-13 font-medium ease-hover max-md:min-h-10',
            size === 'sm' ? 'h-7' : 'h-8',
            option.value === value ? 'text-gray-1000' : 'text-gray-900 hover:text-gray-1000'
          )}
        >
          {option.icon && <option.icon size={14} strokeWidth={1.5} aria-hidden="true" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
