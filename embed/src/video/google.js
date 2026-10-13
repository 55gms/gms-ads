// Google H5 Games Ads through the Ad Placement API (adBreak / adConfig).
// https://developers.google.com/ad-placement
// Google renders the ad, decides skipping and frequency, and reports the
// outcome through callbacks. This adapter passes those outcomes on unchanged:
// adViewed is the only thing treated as "earned", adDismissed is a skip, and
// a break that never offers a reward is a no-fill.

let loaded = null;

function load(cfg) {
  if (loaded) return loaded;
  loaded = new Promise((resolve, reject) => {
    window.adsbygoogle = window.adsbygoogle || [];
    window.adBreak = window.adConfig = function (o) {
      window.adsbygoogle.push(o);
    };
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(cfg.client);
    s.setAttribute('data-ad-client', cfg.client);
    if (cfg.testMode) s.setAttribute('data-adbreak-test', 'on');
    if (cfg.frequencyHint) s.setAttribute('data-ad-frequency-hint', cfg.frequencyHint);
    if (cfg.channel) s.setAttribute('data-ad-channel', cfg.channel);
    s.onerror = () => {
      loaded = null;
      reject(new Error('Google ad script blocked or unavailable'));
    };
    s.onload = () => resolve();
    document.head.appendChild(s);
    window.adConfig({ preloadAdBreaks: 'on', sound: 'on' });
  });
  return loaded;
}

// ctx: { placement, pause(), resume(), offer() -> Promise<boolean>, onAvailable(), onStart() }
// Resolves 'viewed' | 'dismissed' | 'declined' | 'no_fill' | 'error'.
export async function googleRewarded(cfg, ctx, timeoutMs = 8000) {
  try {
    await load(cfg);
  } catch (_e) {
    return 'error';
  }
  return new Promise((resolve) => {
    let settled = false;
    let offered = false;
    let result = null;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    // No beforeReward in time means no rewarded ad for now.
    const timer = setTimeout(() => !offered && done('no_fill'), timeoutMs);
    window.adBreak({
      type: 'reward',
      name: ctx.placement || 'reward',
      beforeAd: () => {
        ctx.pause();
        if (ctx.onStart) ctx.onStart();
      },
      afterAd: () => ctx.resume(),
      beforeReward: (showAdFn) => {
        if (settled) return; // timed out already; do not show a stale offer
        offered = true;
        clearTimeout(timer);
        Promise.resolve(ctx.onAvailable && ctx.onAvailable())
          .then(() => ctx.offer())
          .then((yes) => (yes ? showAdFn() : done('declined')), () => done('error'));
      },
      adDismissed: () => (result = 'dismissed'),
      adViewed: () => (result = 'viewed'),
      adBreakDone: (info) => done(result || (info && info.breakStatus === 'viewed' ? 'viewed' : offered ? 'dismissed' : 'no_fill')),
    });
  });
}

// An interstitial at a natural break. Google decides whether one shows.
export async function googleInterstitial(cfg, ctx) {
  try {
    await load(cfg);
  } catch (_e) {
    return 'error';
  }
  return new Promise((resolve) => {
    let shown = false;
    window.adBreak({
      type: 'next',
      name: ctx.placement || 'break',
      beforeAd: () => {
        shown = true;
        ctx.pause();
      },
      afterAd: () => ctx.resume(),
      adBreakDone: () => resolve(shown ? 'viewed' : 'no_fill'),
    });
  });
}
