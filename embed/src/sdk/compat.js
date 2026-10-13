// Compatibility adapters: route the rewarded-ad calls of SDK stand-ins that
// games already contain to GMSAds, and leave every other method alone.
// Opt-in per game: GMSAds.init({ compat: ['poki'] }). A game counts as
// integrated only once its reward path has been tried with the adapter on.
//
// Commercial (interstitial) breaks are deliberately left as they were: the
// stand-ins resolve them at once, and turning them into real interruptions
// would put full-screen ads where the player did not ask for one.

const GENERIC_REWARD = 'a reward in this game';

// Wraps window[name] now, or as soon as the game assigns it.
function whenDefined(win, name, wrap) {
  if (win[name]) return wrap(win[name]);
  let value;
  try {
    Object.defineProperty(win, name, {
      configurable: true,
      get: () => value,
      set: (v) => {
        value = v;
        if (v) wrap(v);
      },
    });
  } catch (_e) {
    /* non-configurable global; nothing to wrap */
  }
}

const adapters = {
  // PokiSDK.rewardedBreak() -> Promise<boolean>. Newer signatures pass
  // { onStart } or a size; onStart is called when the ad begins.
  poki(win, ads) {
    whenDefined(win, 'PokiSDK', (sdk) => {
      if (sdk.__gmsAds) return;
      sdk.__gmsAds = 1;
      sdk.rewardedBreak = function (arg) {
        const onStart = arg && typeof arg.onStart === 'function' ? arg.onStart : null;
        if (onStart) ads.on('pause', function once() {
          ads.off('pause', once);
          onStart();
        });
        return ads.showRewardedAd({ placement: 'poki-rewarded', rewardLabel: GENERIC_REWARD }).then((r) => r.rewardGranted);
      };
    });
  },

  // CrazyGames SDK v2/v3: SDK.ad.requestAd('rewarded', { adStarted, adFinished, adError }).
  crazygames(win, ads) {
    whenDefined(win, 'CrazyGames', (cg) => {
      const ad = cg && cg.SDK && cg.SDK.ad;
      if (!ad || ad.__gmsAds) return;
      ad.__gmsAds = 1;
      const original = ad.requestAd && ad.requestAd.bind(ad);
      ad.requestAd = function (type, callbacks) {
        if (type !== 'rewarded') return original ? original(type, callbacks) : undefined;
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
      };
    });
  },

  // GameDistribution: gdsdk.showAd('rewarded') plus SDK_REWARDED_WATCH_COMPLETE
  // through GD_OPTIONS.onEvent.
  gamedistribution(win, ads) {
    whenDefined(win, 'gdsdk', (gd) => {
      if (gd.__gmsAds) return;
      gd.__gmsAds = 1;
      const original = gd.showAd && gd.showAd.bind(gd);
      gd.showAd = function (type) {
        if (type !== 'rewarded') return original ? original(type) : Promise.resolve();
        return ads.showRewardedAd({ placement: 'gd-rewarded', rewardLabel: GENERIC_REWARD }).then((r) => {
          const onEvent = win.GD_OPTIONS && win.GD_OPTIONS.onEvent;
          if (r.rewardGranted) {
            if (onEvent) onEvent({ name: 'SDK_REWARDED_WATCH_COMPLETE' });
            return true;
          }
          throw new Error(r.status);
        });
      };
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
