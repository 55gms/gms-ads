// Tiny module-level stores: theme preference, toasts, and command-menu state.
// Components subscribe with useSyncExternalStore.

import { useSyncExternalStore } from 'react';

function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? next(state) : next;
      listeners.forEach((fn) => fn());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

const useStore = (store) => useSyncExternalStore(store.subscribe, store.get);

// --- Theme -------------------------------------------------------------------
const readTheme = () => {
  try {
    return localStorage.getItem('theme') || 'system';
  } catch {
    return 'system';
  }
};
const themeStore = createStore(readTheme());
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(preference) {
  const dark = preference === 'dark' || (preference === 'system' && systemDark.matches);
  const root = document.documentElement;
  const next = dark ? 'dark' : 'light';
  if (root.getAttribute('data-theme') === next) return;
  // Colours change at once: transitions are off for the frame of the swap.
  root.classList.add('theme-switching');
  root.setAttribute('data-theme', next);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
}

systemDark.addEventListener('change', () => applyTheme(themeStore.get()));

export function setTheme(preference) {
  try {
    localStorage.setItem('theme', preference);
  } catch {
    /* storage unavailable */
  }
  themeStore.set(preference);
  applyTheme(preference);
}

export const useTheme = () => useStore(themeStore);

export function toggleTheme() {
  setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

// --- Toasts ------------------------------------------------------------------
const toastStore = createStore([]);
let toastId = 0;

export const useToasts = () => useStore(toastStore);
export const dismissToast = (id) => toastStore.set((list) => list.filter((t) => t.id !== id));

function push(type, message, options = {}) {
  const id = ++toastId;
  toastStore.set((list) => [...list.slice(-4), { id, type, message, duration: 4000, ...options }]);
  return id;
}

export const toast = {
  success: (message, options) => push('success', message, options),
  error: (message, options) => push('error', message, { duration: 6000, ...options }),
  info: (message, options) => push('info', message, options),
  // A reversible action: shows "Undo" for five seconds.
  undo: (message, onUndo) => push('info', message, { duration: 5000, action: { label: 'Undo', onClick: onUndo } }),
};

// --- Command menu ------------------------------------------------------------
const commandStore = createStore(false);
export const useCommandOpen = () => useStore(commandStore);
export const setCommandOpen = (open) => commandStore.set(open);
