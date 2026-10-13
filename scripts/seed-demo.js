// Seeds a development database with what the video demo needs: an API key,
// one campaign in every video format, and a short external video creative.
//   node scripts/seed-demo.js            prints the API key (new each run)
// Refuses to run with NODE_ENV=production.

import crypto from 'node:crypto';
import { pool, query } from '../server/db/pool.js';
import { generateSiteKey } from '../server/middleware/siteKey.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

// CC0 sample from MDN; its host must be in EXTERNAL_VIDEO_HOSTS for the
// dashboard to accept it, but seeding writes it directly.
const VIDEO_URL = process.env.DEMO_VIDEO_URL || 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const VIDEO_SECONDS = Number(process.env.DEMO_VIDEO_SECONDS || 5.4);
const NAME = 'Video demo';

const { key, hash, prefix } = generateSiteKey();
await query('INSERT INTO site_keys (name, key_hash, prefix) VALUES ($1, $2, $3)', [`${NAME} ${crypto.randomBytes(2).toString('hex')}`, hash, prefix]);

let campaign = (await query('SELECT id FROM campaigns WHERE name = $1', [NAME])).rows[0];
if (!campaign) {
  campaign = (
    await query(
      `INSERT INTO campaigns (name, status, weight, click_url, formats, skip_after_seconds, reward_watch_percent, premium_skip_seconds)
       VALUES ($1, 'active', 50, 'https://example.com/?from=55gms-video-demo',
               '{video_embedded,video_fullscreen,video_rewarded}', 5, 100, 5) RETURNING id`,
      [NAME]
    )
  ).rows[0];
  const creative = (
    await query(
      `INSERT INTO creatives (campaign_id, kind, source, title, external_url, width, height, mime, bytes)
       VALUES ($1, 'video', 'external', 'Flower (CC0 sample)', $2, 1280, 720, 'video/mp4', 0) RETURNING id`,
      [campaign.id, VIDEO_URL]
    )
  ).rows[0];
  await query(
    `INSERT INTO video_assets (creative_id, provider, external_url, status, duration_seconds, width, height, has_mp4_fallback)
     VALUES ($1, 'external', $2, 'ready', $3, 1280, 720, true)`,
    [creative.id, VIDEO_URL, VIDEO_SECONDS]
  );
}

console.log(`Campaign "${NAME}" is ready (${campaign.id}).`);
console.log(`ADS_API_KEY=${key}`);
await pool.end();
