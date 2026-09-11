import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import { encrypt } from '../../utils/encrypt.js';
import { WebhookService, validateWebhookURL } from '../../services/WebhookService.js';
import { requireScope } from '../middleware/rbac.js';
import { idParam, nameSchema, httpsURL } from '../middleware/validation.js';
import { webhookEvents } from '../../models/types.js';
import { AppError } from '../../utils/errors.js';
const schema = z
  .object({
    name: nameSchema,
    url: httpsURL,
    method: z.enum(['POST', 'GET', 'PUT']).default('POST'),
    headers: z.record(z.string()).default({}),
    events: z.array(z.enum(webhookEvents)).min(1),
    active: z.boolean().default(true),
    secret: z.string().min(16).optional(),
    retryCount: z.number().int().min(1).max(3).default(3),
    timeout: z.number().int().min(1).max(60).default(30),
  })
  .strict();
export async function webhookRoutes(app: FastifyInstance) {
  const fields = 'id,name,url,method,events,active,retry_count,timeout,created_at';
  app.get(
    '/webhooks',
    { preHandler: requireScope('webhooks:read') },
    async () => (await db.query(`SELECT ${fields} FROM webhooks ORDER BY created_at DESC`)).rows,
  );
  app.get('/webhooks/:id', { preHandler: requireScope('webhooks:read') }, async (req) => {
    const r = await db.query(`SELECT ${fields} FROM webhooks WHERE id=$1`, [
      idParam.parse(req.params).id,
    ]);
    if (!r.rows[0]) throw new AppError(404, 'Webhook not found');
    return r.rows[0];
  });
  app.post('/webhooks', { preHandler: requireScope('webhooks:write') }, async (req, reply) => {
    const b = schema.parse(req.body);
    validateWebhookURL(b.url);
    const r = await db.query(
      `INSERT INTO webhooks(name,url,method,headers_encrypted,events,active,secret_encrypted,retry_count,timeout) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${fields}`,
      [
        b.name,
        b.url,
        b.method,
        encrypt(JSON.stringify(b.headers), env.ENCRYPTION_KEY),
        b.events,
        b.active,
        b.secret ? encrypt(b.secret, env.ENCRYPTION_KEY) : null,
        b.retryCount,
        b.timeout,
      ],
    );
    return reply.code(201).send(r.rows[0]);
  });
  app.put('/webhooks/:id', { preHandler: requireScope('webhooks:write') }, async (req) => {
    const b = schema.parse(req.body);
    validateWebhookURL(b.url);
    const r = await db.query(
      `UPDATE webhooks SET name=$2,url=$3,method=$4,headers_encrypted=$5,events=$6,active=$7,secret_encrypted=COALESCE($8,secret_encrypted),retry_count=$9,timeout=$10 WHERE id=$1 RETURNING ${fields}`,
      [
        idParam.parse(req.params).id,
        b.name,
        b.url,
        b.method,
        encrypt(JSON.stringify(b.headers), env.ENCRYPTION_KEY),
        b.events,
        b.active,
        b.secret ? encrypt(b.secret, env.ENCRYPTION_KEY) : null,
        b.retryCount,
        b.timeout,
      ],
    );
    if (!r.rowCount) throw new AppError(404, 'Webhook not found');
    return r.rows[0];
  });
  app.delete('/webhooks/:id', { preHandler: requireScope('webhooks:write') }, async (req) => {
    await db.query('DELETE FROM webhooks WHERE id=$1', [idParam.parse(req.params).id]);
    return { ok: true };
  });
  app.post('/webhooks/:id/test', { preHandler: requireScope('webhooks:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    if (!(await db.query('SELECT 1 FROM webhooks WHERE id=$1 AND active=true', [id])).rowCount)
      throw new AppError(404, 'Active webhook not found');
    await new WebhookService().emit(
      'alert.triggered',
      { test: true, triggeredBy: req.principal.id },
      id,
    );
    return { queued: true };
  });
  app.get(
    '/webhooks/:id/logs',
    { preHandler: requireScope('webhooks:read') },
    async (req) =>
      (
        await db.query(
          'SELECT * FROM webhook_logs WHERE webhook_id=$1 ORDER BY created_at DESC LIMIT 100',
          [idParam.parse(req.params).id],
        )
      ).rows,
  );
}
