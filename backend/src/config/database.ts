import pg from 'pg';
import { env } from './env.js';
export const db = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 15,
  statement_timeout: 15000,
});
export async function transaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
