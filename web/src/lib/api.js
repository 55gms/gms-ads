import axios from 'axios';

export const http = axios.create({
  withCredentials: true,
  // Double-submit CSRF: the readable cookie is echoed in a header.
  xsrfCookieName: 'ads_csrf',
  xsrfHeaderName: 'X-CSRF-Token',
  headers: { Accept: 'application/json' },
});

let refreshing = null;
const refresh = () => {
  refreshing ||= http.post('/auth/refresh', null, { skipAuthRefresh: true }).finally(() => {
    refreshing = null;
  });
  return refreshing;
};

// On a 401, refresh the session once (shared by concurrent requests) and
// retry. If that fails the caller sees the original 401.
http.interceptors.response.use(undefined, async (error) => {
  const { config, response } = error;
  if (response?.status !== 401 || !config || config.skipAuthRefresh || config.retried) throw error;
  try {
    await refresh();
  } catch {
    // The session is gone: go to sign-in and come back to this page after.
    if (!window.location.pathname.startsWith('/login')) {
      const here = window.location.pathname + window.location.search;
      window.location.assign(here === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(here)}`);
    }
    throw error;
  }
  return http({ ...config, retried: true });
});

export function errorMessage(error, fallback = 'Something went wrong. Try again.') {
  if (error?.response?.data?.message) return error.response.data.message;
  if (error?.code === 'ERR_NETWORK') return 'Cannot reach the server. Check your connection.';
  return fallback;
}

export const fieldErrors = (error) => error?.response?.data?.fields || {};

// --- Cached reads -----------------------------------------------------------
// Loaders and hover-prefetch share this cache, so a prefetched page opens
// without a second request. Any write clears it.
const TTL = 15_000;
const cache = new Map();

const keyOf = (url, params) => `${url}?${new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null && v !== '')).toString()}`;

export function get(url, params) {
  const key = keyOf(url, params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.promise;
  const promise = http.get(url, { params }).then((res) => res.data);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

export const invalidate = () => cache.clear();

async function write(method, url, data, config) {
  const res = await http.request({ method, url, data, ...config });
  invalidate();
  return res.data;
}

export const post = (url, data, config) => write('post', url, data, config);
export const patch = (url, data, config) => write('patch', url, data, config);
export const del = (url, config) => write('delete', url, undefined, config);

export const api = (path) => `/api/admin${path}`;
