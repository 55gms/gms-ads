// Applies numbered .sql files from ./migrations in order, once each.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { logger } from '../logger.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_ID = 5519001;

export async function migrate() {
  const client = await pool.connect();
  try {
    // One migrator at a time, even when several containers start together.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    const ran = [];
    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = fs.readFileSync(path.join(dir, name), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${name} failed: ${err.message}`);
      }
      ran.push(name);
      logger.info('migration applied', { name });
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const ran = await migrate();
    logger.info(ran.length ? 'migrations complete' : 'database is up to date', { applied: ran.length });
    await pool.end();
  } catch (err) {
    logger.error('migration failed', { error: err.message });
    process.exit(1);
  }
}
