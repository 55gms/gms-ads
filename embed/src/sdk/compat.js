// Compatibility adapters: route the rewarded-ad calls of SDK stand-ins that
// games already contain to GMSAds, and leave every other method alone.
// Opt-in per game: GMSAds.init({ compat: ['poki'] }). A game counts as
// integrated only once its reward path has been tried with the adapter on.
//
// Commercial (interstitial) breaks are deliberately left as they were: the
// stand-ins resolve them at once, and turning them into real interruptions
// would put full-screen ads where the player did not ask for one.

const GENERIC_REWARD = 'a reward in this game';

// Objects already wrapped. Not a marker property: many stand-ins are Proxies
// that answer every unknown name with a function, so a marker would always
// read as set.
const wrapped = typeof WeakSet === 'function' ? new WeakSet() : null;
function once(obj) {
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function') || !wrapped || wrapped.has(obj)) return false;
  wrapped.add(obj);
  return true;
}

// Wraps obj[name] now and every time it is assigned again, as a loader stub
// that the full SDK later replaces is. A non-configurable property (a
// top-level var declared before the SDK ran) is only wrapped as it is.
function whenDefined(obj, name, wrap) {
  let value = obj[name];
  if (value) wrap(value);
  try {
    Object.defineProperty(obj, name, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (v) => {
        value = v;
        if (v) wrap(v);
      },
    });
  } catch (_e) {
    /* non-configurable; wrapped above if it was set */
  }
}

// Puts wrap(original) at obj[name] and keeps it there: a later assignment
// replaces the original, not the wrapper. A loader stub's full SDK often
// copies its methods onto the stub object it replaces (Poki's core does
// `for (k in sdk) PokiSDK[k] = sdk[k]`), which would otherwise undo a plain
// assignment.
function pin(obj, name, wrap) {
  let current = wrap(obj[name]);
  try {
    Object.defineProperty(obj, name, {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (v) => {
        if (v !== current) current = wrap(v);
      },
    });
  } catch (_e) {
    try {
      obj[name] = current;
    } catch (_e2) {
      /* frozen; left as it was */
    }
  }
}

const adapters = {
  // PokiSDK.rewardedBreak() -> Promise<boolean>. Newer signatures pass
  // { onStart } or a size, older ones a before-break function; either is
  // called when the ad begins.
  poki(win, ads) {
    whenDefined(win, 'PokiSDK', (sdk) => {
      if (!once(sdk)) return;
      pin(sdk, 'rewardedBreak', () => function (arg) {
        const onStart = typeof arg === 'function' ? arg : arg && typeof arg.onStart === 'function' ? arg.onStart : null;
        if (onStart) ads.on('pause', function started() {
          ads.off('pause', started);
          onStart();
        });
        return ads.showRewardedAd({ placement: 'poki-rewarded', rewardLabel: GENERIC_REWARD }).then((r) => r.rewardGranted);
      });
    });
  },

  // CrazyGames SDK v2/v3: SDK.ad.requestAd('rewarded', { adStarted, adFinished, adError }).
  // The SDK object and its ad module may each be assigned after the global.
  crazygames(win, ads) {
    whenDefined(win, 'CrazyGames', (cg) =>
      whenDefined(cg, 'SDK', (sdk) =>
        whenDefined(sdk, 'ad', (ad) => {
          if (!once(ad)) return;
          pin(ad, 'requestAd', (original) => function (type, callbacks) {
            if (type !== 'rewarded') return typeof original === 'function' ? original.call(ad, type, callbacks) : undefined;
            const cb = callbacks || {};
            let started = false;
            const onPause = () => {
              started = true;
              if (cb.adStarted) cb.adStarted();
            };
            ads.on('pause', onPause);
            return ads.showRewardedAd({ placement: 'crazygames-rewarded', rewardLabel: GENERIC_REWARD }).then((r) => {
              ads.off('pause', onPause);
              if (r.rewardGranted) {
                if (!started && cb.adStarted) cb.adStarted();
                if (cb.adFinished) cb.adFinished();
              } else if (cb.adError) cb.adError({ code: r.status === 'no_fill' ? 'unfilled' : 'other', message: r.status });
            });
          });
        })
      )
    );
  },

  // GameDistribution: gdsdk.showAd('rewarded') plus SDK_REWARDED_WATCH_COMPLETE
  // through GD_OPTIONS.onEvent. Games offer the reward only once
  // preloadAd('rewarded') resolves, so that answers from GMSAds too.
  gamedistribution(win, ads) {
    whenDefined(win, 'gdsdk', (gd) => {
      if (!once(gd)) return;
      pin(gd, 'showAd', (original) => function (type) {
        if (type !== 'rewarded') return typeof original === 'function' ? original.call(gd, type) : Promise.resolve();
        return ads.showRewardedAd({ placement: 'gd-rewarded', rewardLabel: GENERIC_REWARD }).then((r) => {
          const onEvent = win.GD_OPTIONS && win.GD_OPTIONS.onEvent;
          if (r.rewardGranted) {
            if (onEvent) onEvent({ name: 'SDK_REWARDED_WATCH_COMPLETE' });
            return true;
          }
          throw new Error(r.status);
        });
      });
      pin(gd, 'preloadAd', (preload) => function (type) {
        if (type !== 'rewarded') return typeof preload === 'function' ? preload.call(gd, type) : Promise.resolve();
        return ads.isRewardedAdAvailable({ placement: 'gd-rewarded' }).then((ok) => {
          if (!ok) throw new Error('no_fill');
          return true;
        });
      });
    });
  },

  // Yandex Games: YaGames.init() -> ysdk, then
  // ysdk.adv.showRewardedVideo({ callbacks: { onOpen, onRewarded, onClose, onError } }).
  // onOpen pauses the game and onClose resumes it, so a shown ad always gets
  // both; onRewarded only comes with a granted reward. Games often keep the
  // instance as window.ysdk, which may be set before init is wrapped.
  yandex(win, ads) {
    const wrapSdk = (ysdk) =>
      whenDefined(ysdk, 'adv', (adv) => {
        if (!once(adv)) return;
        pin(adv, 'showRewardedVideo', () => function (options) {
          const cb = (options && options.callbacks) || {};
          const call = (name, arg) => {
            try {
              if (typeof cb[name] === 'function') cb[name](arg);
            } catch (_e) {
              /* a game callback must not break the ad */
            }
          };
          let opened = false;
          const onPause = () => {
            opened = true;
            call('onOpen');
          };
          ads.on('pause', onPause);
          ads.showRewardedAd({ placement: 'yandex-rewarded', rewardLabel: GENERIC_REWARD }).then((r) => {
            ads.off('pause', onPause);
            if (r.rewardGranted) {
              if (!opened) call('onOpen');
              call('onRewarded');
              call('onClose', true);
            } else if (opened) call('onClose', false);
            else call('onError', new Error(r.status));
          });
        });
      });
    whenDefined(win, 'YaGames', (ya) => {
      if (!once(ya) || typeof ya.init !== 'function') return;
      const init = ya.init.bind(ya);
      ya.init = function () {
        const p = init.apply(null, arguments);
        if (p && typeof p.then === 'function') {
          p.then(
            (ysdk) => ysdk && wrapSdk(ysdk),
            () => {}
          );
        }
        return p;
      };
    });
    whenDefined(win, 'ysdk', wrapSdk);
  },

  // Famobi: famobi.rewardedAd(callback) calls back (and newer builds also
  // resolve) with { adDidLoad, adDidShow, rewardGranted }. Famobi's own
  // integrations grant the reward when an ad did not load or show, so every
  // outcome without a reward is reported as shown and denied.
  // famobi.hasRewardedAd() is synchronous: it answers from the last check.
  famobi(win, ads) {
    let available = true;
    const refresh = () =>
      ads.isRewardedAdAvailable({ placement: 'famobi-rewarded' }).then((ok) => {
        available = ok;
      });
    whenDefined(win, 'famobi', (fa) => {
      if (!once(fa)) return;
      refresh();
      pin(fa, 'hasRewardedAd', () => () => available);
      pin(fa, 'rewardedAd', () => function (callback) {
        return ads.showRewardedAd({ placement: 'famobi-rewarded', rewardLabel: GENERIC_REWARD }).then((r) => {
          const result = { adDidLoad: true, adDidShow: true, rewardGranted: r.rewardGranted };
          refresh();
          if (typeof callback === 'function') {
            try {
              callback(result);
            } catch (_e) {
              /* a game callback must not break the ad */
            }
          }
          return result;
        });
      });
    });
  },
};

const custom = {};

export function registerAdapter(name, install) {
  custom[name] = install;
}

export function installCompat(names, ads) {
  (names || []).forEach((name) => {
    const install = adapters[name] || custom[name];
    if (install) install(window, ads);
  });
}
