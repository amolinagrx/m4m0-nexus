import { Agent, fetch } from 'undici';
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
import { unsupported, AppError } from '../utils/errors.js';
export class VMwareConnector implements BaseConnector {
  private endpoint = '';
  private session = '';
  private agent!: Agent;
  async request<T>(method: string, path: string): Promise<T> {
    const r = await fetch(this.endpoint + path, {
      method,
      dispatcher: this.agent,
      headers: { 'vmware-api-session-id': this.session },
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw new AppError(502, `vCenter API returned ${r.status}`);
    }
    return (r.status === 204 ? undefined : await r.json()) as T;
  }
  async connect(c: ConnectionConfig) {
    if (new URL(c.endpoint).protocol !== 'https:')
      throw new AppError(400, 'HTTPS endpoint required');
    this.endpoint = c.endpoint.replace(/\/$/, '');
    this.agent = new Agent({ connect: { rejectUnauthorized: true, ca: c.caCert || undefined } });
    const r = await fetch(this.endpoint + '/api/session', {
      method: 'POST',
      dispatcher: this.agent,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64'),
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!r.ok) {
      await r.body?.cancel();
      throw new AppError(502, 'vCenter authentication failed');
    }
    this.session = (await r.json()) as string;
  }
  async disconnect() {
    try {
      if (this.session) await this.request('DELETE', '/api/session');
    } finally {
      await this.agent?.close();
    }
  }
  async getVMs(): Promise<VM[]> {
    return (
      await this.request<
        {
          vm: string;
          name: string;
          power_state: string;
          cpu_count: number;
          memory_size_MiB: number;
        }[]
      >('GET', '/api/vcenter/vm')
    ).map((v) => ({
      id: v.vm,
      name: v.name,
      state: v.power_state.toLowerCase(),
      host: '',
      cpus: v.cpu_count,
      memoryMB: v.memory_size_MiB,
    }));
  }
  async getHosts(): Promise<Host[]> {
    return (
      await this.request<{ host: string; name: string; connection_state: string }[]>(
        'GET',
        '/api/vcenter/host',
      )
    ).map((h) => ({
      id: h.host,
      name: h.name,
      state: h.connection_state.toLowerCase(),
      cpus: 0,
      memoryMB: 0,
    }));
  }
  async getStorage(): Promise<Storage[]> {
    return (
      await this.request<
        { datastore: string; name: string; type: string; capacity: number; free_space: number }[]
      >('GET', '/api/vcenter/datastore')
    ).map((s) => ({
      id: s.datastore,
      name: s.name,
      type: s.type,
      capacityBytes: s.capacity,
      usedBytes: s.capacity - s.free_space,
    }));
  }
  async getNetworks(): Promise<Network[]> {
    return (
      await this.request<{ network: string; name: string; type: string }[]>(
        'GET',
        '/api/vcenter/network',
      )
    ).map((n) => ({ id: n.network, name: n.name, type: n.type }));
  }
  private path(id: string) {
    return '/api/vcenter/vm/' + encodeURIComponent(id);
  }
  async startVM(id: string) {
    await this.request('POST', this.path(id) + '/power?action=start');
  }
  async stopVM(id: string) {
    await this.request('POST', this.path(id) + '/guest/power?action=shutdown');
  }
  async restartVM(id: string) {
    await this.request('POST', this.path(id) + '/guest/power?action=reboot');
  }
  async deleteVM(id: string) {
    await this.request('DELETE', this.path(id));
  }
  async snapshotVM(_id: string, _name: string): Promise<void> {
    unsupported('vSphere SOAP snapshot');
  }
  async migrateVM(_id: string, _target: string): Promise<void> {
    unsupported('vSphere SOAP migration');
  }
  async getMetrics(_id: string): Promise<VMMetrics> {
    return unsupported('vSphere performance manager');
  }
  async getConsoleURL(_id: string): Promise<ConsoleConfig> {
    return unsupported('vSphere WebMKS console');
  }
}
