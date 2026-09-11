import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { PluginManager } from '../plugins/PluginManager.js';
import { requireScope } from '../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
const params = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{1,60}$/) });
export async function pluginRoutes(app: FastifyInstance) {
  app.get(
    '/plugins',
    { preHandler: requireScope('plugins:read') },
    async () =>
      (
        await db.query(
          'SELECT id,name,version,description,author,active,installed_at FROM plugins ORDER BY name',
        )
      ).rows,
  );
  app.get(
    '/plugins/:id/logs',
    { preHandler: requireScope('plugins:read') },
    async (req) =>
      (
        await db.query(
          'SELECT id,action,details,created_at FROM audit_logs WHERE resource=$1 ORDER BY id DESC LIMIT 100',
          ['plugin:' + params.parse(req.params).id],
        )
      ).rows,
  );
  app.post('/plugins', { preHandler: requireScope('plugins:write') }, async (req, reply) =>
    reply.code(201).send(await new PluginManager().install(params.parse(req.body).id)),
  );
  app.put('/plugins/:id', { preHandler: requireScope('plugins:write') }, async (req) => {
    const b = z
      .object({ config: z.record(z.unknown()) })
      .strict()
      .parse(req.body);
    await db.query('UPDATE plugins SET config=$2 WHERE id=$1', [
      params.parse(req.params).id,
      JSON.stringify(b.config),
    ]);
    return { ok: true };
  });
  for (const action of ['enable', 'disable'])
    app.post(
      `/plugins/:id/${action}`,
      { preHandler: requireScope('plugins:write') },
      async (req) => {
        const r = await db.query('UPDATE plugins SET active=$2 WHERE id=$1', [
          params.parse(req.params).id,
          action === 'enable',
        ]);
        if (!r.rowCount) throw new AppError(404, 'Plugin not found');
        return { ok: true };
      },
    );
  app.delete('/plugins/:id', { preHandler: requireScope('plugins:write') }, async (req) => {
    await db.query('DELETE FROM plugins WHERE id=$1', [params.parse(req.params).id]);
    return { ok: true };
  });
}
