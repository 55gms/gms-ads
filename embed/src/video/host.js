// Runs video ads on a page: embedded slots, full-screen breaks, and rewarded
// ads, either for the page itself or for registered game iframes over the
// bridge. First party goes first; when it has no fill, the enabled external
// providers the ad server lists are tried in priority order.

import { event as bridgeEvent, frameOrigins, isSlug, outcome, readRequest, response } from '../bridge.js';
import { createClient } from './client.js';
import { googleInterstitial, googleRewarded } from './google.js';
import { askConsent, createPlayer, openModal } from './player.js';
import { loadVast, vastTracker } from './vast.js';

export const VERSION = '1.1.0';

export function createHost(base) {
  const client = createClient(base);
  let busy = false;

  function playModal(options) {
    let player;
    const closeModal = openModal((box) => {
      const holder = document.createElement('div');
      box.appendChild(holder);
      player = createPlayer(holder, Object.assign({ mode: 'modal' }, options));
      return player;
    });
    return player.finished.then((result) => {
      player.destroy();
      closeModal();
      return result;
    });
  }

  const plain = (result) => outcome(result === 'completed' ? 'completed' : result === 'skipped' ? 'skipped' : result === 'error' ? 'error' : 'cancelled');

  async function firstParty(s, o, ctl) {
    const rewarded = o.format === 'video_rewarded';
    const ev = client.events(s.token);
    if (rewarded && !(await askConsent({ rewardLabel: o.rewardLabel, premiumSkip: Boolean(s.policy && s.policy.rewardOnSkip) }))) {
      ev.push('close');
      await ev.done();
      return outcome('cancelled', { provider: 'first_party' });
    }
    ctl.pause();
    ev.push('impression');
    // A rewarded ad plays as soon as the viewer says yes to it.
    const result = await playModal({ ad: s.ad, policy: s.policy, reward: rewarded ? { label: o.rewardLabel } : null, clickUrl: s.clickUrl, autostart: rewarded, onEvent: (t, p) => ev.push(t, p) });
    await ev.done();
    if (!rewarded) return Object.assign(plain(result), { provider: 'first_party' });
    if (result === 'completed' || (result === 'skipped' && s.policy.rewardOnSkip)) {
      const claim = await client.claim(s.token);
      if (claim.granted) return outcome('granted', { provider: 'first_party', method: claim.grant.method, grant: claim.grant });
      return outcome('error', { provider: 'first_party', reason: claim.reason || 'not_granted' });
    }
    return Object.assign(plain(result), { provider: 'first_party' });
  }

  async function viaGoogle(p, o, ctl) {
    const rewarded = o.format === 'video_rewarded';
    let session = null;
    let ev = null;
    const track = async () => {
      if (session) return;
      session = await client.session({ format: o.format, provider: 'google_h5', gameId: o.gameId, placement: o.placement, rewardId: o.rewardId });
      ev = session.fill ? client.events(session.token) : null;
    };
    if (!rewarded) {
      const r = await googleInterstitial(p.config, {
        placement: o.placement,
        pause: () => {
          ctl.pause();
          track().then(() => ev && ev.push('start'));
        },
        resume: () => ctl.resume(),
      });
      if (ev) {
        ev.push('complete');
        await ev.done();
      }
      return outcome(r === 'viewed' ? 'completed' : r === 'error' ? 'error' : 'no_fill', { provider: 'google_h5' });
    }
    const r = await googleRewarded(p.config, {
      placement: o.placement,
      pause: ctl.pause,
      resume: ctl.resume,
      onAvailable: track,
      onStart: () => ev && ev.push('start'),
      offer: () => askConsent({ rewardLabel: o.rewardLabel, premiumSkip: false, providerName: 'Google' }),
    });
    if (r === 'no_fill') return outcome('no_fill');
    if (r === 'error') return outcome('error', { provider: 'google_h5' });
    if (r === 'declined') {
      if (ev) ev.push('close') && (await ev.done());
      return outcome('cancelled', { provider: 'google_h5' });
    }
    if (r === 'dismissed') {
      if (ev) ev.push('skip') && (await ev.done());
      return outcome('skipped', { provider: 'google_h5' });
    }
    // 'viewed': Google says the reward was earned. Our record is best effort;
    // the grant is reported as provider_reported, which it is.
    if (ev) {
      ev.push('complete');
      await ev.done();
      const claim = await client.claim(session.token);
      if (claim.granted) return outcome('granted', { provider: 'google_h5', method: 'provider_reported', grant: claim.grant });
    }
    return outcome('granted', { provider: 'google_h5', method: 'provider_reported', grant: null });
  }

  async function viaVast(p, o, ctl) {
    const rewarded = o.format === 'video_rewarded';
    const probe = document.createElement('video');
    const ad = await loadVast(p.config.tagUrl, {
      fetchText: (u) => fetch(u, { credentials: 'omit' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error('status ' + r.status)))),
      parseXml: (t) => new DOMParser().parseFromString(t, 'application/xml'),
      canPlay: (t) => Boolean(probe.canPlayType(t)),
    }).catch(() => null);
    if (!ad) return outcome('no_fill');
    if (rewarded && !(await askConsent({ rewardLabel: o.rewardLabel, premiumSkip: false, providerName: ad.advertiser }))) return outcome('cancelled', { provider: 'vast' });
    const session = await client.session({ format: o.format, provider: 'vast', gameId: o.gameId, placement: o.placement, rewardId: o.rewardId });
    const ev = session.fill ? client.events(session.token) : null;
    const tracker = vastTracker(ad);
    ctl.pause();
    const result = await playModal({
      ad: { mp4: ad.media.url, advertiser: ad.advertiser, title: ad.title, durationSeconds: ad.duration, width: ad.media.width, height: ad.media.height },
      policy: { skipAfterSeconds: ad.skipAfterSeconds, rewardOnSkip: false },
      reward: rewarded ? { label: o.rewardLabel } : null,
      clickUrl: ad.clickThrough,
      onClick: tracker.click,
      onEvent: (t, pos) => {
        if (t === 'start') tracker.impression();
        if (tracker[t]) tracker[t]();
        if (ev && t !== 'pause' && t !== 'resume') ev.push(t, pos);
      },
    });
    if (ev) await ev.done();
    if (rewarded && result === 'completed' && ev) {
      const claim = await client.claim(session.token);
      if (claim.granted) return outcome('granted', { provider: 'vast', method: 'provider_reported', grant: claim.grant });
    }
    return Object.assign(plain(result), { provider: 'vast' });
  }

  // o: { format, placement, rewardId, rewardLabel, gameId, pause(), resume() }
  // Always resolves; resume() is guaranteed to run if pause() did.
  async function show(o) {
    if (busy) return outcome('busy');
    busy = true;
    let paused = false;
    const ctl = {
      pause() {
        if (paused) return;
        paused = true;
        try {
          if (o.pause) o.pause();
        } catch (_e) {
          /* a game callback must not break the ad */
        }
      },
      resume() {
        if (!paused) return;
        paused = false;
        try {
          if (o.resume) o.resume();
        } catch (_e) {
          /* same */
        }
      },
    };
    try {
      const cfg = await client.config();
      if (!cfg.enabled) return outcome('unavailable');
      const s = await client.session({ format: o.format, gameId: o.gameId, placement: o.placement, rewardId: o.rewardId });
      if (s.fill) return await firstParty(s, o, ctl);
      if (s.reason === 'rate_limited') return outcome('unavailable', { reason: 'rate_limited' });
      for (const id of s.fallbacks || []) {
        const p = (cfg.providers || []).find((x) => x.id === id);
        if (!p || p.formats.indexOf(o.format) === -1) continue;
        const r = p.type === 'google_h5' ? await viaGoogle(p, o, ctl) : p.type === 'vast' ? await viaVast(p, o, ctl) : null;
        if (r && r.status !== 'no_fill') return r;
      }
      return outcome('no_fill');
    } catch (_e) {
      return outcome('error');
    } finally {
      ctl.resume();
      busy = false;
    }
  }

  async function available(format, gameId) {
    const cfg = await client.config();
    if (!cfg.enabled) return false;
    const a = await client.available(format, gameId);
    return Boolean(a.available);
  }

  // An embedded slot: asks for an ad once the slot is near the viewport,
  // shows the poster, and plays only when the viewer presses play.
  function renderSlot(el, fallback) {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        fill();
      },
      { rootMargin: '200px' }
    );
    io.observe(el);
    async function fill() {
      const s = await client.session({ format: 'video_embedded', gameId: isSlug(el.getAttribute('data-game')) ? el.getAttribute('data-game') : undefined });
      if (!s.fill) {
        if (el.getAttribute('data-fallback') === 'image' && fallback) return fallback(el);
        el.style.display = 'none';
        return;
      }
      el.textContent = '';
      el.style.display = 'block';
      el.style.maxWidth = '100%';
      const holder = document.createElement('div');
      el.appendChild(holder);
      const ev = client.events(s.token);
      const player = createPlayer(holder, { ad: s.ad, policy: s.policy, clickUrl: s.clickUrl, mode: 'inline', onEvent: (t, p) => ev.push(t, p) });
      // Impression: poster at least half visible for one continuous second.
      let timer = 0;
      const seen = new IntersectionObserver(
        (entries) => {
          const e = entries[0];
          if (e.intersectionRatio >= 0.5) {
            if (!timer)
              timer = setTimeout(() => {
                seen.disconnect();
                player.impression();
              }, 1000);
          } else {
            clearTimeout(timer);
            timer = 0;
            player.pause();
          }
        },
        { threshold: [0, 0.5] }
      );
      seen.observe(el);
      player.finished.then(() => ev.done());
    }
  }

  // --- Bridge (parent side) ---------------------------------------------------
  const frameHits = typeof WeakMap === 'function' ? new WeakMap() : null;

  function frameFor(source) {
    const frames = document.querySelectorAll('iframe[data-gms-game]');
    for (let i = 0; i < frames.length; i++) if (frames[i].contentWindow === source) return frames[i];
    return null;
  }

  async function onMessage(e) {
    const req = readRequest(e.data);
    if (!req || !e.source) return;
    // Only iframes the page registered, speaking from their own origin.
    const frame = frameFor(e.source);
    if (!frame) return;
    if (frameOrigins(frame.getAttribute('src') || frame.src, frame.getAttribute('data-gms-origins'), location.href).indexOf(e.origin) === -1) return;
    const gameId = frame.getAttribute('data-gms-game');
    if (!isSlug(gameId)) return;
    // At most 30 requests a minute from one frame.
    const now = Date.now();
    const hits = (frameHits.get(frame) || []).filter((t) => now - t < 60000);
    hits.push(now);
    frameHits.set(frame, hits);
    const reply = (ok, payload) => e.source.postMessage(response(req.id, ok, payload), e.origin);
    if (hits.length > 30) return reply(false, 'rate_limited');
    const send = (name) => e.source.postMessage(bridgeEvent(name), e.origin);
    const p = req.params;
    try {
      if (req.method === 'init') {
        const cfg = await client.config();
        return reply(true, { version: VERSION, gameId, enabled: Boolean(cfg.enabled) });
      }
      if (req.method === 'available') return reply(true, { available: await available(p.format || 'video_rewarded', gameId) });
      const format = req.method === 'showRewarded' ? 'video_rewarded' : 'video_fullscreen';
      reply(true, await show({ format, gameId, placement: p.placement, rewardId: p.rewardId, rewardLabel: p.rewardLabel, pause: () => send('pause'), resume: () => send('resume') }));
    } catch (_err) {
      reply(false, 'error');
    }
  }

  let bridged = false;
  function attachBridge(pending) {
    if (!bridged) {
      bridged = true;
      window.addEventListener('message', onMessage);
    }
    (pending || []).forEach(onMessage);
  }

  return { show, available, renderSlot, attachBridge, version: VERSION };
}
