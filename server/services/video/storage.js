// Video storage interface. Each provider implements:
//   available()                 -> boolean, configured and usable
//   sync(asset)                 -> fresh fields for video_assets, or null
//   playback(asset)             -> { hls, mp4, poster } URLs for a ready asset
//   remove(asset)               -> deletes the provider's copy (best effort)
// 'bunny' uploads go browser -> Bunny over TUS; 'external' is a progressive
// file on an allowlisted host (useful before Bunny is configured, and for tests).

import { config } from '../../config.js';
import { BunnyError, bunnyConfigured, bunnyPlayback, createBunnyClient, mapVideoStatus } from './bunny.js';

let client = null;
const bunnyClient = () => (client ||= createBunnyClient());

// For tests: swap the Bunny client.
export function setBunnyClient(next) {
  client = next;
}

const bunny = {
  available: () => bunnyConfigured(),
  async sync(asset) {
    let video;
    try {
      video = await bunnyClient().getVideo(asset.provider_video_id);
    } catch (err) {
      // Deleted on Bunny's side: the creative can never play again.
      if (err instanceof BunnyError && err.upstreamStatus === 404) return { status: 'failed', error: 'The video was deleted from Bunny Stream' };
      throw err;
    }
    const status = mapVideoStatus(video);
    return {
      status,
      encode_progress: Math.max(0, Math.min(100, Number(video.encodeProgress) || 0)),
      duration_seconds: video.length > 0 ? video.length : null,
      width: video.width || null,
      height: video.height || null,
      available_resolutions: video.availableResolutions || null,
      has_mp4_fallback: Boolean(video.hasMP4Fallback),
      thumbnail_file: video.thumbnailFileName || null,
      error: status === 'failed' ? transcodeError(video) : null,
    };
  },
  playback: (asset) => bunnyPlayback(asset),
  async remove(asset) {
    try {
      await bunnyClient().deleteVideo(asset.provider_video_id);
    } catch (err) {
      if (!(err instanceof BunnyError && err.upstreamStatus === 404)) throw err;
    }
  },
};

function transcodeError(video) {
  const worst = (video.transcodingMessages || []).filter((m) => m.level >= 2).map((m) => m.message).filter(Boolean)[0];
  return worst ? `Bunny could not process the video: ${String(worst).slice(0, 300)}` : 'Bunny could not process the video';
}

const external = {
  available: () => true,
  // Admin-supplied metadata is all there is; nothing to poll.
  sync: async () => null,
  playback: (asset) => ({ hls: null, mp4: asset.external_url, poster: asset.poster_url || null }),
  remove: async () => {},
};

const providers = { bunny, external };

export function videoStorage(name) {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown video storage provider: ${name}`);
  return provider;
}

export const storageStatus = () => ({
  bunny: { configured: bunny.available(), signedPlayback: Boolean(config.bunny.tokenKey), webhooks: Boolean(config.bunny.webhookKey) },
  externalHosts: config.video.externalHosts,
});
