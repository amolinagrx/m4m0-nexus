export type Role = 'admin' | 'user' | 'readonly';
export interface User {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  source: 'local' | 'ldap';
  password_hash?: string;
}
export type Hypervisor = 'proxmox' | 'kubernetes' | 'xcpng' | 'citrix' | 'vmware';
export interface Infrastructure {
  id: string;
  name: string;
  type: Hypervisor;
  endpoint: string;
  credentials_encrypted: string;
  status: string;
  last_sync: string | null;
}
export interface VM {
  id: string;
  name: string;
  state: string;
  host: string;
  cpus: number;
  memoryMB: number;
  infrastructureId?: string;
  kind?: string;
}
export interface Host {
  id: string;
  name: string;
  state: string;
  cpus: number;
  memoryMB: number;
}
export interface Storage {
  id: string;
  name: string;
  type: string;
  capacityBytes: number;
  usedBytes: number;
}
export interface Network {
  id: string;
  name: string;
  type: string;
}
export interface VMMetrics {
  cpu: number;
  memoryBytes: number;
  networkInBytes: number;
  networkOutBytes: number;
  timestamp: string;
}
export interface ConsoleConfig {
  type: 'vnc' | 'spice';
  host: string;
  port: number;
  password?: string;
  tls: boolean;
  url?: string;
  headers?: Record<string, string>;
  caCert?: string;
}
export interface ConnectionConfig {
  endpoint: string;
  username?: string;
  password?: string;
  token?: string;
  tokenId?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  kubeconfig?: string;
}
export const webhookEvents = [
  'vm.started',
  'vm.stopped',
  'vm.created',
  'vm.deleted',
  'vm.migrated',
  'infrastructure.connected',
  'infrastructure.disconnected',
  'user.login',
  'backup.completed',
  'backup.failed',
  'alert.triggered',
] as const;
export type WebhookEvent = (typeof webhookEvents)[number];
export interface Principal {
  id: string;
  role: Role;
  scopes?: string[];
  tokenId?: string;
}
