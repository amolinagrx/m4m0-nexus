import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import { encrypt, decrypt } from '../../utils/encrypt.js';
import { BackupService, exportSchema } from '../../services/BackupService.js';
import { AppError } from '../../utils/errors.js';
import { requireScope } from '../middleware/rbac.js';
import { idParam, nameSchema } from '../middleware/validation.js';
const schema = z
  .object({
    name: nameSchema,
    type: z.enum(['vm', 'infrastructure', 'full']),
    targets: z.array(z.string().uuid()).default([]),
    schedule: z.string().min(9).max(100),
    retention: z.number().int().min(1).max(3650).default(30),
    storage: z
      .object({
        type: z.enum(['local', 's3', 'nfs', 'smb']),
        bucket: z.string().optional(),
        endpoint: z.string().url().optional(),
        accessKey: z.string().optional(),
        secretKey: z.string().optional(),
        region: z.string().optional(),
        proxmoxStorage: z.string().optional(),
      })
      .strict(),
    compression: z.boolean().default(true),
    encryption: z.boolean().default(true),
    encryptionPassword: z.string().min(16).optional(),
    notifyOnComplete: z.boolean().default(true),
    notifyOnFailure: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((b) => !b.encryption || !!b.encryptionPassword, 'Encryption password required')
  .refine(
    (b) => b.type !== 'vm' || (b.targets.length > 0 && !!b.storage.proxmoxStorage && !b.encryption),
    'VM backups require targets, proxmoxStorage and encryption=false',
  );
export async function backupRoutes(app: FastifyInstance) {
  const service = new BackupService();
  app.get(
    '/backups/jobs',
    { preHandler: requireScope('backups:read') },
    async () =>
      (
        await db.query(
          'SELECT id,name,type,targets,schedule,retention_days,storage_type,compression,encryption,notify_on_complete,notify_on_failure,active,last_run FROM backup_jobs ORDER BY name',
        )
      ).rows,
  );
  async function save(body: unknown, id?: string) {
    if (id) {
      const old = (await db.query('SELECT * FROM backup_jobs WHERE id=$1', [id])).rows[0];
      if (!old) throw new AppError(404, 'Backup job not found');
      const incoming = z.record(z.unknown()).parse(body);
      const oldStorage = JSON.parse(decrypt(old.storage_config_encrypted, env.ENCRYPTION_KEY));
      body = {
        ...incoming,
        storage: { ...oldStorage, ...z.record(z.unknown()).parse(incoming.storage) },
        encryptionPassword:
          incoming.encryptionPassword ??
          (old.encryption_password_encrypted
            ? decrypt(old.encryption_password_encrypted, env.ENCRYPTION_KEY)
            : undefined),
      };
    }
    const b = schema.parse(body);
    const jobId = id ?? randomUUID();
    // Validate cron before persisting or scheduling.
    const { default: parser } = await import('cron-parser');
    parser.parseExpression(b.schedule, { tz: 'UTC' });
    const values = [
      jobId,
      b.name,
      b.type,
      b.targets,
      b.schedule,
      b.retention,
      b.storage.type,
      encrypt(JSON.stringify(b.storage), env.ENCRYPTION_KEY),
      b.compression,
      b.encryption,
      b.encryptionPassword ? encrypt(b.encryptionPassword, env.ENCRYPTION_KEY) : null,
      b.notifyOnComplete,
      b.notifyOnFailure,
      b.active,
    ];
    await db.query(
      'INSERT INTO backup_jobs(id,name,type,targets,schedule,retention_days,storage_type,storage_config_encrypted,compression,encryption,encryption_password_encrypted,notify_on_complete,notify_on_failure,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET name=$2,type=$3,targets=$4,schedule=$5,retention_days=$6,storage_type=$7,storage_config_encrypted=$8,compression=$9,encryption=$10,encryption_password_encrypted=$11,notify_on_complete=$12,notify_on_failure=$13,active=$14',
      values,
    );
    if (b.active) await service.scheduleBackup(jobId, b.schedule);
    else await service.queue.removeJobScheduler(`backup-${jobId}`);
    return { id: jobId };
  }
  app.post('/backups/jobs', { preHandler: requireScope('backups:write') }, async (req, reply) =>
    reply.code(201).send(await save(req.body)),
  );
  app.put('/backups/jobs/:id', { preHandler: requireScope('backups:write') }, async (req) =>
    save(req.body, idParam.parse(req.params).id),
  );
  app.delete('/backups/jobs/:id', { preHandler: requireScope('backups:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    await service.queue.removeJobScheduler(`backup-${id}`);
    await db.query('DELETE FROM backup_jobs WHERE id=$1', [id]);
    return { ok: true };
  });
  app.post(
    '/backups/jobs/:id/run',
    { preHandler: requireScope('backups:write') },
    async (req, reply) => {
      const { id } = idParam.parse(req.params);
      if (!(await db.query('SELECT 1 FROM backup_jobs WHERE id=$1', [id])).rowCount)
        throw new AppError(404, 'Backup job not found');
      await service.queue.add(
        'manual',
        { id },
        { attempts: 1, jobId: `manual-${id}`, removeOnComplete: true, removeOnFail: true },
      );
      return reply.code(202).send({ queued: true });
    },
  );
  app.get(
    '/backups/history',
    { preHandler: requireScope('backups:read') },
    async () =>
      (
        await db.query(
          'SELECT id,job_id,status,started_at,completed_at,duration_seconds,backup_size_bytes,error_message FROM backup_history ORDER BY started_at DESC LIMIT 200',
        )
      ).rows,
  );
  app.get('/backups/:id', { preHandler: requireScope('backups:read') }, async (req) => {
    const r = await db.query(
      'SELECT id,job_id,status,started_at,completed_at,backup_size_bytes,error_message FROM backup_history WHERE id=$1',
      [idParam.parse(req.params).id],
    );
    if (!r.rows[0]) throw new AppError(404, 'Backup not found');
    return r.rows[0];
  });
  app.get(
    '/backups/:id/download',
    { preHandler: requireScope('backups:read') },
    async (req, reply) =>
      reply
        .type('application/octet-stream')
        .send(await service.download(idParam.parse(req.params).id)),
  );
  app.post('/backups/:id/restore', { preHandler: requireScope('backups:write') }, async (req) => {
    const b = z.object({ password: z.string().optional() }).parse(req.body ?? {});
    return service.restore(idParam.parse(req.params).id, b.password);
  });
  app.delete('/backups/:id', { preHandler: requireScope('backups:write') }, async (req) => {
    await service.remove(idParam.parse(req.params).id);
    return { ok: true };
  });
  app.post('/export', { preHandler: requireScope('backups:write') }, async (req, reply) => {
    const bytes = await service.export(exportSchema.parse(req.body)),
      id = randomUUID();
    await mkdir(env.BACKUP_DIR, { recursive: true });
    const path = join(env.BACKUP_DIR, `export-${id}.nexus`);
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    await db.query('INSERT INTO exports(id,owner_id,backup_path) VALUES($1,$2,$3)', [
      id,
      req.principal.id,
      path,
    ]);
    return reply.code(201).send({ id });
  });
  app.get('/export/:id', { preHandler: requireScope('backups:read') }, async (req, reply) => {
    const r = await db.query('SELECT backup_path FROM exports WHERE id=$1 AND owner_id=$2', [
      idParam.parse(req.params).id,
      req.principal.id,
    ]);
    if (!r.rows[0]) throw new AppError(404, 'Export not found');
    return reply
      .header('Content-Disposition', 'attachment; filename="nexus-config.nexus"')
      .type('application/octet-stream')
      .send(await readFile(r.rows[0].backup_path));
  });
  app.post('/import', { preHandler: requireScope('backups:write') }, async (req, reply) => {
    const b = z
      .object({ data: z.string().max(28 * 1024 * 1024), password: z.string().optional() })
      .strict()
      .parse(req.body);
    const id = randomUUID();
    await db.query("INSERT INTO imports(id,owner_id,status) VALUES($1,$2,'running')", [
      id,
      req.principal.id,
    ]);
    try {
      const result = await service.import(Buffer.from(b.data, 'base64'), b.password);
      await db.query("UPDATE imports SET status='completed',result=$2 WHERE id=$1", [
        id,
        JSON.stringify(result),
      ]);
      return reply.code(201).send({ id, ...result });
    } catch (e) {
      await db.query("UPDATE imports SET status='failed' WHERE id=$1", [id]);
      throw e;
    }
  });
  app.get('/import/:id/status', { preHandler: requireScope('backups:read') }, async (req) => {
    const r = await db.query('SELECT id,status,result FROM imports WHERE id=$1 AND owner_id=$2', [
      idParam.parse(req.params).id,
      req.principal.id,
    ]);
    if (!r.rows[0]) throw new AppError(404, 'Import not found');
    return r.rows[0];
  });
}
