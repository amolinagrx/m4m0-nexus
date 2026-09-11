import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import { encrypt } from '../../utils/encrypt.js';
import { requireScope } from '../middleware/rbac.js';
import { KubernetesConnector } from '../../connectors/KubernetesConnector.js';
import { InfrastructureService } from '../../services/InfrastructureService.js';
import { AppError } from '../../utils/errors.js';
import { infrastructureSchema } from './infrastructure.js';
const params = z.object({
  id: z.string().uuid(),
  ns: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
    .optional(),
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{0,252}$/)
    .optional(),
  pod: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{0,252}$/)
    .optional(),
});
export async function withKubernetes<T>(id: string, fn: (c: KubernetesConnector) => Promise<T>) {
  return new InfrastructureService().withConnector(id, (c) => {
    if (!(c instanceof KubernetesConnector)) throw new AppError(400, 'Not a Kubernetes cluster');
    return fn(c);
  });
}
export async function kubernetesRoutes(app: FastifyInstance) {
  app.get(
    '/kubernetes/clusters',
    { preHandler: requireScope('kubernetes:read') },
    async () =>
      (
        await db.query(
          "SELECT id,name,endpoint,status,last_sync FROM infrastructures WHERE type='kubernetes' ORDER BY name",
        )
      ).rows,
  );
  app.post(
    '/kubernetes/clusters',
    { preHandler: requireScope('infra:write') },
    async (req, reply) => {
      const b = infrastructureSchema.parse(req.body);
      if (b.type !== 'kubernetes') throw new AppError(400, 'Kubernetes type required');
      const r = await db.query(
        'INSERT INTO infrastructures(name,type,endpoint,credentials_encrypted) VALUES($1,$2,$3,$4) RETURNING id,name,status',
        [b.name, b.type, b.endpoint, encrypt(JSON.stringify(b.credentials), env.ENCRYPTION_KEY)],
      );
      return reply.code(201).send(r.rows[0]);
    },
  );
  app.get(
    '/kubernetes/clusters/:id/namespaces',
    { preHandler: requireScope('kubernetes:read') },
    async (req) => withKubernetes(params.parse(req.params).id, (c) => c.namespaces()),
  );
  for (const resource of [
    'pods',
    'deployments',
    'services',
    'ingress',
    'pvcs',
    'configmaps',
    'secrets',
  ] as const)
    app.get(
      `/kubernetes/clusters/:id/namespaces/:ns/${resource}`,
      { preHandler: requireScope(resource === 'secrets' ? 'kubernetes:write' : 'kubernetes:read') },
      async (req) => {
        const p = params.parse(req.params);
        return withKubernetes<unknown>(p.id, (c) => c[resource](p.ns!));
      },
    );
  app.post(
    '/kubernetes/clusters/:id/namespaces/:ns/deployments/:name/scale',
    { preHandler: requireScope('kubernetes:write') },
    async (req) => {
      const p = params.parse(req.params),
        b = z.object({ replicas: z.number().int().min(0).max(1000) }).parse(req.body);
      return withKubernetes(p.id, (c) => c.scale(p.ns!, p.name!, b.replicas));
    },
  );
  app.post(
    '/kubernetes/clusters/:id/namespaces/:ns/deployments/:name/restart',
    { preHandler: requireScope('kubernetes:write') },
    async (req) => {
      const p = params.parse(req.params);
      return withKubernetes(p.id, (c) => c.restartDeployment(p.ns!, p.name!));
    },
  );
  app.get(
    '/kubernetes/clusters/:id/namespaces/:ns/pods/:pod/logs',
    { preHandler: requireScope('kubernetes:read') },
    async (req) => {
      const p = params.parse(req.params),
        q = z.object({ container: z.string().optional() }).parse(req.query);
      return { logs: await withKubernetes(p.id, (c) => c.logs(p.ns!, p.pod!, q.container)) };
    },
  );
}
