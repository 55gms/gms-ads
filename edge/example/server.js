// Minimal stand-in for the 55GMS game server, for local end-to-end runs.
//   ADS_SERVER_URL=http://localhost:3000 ADS_API_KEY=gms_live_... node edge/example/server.js
// Then open http://localhost:4000 and POST /_debug/flush to push stats now.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAdsRouter } from '../index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const ads = createAdsRouter({
  adServerUrl: process.env.ADS_SERVER_URL || 'http://localhost:3000',
  apiKey: process.env.ADS_API_KEY,
  flushIntervalMs: Number(process.env.ADS_FLUSH_INTERVAL_MS) || 60 * 60 * 1000,
  manifestRefreshMs: 60 * 1000,
  spoolDir: process.env.ADS_SPOOL_DIR || path.join(here, '.spool'),
});

app.use('/_ads', ads);
app.get('/ads.min.js', (_req, res) => res.sendFile(path.join(here, '../../embed/dist/ads.min.js')));
app.get('/_debug/stats', (_req, res) => res.json(ads.getStats()));
app.post('/_debug/flush', async (_req, res) => res.json(await ads.flush()));
app.get('/', (_req, res) => res.sendFile(path.join(here, 'index.html')));

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Example 55GMS server on http://localhost:${port}`));
