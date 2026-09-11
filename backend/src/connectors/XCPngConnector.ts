import xmlrpc from 'xmlrpc';
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
import { AppError, unsupported } from '../utils/errors.js';
type RecordMap = Record<string, Record<string, unknown>>;
export class XCPngConnector implements BaseConnector {
  private client!: xmlrpc.Client;
  private session = '';
  async call<T>(method: string, ...args: unknown[]): Promise<T> {
    return new Promise((resolve, reject) =>
      this.client.methodCall(
        method,
        [this.session, ...args],
        (error: unknown, result: { Status: string; Value: T; ErrorDescription?: string[] }) => {
          if (error) return reject(new AppError(502, 'XAPI transport failed'));
          if (result.Status !== 'Success')
            return reject(
              new AppError(502, `XAPI: ${result.ErrorDescription?.[0] ?? 'request failed'}`),
            );
          resolve(result.Value);
        },
      ),
    );
  }
  async connect(c: ConnectionConfig) {
    const u = new URL(c.endpoint);
    if (u.protocol !== 'https:') throw new AppError(400, 'HTTPS endpoint required');
    this.client = xmlrpc.createSecureClient({
      host: u.hostname,
      port: Number(u.port) || 443,
      path: u.pathname || '/',
      rejectUnauthorized: true,
      ca: c.caCert,
    } as Parameters<typeof xmlrpc.createSecureClient>[0]);
    this.session = await new Promise<string>((resolve, reject) =>
      this.client.methodCall(
        'session.login_with_password',
        [c.username, c.password, '1.0', 'm4m0 NEXUS'],
        (error: unknown, r: { Status: string; Value: string }) => {
          if (error || r.Status !== 'Success')
            reject(new AppError(502, 'XAPI authentication failed'));
          else resolve(r.Value);
        },
      ),
    );
  }
  async disconnect() {
    if (this.session) await this.call('session.logout');
  }
  async getVMs(): Promise<VM[]> {
    const r = await this.call<RecordMap>('VM.get_all_records');
    return Object.entries(r)
      .filter(([, v]) => !v.is_a_template && !v.is_control_domain)
      .map(([id, v]) => ({
        id,
        name: String(v.name_label),
        state: String(v.power_state).toLowerCase(),
        host: String(v.resident_on),
        cpus: Number(v.VCPUs_max),
        memoryMB: Number(v.memory_static_max) / 1048576,
      }));
  }
  async getHosts(): Promise<Host[]> {
    return Object.entries(await this.call<RecordMap>('host.get_all_records')).map(([id, h]) => ({
      id,
      name: String(h.name_label),
      state: h.enabled ? 'online' : 'offline',
      cpus: 0,
      memoryMB: 0,
    }));
  }
  async getStorage(): Promise<Storage[]> {
    return Object.entries(await this.call<RecordMap>('SR.get_all_records')).map(([id, s]) => ({
      id,
      name: String(s.name_label),
      type: String(s.type),
      capacityBytes: Number(s.physical_size),
      usedBytes: Number(s.physical_utilisation),
    }));
  }
  async getNetworks(): Promise<Network[]> {
    return Object.entries(await this.call<RecordMap>('network.get_all_records')).map(([id, n]) => ({
      id,
      name: String(n.name_label),
      type: 'xapi',
    }));
  }
  async startVM(id: string) {
    await this.call('VM.start', id, false, false);
  }
  async stopVM(id: string) {
    await this.call('VM.clean_shutdown', id);
  }
  async restartVM(id: string) {
    await this.call('VM.clean_reboot', id);
  }
  async snapshotVM(id: string, name: string) {
    await this.call('VM.snapshot', id, name);
  }
  async migrateVM(id: string, target: string) {
    await this.call('VM.pool_migrate', id, target, { live: 'true' });
  }
  async deleteVM(id: string) {
    await this.call('VM.destroy', id);
  }
  async getMetrics(_id: string): Promise<VMMetrics> {
    return unsupported('XAPI RRD metrics');
  }
  async getConsoleURL(_id: string): Promise<ConsoleConfig> {
    return unsupported('XAPI console CONNECT tunnel');
  }
}
