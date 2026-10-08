// 55GMS ads.js — finds [data-55gms-ad] slots, fills them from the game site's
// own origin (/_ads/*), and reports viewable impressions. No dependencies.

import { pickSizes, parseSize } from './sizes.js';

(function (win, doc) {
  if (win.__gmsAds) return;
  win.__gmsAds = 1;

  var script = doc.currentScript;
  var base = ((script && script.getAttribute('data-endpoint')) || '/_ads').replace(/\/+$/, '');
  var ATTR = 'data-55gms-ad';
  var pending = []; // slots waiting for the next batched serve request
  var serveTimer = 0;
  var queue = []; // viewable serve IDs waiting to be reported
  var beaconTimer = 0;
  var slots = []; // every slot we manage
  var viewTimers = typeof WeakMap === 'function' ? new WeakMap() : null;

  if (!viewTimers || !win.IntersectionObserver || !win.fetch) return;

  var viewObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        var el = entry.target;
        var timer = viewTimers.get(el);
        if (entry.intersectionRatio >= 0.5) {
          if (!timer) {
            viewTimers.set(
              el,
              setTimeout(function () {
                viewObserver.unobserve(el);
                viewTimers.delete(el);
                var id = el.getAttribute('data-serve');
                if (id) {
                  queue.push(id);
                  if (!beaconTimer) beaconTimer = setTimeout(flushImpressions, 1500);
                }
              }, 1000)
            );
          }
        } else if (timer) {
          clearTimeout(timer);
          viewTimers.delete(el);
        }
      });
    },
    { threshold: [0, 0.5, 1] }
  );

  function flushImpressions() {
    clearTimeout(beaconTimer);
    beaconTimer = 0;
    if (!queue.length) return;
    var body = JSON.stringify({ serveIds: queue.splice(0, queue.length) });
    try {
      if (!(navigator.sendBeacon && navigator.sendBeacon(base + '/i', body))) {
        fetch(base + '/i', { method: 'POST', body: body, keepalive: true }).catch(function () {});
      }
    } catch (_e) {
      /* never surface errors on the host page */
    }
  }

  function sizesFor(slot) {
    var fixed = parseSize(slot.el.getAttribute('data-size'));
    if (fixed) return [fixed.key];
    var parent = slot.el.parentElement;
    var width = slot.el.clientWidth || (parent && parent.clientWidth) || 0;
    // Height only counts when the parent actually constrains it.
    var height = 0;
    if (parent) {
      var style = getComputedStyle(parent);
      if ((style.height !== 'auto' && parent.style.height) || style.maxHeight !== 'none') height = parent.clientHeight;
    }
    return pickSizes(width, height);
  }

  function reserve(slot, size) {
    var s = parseSize(size);
    var style = slot.el.style;
    style.display = 'block';
    style.maxWidth = '100%';
    if (s) {
      style.width = s.width + 'px';
      style.minHeight = s.height + 'px';
    }
  }

  function collapse(slot) {
    slot.el.textContent = '';
    slot.el.removeAttribute('data-serve');
    slot.el.style.display = 'none';
    slot.el.style.minHeight = '';
  }

  function render(slot, ad) {
    var el = slot.el;
    var style = el.style;
    el.textContent = '';
    style.display = 'block';
    style.position = 'relative';
    style.width = ad.width + 'px';
    style.maxWidth = '100%';
    style.minHeight = '';
    style.aspectRatio = ad.width + ' / ' + ad.height;
    style.overflow = 'hidden';
    style.lineHeight = '0';

    var link = doc.createElement('a');
    link.href = ad.clickUrl;
    link.target = '_blank';
    link.rel = 'noopener sponsored';

    var img = doc.createElement('img');
    img.width = ad.width;
    img.height = ad.height;
    img.alt = ad.alt || 'Advertisement';
    img.decoding = 'async';
    img.style.cssText = 'display:block;width:100%;height:auto;border:0';
    img.onerror = function () {
      collapse(slot);
    };
    img.src = ad.imageUrl;
    link.appendChild(img);

    var label = doc.createElement('span');
    label.textContent = 'Ad';
    label.style.cssText =
      'position:absolute;top:0;right:0;padding:1px 4px;font:10px/12px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.45);border-bottom-left-radius:4px;pointer-events:none';

    el.appendChild(link);
    el.appendChild(label);
    el.setAttribute('data-serve', ad.serveId);
    viewObserver.observe(el);
  }

  function requestAds() {
    serveTimer = 0;
    var batch = pending.splice(0, 12);
    if (pending.length) serveTimer = setTimeout(requestAds, 0);
    if (!batch.length) return;
    var groups = batch.map(function (slot) {
      return slot.sizes.join(',');
    });
    fetch(base + '/serve?slots=' + encodeURIComponent(groups.join(';')), { credentials: 'omit' })
      .then(function (res) {
        return res.ok && res.status !== 204 ? res.json() : { ads: [] };
      })
      .then(function (data) {
        var ads = (data && data.ads) || [];
        batch.forEach(function (slot, i) {
          if (ads[i] && ads[i].serveId) render(slot, ads[i]);
          else collapse(slot);
        });
      })
      .catch(function () {
        batch.forEach(collapse);
      });
  }

  function enqueue(slot) {
    slot.sizes = sizesFor(slot);
    slot.key = slot.sizes.join(',');
    if (!slot.sizes.length) return collapse(slot);
    reserve(slot, slot.sizes[0]);
    if (pending.indexOf(slot) === -1) pending.push(slot);
    // One macrotask later, so every slot found in this pass shares a request.
    if (!serveTimer) serveTimer = setTimeout(requestAds, 0);
  }

  function scan(root) {
    var found = root.querySelectorAll ? root.querySelectorAll('[' + ATTR + ']') : [];
    var list = Array.prototype.slice.call(found);
    if (root.hasAttribute && root.hasAttribute(ATTR)) list.push(root);
    list.forEach(function (el) {
      if (el.__gmsAd) return;
      el.__gmsAd = 1;
      var slot = { el: el, sizes: [], key: '' };
      slots.push(slot);
      enqueue(slot);
    });
  }

  function onResize() {
    slots = slots.filter(function (slot) {
      return slot.el.isConnected;
    });
    slots.forEach(function (slot) {
      if (slot.el.getAttribute('data-size')) return;
      // Measure against the parent: the slot itself is sized to the current ad.
      var hidden = slot.el.style.display === 'none';
      var width = slot.el.style.width;
      slot.el.style.width = '';
      if (hidden) slot.el.style.display = 'block';
      var next = sizesFor(slot);
      slot.el.style.width = width;
      if (hidden) slot.el.style.display = 'none';
      if (next[0] !== slot.sizes[0]) {
        viewObserver.unobserve(slot.el);
        enqueue(slot);
      }
    });
  }

  function start() {
    scan(doc);
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        Array.prototype.forEach.call(record.addedNodes, function (node) {
          if (node.nodeType === 1) scan(node);
        });
      });
    }).observe(doc.documentElement, { childList: true, subtree: true });

    var resizeTimer = 0;
    win.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(onResize, 300);
    });
    win.addEventListener('pagehide', flushImpressions);
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') flushImpressions();
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
  else start();
})(window, document);
