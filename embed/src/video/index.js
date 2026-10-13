// Entry for video.min.js. Loaded on demand by ads.js (video slots, game
// bridge) or by sdk.js (a game running as the top-level page). Never loaded
// on pages that show only image ads.

import { createHost } from './host.js';

(function (win) {
  if (win.__gmsAdsVideo) return;
  const hosts = {};
  win.__gmsAdsVideo = {
    // One host per endpoint, so a page and its bridge share busy state.
    host(base) {
      const key = String(base || '/_ads').replace(/\/+$/, '');
      return (hosts[key] = hosts[key] || createHost(key));
    },
  };
})(window);
