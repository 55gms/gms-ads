import { createApp } from './app.js';
import { pruneRefreshTokens } from './auth/session.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { logger } from './logger.js';
import { pruneIngestBatches } from './services/ingest.js';

async function main() {
  // Migrations run on boot so a deploy never serves against an old schema.
  await migrate();

  const server = createApp().listen(config.port, () => {
    logger.info('ad server listening', { port: config.port, publicBaseUrl: config.publicBaseUrl, env: config.isProd ? 'production' : 'development' });
  });
  server.keepAliveTimeout = 65_000;

  const housekeeping = () =>
    Promise.all([pruneIngestBatches(), pruneRefreshTokens(), pool.query("DELETE FROM edge_instances WHERE last_seen_at < now() - interval '1 day'")]).catch((err) =>
      logger.error('housekeeping failed', { error: err.message })
    );
  housekeeping();
  const timer = setInterval(housekeeping, 6 * 60 * 60 * 1000);
  timer.unref();

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    clearInterval(timer);
    // Stop accepting connections, let in-flight requests finish, then close the pool.
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', { error: String(reason?.message || reason) }));

main().catch((err) => {
  logger.error('startup failed', { error: err.message });
  process.exit(1);
});
