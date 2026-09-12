import { ZodError } from 'zod';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { decrypt } from '../utils/encrypt.js';
import { AppError } from '../utils/errors.js';
import { DockerConnector } from '../connectors/DockerConnector.js';
import { ZerobyteConnector } from '../connectors/ZerobyteConnector.js';
import type { EndpointCredentials } from '../connectors/ManagedEndpoint.js';
export async function withManagedConnector<T>(
  kind: 'docker',
  id: string,
  fn: (c: DockerConnector) => Promise<T>,
): Promise<T>;
export async function withManagedConnector<T>(
  kind: 'zerobyte',
  id: string,
  fn: (c: ZerobyteConnector) => Promise<T>,
): Promise<T>;
export async function withManagedConnector<T>(
  kind: 'docker' | 'zerobyte',
  id: string,
  fn: (c: never) => Promise<T>,
): Promise<T> {
  const table = kind === 'docker' ? 'docker_hosts' : 'zerobyte_instances';
  const row = (await db.query(`SELECT * FROM ${table} WHERE id=$1`, [id])).rows[0];
  if (!row) throw new AppError(404, 'Connection not found');
  const credentials = JSON.parse(
    decrypt(row.credentials_encrypted, env.ENCRYPTION_KEY),
  ) as EndpointCredentials;
  const c =
    kind === 'docker'
      ? new DockerConnector(row.endpoint, credentials)
      : new ZerobyteConnector(row.endpoint, credentials);
  try {
    if (c instanceof DockerConnector) await c.connect();
    const result = await fn(c as never);
    await db.query(`UPDATE ${table} SET status='connected',last_sync=now() WHERE id=$1`, [id]);
    return result;
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode >= 500)
      await db.query(`UPDATE ${table} SET status='error' WHERE id=$1`, [id]);
    if (error instanceof ZodError)
      throw new AppError(502, `Unexpected ${kind} response; check supported API version`);
    throw error;
  } finally {
    await c.close();
  }
}
