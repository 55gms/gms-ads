// Message protocol between a game iframe (sdk.js) and the page hosting it
// (ads.js + video.js). Pure: validation only, no DOM. Every message is a plain
// object tagged gmsAds: 1; anything else is ignored.
//
//   game -> host  { gmsAds: 1, kind: 'req', id, method, params }
//   host -> game  { gmsAds: 1, kind: 'res', id, ok, result | error }
//   host -> game  { gmsAds: 1, kind: 'evt', name: 'pause' | 'resume' }
//
// The host never takes the game ID from a message: it comes from the
// data-gms-game attribute of the registered iframe the message came from.

export const METHODS = ['init', 'available', 'showRewarded', 'showInterstitial'];
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export const isSlug = (v) => typeof v === 'string' && SLUG_RE.test(v);

// Reward labels are shown to the player as plain text, never as HTML.
function label(v) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 80);
}

// Returns { id, method, params } for a well-formed request, otherwise null.
export function readRequest(data) {
  if (!data || typeof data !== 'object' || data.gmsAds !== 1 || data.kind !== 'req') return null;
  if (typeof data.id !== 'string' || !ID_RE.test(data.id)) return null;
  if (METHODS.indexOf(data.method) === -1) return null;
  const raw = data.params && typeof data.params === 'object' ? data.params : {};
  const params = {};
  if (raw.placement !== undefined) {
    if (!isSlug(raw.placement)) return null;
    params.placement = raw.placement;
  }
  if (raw.rewardId !== undefined) {
    if (!isSlug(raw.rewardId)) return null;
    params.rewardId = raw.rewardId;
  }
  if (raw.rewardLabel !== undefined) params.rewardLabel = label(raw.rewardLabel);
  if (raw.format !== undefined) {
    if (raw.format !== 'video_rewarded' && raw.format !== 'video_fullscreen') return null;
    params.format = raw.format;
  }
  return { id: data.id, method: data.method, params };
}

export function readResponse(data, pendingIds) {
  if (!data || typeof data !== 'object' || data.gmsAds !== 1) return null;
  if (data.kind === 'evt') return data.name === 'pause' || data.name === 'resume' ? { event: data.name } : null;
  if (data.kind !== 'res' || typeof data.id !== 'string' || !pendingIds.has(data.id)) return null;
  return { id: data.id, ok: data.ok === true, result: data.result, error: typeof data.error === 'string' ? data.error : null };
}

export const response = (id, ok, payload) => (ok ? { gmsAds: 1, kind: 'res', id, ok: true, result: payload } : { gmsAds: 1, kind: 'res', id, ok: false, error: String(payload) });
export const event = (name) => ({ gmsAds: 1, kind: 'evt', name });
export const request = (id, method, params) => ({ gmsAds: 1, kind: 'req', id, method, params: params || {} });

// Origins a registered frame may speak for: its own src origin plus any
// listed in data-gms-origins. Opaque ("null") origins are never trusted.
export function frameOrigins(src, extra, base) {
  const out = [];
  try {
    out.push(new URL(src, base).origin);
  } catch (_e) {
    /* no src */
  }
  String(extra || '')
    .split(/\s+/)
    .forEach((o) => {
      if (/^https?:\/\/[^/\s]+$/.test(o)) out.push(o);
    });
  return out.filter((o) => o && o !== 'null');
}

// Normalises what a show call resolves with. Games always get one of these,
// never a rejection, so a failed ad cannot leave a game waiting forever.
export const STATUSES = ['granted', 'completed', 'cancelled', 'skipped', 'no_fill', 'error', 'busy', 'unavailable', 'timeout'];
export function outcome(status, extra) {
  const s = STATUSES.indexOf(status) === -1 ? 'error' : status;
  return Object.assign({ status: s, rewardGranted: s === 'granted' }, extra || {});
}
