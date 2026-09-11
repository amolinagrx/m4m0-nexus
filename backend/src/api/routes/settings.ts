import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isIP } from 'node:net';
import { db } from '../../config/database.js';
import { ldapSchema } from '../../config/ldap.js';
import { LDAPService } from '../../services/LDAPService.js';
import { WebhookService } from '../../services/WebhookService.js';
import { requireScope } from '../middleware/rbac.js';
import { AppError } from '../../utils/errors.js';
export async function maintenanceStatus() {
  const c = (await db.query('SELECT * FROM maintenance_config WHERE id=1')).rows[0];
  const now = Date.now();
  const scheduled =
    !!c.scheduled_start &&
    new Date(c.scheduled_start).getTime() <= now &&
    (!c.scheduled_end || new Date(c.scheduled_end).getTime() > now);
  return { ...c, active: c.active || scheduled };
}
export async function maintenanceGuard(req: FastifyRequest) {
  if (
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
    req.routeOptions.url?.startsWith('/api/v1/auth/')
  )
    return;
  const c = await maintenanceStatus();
  if (!c.active) return;
  const admin = req.principal.role === 'admin';
  if (admin && req.routeOptions.url?.startsWith('/api/v1/maintenance/')) return;
  if (admin && c.allowed_ips.includes(req.ip)) return;
  throw new AppError(503, c.message);
}
export async function settingsRoutes(app: FastifyInstance) {
  const ldap = new LDAPService();
  app.get('/maintenance/status', async () => {
    const c = await maintenanceStatus();
    return {
      active: c.active,
      message: c.message,
      scheduled_start: c.scheduled_start,
      scheduled_end: c.scheduled_end,
    };
  });
  app.get('/maintenance/config', { preHandler: requireScope('settings:read') }, maintenanceStatus);
  app.post('/maintenance/enable', { preHandler: requireScope('settings:write') }, async (req) => {
    const b = z
      .object({
        message: z.string().min(1).max(500),
        allowedIPs: z.array(z.string().refine((v) => isIP(v) !== 0)).default([]),
        scheduledStart: z.string().datetime().optional(),
        scheduledEnd: z.string().datetime().optional(),
      })
      .strict()
      .refine(
        (b) =>
          !b.scheduledEnd ||
          (!!b.scheduledStart && new Date(b.scheduledEnd) > new Date(b.scheduledStart)),
        'Invalid maintenance window',
      )
      .parse(req.body);
    await db.query(
      'UPDATE maintenance_config SET active=$1,message=$2,allowed_ips=$3,scheduled_start=$4,scheduled_end=$5 WHERE id=1',
      [
        !b.scheduledStart,
        b.message,
        b.allowedIPs,
        b.scheduledStart ?? null,
        b.scheduledEnd ?? null,
      ],
    );
    await new WebhookService().emit('alert.triggered', {
      type: 'maintenance',
      active: !b.scheduledStart,
      scheduledStart: b.scheduledStart,
    });
    return maintenanceStatus();
  });
  app.post('/maintenance/disable', { preHandler: requireScope('settings:write') }, async () => {
    await db.query(
      'UPDATE maintenance_config SET active=false,scheduled_start=NULL,scheduled_end=NULL WHERE id=1',
    );
    await new WebhookService().emit('alert.triggered', { type: 'maintenance', active: false });
    return maintenanceStatus();
  });
  app.put('/maintenance/message', { preHandler: requireScope('settings:write') }, async (req) => {
    const b = z.object({ message: z.string().min(1).max(500) }).parse(req.body);
    await db.query('UPDATE maintenance_config SET message=$1 WHERE id=1', [b.message]);
    return maintenanceStatus();
  });
  app.get('/ldap/config', { preHandler: requireScope('settings:read') }, async () => {
    const c = await ldap.config();
    if (!c) return null;
    const { bindCredentials, ...safe } = c;
    return { ...safe, hasBindCredentials: !!bindCredentials };
  });
  app.put('/ldap/config', { preHandler: requireScope('settings:write') }, async (req) => {
    await ldap.save(ldapSchema.parse(req.body));
    return { ok: true };
  });
  app.post('/ldap/test', { preHandler: requireScope('settings:write') }, async (req) =>
    ldap.test(ldapSchema.parse(req.body)),
  );
  app.post('/ldap/sync', { preHandler: requireScope('settings:write') }, async () =>
    ldap.syncUsers(),
  );
  app.get('/audit', { preHandler: requireScope('audit:read') }, async (req) => {
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(req.query);
    return (await db.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT $1', [q.limit])).rows;
  });
  app.get('/settings', { preHandler: requireScope('settings:read') }, async () => ({
    product: 'm4m0 NEXUS',
    version: '0.1.0',
    auth: ['local', 'ldap'],
    apiVersion: 'v1',
    backupTimezone: 'UTC',
    pluginPolicy: 'administrator-vetted code only',
  }));
}
