// Minimal stand-in for the 55GMS game server, for local end-to-end runs.
//   ADS_SERVER_URL=http://localhost:3001 ADS_API_KEY=gms_live_... node edge/example/server.js
// Then open http://ads.test:4000 (localhost gets no ads: a host needs a dot)
// and POST /_debug/flush to push image stats now.
//
// /game.html is the video and rewarded demo: a parent page that registers a
// game iframe, exactly as the 55GMS game page would.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAdsRouter } from '../index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '../../embed/dist');
const app = express();

// Demo only: Premium comes from a cookie the page can toggle. On 55GMS this
// hook reads the real session and the users table instead; never a value the
// browser can set.
const demoViewer = (req) => {
  const cookie = req.headers.cookie || '';
  const user = /(?:^|;\s*)demo_user=([a-z0-9-]{1,40})/.exec(cookie);
  return user ? { userId: user[1], premium: /(?:^|;\s*)demo_premium=1/.test(cookie) } : null;
};

const ads = createAdsRouter({
  adServerUrl: process.env.ADS_SERVER_URL || 'http://localhost:3000',
  apiKey: process.env.ADS_API_KEY,
  flushIntervalMs: Number(process.env.ADS_FLUSH_INTERVAL_MS) || 60 * 60 * 1000,
  manifestRefreshMs: 60 * 1000,
  spoolDir: process.env.ADS_SPOOL_DIR || path.join(here, '.spool'),
  resolveViewer: demoViewer,
});

app.use('/_ads', ads);
for (const name of ['ads', 'video', 'sdk']) app.get(`/${name}.min.js`, (_req, res) => res.sendFile(path.join(dist, `${name}.min.js`)));
app.get('/_debug/stats', (_req, res) => res.json(ads.getStats()));
app.post('/_debug/flush', async (_req, res) => res.json(await ads.flush()));
// Signs the demo visitor in as a free or Premium user.
app.post('/_debug/viewer', express.json(), (req, res) => {
  const premium = req.body?.premium === true;
  res.setHeader('Set-Cookie', [`demo_user=demo-${premium ? 'premium' : 'free'}; Path=/; SameSite=Lax`, `demo_premium=${premium ? 1 : 0}; Path=/; SameSite=Lax`]);
  res.json({ premium });
});
app.use('/games', express.static(path.join(here, 'games')));
app.get('/game.html', (_req, res) => res.sendFile(path.join(here, 'game.html')));
app.get('/', (_req, res) => res.sendFile(path.join(here, 'index.html')));

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Example 55GMS server on http://localhost:${port}`));
