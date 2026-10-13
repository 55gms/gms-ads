// Talks to the edge under /_ads/v/*. Events are batched per session and sent
// in order; terminal events (complete, skip, close, error) are flushed at
// once and awaited, because a reward claim depends on them being recorded.

// 'start' too: the server times completion from when it hears about it.
const TERMINAL = { start: 1, complete: 1, skip: 1, close: 1, error: 1 };

function nonce() {
  // Per-tab, so visitors on one shared network do not share limits. Not
  // persisted beyond the tab and never sent anywhere but this origin.
  try {
    let n = sessionStorage.getItem('gmsAdsTab');
    if (!n) {
      n = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem('gmsAdsTab', n);
    }
    return n;
  } catch (_e) {
    return '';
  }
}

export function createClient(base) {
  const tab = nonce();
  const post = (path, body, keepalive) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', keepalive: Boolean(keepalive) }).then((res) =>
      res.json().then(
        (data) => ({ status: res.status, data }),
        () => ({ status: res.status, data: null })
      )
    );

  let config = null;
  return {
    config() {
      config =
        config ||
        fetch(base + '/v/config', { credentials: 'same-origin' })
          .then((r) => (r.ok ? r.json() : { enabled: false, providers: [] }))
          .catch(() => ({ enabled: false, providers: [] }));
      return config;
    },
    available: (format, gameId) =>
      post('/v/available', { format, gameId, nonce: tab })
        .then((r) => r.data || { available: false })
        .catch(() => ({ available: false })),
    session: (body) =>
      post('/v/session', Object.assign({ nonce: tab }, body))
        .then((r) => (r.status === 200 && r.data ? r.data : { fill: false, reason: r.status === 429 ? 'rate_limited' : 'unavailable' }))
        .catch(() => ({ fill: false, reason: 'unavailable' })),
    // Returns a tracker bound to one session token.
    events(token) {
      let queue = [];
      let timer = 0;
      let chain = Promise.resolve();
      const flush = (keepalive) => {
        clearTimeout(timer);
        timer = 0;
        if (!queue.length) return chain;
        const events = queue;
        queue = [];
        chain = chain.then(() => post('/v/event', { token, events }, keepalive).catch(() => null));
        return chain;
      };
      const onHide = () => flush(true);
      window.addEventListener('pagehide', onHide);
      return {
        push(type, position) {
          queue.push({ type, position: Math.round((position || 0) * 100) / 100 });
          if (TERMINAL[type]) return flush();
          if (!timer) timer = setTimeout(flush, 1000);
          return chain;
        },
        flush,
        done() {
          window.removeEventListener('pagehide', onHide);
          return flush();
        },
      };
    },
    // Idempotent: the same key and session always return the same grant.
    claim(token) {
      const key = token.slice(-16) + '-claim';
      const attempt = (n) =>
        post('/v/reward', { token, idempotencyKey: key }).then(
          (r) => (r.status >= 500 && n < 2 ? new Promise((res) => setTimeout(res, 800 * (n + 1))).then(() => attempt(n + 1)) : r.data || { granted: false, reason: 'unavailable' }),
          () => (n < 2 ? new Promise((res) => setTimeout(res, 800 * (n + 1))).then(() => attempt(n + 1)) : { granted: false, reason: 'unavailable' })
        );
      return attempt(0);
    },
  };
}
