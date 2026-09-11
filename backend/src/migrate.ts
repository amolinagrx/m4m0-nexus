import { readFile, readdir } from 'node:fs/promises';
import { db, transaction } from './config/database.js';
const directory = new URL('../../database/init-scripts/', import.meta.url);
try {
  await transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(401010)');
    await c.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const f of (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort()) {
      if (!(await c.query('SELECT 1 FROM schema_migrations WHERE version=$1', [f])).rowCount) {
        await c.query(await readFile(new URL(f, directory), 'utf8'));
      }
    }
  });
} finally {
  await db.end();
}
