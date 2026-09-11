import type {
  ConnectionConfig,
  VM,
  Host,
  Storage,
  Network,
  VMMetrics,
  ConsoleConfig,
} from '../models/types.js';
export interface BaseConnector {
  connect(config: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  getVMs(): Promise<VM[]>;
  getHosts(): Promise<Host[]>;
  getStorage(): Promise<Storage[]>;
  getNetworks(): Promise<Network[]>;
  startVM(id: string): Promise<void>;
  stopVM(id: string): Promise<void>;
  restartVM(id: string): Promise<void>;
  snapshotVM(id: string, name: string): Promise<void>;
  migrateVM(id: string, targetHost: string): Promise<void>;
  deleteVM(id: string): Promise<void>;
  getMetrics(id: string): Promise<VMMetrics>;
  getConsoleURL(id: string): Promise<ConsoleConfig>;
}
