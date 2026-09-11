import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID, createHash } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { z } from 'zod';
import { db, transaction } from '../config/database.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { encrypt, decrypt, passwordEncrypt, passwordDecrypt } from '../utils/encrypt.js';
import { AppError } from '../utils/errors.js';
import { InfrastructureService } from './InfrastructureService.js';
import { ProxmoxConnector } from '../connectors/ProxmoxConnector.js';
import { WebhookService } from './WebhookService.js';
export const exportSchema = z
  .object({
    includeInfrastructures: z.boolean().default(true),
    includeUsers: z.boolean().default(false),
    includeWebhooks: z.boolean().default(true),
    includeTokens: z.boolean().default(false),
    includeAuditLogs: z.boolean().default(false),
    format: z.enum(['json', 'sql']).default('json'),
    encrypt: z.boolean().default(true),
    encryptionPassword: z.string().min(16).optional(),
  })
  .strict()
  .refine((c) => !c.encrypt || !!c.encryptionPassword, 'Encryption password required');
export type BackupConfig = z.infer<typeof exportSchema>;
const str = z.string(),
  id = z.string().uuid(),
  nullable = str.nullable();
const tables = {
  infrastructures: z
    .object({
      id,
      name: str,
      type: z.enum(['proxmox', 'kubernetes', 'xcpng', 'citrix', 'vmware']),
      endpoint: str.url(),
      credentials_encrypted: str,
      status: str,
      last_sync: nullable,
      created_at: str,
    })
    .strict(),
  users: z
    .object({
      id,
      email: str.email(),
      password_hash: nullable,
      role: z.enum(['admin', 'user', 'readonly']),
      source: z.enum(['local', 'ldap']),
      active: z.boolean(),
      ldap_dn: nullable,
      created_at: str,
    })
    .strict(),
  webhooks: z
    .object({
      id,
      name: str,
      url: str.url(),
      method: z.enum(['GET', 'POST', 'PUT']),
      headers_encrypted: nullable,
      events: z.array(str),
      active: z.boolean(),
      secret_encrypted: nullable,
      retry_count: z.number().int().min(1).max(3),
      timeout: z.number().int().min(1).max(60),
      created_at: str,
    })
    .strict(),
  api_tokens: z
    .object({
      id,
      name: str,
      token_hash: str,
      user_id: id,
      scopes: z.array(str),
      expires_at: nullable,
      last_used_at: nullable,
      created_at: str,
    })
    .strict(),
};
type TableName = keyof typeof tables;
const selections: Record<TableName, keyof BackupConfig> = {
  infrastructures: 'includeInfrastructures',
  users: 'includeUsers',
  webhooks: 'includeWebhooks',
  api_tokens: 'includeTokens',
};
const sharedQueue = new Queue<{ id: string }>('backups', { connection: redis });
export class BackupService {
  readonly queue = sharedQueue;
  async export(config: BackupConfig): Promise<Buffer> {
    const c = exportSchema.parse(config);
    const data: Record<string, unknown[]> = {};
    await transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      for (const [table, key] of Object.entries(selections))
        if (c[key]) data[table] = (await tx.query(`SELECT * FROM ${table}`)).rows;
      if (c.includeAuditLogs)
        data.audit_logs = (await tx.query('SELECT * FROM audit_logs ORDER BY id')).rows;
    });
    const payload = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), data });
    const manifest = JSON.stringify({
      payload,
      sha256: createHash('sha256').update(payload).digest('hex'),
    });
    let result = manifest;
    if (c.format === 'sql') {
      const quote = (v: unknown): string =>
        v === null
          ? 'NULL'
          : typeof v === 'boolean'
            ? String(v)
            : typeof v === 'number'
              ? String(v)
              : Array.isArray(v)
                ? `ARRAY[${v.map(quote).join(',')}]::text[]`
                : `'${(typeof v === 'object' ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'`;
      result =
        '-- Nexus configuration export. Restore only into an isolated database.\nBEGIN;\n' +
        Object.entries(data)
          .filter(([t]) => t !== 'audit_logs')
          .flatMap(([t, rows]) =>
            rows.map((r) => {
              const row = r as Record<string, unknown>;
              return `INSERT INTO ${t} (${Object.keys(row)
                .map((k) => '"' + k + '"')
                .join(
                  ',',
                )}) VALUES (${Object.values(row).map(quote).join(',')}) ON CONFLICT DO NOTHING;`;
            }),
          )
          .join('\n') +
        '\nCOMMIT;\n';
    }
    return c.encrypt ? passwordEncrypt(result, c.encryptionPassword!) : Buffer.from(result);
  }
  async import(buffer: Buffer, password?: string) {
    if (buffer.length > 20 * 1024 * 1024) throw new AppError(413, 'Import exceeds 20 MB');
    let parsed: unknown;
    try {
      parsed = JSON.parse(password ? passwordDecrypt(buffer, password) : buffer.toString());
    } catch {
      throw new AppError(400, 'Invalid backup or password');
    }
    const envelope = z
      .object({ payload: str, sha256: str.regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(parsed);
    if (createHash('sha256').update(envelope.payload).digest('hex') !== envelope.sha256)
      throw new AppError(400, 'Backup integrity check failed');
    const content = z
      .object({ version: z.literal(1), createdAt: str, data: z.record(z.array(z.unknown())) })
      .strict()
      .parse(JSON.parse(envelope.payload));
    const validated: Partial<Record<TableName, Record<string, unknown>[]>> = {};
    for (const [name, rows] of Object.entries(content.data)) {
      if (name === 'audit_logs') continue;
      if (!(name in tables)) throw new AppError(400, 'Unknown backup table');
      const table = name as TableName;
      validated[table] = rows.map((row) => tables[table].parse(row));
    }
    // Encrypted credential blobs remain bound to ENCRYPTION_KEY. Validate before writing anything.
    for (const rows of Object.values(validated))
      for (const row of rows ?? [])
        for (const [key, value] of Object.entries(row))
          if (key.endsWith('_encrypted') && typeof value === 'string')
            decrypt(value, env.ENCRYPTION_KEY);
    const restored = await transaction(async (tx) => {
      let count = 0;
      for (const table of ['users', 'infrastructures', 'webhooks', 'api_tokens'] as TableName[])
        for (const row of validated[table] ?? []) {
          const entries = Object.entries(row);
          const columns = entries.map(([k]) => '"' + k + '"').join(',');
          const values = entries.map((_, i) => '$' + (i + 1)).join(',');
          const r = await tx.query(
            `INSERT INTO ${table} (${columns}) VALUES (${values}) ON CONFLICT(id) DO NOTHING`,
            entries.map(([, v]) => v),
          );
          count += r.rowCount ?? 0;
        }
      return count;
    });
    return { restored, mode: 'merge-missing', auditLogs: 'preserved locally; not imported' };
  }
  async scheduleBackup(id: string, cron: string) {
    await this.queue.upsertJobScheduler(
      `backup-${id}`,
      { pattern: cron },
      {
        name: 'scheduled-backup',
        data: { id },
        opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      },
    );
  }
  async reconcile() {
    for (const job of await this.queue.getJobSchedulers()) {
      const id = job.key?.replace('backup-', '');
      if (
        id &&
        !(await db.query('SELECT 1 FROM backup_jobs WHERE id=$1 AND active=true', [id])).rowCount
      )
        await this.queue.removeJobScheduler(job.key!);
    }
    for (const job of (await db.query('SELECT id,schedule FROM backup_jobs WHERE active=true'))
      .rows)
      await this.scheduleBackup(job.id, job.schedule);
  }
  private safePath(path: string) {
    const full = resolve(path),
      root = resolve(env.BACKUP_DIR) + sep;
    if (!full.startsWith(root)) throw new AppError(400, 'Invalid backup path');
    return full;
  }
  private s3(config: Record<string, string>) {
    return new S3Client({
      region: config.region ?? 'us-east-1',
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials:
        config.accessKey && config.secretKey
          ? { accessKeyId: config.accessKey, secretAccessKey: config.secretKey }
          : undefined,
    });
  }
  worker() {
    return new Worker<{ id: string }>('backups', async (job) => this.run(job.data.id), {
      connection: redis,
      concurrency: 1,
    });
  }
  async run(id: string) {
    const jobs = await db.query('SELECT * FROM backup_jobs WHERE id=$1', [id]);
    const job = jobs.rows[0];
    if (!job) throw new AppError(404, 'Backup job not found');
    const history = (
      await db.query(
        "INSERT INTO backup_history(job_id,status) VALUES($1,'running') RETURNING id",
        [id],
      )
    ).rows[0].id as string;
    try {
      const config = JSON.parse(
        decrypt(job.storage_config_encrypted, env.ENCRYPTION_KEY),
      ) as Record<string, string>;
      let path: string | undefined,
        size = 0,
        manifest: Record<string, unknown> = {};
      if (job.type === 'vm') {
        if (job.encryption || !config.proxmoxStorage)
          throw new AppError(
            400,
            'VM backups require proxmoxStorage; Nexus envelope encryption applies only to configuration backups',
          );
        const results = [];
        for (const vmId of job.targets) {
          const vm = (await db.query('SELECT * FROM vms WHERE id=$1', [vmId])).rows[0];
          if (!vm) throw new AppError(404, 'Backup target missing');
          results.push(
            await new InfrastructureService().withConnector(vm.infrastructure_id, async (c) => {
              if (!(c instanceof ProxmoxConnector))
                throw new AppError(501, 'VM backup currently supports Proxmox vzdump');
              return c.backupVM(vm.external_id, config.proxmoxStorage!);
            }),
          );
        }
        manifest = {
          type: 'proxmox-vzdump',
          results,
          restore: 'Restore using Proxmox storage UI; archives remain on hypervisor storage',
        };
      } else {
        let bytes = await this.export({
          includeInfrastructures: true,
          includeUsers: job.type === 'full',
          includeWebhooks: true,
          includeTokens: false,
          includeAuditLogs: false,
          format: 'json',
          encrypt: job.encryption,
          encryptionPassword: job.encryption_password_encrypted
            ? decrypt(job.encryption_password_encrypted, env.ENCRYPTION_KEY)
            : undefined,
        });
        if (job.compression) bytes = gzipSync(bytes);
        size = bytes.length;
        const file = history + '.nexus' + (job.compression ? '.gz' : '');
        if (job.storage_type === 's3') {
          if (!config.bucket) throw new AppError(400, 'S3 bucket required');
          const s3 = this.s3(config);
          try {
            await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: file, Body: bytes }));
          } finally {
            s3.destroy();
          }
          path = `s3://${config.bucket}/${file}`;
        } else {
          await mkdir(env.BACKUP_DIR, { recursive: true });
          path = join(env.BACKUP_DIR, file);
          await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
        }
        manifest = {
          type: 'configuration',
          compression: job.compression,
          encryption: job.encryption,
          storage: job.storage_type,
          configEncrypted: job.storage_config_encrypted,
        };
      }
      await db.query(
        "UPDATE backup_history SET status='completed',completed_at=now(),duration_seconds=extract(epoch FROM now()-started_at),backup_size_bytes=$2,backup_path=$3,manifest=$4 WHERE id=$1",
        [history, size, path, JSON.stringify(manifest)],
      );
      await db.query('UPDATE backup_jobs SET last_run=now() WHERE id=$1', [id]);
      if (job.notify_on_complete)
        await new WebhookService().emit('backup.completed', { jobId: id, backupId: history });
      await this.retention(id, job.retention_days);
      return { backupId: history };
    } catch (e) {
      const message =
        e instanceof AppError
          ? e.message
          : 'Backup failed; inspect provider and storage connectivity';
      await db.query(
        "UPDATE backup_history SET status='failed',completed_at=now(),error_message=$2 WHERE id=$1",
        [history, message],
      );
      if (job.notify_on_failure)
        await new WebhookService().emit('backup.failed', {
          jobId: id,
          backupId: history,
          error: message,
        });
      throw e;
    }
  }
  async download(id: string) {
    const row = (
      await db.query("SELECT * FROM backup_history WHERE id=$1 AND status='completed'", [id])
    ).rows[0];
    if (!row?.backup_path) throw new AppError(404, 'Downloadable configuration backup not found');
    if (row.backup_path.startsWith('s3://')) {
      const config = JSON.parse(decrypt(row.manifest.configEncrypted, env.ENCRYPTION_KEY));
      const client = this.s3(config);
      try {
        const r = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: row.backup_path.split('/').at(-1) }),
        );
        return Buffer.from(await r.Body!.transformToByteArray());
      } finally {
        client.destroy();
      }
    }
    return readFile(this.safePath(row.backup_path));
  }
  async restore(id: string, password?: string) {
    const bytes = await this.download(id);
    return this.import(
      bytes[0] === 0x1f && bytes[1] === 0x8b
        ? gunzipSync(bytes, { maxOutputLength: 20 * 1024 * 1024 })
        : bytes,
      password,
    );
  }
  async remove(id: string) {
    const row = (await db.query('SELECT * FROM backup_history WHERE id=$1', [id])).rows[0];
    if (!row) throw new AppError(404, 'Backup not found');
    if (row.status === 'running') throw new AppError(409, 'Backup is running');
    if (row.backup_path?.startsWith('s3://')) {
      const config = JSON.parse(decrypt(row.manifest.configEncrypted, env.ENCRYPTION_KEY));
      const client = this.s3(config);
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: config.bucket,
            Key: row.backup_path.split('/').at(-1),
          }),
        );
      } finally {
        client.destroy();
      }
    } else if (row.backup_path) await unlink(this.safePath(row.backup_path));
    await db.query('DELETE FROM backup_history WHERE id=$1', [id]);
  }
  async retention(job: string, days: number) {
    const rows = await db.query(
      "SELECT id FROM backup_history WHERE job_id=$1 AND status='completed' AND manifest->>'type'='configuration' AND started_at<now()-($2 * interval '1 day')",
      [job, days],
    );
    for (const row of rows.rows) await this.remove(row.id);
  }
}
