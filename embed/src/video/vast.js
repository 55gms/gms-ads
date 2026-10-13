// Minimal VAST 2-4 support for linear video ads: follow wrappers, pick a
// progressive MP4/WebM file, and fire the tag's own tracking URLs at the
// matching moments. URLs are used exactly as served apart from the standard
// [CACHEBUSTING]/[TIMESTAMP] macros; nothing is invented or re-labelled.
//
// Works on any DOM-like document (getElementsByTagName, getAttribute,
// textContent), so it runs on DOMParser output in browsers and on a stub in
// tests.

const MAX_WRAPPERS = 4;

const text = (el) => (el && el.textContent ? el.textContent.trim() : '');
const all = (root, name) => Array.prototype.slice.call(root.getElementsByTagName(name));
const first = (root, name) => all(root, name)[0] || null;

export function expandMacros(url, now) {
  return url.replace(/\[CACHEBUSTING\]/g, String(Math.floor(Math.random() * 1e8)).padStart(8, '0')).replace(/\[TIMESTAMP\]/g, encodeURIComponent(new Date(now || Date.now()).toISOString()));
}

// "00:00:05", "00:00:05.500", or "25%" of the duration.
export function parseOffset(value, duration) {
  if (!value) return null;
  const v = String(value).trim();
  if (/%$/.test(v)) return duration ? (parseFloat(v) / 100) * duration : null;
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v);
  return m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : null;
}

function pickMedia(linear, canPlay) {
  const files = all(linear, 'MediaFile')
    .map((f) => ({
      url: text(f),
      type: (f.getAttribute('type') || '').toLowerCase(),
      delivery: (f.getAttribute('delivery') || 'progressive').toLowerCase(),
      width: +f.getAttribute('width') || 0,
      height: +f.getAttribute('height') || 0,
    }))
    .filter((f) => /^https:\/\//.test(f.url) && f.delivery === 'progressive' && (f.type === 'video/mp4' || f.type === 'video/webm') && (!canPlay || canPlay(f.type)));
  // Closest to 720p wide without going far above it: smaller is kinder to slow devices.
  files.sort((a, b) => Math.abs(a.width - 1280) - Math.abs(b.width - 1280));
  return files[0] || null;
}

// Collects tracking from one <Ad> (inline or wrapper) into `acc`.
function collect(ad, acc) {
  all(ad, 'Impression').forEach((el) => text(el) && acc.impression.push(text(el)));
  all(ad, 'Error').forEach((el) => text(el) && acc.error.push(text(el)));
  const linear = first(ad, 'Linear');
  if (linear) {
    all(linear, 'Tracking').forEach((el) => {
      const name = el.getAttribute('event');
      const url = text(el);
      if (!name || !url) return;
      (acc.events[name] = acc.events[name] || []).push(url);
    });
    all(linear, 'ClickTracking').forEach((el) => text(el) && acc.clickTracking.push(text(el)));
  }
  return linear;
}

// Resolves a VAST tag URL to a playable ad, or null for no fill.
//   fetchText(url) -> Promise<string>, parseXml(string) -> Document
export async function loadVast(tagUrl, { fetchText, parseXml, canPlay, now } = {}) {
  const acc = { impression: [], error: [], events: {}, clickTracking: [] };
  let url = expandMacros(tagUrl, now);
  for (let depth = 0; depth <= MAX_WRAPPERS; depth++) {
    const doc = parseXml(await fetchText(url));
    const ad = first(doc, 'Ad');
    if (!ad) return null; // empty VAST response: no fill
    const wrapper = first(ad, 'Wrapper');
    if (wrapper) {
      collect(wrapper, acc);
      const next = text(first(wrapper, 'VASTAdTagURI'));
      if (!/^https:\/\//.test(next)) return null;
      url = expandMacros(next, now);
      continue;
    }
    const inline = first(ad, 'InLine');
    if (!inline) return null;
    const linear = collect(inline, acc);
    if (!linear) return null;
    const media = pickMedia(linear, canPlay);
    if (!media) {
      fire(acc.error.map((u) => u.replace(/\[ERRORCODE\]/g, '403')), now);
      return null;
    }
    const duration = parseOffset(text(first(linear, 'Duration')), 0) || 0;
    const clickThrough = text(first(linear, 'ClickThrough'));
    return {
      media,
      duration,
      // The tag's own skip rule. No skipoffset means not skippable.
      skipAfterSeconds: parseOffset(linear.getAttribute('skipoffset'), duration),
      clickThrough: /^https:\/\//.test(clickThrough) ? clickThrough : null,
      advertiser: text(first(inline, 'Advertiser')) || text(first(inline, 'AdSystem')) || 'Advertiser',
      title: text(first(inline, 'AdTitle')),
      tracking: acc,
    };
  }
  return null;
}

export function fire(urls, now) {
  (urls || []).forEach((u) => {
    if (!/^https:\/\//.test(u)) return;
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.src = expandMacros(u, now);
  });
}

// Maps player lifecycle to VAST events. Each fires at most once, except
// pause/resume/mute which may repeat as the viewer acts.
export function vastTracker(ad, fireFn = fire) {
  const done = {};
  const once = (name) => {
    if (done[name]) return;
    done[name] = 1;
    fireFn(ad.tracking.events[name]);
  };
  return {
    impression() {
      if (done.impression) return;
      done.impression = 1;
      fireFn(ad.tracking.impression);
      once('creativeView');
    },
    start: () => once('start'),
    q1: () => once('firstQuartile'),
    midpoint: () => once('midpoint'),
    q3: () => once('thirdQuartile'),
    complete: () => once('complete'),
    // A skip is reported as a skip, never as a completion.
    skip: () => !done.complete && once('skip'),
    close: () => once('close') || once('closeLinear'),
    click: () => fireFn(ad.tracking.clickTracking),
    pause: () => fireFn(ad.tracking.events.pause),
    resume: () => fireFn(ad.tracking.events.resume),
    mute: () => fireFn(ad.tracking.events.mute),
    unmute: () => fireFn(ad.tracking.events.unmute),
    error: (code) => !done.error && (done.error = 1) && fireFn(ad.tracking.error.map((u) => u.replace(/\[ERRORCODE\]/g, String(code || 405)))),
  };
}
