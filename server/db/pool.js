import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

// bigint (20) and numeric (1700, what sum() over bigint returns) arrive as
// strings by default. Every such value here is a count that fits in a double.
pg.types.setTypeParser(20, Number);
pg.types.setTypeParser(1700, Number);

const ssl = config.pgSsl ? { rejectUnauthorized: false } : undefined;

// Without DATABASE_URL, pg reads PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
export const pool = new pg.Pool({
  ...(config.databaseUrl ? { connectionString: config.databaseUrl } : {}),
  ssl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => logger.error('idle database client error', { error: err.message }));

export const query = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
