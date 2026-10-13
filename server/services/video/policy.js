// Skip and reward policy for video sessions. Pure functions: the session
// service feeds them a session row, an event, and the server clock, and
// writes back whatever they return. Nothing here trusts client timing; every
// check is against server time since the start event was received.

export const FORMATS = ['video_embedded', 'video_fullscreen', 'video_rewarded'];
export const MILESTONES = ['impression', 'start', 'q1', 'midpoint', 'q3', 'complete'];
const QUARTILE_SHARE = { q1: 0.25, midpoint: 0.5, q3: 0.75, complete: 1 };

// Allowed slack between server elapsed time and claimed position, for network
// latency between the start event and real playback.
export const CLOCK_TOLERANCE_S = 2;
const EXTERNAL = new Set(['google_h5', 'vast']);

export const isProviderSession = (session) => EXTERNAL.has(session.provider);

// What the player may do. Decided once when the session is created.
// - Non-rewarded first party: skippable after the campaign's skip time (default 5s).
// - Rewarded, free viewer: not skippable; closing early forfeits the reward.
//   The reward needs `reward_watch_percent` of the video watched.
// - Rewarded, verified Premium viewer: skippable after premium_skip_seconds
//   (default 5s) and the skip still earns the reward.
// External providers bring their own rules, so nothing is set for them here.
export function playbackPolicy({ format, premium, durationSeconds, campaign = {} }) {
  const duration = Number(durationSeconds) || 0;
  if (format !== 'video_rewarded') {
    const skip = campaign.skip_after_seconds;
    return { skipAfterSeconds: skip == null ? null : Math.min(skip, duration || skip), requiredSeconds: null, rewardOnSkip: false };
  }
  const percent = campaign.reward_watch_percent ?? 100;
  const required = round2(duration * (percent / 100));
  if (premium && campaign.premium_skip_seconds != null) {
    return { skipAfterSeconds: Math.min(campaign.premium_skip_seconds, required), requiredSeconds: required, rewardOnSkip: true };
  }
  return { skipAfterSeconds: null, requiredSeconds: required, rewardOnSkip: false };
}

const round2 = (n) => Math.round(n * 100) / 100;

const elapsedSeconds = (session, now) => (session.started_at ? (now - new Date(session.started_at).getTime()) / 1000 : 0);

const TERMINAL = new Set(['completed', 'skipped', 'closed', 'error', 'expired']);

// Applies one client event. Returns { accept, changes, count, reason }:
//   changes: columns to update on the session (may be empty)
//   count:   video_stats_hourly columns to increment by one
// A rejected event changes nothing and is not counted. Repeated milestones
// are accepted but not counted again, so retries never double count.
export function applyEvent(session, event, now = Date.now()) {
  const type = event?.type;
  const nowDate = new Date(now);
  if (session.expires_at && new Date(session.expires_at).getTime() <= now) return reject('expired');
  const seen = new Set(session.milestones || []);
  const changes = {};
  const count = [];
  const mark = (milestone, column) => {
    if (seen.has(milestone)) return;
    seen.add(milestone);
    changes.milestones = [...seen];
    count.push(column);
  };

  switch (type) {
    case 'impression':
      mark('impression', 'impressions');
      return ok(changes, count);

    case 'start':
      if (TERMINAL.has(session.state)) return reject('session_ended');
      if (session.state === 'started') return ok({}, []);
      mark('start', 'starts');
      return ok({ ...changes, state: 'started', started_at: nowDate }, count);

    case 'q1':
    case 'midpoint':
    case 'q3':
    case 'complete': {
      // Late or repeated milestones after completion are harmless no-ops.
      if (session.state !== 'started') return session.state === 'completed' ? ok({}, []) : reject('not_started');
      if (isProviderSession(session)) {
        // A provider's own client-side event; recorded as provider-reported.
        const column = { q1: 'q1', midpoint: 'midpoints', q3: 'q3', complete: 'completes' }[type];
        mark(type, column);
        if (type === 'complete') {
          changes.state = 'completed';
          changes.ended_at = nowDate;
          changes.reward_eligible = session.format === 'video_rewarded';
          if (changes.reward_eligible) count.push('rewards');
        }
        return ok(changes, count);
      }
      const duration = Number(session.duration_seconds) || 0;
      const needed = type === 'complete' ? Number(session.required_seconds ?? duration) : duration * QUARTILE_SHARE[type];
      // The server clock must have advanced at least as far as playback claims.
      if (elapsedSeconds(session, now) + CLOCK_TOLERANCE_S < needed) return reject('too_early');
      const column = { q1: 'q1', midpoint: 'midpoints', q3: 'q3', complete: 'completes' }[type];
      mark(type, column);
      if (Number.isFinite(event.position)) changes.position_seconds = Math.max(Number(session.position_seconds) || 0, Math.min(event.position, duration));
      if (type === 'complete') {
        changes.state = 'completed';
        changes.ended_at = nowDate;
        changes.reward_eligible = session.format === 'video_rewarded';
        if (changes.reward_eligible) count.push('rewards');
      }
      return ok(changes, count);
    }

    case 'skip': {
      if (session.state !== 'started') return session.state === 'skipped' ? ok({}, []) : reject('not_started');
      if (isProviderSession(session)) {
        // Provider skips are recorded as skips, never as completions.
        return ok({ state: 'skipped', ended_at: nowDate, reward_eligible: false }, ['skips']);
      }
      if (session.skip_after_seconds == null) return reject('not_skippable');
      if (elapsedSeconds(session, now) + 0.5 < Number(session.skip_after_seconds)) return reject('too_early');
      const reward = session.format === 'video_rewarded' && session.premium === true;
      return ok({ state: 'skipped', ended_at: nowDate, reward_eligible: reward }, reward ? ['skips', 'rewards'] : ['skips']);
    }

    case 'close':
      if (TERMINAL.has(session.state)) return ok({}, []);
      return ok({ state: 'closed', ended_at: nowDate }, []);

    case 'error':
      if (TERMINAL.has(session.state)) return ok({}, []);
      return ok({ state: 'error', ended_at: nowDate }, ['errors']);

    case 'click':
      if (seen.has('click')) return ok({}, []);
      seen.add('click');
      return ok({ milestones: [...seen] }, ['clicks']);

    default:
      return reject('unknown_event');
  }
}

const ok = (changes, count) => ({ accept: true, changes, count });
const reject = (reason) => ({ accept: false, changes: {}, count: [], reason });

// Whether a claim on this session may mint a grant, and how it was earned.
export function grantDecision(session, now = Date.now()) {
  if (new Date(session.expires_at).getTime() <= now) return { ok: false, reason: 'expired' };
  if (session.format !== 'video_rewarded') return { ok: false, reason: 'not_rewarded' };
  if (!session.reward_eligible) return { ok: false, reason: 'not_eligible' };
  if (isProviderSession(session)) return { ok: true, method: 'provider_reported' };
  if (session.state === 'completed') return { ok: true, method: 'completion' };
  if (session.state === 'skipped' && session.premium) return { ok: true, method: 'premium_skip' };
  return { ok: false, reason: 'not_eligible' };
}
