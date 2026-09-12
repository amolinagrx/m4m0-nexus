import { z } from 'zod';
import { ManagedEndpoint, type EndpointCredentials, remoteId } from './ManagedEndpoint.js';
import { AppError } from '../utils/errors.js';

const mountSchema = z.object({
  Type: z.string(),
  Name: z.string().optional(),
  Source: z.string().optional(),
  Destination: z.string(),
  RW: z.boolean().optional(),
});
const containerSchema = z.object({
  Id: z.string(),
  Names: z.array(z.string()),
  Image: z.string(),
  State: z.string(),
  Status: z.string(),
  Labels: z
    .record(z.string())
    .nullish()
    .transform((v) => v ?? {}),
  Mounts: z
    .array(mountSchema)
    .nullish()
    .transform((v) => v ?? []),
  Ports: z
    .array(
      z.object({
        IP: z.string().optional(),
        PrivatePort: z.number(),
        PublicPort: z.number().optional(),
        Type: z.string(),
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
});
export const containerCreateSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/),
    image: z.string().min(1).max(256).regex(/^\S+$/),
    ports: z
      .array(
        z
          .object({
            containerPort: z.number().int().min(1).max(65535),
            hostPort: z.number().int().min(1).max(65535),
            hostIp: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
          })
          .strict(),
      )
      .max(16)
      .default([]),
    volumes: z
      .array(
        z
          .object({
            name: remoteId,
            target: z
              .string()
              .max(1024)
              .refine(
                (value) =>
                  value.startsWith('/') &&
                  !value.includes('\0') &&
                  !value.split('/').includes('..'),
                'Use an absolute container path without parent traversal',
              ),
            readOnly: z.boolean().default(false),
          })
          .strict(),
      )
      .max(16)
      .default([]),
    restartPolicy: z.enum(['no', 'unless-stopped', 'on-failure']).default('unless-stopped'),
  })
  .strict();

export function decodeDockerLogs(buffer: Buffer, tty: boolean): string {
  if (tty) return buffer.toString('utf8');
  let offset = 0;
  const chunks: Buffer[] = [];
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length || buffer[offset]! > 2 || buffer.readUIntBE(offset + 1, 3) !== 0)
      throw new AppError(502, 'Invalid Docker log frame');
    const length = buffer.readUInt32BE(offset + 4);
    if (offset + 8 + length > buffer.length) throw new AppError(502, 'Truncated Docker log frame');
    chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length;
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class DockerConnector {
  private readonly transport: ManagedEndpoint;
  private version = '';
  constructor(endpoint: string, credentials: EndpointCredentials) {
    if (!credentials.clientCert || !credentials.clientKey)
      throw new AppError(400, 'Docker requires a client certificate and key (mTLS)');
    this.transport = new ManagedEndpoint(endpoint, credentials, 'Docker');
  }
  async connect() {
    const data = z
      .object({
        ApiVersion: z.string().regex(/^1\.\d+$/),
        MinAPIVersion: z.string().optional(),
        Version: z.string(),
      })
      .parse(await this.transport.json('GET', '/version'));
    // These operations use the v1.47 contract. Negotiate upwards when a newer daemon requires it.
    const minimum = Number(data.MinAPIVersion?.split('.')[1] ?? 24);
    const maximum = Number(data.ApiVersion.split('.')[1]);
    if (maximum < 47 || minimum > maximum)
      throw new AppError(502, 'Docker Engine API 1.47 or newer is required');
    this.version = `/v1.${Math.max(47, minimum)}`;
    return { version: data.Version, apiVersion: this.version.slice(2) };
  }
  private request<T = unknown>(method: string, path: string, body?: unknown) {
    return this.transport.json<T>(method, this.version + path, body);
  }
  async containers() {
    return z
      .array(containerSchema)
      .parse(await this.request('GET', '/containers/json?all=true'))
      .map((c) => ({
        id: c.Id,
        name: c.Names[0]?.replace(/^\//, '') ?? c.Id.slice(0, 12),
        image: c.Image,
        state: c.State,
        status: c.Status,
        project: c.Labels['com.docker.compose.project'] ?? '',
        service: c.Labels['com.docker.compose.service'] ?? '',
        mounts: c.Mounts,
        ports: c.Ports,
      }));
  }
  async inventory() {
    const containers = await this.containers();
    const images = z
      .array(
        z.object({
          Id: z.string(),
          RepoTags: z.array(z.string()).nullable().optional(),
          Size: z.number(),
          Created: z.number(),
        }),
      )
      .parse(await this.request('GET', '/images/json'));
    const volumes = z
      .object({
        Volumes: z
          .array(
            z.object({ Name: z.string(), Driver: z.string(), Mountpoint: z.string().optional() }),
          )
          .nullable(),
      })
      .parse(await this.request('GET', '/volumes'));
    const networks = z
      .array(z.object({ Id: z.string(), Name: z.string(), Driver: z.string(), Scope: z.string() }))
      .parse(await this.request('GET', '/networks'));
    return { containers, images, volumes: volumes.Volumes ?? [], networks };
  }
  async action(id: string, action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove') {
    const target = remoteId.parse(id);
    if (action === 'remove') {
      const info = await this.request<{ State: { Running: boolean } }>(
        'GET',
        `/containers/${target}/json`,
      );
      if (info.State.Running) throw new AppError(409, 'Stop the container before removing it');
      await this.request('DELETE', `/containers/${target}?force=false&v=false`);
    } else
      await this.request(
        'POST',
        `/containers/${target}/${action}${['stop', 'restart'].includes(action) ? '?t=30' : ''}`,
      );
    return { ok: true };
  }
  async logs(id: string, tail: number) {
    const target = remoteId.parse(id);
    const info = await this.request<{ Config: { Tty: boolean } }>(
      'GET',
      `/containers/${target}/json`,
    );
    const raw = await this.transport.bytes(
      'GET',
      `${this.version}/containers/${target}/logs?stdout=true&stderr=true&timestamps=true&tail=${tail}&follow=false`,
    );
    return { text: decodeDockerLogs(raw, info.Config.Tty) };
  }
  async create(input: z.infer<typeof containerCreateSchema>) {
    const b = containerCreateSchema.parse(input);
    // Reject missing images/volumes instead of silently pulling images or creating misspelled volumes.
    await this.request('GET', '/images/' + encodeURIComponent(b.image) + '/json');
    for (const v of b.volumes) await this.request('GET', '/volumes/' + v.name);
    return this.request<{ Id: string; Warnings: string[] }>(
      'POST',
      '/containers/create?name=' + encodeURIComponent(b.name),
      {
        Image: b.image,
        ExposedPorts: Object.fromEntries(b.ports.map((p) => [`${p.containerPort}/tcp`, {}])),
        HostConfig: {
          Privileged: false,
          SecurityOpt: ['no-new-privileges:true'],
          RestartPolicy: { Name: b.restartPolicy },
          PortBindings: Object.fromEntries(
            b.ports.map((p) => [
              `${p.containerPort}/tcp`,
              [{ HostIp: p.hostIp, HostPort: String(p.hostPort) }],
            ]),
          ),
          Mounts: b.volumes.map((v) => ({
            Type: 'volume',
            Source: v.name,
            Target: v.target,
            ReadOnly: v.readOnly,
          })),
        },
      },
    );
  }
  async createVolume(name: string) {
    return this.request('POST', '/volumes/create', { Name: remoteId.parse(name), Driver: 'local' });
  }
  async close() {
    await this.transport.close();
  }
}
