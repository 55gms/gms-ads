import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

export function useMediaQuery(query) {
  const subscribe = useCallback(
    (notify) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    [query]
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');

// Keeps a component mounted while its exit animation plays.
// Returns [mounted, state] where state is "open" or "closed".
export function usePresence(open, exitMs = 150) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return undefined;
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, mounted, exitMs]);
  return [mounted, open ? 'open' : 'closed'];
}

export function useLatest(value) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function useEscape(active, onEscape) {
  const handler = useLatest(onEscape);
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        handler.current(event);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, handler]);
}

export function useOutsidePress(active, refs, onOutside) {
  const handler = useLatest(onOutside);
  const targets = useLatest(refs);
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (event) => {
      if (targets.current.some((ref) => ref.current?.contains(event.target))) return;
      handler.current(event);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [active, handler, targets]);
}

const FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

// Traps Tab inside the container while active and returns focus to whatever
// had it before, once the container closes.
export function useFocusTrap(active, ref) {
  useEffect(() => {
    if (!active) return undefined;
    const previous = document.activeElement;
    const node = ref.current;
    const focusFirst = () => {
      const target = node?.querySelector('[data-autofocus]') || node?.querySelector(FOCUSABLE) || node;
      target?.focus({ preventScroll: true });
    };
    const frame = requestAnimationFrame(focusFirst);
    const onKey = (event) => {
      if (event.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return event.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [active]);
}

export function useDebounced(value, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// Animates from the previously shown number to the new one (~600ms ease-out).
export function useCountUp(target, duration = 600) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(target);
  const shown = useRef(target);
  useEffect(() => {
    const from = shown.current;
    if (reduced || from === target) {
      shown.current = target;
      setValue(target);
      return undefined;
    }
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 4;
      shown.current = from + (target - from) * eased;
      setValue(shown.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduced]);
  return value;
}

// Re-renders on an interval so relative times stay current.
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// Form state mirrored to localStorage (debounced) so unsaved work survives a
// reload. `clear` removes the draft and stops writes until the next edit.
export function useLocalDraft(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? { ...initial, ...JSON.parse(saved) } : initial;
    } catch {
      return initial;
    }
  });
  const paused = useRef(true);
  useEffect(() => {
    if (paused.current) return undefined;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage full or unavailable */
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [key, value]);
  const update = useCallback((next) => {
    paused.current = false;
    setValue(next);
  }, []);
  const clear = useCallback(() => {
    paused.current = true;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, [key]);
  return [value, update, clear];
}
