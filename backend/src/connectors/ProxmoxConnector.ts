import { Agent, fetch } from 'undici';
import { z } from 'zod';
import type { BaseConnector } from './BaseConnector.js';
import type {
  ConnectionConfig,
  VM,
  Host,
  Storage,
  Network,
  VMMetrics,
  ConsoleConfig,
} from '../models/types.js';
import { AppError } from '../utils/errors.js';
const resource = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    node: z.string().optional(),
    type: z.string(),
    vmid: z.number().optional(),
    status: z.string().optional(),
    maxcpu: z.number().optional(),
    maxmem: z.number().optional(),
    maxdisk: z.number().optional(),
    disk: z.number().optional(),
  })
  .passthrough();
export class ProxmoxConnector implements BaseConnector {
  private config!: ConnectionConfig;
  private agent!: Agent;
  private headers: Record<string, string> = {};
  async connect(c: ConnectionConfig) {
    if (new URL(c.endpoint).protocol !== 'https:')
      throw new AppError(400, 'HTTPS endpoint required');
    this.config = c;
    this.agent = new Agent({ connect: { ca: c.caCert || undefined, rejectUnauthorized: true } });
    if (c.tokenId && c.token) this.headers.Authorization = `PVEAPIToken=${c.tokenId}=${c.token}`;
    else {
      const t = await this.request<{ ticket: string; CSRFPreventionToken: string }>(
        'POST',
        '/access/ticket',
        { username: c.username ?? '', password: c.password ?? '' },
      );
      this.headers = {
        Cookie: `PVEAuthCookie=${t.ticket}`,
        CSRFPreventionToken: t.CSRFPreventionToken,
      };
    }
    await this.request('GET', '/version');
  }
  async request<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, string | number | boolean>,
  ): Promise<T> {
    const r = await fetch(`${this.config.endpoint.replace(/\/$/, '')}/api2/json${path}`, {
      method,
      dispatcher: this.agent,
      headers: {
        ...this.headers,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: body
        ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]))
        : undefined,
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw new AppError(502, `Proxmox API returned ${r.status}`);
    }
    return ((await r.json()) as { data: T }).data;
  }
  async disconnect() {
    await this.agent?.close();
  }
  private async resources() {
    return z.array(resource).parse(await this.request('GET', '/cluster/resources'));
  }
  async getVMs(): Promise<VM[]> {
    return (await this.resources())
      .filter((x) => ['qemu', 'lxc'].includes(x.type))
      .map((x) => ({
        id: `${x.node}/${x.type}/${x.vmid}`,
        name: x.name ?? x.id,
        state: x.status ?? 'unknown',
        host: x.node ?? '',
        cpus: x.maxcpu ?? 0,
        memoryMB: (x.maxmem ?? 0) / 1048576,
        kind: x.type,
      }));
  }
  async getHosts(): Promise<Host[]> {
    return (await this.resources())
      .filter((x) => x.type === 'node')
      .map((x) => ({
        id: x.node ?? x.id,
        name: x.node ?? x.id,
        state: x.status ?? 'unknown',
        cpus: x.maxcpu ?? 0,
        memoryMB: (x.maxmem ?? 0) / 1048576,
      }));
  }
  async getStorage(): Promise<Storage[]> {
    return (await this.resources())
      .filter((x) => x.type === 'storage')
      .map((x) => ({
        id: x.id,
        name: x.id,
        type: 'proxmox',
        capacityBytes: x.maxdisk ?? 0,
        usedBytes: x.disk ?? 0,
      }));
  }
  async getNetworks(): Promise<Network[]> {
    const hosts = await this.getHosts();
    return (
      await Promise.all(
        hosts.map(async (h) => {
          const rows = await this.request<{ iface: string; type: string }[]>(
            'GET',
            `/nodes/${encodeURIComponent(h.id)}/network`,
          );
          return rows.map((x) => ({ id: `${h.id}/${x.iface}`, name: x.iface, type: x.type }));
        }),
      )
    ).flat();
  }
  private path(id: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/(qemu|lxc)\/\d+$/.test(id))
      throw new AppError(400, 'Invalid Proxmox VM ID');
    return `/nodes/${id}`;
  }
  async waitTask(node: string, task: string) {
    for (let i = 0; i < 120; i++) {
      const s = await this.request<{ status: string; exitstatus?: string }>(
        'GET',
        `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(task)}/status`,
      );
      if (s.status === 'stopped') {
        if (s.exitstatus !== 'OK') throw new AppError(502, `Proxmox task failed: ${s.exitstatus}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new AppError(504, 'Proxmox task still running; inspect task status before retrying');
  }
  private async operation(
    id: string,
    suffix: string,
    body?: Record<string, string | number | boolean>,
    method = 'POST',
  ) {
    const result = await this.request<string | null>(method, this.path(id) + suffix, body);
    if (result) await this.waitTask(id.split('/')[0]!, result);
  }
  async startVM(id: string) {
    await this.operation(id, '/status/start');
  }
  async stopVM(id: string) {
    await this.operation(id, '/status/shutdown');
  }
  async restartVM(id: string) {
    await this.operation(id, '/status/reboot');
  }
  async snapshotVM(id: string, name: string) {
    await this.operation(id, '/snapshot', { snapname: name });
  }
  async migrateVM(id: string, target: string) {
    await this.operation(id, '/migrate', { target, online: 1 });
  }
  async deleteVM(id: string) {
    await this.operation(id, '', undefined, 'DELETE');
  }
  async getMetrics(id: string): Promise<VMMetrics> {
    const r = await this.request<{ cpu: number; mem: number; netin: number; netout: number }>(
      'GET',
      this.path(id) + '/status/current',
    );
    return {
      cpu: r.cpu,
      memoryBytes: r.mem,
      networkInBytes: r.netin,
      networkOutBytes: r.netout,
      timestamp: new Date().toISOString(),
    };
  }
  async getConsoleURL(id: string): Promise<ConsoleConfig> {
    const t = await this.request<{ ticket: string; port: number }>(
      'POST',
      this.path(id) + '/vncproxy',
      { websocket: 1 },
    );
    const u = new URL(this.config.endpoint);
    return {
      type: 'vnc',
      host: u.hostname,
      port: t.port,
      password: t.ticket,
      tls: true,
      url: `wss://${u.host}/api2/json${this.path(id)}/vncwebsocket?port=${t.port}&vncticket=${encodeURIComponent(t.ticket)}`,
      headers: this.headers,
      caCert: this.config.caCert,
    };
  }
  async provisionVM(input: {
    name: string;
    cpus: number;
    memory_mb: number;
    disk_gb: number;
    template_id: string;
  }) {
    const template = this.path(input.template_id);
    if (!input.template_id.includes('/qemu/'))
      throw new AppError(400, 'Provisioning requires a QEMU template');
    const source = await this.request<{ template?: number }>('GET', template + '/config');
    if (source.template !== 1) throw new AppError(400, 'Source is not a Proxmox template');
    const vmid = await this.request<string>('GET', '/cluster/nextid');
    const node = input.template_id.split('/')[0]!;
    const id = `${node}/qemu/${vmid}`;
    let cloned = false;
    try {
      await this.operation(input.template_id, '/clone', { newid: vmid, name: input.name, full: 1 });
      cloned = true;
      await this.request('PUT', this.path(id) + '/config', {
        cores: input.cpus,
        memory: input.memory_mb,
      });
      const config = await this.request<Record<string, string>>('GET', this.path(id) + '/config');
      const disk = Object.keys(config)
        .filter((k) => /^(scsi|virtio|sata)\d+$/.test(k) && !config[k]?.includes('media=cdrom'))
        .sort()[0];
      if (!disk) throw new AppError(400, 'Template has no supported disk');
      await this.operation(id, '/resize', { disk, size: input.disk_gb + 'G' }, 'PUT');
      return id;
    } catch (e) {
      if (cloned) {
        try {
          await this.deleteVM(id);
        } catch {
          throw new AppError(502, `Provisioning incomplete; inspect and clean up ${id}`);
        }
      }
      throw e;
    }
  }
  async backupVM(id: string, storage: string) {
    const [node, , vmid] = id.split('/');
    this.path(id);
    const task = await this.request<string>('POST', `/nodes/${node}/vzdump`, {
      vmid: vmid!,
      storage,
      mode: 'snapshot',
      compress: 'zstd',
    });
    await this.waitTask(node!, task);
    return { task, storage };
  }
}
