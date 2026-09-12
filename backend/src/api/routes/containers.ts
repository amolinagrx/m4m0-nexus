import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import { encrypt, decrypt } from '../../utils/encrypt.js';
import { AppError } from '../../utils/errors.js';
import { managedEndpoint, remoteId } from '../../connectors/ManagedEndpoint.js';
import { containerCreateSchema } from '../../connectors/DockerConnector.js';
import { zerobyteJobSchema } from '../../connectors/ZerobyteConnector.js';
import { audit } from '../../services/AuditService.js';
import { withManagedConnector } from '../../services/ContainerManagementService.js';
import { requireScope } from '../middleware/rbac.js';
import { idParam, nameSchema } from '../middleware/validation.js';
const pem = z.string().min(1).max(32768);
const hostSchema = z
  .object({
    name: nameSchema,
    endpoint: managedEndpoint,
    credentials: z
      .object({ caCert: pem.optional(), clientCert: pem.optional(), clientKey: pem.optional() })
      .strict(),
  })
  .strict();
const instanceSchema = z
  .object({
    name: nameSchema,
    endpoint: managedEndpoint,
    dockerHostId: z.string().uuid(),
    credentials: z
      .object({ caCert: pem.optional(), apiKey: z.string().min(16).max(4096).optional() })
      .strict(),
  })
  .strict();
const target = idParam.extend({ containerId: remoteId });
const jobTarget = idParam.extend({ jobId: remoteId });
export async function containerRoutes(app: FastifyInstance) {
  app.addHook('onResponse', async (req, reply) => {
    if (
      !req.principal ||
      reply.statusCode >= 400 ||
      ['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    )
      return;
    const params = req.params as Record<string, string>;
    const route = req.routeOptions.url ?? '';
    const action = route.endsWith('/action')
      ? (req.body as { action: string }).action
      : req.method.toLowerCase();
    await audit(
      req.principal.id,
      `${route.includes('/docker/') ? 'docker' : 'zerobyte'}.${action}`,
      params.containerId ?? params.jobId ?? params.id ?? null,
      req.ip,
      { connectionId: params.id, route, statusCode: reply.statusCode },
    );
  });
  for (const kind of ['docker', 'zerobyte'] as const) {
    const table = kind === 'docker' ? 'docker_hosts' : 'zerobyte_instances';
    const base = kind === 'docker' ? '/docker/hosts' : '/zerobyte/instances';
    const scope = kind === 'docker' ? 'docker' : 'backups';
    const columns =
      'id,name,endpoint,status,last_sync,created_at' +
      (kind === 'zerobyte' ? ',docker_host_id' : '');
    app.get(
      base,
      { preHandler: requireScope(`${scope}:read`) },
      async () => (await db.query(`SELECT ${columns} FROM ${table} ORDER BY name`)).rows,
    );
    const save = async (body: unknown, id?: string) => {
      const b = kind === 'docker' ? hostSchema.parse(body) : instanceSchema.parse(body);
      const old = id
        ? (await db.query(`SELECT credentials_encrypted,endpoint FROM ${table} WHERE id=$1`, [id]))
            .rows[0]
        : null;
      if (id && !old) throw new AppError(404, 'Connection not found');
      // Never forward old credentials to a different server after an endpoint edit.
      const credentials = {
        ...(old && old.endpoint === b.endpoint
          ? JSON.parse(decrypt(old.credentials_encrypted, env.ENCRYPTION_KEY))
          : {}),
        ...b.credentials,
      };
      if (
        kind === 'docker' ? !credentials.clientCert || !credentials.clientKey : !credentials.apiKey
      )
        throw new AppError(
          400,
          kind === 'docker' ? 'Client certificate and key required' : 'Zerobyte API key required',
        );
      const values: unknown[] = [
        b.name,
        b.endpoint,
        encrypt(JSON.stringify(credentials), env.ENCRYPTION_KEY),
      ];
      let extraColumn = '',
        extraValue = '',
        extraUpdate = '';
      if ('dockerHostId' in b) {
        if (!(await db.query('SELECT 1 FROM docker_hosts WHERE id=$1', [b.dockerHostId])).rowCount)
          throw new AppError(404, 'Docker host not found');
        values.push(b.dockerHostId);
        extraColumn = ',docker_host_id';
        extraValue = ',$4';
        extraUpdate = ',docker_host_id=$4';
      }
      if (id) {
        values.push(id);
        return (
          await db.query(
            `UPDATE ${table} SET name=$1,endpoint=$2,credentials_encrypted=$3,status='pending'${extraUpdate} WHERE id=$${values.length} RETURNING ${columns}`,
            values,
          )
        ).rows[0];
      }
      return (
        await db.query(
          `INSERT INTO ${table}(name,endpoint,credentials_encrypted${extraColumn}) VALUES($1,$2,$3${extraValue}) RETURNING ${columns}`,
          values,
        )
      ).rows[0];
    };
    app.post(base, { preHandler: requireScope(`${scope}:write`) }, async (req, reply) =>
      reply.code(201).send(await save(req.body)),
    );
    app.put(base + '/:id', { preHandler: requireScope(`${scope}:write`) }, async (req) =>
      save(req.body, idParam.parse(req.params).id),
    );
    app.delete(base + '/:id', { preHandler: requireScope(`${scope}:write`) }, async (req) => {
      const { id } = idParam.parse(req.params);
      try {
        await db.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
      } catch (error) {
        if ((error as { code?: string }).code === '23503')
          throw new AppError(409, 'Remove the linked Zerobyte connections first');
        throw error;
      }
      return { ok: true };
    });
  }
  app.get('/docker/hosts/:id/inventory', { preHandler: requireScope('docker:read') }, async (req) =>
    withManagedConnector('docker', idParam.parse(req.params).id, (c) => c.inventory()),
  );
  app.post(
    '/docker/hosts/:id/containers',
    { preHandler: requireScope('docker:write') },
    async (req, reply) => {
      const b = containerCreateSchema.parse(req.body);
      return reply
        .code(201)
        .send(
          await withManagedConnector('docker', idParam.parse(req.params).id, (c) => c.create(b)),
        );
    },
  );
  app.post(
    '/docker/hosts/:id/volumes',
    { preHandler: requireScope('docker:write') },
    async (req, reply) => {
      const { name } = z.object({ name: remoteId }).strict().parse(req.body);
      await withManagedConnector('docker', idParam.parse(req.params).id, (c) =>
        c.createVolume(name),
      );
      return reply.code(201).send({ name });
    },
  );
  app.post(
    '/docker/hosts/:id/containers/:containerId/action',
    { preHandler: requireScope('docker:write') },
    async (req) => {
      const { id, containerId } = target.parse(req.params);
      const { action } = z
        .object({ action: z.enum(['start', 'stop', 'restart', 'pause', 'unpause', 'remove']) })
        .strict()
        .parse(req.body);
      return withManagedConnector('docker', id, (c) => c.action(containerId, action));
    },
  );
  app.get(
    '/docker/hosts/:id/containers/:containerId/logs',
    { preHandler: requireScope('docker:logs') },
    async (req) => {
      const { id, containerId } = target.parse(req.params);
      const { tail } = z
        .object({ tail: z.coerce.number().int().min(1).max(2000).default(200) })
        .parse(req.query);
      return withManagedConnector('docker', id, (c) => c.logs(containerId, tail));
    },
  );
  for (const resource of ['jobs', 'resources', 'history'] as const)
    app.get(
      `/zerobyte/instances/:id/${resource}`,
      { preHandler: requireScope('backups:read') },
      async (req) =>
        withManagedConnector<unknown>('zerobyte', idParam.parse(req.params).id, (c) =>
          c[resource](),
        ),
    );
  app.post(
    '/zerobyte/instances/:id/jobs',
    { preHandler: requireScope('backups:write') },
    async (req, reply) => {
      const b = zerobyteJobSchema.parse(req.body);
      return reply
        .code(201)
        .send(
          await withManagedConnector('zerobyte', idParam.parse(req.params).id, (c) =>
            c.createJob(b),
          ),
        );
    },
  );
  app.put(
    '/zerobyte/instances/:id/jobs/:jobId',
    { preHandler: requireScope('backups:write') },
    async (req) => {
      const { id, jobId } = jobTarget.parse(req.params);
      const b = zerobyteJobSchema.parse(req.body);
      return withManagedConnector('zerobyte', id, (c) => c.updateJob(jobId, b));
    },
  );
  app.delete(
    '/zerobyte/instances/:id/jobs/:jobId',
    { preHandler: requireScope('backups:write') },
    async (req) => {
      const { id, jobId } = jobTarget.parse(req.params);
      return withManagedConnector('zerobyte', id, (c) => c.deleteJob(jobId));
    },
  );
  app.post(
    '/zerobyte/instances/:id/jobs/:jobId/run',
    { preHandler: requireScope('backups:write') },
    async (req, reply) => {
      const { id, jobId } = jobTarget.parse(req.params);
      return reply.code(202).send(await withManagedConnector('zerobyte', id, (c) => c.run(jobId)));
    },
  );
  app.get(
    '/zerobyte/instances/:id/repositories/:repositoryId/snapshots',
    { preHandler: requireScope('backups:read') },
    async (req) => {
      const { id, repositoryId } = idParam.extend({ repositoryId: remoteId }).parse(req.params);
      return withManagedConnector('zerobyte', id, (c) => c.snapshots(repositoryId));
    },
  );
}
