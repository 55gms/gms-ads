import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '../lib/cx.js';
import { dismissToast, useToasts } from '../lib/stores.js';

const ICONS = {
  success: [CircleCheck, 'text-green'],
  error: [CircleAlert, 'text-red'],
  info: [Info, 'text-gray-900'],
};
const GAP = 8;

// Bottom-right stack. Older toasts sit compressed behind the newest and the
// deck opens into a list on hover or focus.
export function Toaster() {
  const toasts = useToasts();
  const [expanded, setExpanded] = useState(false);
  const [heights, setHeights] = useState({});
  const ordered = [...toasts].reverse(); // newest first

  // Distance of each toast from the bottom when the deck is expanded.
  const offsets = ordered.reduce((list, item, i) => [...list, i === 0 ? 0 : list[i - 1] + (heights[ordered[i - 1].id] || 56) + GAP], []);
  return (
    <ol
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 bottom-4 z-[70] w-[min(380px,calc(100vw-32px))]"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
    >
      {ordered.map((item, index) => {
        const offset = offsets[index];
        return (
          <ToastItem
            key={item.id}
            item={item}
            index={index}
            paused={expanded}
            offset={expanded ? offset : index * 10}
            scale={expanded ? 1 : Math.max(0.85, 1 - index * 0.05)}
            hidden={!expanded && index > 2}
            onHeight={(h) => setHeights((prev) => (prev[item.id] === h ? prev : { ...prev, [item.id]: h }))}
          />
        );
      })}
    </ol>
  );
}

function ToastItem({ item, index, paused, offset, scale, hidden, onHeight }) {
  const ref = useRef(null);
  const remaining = useRef(item.duration);
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef(null);
  const [Icon, tone] = ICONS[item.type] || ICONS.info;

  const close = () => {
    setClosing(true);
    setTimeout(() => dismissToast(item.id), 150);
  };

  useEffect(() => {
    if (ref.current) onHeight(ref.current.offsetHeight);
  });

  // Auto-dismiss, with the clock stopped while the deck is hovered.
  useEffect(() => {
    if (paused || closing) return undefined;
    const began = Date.now();
    const timer = setTimeout(close, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(800, remaining.current - (Date.now() - began));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, closing]);

  const onPointerDown = (event) => {
    if (event.pointerType !== 'touch') return;
    start.current = event.clientX;
  };
  const onPointerMove = (event) => {
    if (start.current !== null) setDrag(Math.max(0, event.clientX - start.current));
  };
  const onPointerUp = () => {
    if (start.current === null) return;
    start.current = null;
    if (drag > 80) close();
    else setDrag(0);
  };

  return (
    <li
      ref={ref}
      role={item.type === 'error' ? 'alert' : 'status'}
      aria-live={item.type === 'error' ? 'assertive' : 'polite'}
      style={{
        transform: `translate(${drag}px, ${-offset}px) scale(${scale})`,
        opacity: closing || hidden ? 0 : drag ? 1 - drag / 200 : 1,
        zIndex: 10 - index,
        transition: drag ? 'none' : undefined,
      }}
      className={cx(
        'pointer-events-auto absolute right-0 bottom-0 w-full origin-bottom touch-pan-y',
        'transition-[transform,opacity] duration-[200ms] ease-out',
        hidden && 'pointer-events-none'
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div data-motion className="flex animate-toast-in items-start gap-3 rounded-md border border-gray-400 bg-raised p-3 pl-4 shadow-popover">
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" className={cx('mt-0.5 shrink-0', tone)} />
        <p className="min-w-0 flex-1 copy-14">{item.message}</p>
        {item.action && (
          <button
            type="button"
            className="shrink-0 rounded-sm px-2 copy-13 font-medium text-blue-text ease-hover hover:bg-blue-soft"
            onClick={() => {
              item.action.onClick();
              close();
            }}
          >
            {item.action.label}
          </button>
        )}
        <button type="button" aria-label="Dismiss" onClick={close} className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-gray-700 ease-hover hover:text-gray-1000">
          <X size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
