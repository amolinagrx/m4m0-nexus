import { z } from 'zod';
import parser from 'cron-parser';
import { AppError } from '../utils/errors.js';
import { ManagedEndpoint, type EndpointCredentials, remoteId } from './ManagedEndpoint.js';
const retention = z.object({ keepLast: z.number().int().min(1).max(10000) }).strict();
export const zerobyteJobSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    volumeId: remoteId,
    repositoryId: remoteId,
    enabled: z.boolean().default(true),
    cronExpression: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          parser.parseExpression(value);
          return true;
        } catch {
          return false;
        }
      }, 'Invalid cron expression'),
    retentionPolicy: retention.default({ keepLast: 7 }),
    includePaths: z.array(z.string().max(2048)).max(100).default([]),
    excludePatterns: z.array(z.string().max(2048)).max(100).default([]),
  })
  .strict();
const schedule = z.object({
  id: z.number(),
  shortId: remoteId,
  name: z.string(),
  volumeId: z.number(),
  repositoryId: z.string(),
  enabled: z.boolean(),
  cronExpression: z.string(),
  retentionPolicy: z.record(z.unknown()).nullable(),
  includePaths: z.array(z.string()).nullable(),
  excludePatterns: z.array(z.string()).nullable(),
  lastBackupAt: z.number().nullable(),
  lastBackupStatus: z.string().nullable(),
  nextBackupAt: z.number().nullable(),
  volume: z.object({ name: z.string() }).optional(),
  repository: z.object({ name: z.string() }).optional(),
});
export class ZerobyteConnector {
  private readonly transport: ManagedEndpoint;
  constructor(endpoint: string, credentials: EndpointCredentials) {
    this.transport = new ManagedEndpoint(endpoint, credentials, 'Zerobyte');
  }
  async jobs() {
    return z.array(schedule).parse(await this.transport.json('GET', '/api/v1/backups'));
  }
  async resources() {
    const volumes = z
      .array(
        z.object({
          id: z.number(),
          shortId: remoteId,
          name: z.string(),
          status: z.string().optional(),
        }),
      )
      .parse(await this.transport.json('GET', '/api/v1/volumes'));
    const repositories = z
      .array(z.object({ id: z.string(), shortId: remoteId, name: z.string() }))
      .parse(await this.transport.json('GET', '/api/v1/repositories'));
    return { volumes, repositories };
  }
  async createJob(body: z.infer<typeof zerobyteJobSchema>) {
    return schedule.parse(await this.transport.json('POST', '/api/v1/backups', body));
  }
  async updateJob(id: string, body: z.infer<typeof zerobyteJobSchema>) {
    // Zerobyte does not support changing a schedule's source volume.
    const old = schedule
      .extend({ maxRetries: z.number().optional(), retryDelay: z.number().optional() })
      .parse(await this.transport.json('GET', '/api/v1/backups/' + remoteId.parse(id)));
    const resources = await this.resources();
    const source = resources.volumes.find(
      (v) => v.shortId === body.volumeId || String(v.id) === body.volumeId,
    );
    if (!source || source.id !== old.volumeId)
      throw new AppError(400, 'The source volume of a schedule cannot change');
    const { volumeId: _volumeId, ...update } = body;
    return schedule.parse(
      await this.transport.json('PATCH', '/api/v1/backups/' + id, {
        ...update,
        retentionPolicy: { ...old.retentionPolicy, ...update.retentionPolicy },
        maxRetries: old.maxRetries ?? 2,
        retryDelay: old.retryDelay ?? 15,
      }),
    );
  }
  async deleteJob(id: string) {
    await this.transport.json('DELETE', '/api/v1/backups/' + remoteId.parse(id));
    return { ok: true };
  }
  async run(id: string) {
    return z
      .object({ taskId: z.string(), status: z.literal('started') })
      .parse(await this.transport.json('POST', `/api/v1/backups/${remoteId.parse(id)}/run`));
  }
  async history() {
    const response = await this.transport.json('GET', '/api/v1/tasks/history?page=1');
    // Project only safe fields; task errors can contain storage credentials or command arguments.
    return z
      .object({
        items: z.array(
          z.object({
            id: z.string(),
            kind: z.string(),
            status: z.string(),
            startedAt: z.number().nullable().optional(),
            finishedAt: z.number().nullable().optional(),
            outcome: z.string().nullable().optional(),
          }),
        ),
      })
      .parse(response);
  }
  async snapshots(repositoryId: string) {
    return z
      .array(
        z.object({
          short_id: z.string(),
          time: z.number(),
          size: z.number(),
          paths: z.array(z.string()),
          tags: z.array(z.string()),
        }),
      )
      .parse(
        await this.transport.json(
          'GET',
          `/api/v1/repositories/${remoteId.parse(repositoryId)}/snapshots`,
        ),
      );
  }
  async close() {
    await this.transport.close();
  }
}
