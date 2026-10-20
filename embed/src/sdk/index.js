// 55GMS game ads SDK (sdk.min.js). Framework-free; a game adds one script
// tag and calls window.GMSAds. Every call resolves (never rejects) with an
// outcome object, and every pause is followed by a resume, so an ad that
// fails, times out, or is blocked cannot leave a game stuck.
//
//   await GMSAds.init({ gameId: 'my-game', onPause, onResume });
//   const r = await GMSAds.showRewardedAd({ placement: 'revive', rewardId: 'extra-life', rewardLabel: 'an extra life' });
//   if (r.rewardGranted) game.addLife();
//
// In an iframe, ads are shown by the parent page (ads.js) over postMessage.
// As a top-level page, the SDK loads video.min.js and shows them itself.

import { isSlug, outcome, readResponse, request } from '../bridge.js';
import { installCompat, registerAdapter } from './compat.js';

(function (win, doc) {
  if (win.GMSAds && win.GMSAds.version) return;

  const VERSION = '1.2.0';
  const script = doc.currentScript;
  const listeners = {};
  const pending = new Map(); // id -> { resolve, timer }
  let state = null; // { mode, gameId, enabled, opts, parentOrigin, host }
  let initPromise = null;
  let inFlight = null;
  let seq = 0;

  const emit = (name, data) =>
    (listeners[name] || []).slice().forEach((fn) => {
      try {
        fn(data);
      } catch (_e) {
        /* a listener must not break the SDK */
      }
    });

  // Pause/resume are paired: resume only fires after a pause, once.
  let paused = false;
  function gamePause() {
    if (paused) return;
    paused = true;
    emit('pause');
    if (state && state.opts.onPause) safe(state.opts.onPause);
  }
  function gameResume() {
    if (!paused) return;
    paused = false;
    emit('resume');
    if (state && state.opts.onResume) safe(state.opts.onResume);
  }
  function safe(fn) {
    try {
      fn();
    } catch (_e) {
      /* game callbacks must not break the SDK */
    }
  }

  // --- Bridge client -----------------------------------------------------------
  function expectedParentOrigin(opts) {
    if (opts.parentOrigin) return opts.parentOrigin;
    try {
      if (win.location.ancestorOrigins && win.location.ancestorOrigins.length) return win.location.ancestorOrigins[0];
    } catch (_e) {
      /* not available */
    }
    return null;
  }

  function onMessage(e) {
    if (!state || e.source !== win.parent) return;
    if (state.parentOrigin && e.origin !== state.parentOrigin) return;
    const msg = readResponse(e.data, pending);
    if (!msg) return;
    if (msg.event) return msg.event === 'pause' ? gamePause() : gameResume();
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    // The first answer fixes which origin the parent speaks from.
    if (!state.parentOrigin) state.parentOrigin = e.origin;
    entry.resolve(msg.ok ? msg.result : { error: msg.error || 'error' });
  }

  function call(method, params, timeoutMs) {
    return new Promise((resolve) => {
      const id = 'g' + ++seq + '-' + Math.random().toString(36).slice(2, 8);
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ error: 'timeout' });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      // Nothing secret is in a request; replies are checked on arrival.
      win.parent.postMessage(request(id, method, params), state.parentOrigin || '*');
    });
  }

  // --- Direct mode -------------------------------------------------------------
  function loadVideo(opts) {
    return new Promise((resolve, reject) => {
      if (win.__gmsAdsVideo) return resolve(win.__gmsAdsVideo.host(opts.endpoint));
      const src = opts.videoSrc || (script && script.src ? script.src.replace(/sdk(\.min)?\.js(\?.*)?$/, 'video.min.js') : '');
      if (!src) return reject(new Error('no video.min.js'));
      const s = doc.createElement('script');
      s.src = src;
      s.async = true;
      if (/^https:/.test(src) && __VIDEO_SRI__ && !opts.videoSrc) {
        s.integrity = __VIDEO_SRI__;
        s.crossOrigin = 'anonymous';
      }
      s.onload = () => (win.__gmsAdsVideo ? resolve(win.__gmsAdsVideo.host(opts.endpoint)) : reject(new Error('video')));
      s.onerror = () => reject(new Error('video'));
      doc.head.appendChild(s);
    });
  }

  // --- Public API ---------------------------------------------------------------
  function init(options) {
    if (initPromise) return initPromise;
    const opts = Object.assign({ endpoint: '/_ads', timeoutMs: 3000, showTimeoutMs: 10 * 60 * 1000 }, options || {});
    if (!isSlug(opts.gameId)) opts.gameId = undefined;
    state = { mode: 'none', gameId: opts.gameId, enabled: false, opts, parentOrigin: expectedParentOrigin(opts), host: null };
    win.addEventListener('message', onMessage);
    // Before the handshake, so a stand-in the game defines meanwhile is
    // wrapped as it is assigned. The adapters' calls wait for init themselves.
    if (opts.compat) installCompat(opts.compat, api);
    initPromise = (async () => {
      if (win.parent && win.parent !== win) {
        // The parent's ads.js loads async and may not be listening yet, so
        // the hello is repeated in short attempts within the timeout.
        let r = { error: 'timeout' };
        for (let waited = 0; r.error === 'timeout' && waited < opts.timeoutMs; waited += 500) r = await call('init', {}, 500);
        if (!r.error) {
          state.mode = 'bridge';
          state.enabled = Boolean(r.enabled);
          // The host's game ID (from its iframe attribute) wins over ours.
          state.gameId = r.gameId || state.gameId;
        }
      }
      if (state.mode === 'none' && opts.direct !== false) {
        try {
          state.host = await loadVideo(opts);
          state.mode = 'direct';
          state.enabled = true;
        } catch (_e) {
          state.mode = 'none';
        }
      }
      return { mode: state.mode, enabled: state.enabled, gameId: state.gameId || null, version: VERSION };
    })();
    return initPromise;
  }

  async function isRewardedAdAvailable(o) {
    await (initPromise || init());
    if (!state.enabled) return false;
    if (state.mode === 'bridge') {
      const r = await call('available', { format: 'video_rewarded', placement: o && isSlug(o.placement) ? o.placement : undefined }, state.opts.timeoutMs * 2);
      return Boolean(r && r.available);
    }
    if (state.mode === 'direct') return state.host.available('video_rewarded', state.gameId).catch(() => false);
    return false;
  }

  function show(method, format, o) {
    if (inFlight) return Promise.resolve(outcome('busy'));
    const params = {};
    if (o && isSlug(o.placement)) params.placement = o.placement;
    if (o && isSlug(o.rewardId)) params.rewardId = o.rewardId;
    if (o && typeof o.rewardLabel === 'string') params.rewardLabel = o.rewardLabel.slice(0, 80);
    inFlight = (async () => {
      try {
        await (initPromise || init());
        if (!state.enabled) return outcome('unavailable');
        let result;
        if (state.mode === 'bridge') {
          result = await call(method, params, state.opts.showTimeoutMs);
          if (result && result.error) result = outcome(result.error === 'timeout' ? 'timeout' : 'error', { reason: result.error });
        } else {
          result = await Promise.race([
            state.host.show(Object.assign({ format, gameId: state.gameId, pause: gamePause, resume: gameResume }, params)),
            new Promise((r) => setTimeout(() => r(outcome('timeout')), state.opts.showTimeoutMs)),
          ]);
        }
        result = outcome(result.status, result);
        if (result.rewardGranted) emit('rewardGranted', result);
        emit('adFinished', result);
        return result;
      } catch (_e) {
        return outcome('error');
      } finally {
        // Whatever happened, the game gets its resume.
        gameResume();
        inFlight = null;
      }
    })();
    return inFlight;
  }

  const api = {
    version: VERSION,
    init,
    isRewardedAdAvailable,
    showRewardedAd: (o) => show('showRewarded', 'video_rewarded', o),
    // For natural breaks only (between levels, after a game over).
    showInterstitial: (o) => show('showInterstitial', 'video_fullscreen', o),
    on(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return api;
    },
    off(name, fn) {
      listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
      return api;
    },
    // Per-game adapters: GMSAds.adapters.register('my-engine', (win, ads) => { ... })
    adapters: { register: registerAdapter },
    get mode() {
      return state ? state.mode : 'none';
    },
    destroy() {
      win.removeEventListener('message', onMessage);
      pending.forEach((entry) => {
        clearTimeout(entry.timer);
        entry.resolve({ error: 'destroyed' });
      });
      pending.clear();
      gameResume();
      state = null;
      initPromise = null;
    },
  };

  win.GMSAds = api;
  // Games that load the SDK with data-game-id start without an init call.
  const auto = script && script.getAttribute('data-game-id');
  if (auto) init({ gameId: auto, compat: (script.getAttribute('data-compat') || '').split(/[\s,]+/).filter(Boolean) });
})(window, document);
