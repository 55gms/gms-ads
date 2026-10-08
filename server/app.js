import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { authRouter } from './auth/routes.js';
import { config, rootDir } from './config.js';
import { query } from './db/pool.js';
import { cookies } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { adminRouter } from './routes/admin/index.js';
import { mediaRouter } from './routes/media.js';
import { v1Router } from './routes/v1.js';

const spaDir = path.join(rootDir, 'web/dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);

  // Strict CSP for the admin SPA. Images may come from https hosts because
  // external creatives and avatars live elsewhere. No CORS headers anywhere.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          styleSrcAttr: ["'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.isProd,
    })
  );

  app.get('/healthz', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/media', mediaRouter);
  app.use('/api/v1', v1Router);

  app.use(cookies);
  app.use('/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use(['/api', '/auth', '/media'], notFound);

  // Built SPA: hashed assets are immutable, index.html is always revalidated.
  if (fs.existsSync(spaDir)) {
    app.use(
      express.static(spaDir, {
        index: false,
        setHeaders: (res, file) => {
          const immutable = file.includes(`${path.sep}assets${path.sep}`) || file.includes(`${path.sep}fonts${path.sep}`);
          res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      })
    );
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(spaDir, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
