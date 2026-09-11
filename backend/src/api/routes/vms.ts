import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { VMService } from '../../services/VMService.js';
import { InfrastructureService } from '../../services/InfrastructureService.js';
import { requireScope } from '../middleware/rbac.js';
import { idParam } from '../middleware/validation.js';
import { ProxmoxConnector } from '../../connectors/ProxmoxConnector.js';
import { WebhookService } from '../../services/WebhookService.js';
import { AppError } from '../../utils/errors.js';
export async function vmRoutes(app: FastifyInstance) {
  const service = new VMService();
  app.get('/vms', { preHandler: requireScope('vms:read') }, async (req) => {
    const q = z.object({ infrastructureId: z.string().uuid().optional() }).parse(req.query);
    return (
      await db.query(
        'SELECT v.*,i.name AS infrastructure_name,i.type AS infrastructure_type FROM vms v JOIN infrastructures i ON i.id=v.infrastructure_id WHERE ($1::uuid IS NULL OR infrastructure_id=$1) ORDER BY v.name',
        [q.infrastructureId ?? null],
      )
    ).rows;
  });
  app.get('/vms/:id', { preHandler: requireScope('vms:read') }, async (req) =>
    service.find(idParam.parse(req.params).id),
  );
  app.get('/vms/:id/metrics', { preHandler: requireScope('vms:read') }, async (req) => {
    const vm = await service.find(idParam.parse(req.params).id);
    return new InfrastructureService().withConnector(vm.infrastructure_id, (c) =>
      c.getMetrics(vm.external_id),
    );
  });
  app.post('/vms', { preHandler: requireScope('vms:write') }, async (req, reply) => {
    const b = z
      .object({
        infrastructure_id: z.string().uuid(),
        name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9-]{0,62}$/),
        cpus: z.number().int().min(1).max(256),
        memory_mb: z.number().int().min(128),
        disk_gb: z.number().int().min(1),
        template_id: z.string().min(1),
      })
      .strict()
      .parse(req.body);
    const infra = new InfrastructureService();
    const external = await infra.withConnector(b.infrastructure_id, async (c) => {
      if (!(c instanceof ProxmoxConnector))
        throw new AppError(501, 'Provisioning currently supports Proxmox QEMU templates');
      return c.provisionVM(b);
    });
    await infra.sync(b.infrastructure_id);
    const row = (
      await db.query('SELECT * FROM vms WHERE infrastructure_id=$1 AND external_id=$2', [
        b.infrastructure_id,
        external,
      ])
    ).rows[0];
    await new WebhookService().emit('vm.created', {
      vmId: row.id,
      vmName: row.name,
      infrastructure: b.infrastructure_id,
      triggeredBy: req.principal.id,
    });
    return reply.code(201).send(row);
  });
  for (const action of ['start', 'stop', 'restart', 'snapshot', 'migrate'] as const)
    app.post(`/vms/:id/${action}`, { preHandler: requireScope('vms:write') }, async (req) => {
      const { id } = idParam.parse(req.params);
      const body = z
        .object({
          name: z
            .string()
            .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
            .optional(),
          targetHost: z.string().min(1).max(128).optional(),
        })
        .strict()
        .parse(req.body ?? {});
      const value = action === 'snapshot' ? body.name : body.targetHost;
      if (['snapshot', 'migrate'].includes(action) && !value)
        throw new AppError(400, 'Name or targetHost required');
      return service.action(id, action, req.principal.id, value);
    });
  app.delete('/vms/:id', { preHandler: requireScope('vms:write') }, async (req) =>
    service.action(idParam.parse(req.params).id, 'delete', req.principal.id),
  );
}
