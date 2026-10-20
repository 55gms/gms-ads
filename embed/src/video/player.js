// The 55GMS video ad player. Plain DOM in a shadow root so host-page CSS
// cannot reach it. Rules it enforces:
//   - Nothing plays until the viewer presses play. preload="none" until then.
//   - One ad plays at a time across the page.
//   - Skip appears only when the policy allows it; a skip is never a completion.
//   - Seeking and playback-rate changes are not possible.
// It reports lifecycle through onEvent(type, position) and resolves finished
// with 'completed' | 'skipped' | 'closed' | 'error'.

const HLS_JS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.light.min.js';
let playing = null; // the player currently producing sound and picture
let hlsLoad = null;

const CSS = `
:host{all:initial;display:block;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff}
*{box-sizing:border-box}
.f{position:relative;width:100%;background:#000;overflow:hidden;border-radius:inherit}
.f:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}
video{display:block;width:100%;height:100%;object-fit:contain;background:#000}
.pv{position:absolute;inset:0;background:#000 center/contain no-repeat;display:grid;place-items:center}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}
button:focus-visible,a:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}
.big{display:flex;align-items:center;gap:8px;padding:10px 18px 10px 14px;border-radius:999px;background:rgba(0,0,0,.72);font-weight:600;font-size:14px;box-shadow:0 0 0 1px rgba(255,255,255,.25)}
.big:hover{background:rgba(0,0,0,.85)}
.top,.bar{position:absolute;left:0;right:0;display:flex;align-items:center;gap:8px;padding:8px}
.top{top:0;background:linear-gradient(rgba(0,0,0,.6),transparent)}
.bar{bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.7));padding-top:20px}
.tag{padding:1px 5px;border-radius:3px;background:#facc15;color:#000;font-weight:700;font-size:11px}
.by{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;opacity:.9}
.ic{width:32px;height:32px;display:grid;place-items:center;border-radius:6px}
.ic:hover{background:rgba(255,255,255,.15)}
.pill{padding:6px 12px;border-radius:6px;background:rgba(0,0,0,.7);box-shadow:0 0 0 1px rgba(255,255,255,.3);white-space:nowrap}
.pill[disabled]{cursor:default;opacity:.85}
.lm{padding:6px 12px;border-radius:6px;background:#fff;color:#000;font-weight:600;text-decoration:none;white-space:nowrap}
.t{font-variant-numeric:tabular-nums;opacity:.9;white-space:nowrap}
.sp{flex:1}
.vol{width:72px;accent-color:#fff}
.pr{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.25)}
.pr i{display:block;height:100%;width:100%;background:#facc15;transform-origin:left;transform:scaleX(0)}
.ov{position:absolute;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.72);padding:16px;text-align:center}
.ov p{margin:0 0 12px;max-width:340px}
.row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.spin{width:28px;height:28px;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:r .8s linear infinite}
@keyframes r{to{transform:rotate(1turn)}}
@media (prefers-reduced-motion:reduce){.spin{animation-duration:2.4s}}
@media (max-width:420px){.vol{display:none}.by{font-size:12px}}
[hidden]{display:none!important}
`;

const ICONS = {
  play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  vol: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>',
  mute: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

function el(tag, attrs, html) {
  const node = document.createElement(tag);
  for (const k in attrs || {}) {
    if (attrs[k] === true) node.setAttribute(k, '');
    else if (attrs[k] != null && attrs[k] !== false) node.setAttribute(k, attrs[k]);
  }
  if (html) node.innerHTML = html; // only ever our own static icon markup
  return node;
}

const fmt = (s) => {
  s = Math.max(0, Math.ceil(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function loadHls() {
  hlsLoad =
    hlsLoad ||
    new Promise((resolve, reject) => {
      if (window.Hls) return resolve(window.Hls);
      const s = document.createElement('script');
      s.src = HLS_JS;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('hls.js missing')));
      s.onerror = () => {
        hlsLoad = null;
        reject(new Error('hls.js failed to load'));
      };
      document.head.appendChild(s);
    });
  return hlsLoad;
}

// Sets the source only now, at play time: nothing is downloaded before.
async function attachSource(video, ad) {
  if (ad.mp4) {
    video.src = ad.mp4;
    return null;
  }
  if (!ad.hls) throw new Error('no playable source');
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = ad.hls;
    return null;
  }
  const Hls = await loadHls();
  if (!Hls.isSupported()) throw new Error('HLS is not supported here');
  const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 20 });
  hls.loadSource(ad.hls);
  hls.attachMedia(video);
  return hls;
}

// options:
//   ad:      { poster, mp4, hls, advertiser, title, durationSeconds, width, height }
//   policy:  { skipAfterSeconds (null = no skip), rewardOnSkip }
//   reward:  { label } for rewarded, else null
//   clickUrl, mode ('inline' | 'modal'), onEvent(type, position), onClick()
//   autostart: play at once, as when the viewer just said yes to the ad
export function createPlayer(host, options) {
  const ad = options.ad;
  const policy = options.policy || {};
  const reward = options.reward || null;
  const modal = options.mode === 'modal';
  const root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
  const style = el('style');
  style.textContent = CSS;
  root.appendChild(style);

  const ratio = ad.width && ad.height ? ad.width + ' / ' + ad.height : '16 / 9';
  const frame = el('div', { class: 'f', tabindex: '0', role: 'region', 'aria-label': 'Advertisement' });
  frame.style.aspectRatio = ratio;
  if (modal) {
    frame.style.maxHeight = '80vh';
    frame.style.maxWidth = 'min(100%, calc(80vh * ' + (ad.width && ad.height ? ad.width / ad.height : 16 / 9) + '))';
    frame.style.margin = '0 auto';
  }
  const video = el('video', { playsinline: true, 'webkit-playsinline': true, preload: 'none', disablepictureinpicture: true, disableremoteplayback: true, 'aria-label': 'Video advertisement' });
  if (ad.poster) video.poster = ad.poster;

  const poster = el('div', { class: 'pv' });
  if (ad.poster) poster.style.backgroundImage = 'url("' + String(ad.poster).replace(/["\\]/g, '') + '")';
  const big = el('button', { class: 'big', type: 'button' }, ICONS.play);
  big.appendChild(document.createTextNode('Play ad'));
  poster.appendChild(big);

  const top = el('div', { class: 'top' });
  const tag = el('span', { class: 'tag' });
  tag.textContent = 'Ad';
  const by = el('span', { class: 'by' });
  by.textContent = ad.advertiser ? 'Sponsored by ' + ad.advertiser : 'Sponsored';
  const skip = el('button', { class: 'pill', type: 'button', hidden: true });
  const close = el('button', { class: 'ic', type: 'button', 'aria-label': 'Close ad', hidden: !modal }, ICONS.x);
  top.append(tag, by, skip, close);

  const bar = el('div', { class: 'bar', hidden: true });
  const toggle = el('button', { class: 'ic', type: 'button', 'aria-label': 'Pause' }, ICONS.pause);
  const muteBtn = el('button', { class: 'ic', type: 'button', 'aria-label': 'Mute' }, ICONS.vol);
  const vol = el('input', { class: 'vol', type: 'range', min: '0', max: '1', step: '0.05', value: '1', 'aria-label': 'Volume' });
  const time = el('span', { class: 't', 'aria-live': 'off' });
  const spacer = el('span', { class: 'sp' });
  bar.append(toggle, muteBtn, vol, time, spacer);
  if (options.clickUrl) {
    const more = el('a', { class: 'lm', href: options.clickUrl, target: '_blank', rel: 'noopener sponsored' });
    more.textContent = 'Learn more';
    more.addEventListener('click', () => {
      if (!video.paused) video.pause();
      if (options.onClick) options.onClick();
    });
    bar.appendChild(more);
  }
  const progress = el('div', { class: 'pr', role: 'progressbar', 'aria-label': 'Ad progress', 'aria-valuemin': '0', 'aria-valuemax': '100', hidden: true });
  const fill = el('i');
  progress.appendChild(fill);
  const spin = el('div', { class: 'ov', hidden: true }, '<div class="spin" role="status" aria-label="Loading"></div>');
  const overlay = el('div', { class: 'ov', hidden: true });

  frame.append(video, poster, top, bar, progress, spin, overlay);
  root.appendChild(frame);

  let resolveFinish;
  const finished = new Promise((r) => (resolveFinish = r));
  let state = 'idle'; // idle | loading | playing | paused | done
  let hls = null;
  let started = false;
  let skippable = false;
  const sent = {};
  const report = (type) => {
    if (type !== 'pause' && type !== 'resume' && sent[type]) return;
    sent[type] = 1;
    if (options.onEvent) options.onEvent(type, video.currentTime || 0);
  };
  const duration = () => (isFinite(video.duration) && video.duration > 0 ? video.duration : ad.durationSeconds || 0);

  function finish(result) {
    if (state === 'done') return;
    state = 'done';
    if (playing === api) playing = null;
    try {
      video.pause();
    } catch (_e) {
      /* ignore */
    }
    resolveFinish(result);
  }

  function showOverlay(message, buttons) {
    overlay.textContent = '';
    const p = el('p');
    p.textContent = message;
    const row = el('div', { class: 'row' });
    buttons.forEach((b) => {
      const btn = el('button', { class: b.primary ? 'lm' : 'pill', type: 'button' });
      btn.textContent = b.label;
      btn.addEventListener('click', b.onClick);
      row.appendChild(btn);
    });
    overlay.append(p, row);
    overlay.hidden = false;
    const target = row.querySelector('button');
    if (target) target.focus();
  }

  async function start(auto) {
    if (state !== 'idle') return;
    if (playing && playing !== api) playing.pause();
    playing = api;
    state = 'loading';
    poster.hidden = true;
    spin.hidden = false;
    try {
      hls = await attachSource(video, ad);
      video.preload = 'auto';
      await video.play();
    } catch (err) {
      // A browser that refuses to play without a fresh click gets the play button.
      if (auto && err && err.name === 'NotAllowedError' && state === 'loading') {
        state = 'idle';
        spin.hidden = true;
        poster.hidden = false;
        big.focus();
        return;
      }
      fail(err);
    }
  }

  function fail(err) {
    if (state === 'done') return;
    spin.hidden = true;
    report('error');
    showOverlay("This ad couldn't play. You can close it.", [{ label: 'Close', onClick: () => finish('error') }]);
    if (options.onError) options.onError(err);
    state = 'error';
    close.hidden = false;
  }

  function updateSkip() {
    if (policy.skipAfterSeconds == null || !started) return;
    const left = policy.skipAfterSeconds - video.currentTime;
    skip.hidden = false;
    if (left > 0) {
      skippable = false;
      skip.disabled = true;
      skip.textContent = 'Skip in ' + Math.ceil(left);
    } else if (!skippable) {
      skippable = true;
      skip.disabled = false;
      skip.textContent = reward && policy.rewardOnSkip ? 'Skip, keep reward' : 'Skip ad';
    }
  }

  video.addEventListener('playing', () => {
    spin.hidden = true;
    bar.hidden = false;
    progress.hidden = false;
    state = 'playing';
    toggle.innerHTML = ICONS.pause;
    toggle.setAttribute('aria-label', 'Pause');
    if (!started) {
      started = true;
      report('start');
    } else report('resume');
    updateSkip();
  });
  video.addEventListener('pause', () => {
    if (state !== 'playing') return;
    state = 'paused';
    toggle.innerHTML = ICONS.play;
    toggle.setAttribute('aria-label', 'Play');
    report('pause');
  });
  video.addEventListener('waiting', () => state === 'playing' && (spin.hidden = false));
  video.addEventListener('timeupdate', () => {
    const d = duration();
    const t = video.currentTime;
    if (d) {
      fill.style.transform = 'scaleX(' + Math.min(1, t / d) + ')';
      progress.setAttribute('aria-valuenow', String(Math.round((t / d) * 100)));
      time.textContent = fmt(d - t);
      if (t >= d * 0.25) report('q1');
      if (t >= d * 0.5) report('midpoint');
      if (t >= d * 0.75) report('q3');
    }
    updateSkip();
  });
  // Ads cannot be fast-forwarded or sped up.
  let lastTime = 0;
  video.addEventListener('timeupdate', () => {
    if (video.currentTime > lastTime + 1.5 && !video.seeking) video.currentTime = lastTime;
    else lastTime = video.currentTime;
  });
  video.addEventListener('seeking', () => {
    if (video.currentTime > lastTime + 0.5) video.currentTime = lastTime;
  });
  video.addEventListener('ratechange', () => {
    if (video.playbackRate !== 1) video.playbackRate = 1;
  });
  video.addEventListener('ended', () => {
    report('q1');
    report('midpoint');
    report('q3');
    report('complete');
    finish('completed');
  });
  video.addEventListener('error', () => fail(video.error));
  video.addEventListener('volumechange', () => {
    const muted = video.muted || video.volume === 0;
    muteBtn.innerHTML = muted ? ICONS.mute : ICONS.vol;
    muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    vol.value = String(video.muted ? 0 : video.volume);
  });

  big.addEventListener('click', () => start());
  toggle.addEventListener('click', () => (video.paused ? video.play().catch(fail) : video.pause()));
  muteBtn.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) video.volume = 1;
  });
  vol.addEventListener('input', () => {
    video.volume = +vol.value;
    video.muted = +vol.value === 0;
  });
  skip.addEventListener('click', () => {
    if (!skippable) return;
    report('skip');
    finish('skipped');
  });

  // Closing a rewarded ad before it has earned the reward is allowed, but the
  // viewer is told plainly what they give up.
  function requestClose() {
    if (state === 'done') return;
    if (state === 'idle' || state === 'error' || !reward) {
      report('close');
      return finish(state === 'error' ? 'error' : 'closed');
    }
    if (skippable && policy.rewardOnSkip) return skip.click();
    const wasPlaying = !video.paused;
    video.pause();
    showOverlay('Close now and you will not get ' + (reward.label || 'the reward') + '.', [
      {
        label: 'Keep watching',
        primary: true,
        onClick: () => {
          overlay.hidden = true;
          if (wasPlaying) video.play().catch(fail);
          frame.focus();
        },
      },
      {
        label: 'Close ad',
        onClick: () => {
          report('close');
          finish('closed');
        },
      },
    ]);
  }
  close.addEventListener('click', requestClose);

  frame.addEventListener('keydown', (e) => {
    if (e.target !== frame) return;
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      if (state === 'idle') start();
      else toggle.click();
    } else if (e.key === 'm') muteBtn.click();
  });

  // A hidden tab pauses the ad; the viewer resumes it with play.
  const onVisibility = () => document.visibilityState === 'hidden' && !video.paused && video.pause();
  document.addEventListener('visibilitychange', onVisibility);

  const api = {
    host,
    frame,
    finished,
    start,
    requestClose,
    pause: () => !video.paused && video.pause(),
    impression: () => report('impression'),
    destroy() {
      document.removeEventListener('visibilitychange', onVisibility);
      if (state !== 'done') finish('closed');
      if (hls) hls.destroy();
      video.removeAttribute('src');
      try {
        video.load();
      } catch (_e) {
        /* releases the decoder and network */
      }
      root.textContent = '';
    },
  };
  if (options.autostart) start(true);
  return api;
}

// Full-screen dialog around a player. Traps focus, restores it afterwards,
// and locks page scroll while open. Opened with showModal() where it exists,
// so it sits in the top layer: above any z-index another script on the page
// uses (some partner scripts lay a click-catching layer at the maximum one),
// and above a game frame that is in fullscreen.
export function openModal(build) {
  const previous = document.activeElement;
  const backdrop = document.createElement('dialog');
  const modal = typeof backdrop.showModal === 'function';
  const fallback = modal ? null : document.createElement('div');
  const root = fallback || backdrop;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Advertisement');
  root.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;padding:16px;' +
    'margin:0;border:0;width:auto;height:auto;max-width:none;max-height:none;box-sizing:border-box;color:inherit';
  const box = document.createElement('div');
  box.style.cssText = 'width:min(960px,100%);border-radius:10px;overflow:hidden';
  root.appendChild(box);
  const overflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  document.body.appendChild(root);
  // Escape is handled below, as a close request the content decides on.
  const onCancel = (e) => e.preventDefault();
  if (modal) {
    backdrop.addEventListener('cancel', onCancel);
    backdrop.showModal();
  }
  const content = build(box);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      content.requestClose();
    }
    // The player lives in a closed shadow root; keep focus on its frame.
    if (e.key === 'Tab' && !root.contains(document.activeElement)) {
      e.preventDefault();
      content.frame.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => content.frame.focus());
  return function closeModal() {
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.style.overflow = overflow;
    if (modal) {
      backdrop.removeEventListener('cancel', onCancel);
      if (backdrop.open) backdrop.close();
    }
    root.remove();
    if (previous && previous.focus && document.contains(previous)) previous.focus({ preventScroll: true });
  };
}

// The consent step for rewarded ads: what the player gets, before anything plays.
export function askConsent({ rewardLabel, premiumSkip, providerName }) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    let answered = false;
    const closeModal = openModal((box) => {
      box.style.width = 'min(420px,100%)';
      box.appendChild(host);
      const root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = CSS + '.c{background:#111;padding:20px;border-radius:10px}.c h2{margin:0 0 6px;font-size:17px}.c p{margin:0 0 16px;opacity:.85}';
      const card = el('div', { class: 'c f', tabindex: '-1', role: 'document' });
      card.style.aspectRatio = 'auto';
      const h = el('h2');
      h.textContent = rewardLabel ? 'Watch an ad to get ' + rewardLabel + '?' : 'Watch an ad for a reward?';
      const p = el('p');
      p.textContent = premiumSkip
        ? 'As a Premium member you can skip after 5 seconds and still get it.'
        : 'Watch until the end to get it. You can close the ad at any time, but you will not get the reward.' + (providerName ? ' Ad by ' + providerName + '.' : '');
      const row = el('div', { class: 'row' });
      const yes = el('button', { class: 'lm', type: 'button' });
      yes.textContent = 'Watch ad';
      const no = el('button', { class: 'pill', type: 'button' });
      no.textContent = 'No thanks';
      row.append(yes, no);
      card.append(h, p, row);
      root.append(style, card);
      const answer = (v) => {
        if (answered) return;
        answered = true;
        closeModal();
        resolve(v);
      };
      yes.addEventListener('click', () => answer(true));
      no.addEventListener('click', () => answer(false));
      return { frame: yes, requestClose: () => answer(false) };
    });
  });
}
