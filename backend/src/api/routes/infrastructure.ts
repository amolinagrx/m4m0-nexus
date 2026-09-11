import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import { encrypt, decrypt } from '../../utils/encrypt.js';
import { AppError } from '../../utils/errors.js';
import { InfrastructureService } from '../../services/InfrastructureService.js';
import { WebhookService } from '../../services/WebhookService.js';
import { requireScope } from '../middleware/rbac.js';
import { idParam, nameSchema, httpsURL } from '../middleware/validation.js';
export const infrastructureSchema = z
  .object({
    name: nameSchema,
    type: z.enum(['proxmox', 'kubernetes', 'xcpng', 'citrix', 'vmware']),
    endpoint: httpsURL,
    credentials: z
      .object({
        username: z.string().optional(),
        password: z.string().optional(),
        token: z.string().optional(),
        tokenId: z.string().optional(),
        caCert: z.string().optional(),
        clientCert: z.string().optional(),
        clientKey: z.string().optional(),
        kubeconfig: z
          .string()
          .max(1024 * 1024)
          .optional(),
      })
      .strict(),
  })
  .strict();
export async function infrastructureRoutes(app: FastifyInstance) {
  const service = new InfrastructureService();
  app.get(
    '/infrastructure',
    { preHandler: requireScope('infra:read') },
    async () =>
      (
        await db.query(
          'SELECT id,name,type,endpoint,status,last_sync,created_at FROM infrastructures ORDER BY name',
        )
      ).rows,
  );
  app.get('/infrastructure/:id', { preHandler: requireScope('infra:read') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const r = await db.query(
      'SELECT id,name,type,endpoint,status,last_sync FROM infrastructures WHERE id=$1',
      [id],
    );
    if (!r.rows[0]) throw new AppError(404, 'Infrastructure not found');
    return r.rows[0];
  });
  app.post('/infrastructure', { preHandler: requireScope('infra:write') }, async (req, reply) => {
    const b = infrastructureSchema.parse(req.body);
    const r = await db.query(
      'INSERT INTO infrastructures(name,type,endpoint,credentials_encrypted) VALUES($1,$2,$3,$4) RETURNING id,name,type,endpoint,status',
      [b.name, b.type, b.endpoint, encrypt(JSON.stringify(b.credentials), env.ENCRYPTION_KEY)],
    );
    return reply.code(201).send(r.rows[0]);
  });
  app.put('/infrastructure/:id', { preHandler: requireScope('infra:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = infrastructureSchema.parse(req.body);
    const old = (
      await db.query('SELECT type,credentials_encrypted FROM infrastructures WHERE id=$1', [id])
    ).rows[0];
    if (!old) throw new AppError(404, 'Infrastructure not found');
    if (old.type !== b.type) throw new AppError(400, 'Provider type is immutable');
    const credentials = {
      ...JSON.parse(decrypt(old.credentials_encrypted, env.ENCRYPTION_KEY)),
      ...b.credentials,
    };
    const r = await db.query(
      "UPDATE infrastructures SET name=$2,type=$3,endpoint=$4,credentials_encrypted=$5,status='pending' WHERE id=$1 RETURNING id,name,type,endpoint,status",
      [id, b.name, b.type, b.endpoint, encrypt(JSON.stringify(credentials), env.ENCRYPTION_KEY)],
    );
    if (!r.rowCount) throw new AppError(404, 'Infrastructure not found');
    return r.rows[0];
  });
  app.delete('/infrastructure/:id', { preHandler: requireScope('infra:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    await db.query('DELETE FROM infrastructures WHERE id=$1', [id]);
    await new WebhookService().emit('infrastructure.disconnected', { infrastructureId: id });
    return { ok: true };
  });
  app.post('/infrastructure/:id/sync', { preHandler: requireScope('infra:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const result = await service.sync(id);
    await new WebhookService().emit('infrastructure.connected', { infrastructureId: id });
    return result;
  });
  for (const [resource, scope, method] of [
    ['hosts', 'hosts:read', 'getHosts'],
    ['storage', 'storage:read', 'getStorage'],
    ['networks', 'infra:read', 'getNetworks'],
  ] as const) {
    app.get('/' + resource, { preHandler: requireScope(scope) }, async (req) => {
      const q = z.object({ infrastructureId: z.string().uuid() }).parse(req.query);
      return service.withConnector<unknown>(q.infrastructureId, (c) => c[method]());
    });
  }
}
