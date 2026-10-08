import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.js';
import { useEscape, useIsMobile, useOutsidePress, usePresence } from '../lib/hooks.js';

const SURFACE = 'rounded-md border border-gray-400 bg-raised shadow-popover';

// Positions a portal next to its anchor, flipping above when there is no
// room below, and animating from the trigger side.
export function Floating({ anchorRef, open, onClose, placement = 'bottom-start', offset = 6, matchWidth, mobileSheet, className, children, ...props }) {
  const ref = useRef(null);
  const isMobile = useIsMobile();
  const asSheet = mobileSheet && isMobile;
  const [mounted, state] = usePresence(open, asSheet ? 220 : 150);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!mounted || asSheet) return undefined;
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const el = ref.current;
      if (!anchor || !el) return;
      const { offsetWidth: width, offsetHeight: height } = el;
      const [side, align] = placement.split('-');
      const below = window.innerHeight - anchor.bottom;
      const above = side === 'top' ? above0(anchor, height, offset) : below < height + offset + 8 && anchor.top > below;
      let left = align === 'end' ? anchor.right - width : align === 'center' ? anchor.left + anchor.width / 2 - width / 2 : anchor.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      const top = above ? anchor.top - height - offset : anchor.bottom + offset;
      setPos({ top, left, above, minWidth: matchWidth ? anchor.width : undefined, originX: align === 'end' ? 'right' : align === 'center' ? 'center' : 'left' });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [mounted, asSheet, anchorRef, placement, offset, matchWidth]);

  useEscape(open, onClose);
  useOutsidePress(open, [anchorRef, ref], onClose);

  if (!mounted) return null;

  if (asSheet) {
    return createPortal(
      <div className="fixed inset-0 z-50">
        <div data-motion data-state={state} className="absolute inset-0 bg-gray-alpha-500 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <div
          ref={ref}
          data-motion
          data-state={state}
          className={cx('absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-auto rounded-t-lg border-t border-gray-400 bg-raised pb-[env(safe-area-inset-bottom)]', 'data-[state=closed]:animate-rise-out data-[state=open]:animate-rise-in')}
          {...props}
        >
          {children}
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      ref={ref}
      data-motion
      data-state={state}
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        minWidth: pos?.minWidth,
        visibility: pos ? 'visible' : 'hidden',
        transformOrigin: `${pos?.originX || 'left'} ${pos?.above ? 'bottom' : 'top'}`,
        '--pop-y': pos?.above ? '4px' : '-4px',
      }}
      className={cx('z-50', SURFACE, 'data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in', className)}
      {...props}
    >
      {children}
    </div>,
    document.body
  );
}

function above0(anchor, height, offset) {
  return anchor.top >= height + offset + 8;
}

// Generic popover: the trigger is a render prop that receives the props it
// needs to open the panel and describe its state.
export function Popover({ trigger, children, placement, className, mobileSheet, open: controlled, onOpenChange }) {
  const anchorRef = useRef(null);
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const setOpen = (next) => {
    setInner(next);
    onOpenChange?.(next);
  };
  return (
    <>
      {trigger({ ref: anchorRef, onClick: () => setOpen(!open), 'aria-expanded': open, 'aria-haspopup': 'dialog' })}
      <Floating anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} placement={placement} mobileSheet={mobileSheet} role="dialog" className={className}>
        {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
      </Floating>
    </>
  );
}

// Dropdown menu. `items` is a list of { label, icon, onSelect, danger,
// disabled } with `null` entries drawn as separators.
export function Menu({ trigger, items, placement = 'bottom-end', label }) {
  const anchorRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) anchorRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => listRef.current?.querySelector('[role=menuitem]:not(:disabled)')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const onKeyDown = (event) => {
    const options = [...listRef.current.querySelectorAll('[role=menuitem]:not(:disabled)')];
    const index = options.indexOf(document.activeElement);
    const move = (to) => {
      event.preventDefault();
      options[(to + options.length) % options.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(options.length - 1);
    else if (event.key === 'Tab') close(false);
  };

  return (
    <>
      {trigger({ ref: anchorRef, onClick: () => setOpen((v) => !v), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      <Floating anchorRef={anchorRef} open={open} onClose={() => close()} placement={placement} className="min-w-44 p-1">
        <div ref={listRef} role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {items.filter((item) => item !== false).map((item, i) =>
            item === null ? (
              <div key={`sep-${i}`} role="separator" className="-mx-1 my-1 h-px bg-gray-400" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={cx(
                  'flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left copy-14 ease-hover outline-none max-md:h-11',
                  'hover:bg-gray-alpha-200 focus-visible:bg-gray-alpha-200 focus-visible:shadow-none disabled:opacity-50',
                  item.danger ? 'text-red-text' : 'text-gray-1000'
                )}
              >
                {item.icon && <item.icon size={16} strokeWidth={1.5} aria-hidden="true" className={item.danger ? '' : 'text-gray-900'} />}
                {item.label}
              </button>
            )
          )}
        </div>
      </Floating>
    </>
  );
}

// Tooltips wait 400ms before the first one shows. While one is open, or just
// after it closed, neighbours show at once.
let warmUntil = 0;

export function Tooltip({ content, children, placement = 'top-center', className }) {
  const anchorRef = useRef(null);
  const timer = useRef(0);
  const id = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!content) return children;

  const show = () => {
    clearTimeout(timer.current);
    const delay = Date.now() < warmUntil ? 0 : 400;
    timer.current = setTimeout(() => {
      warmUntil = Infinity;
      setOpen(true);
    }, delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (open) warmUntil = Date.now() + 300;
    setOpen(false);
  };

  return (
    <>
      <span ref={anchorRef} className={cx('inline-flex', className)} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} aria-describedby={open ? id : undefined}>
        {children}
      </span>
      <TooltipBubble anchorRef={anchorRef} open={open} placement={placement} id={id}>
        {content}
      </TooltipBubble>
    </>
  );
}

function TooltipBubble({ anchorRef, open, placement, id, children }) {
  const ref = useRef(null);
  const [mounted, state] = usePresence(open, 120);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!mounted) return;
    const anchor = anchorRef.current?.getBoundingClientRect();
    const el = ref.current;
    if (!anchor || !el) return;
    const above = placement.startsWith('top') && anchor.top > el.offsetHeight + 12;
    const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - el.offsetWidth / 2, window.innerWidth - el.offsetWidth - 8));
    setPos({ left, top: above ? anchor.top - el.offsetHeight - 6 : anchor.bottom + 6, above });
  }, [mounted, anchorRef, placement, children]);

  if (!mounted) return null;
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      data-motion
      data-state={state}
      style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden', '--pop-y': pos?.above ? '2px' : '-2px' }}
      className="pointer-events-none z-[60] max-w-64 rounded-sm bg-gray-1000 px-2 py-1 copy-12 text-background-100 data-[state=closed]:animate-fade-out data-[state=open]:animate-tip-in"
    >
      {children}
    </div>,
    document.body
  );
}
