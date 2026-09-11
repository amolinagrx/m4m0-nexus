export type Row = Record<string, unknown>;
export const demoInfrastructure: Row[] = [
  {
    id: 'pve',
    name: 'proxmox-mad-01',
    type: 'proxmox',
    endpoint: 'https://pve.madrid.example:8006',
    status: 'connected',
    last_sync: new Date().toISOString(),
  },
  {
    id: 'k8s',
    name: 'kubernetes-prod',
    type: 'kubernetes',
    endpoint: 'https://k8s.example:6443',
    status: 'connected',
    last_sync: new Date().toISOString(),
  },
  {
    id: 'xcp',
    name: 'xcpng-bcn-01',
    type: 'xcpng',
    endpoint: 'https://xcp.barcelona.example',
    status: 'connected',
    last_sync: new Date().toISOString(),
  },
  {
    id: 'vs',
    name: 'vsphere-lab',
    type: 'vmware',
    endpoint: 'https://vcenter.example',
    status: 'error',
    last_sync: null,
  },
];
export const demoVMs: Row[] = [
  ['web-prod-01', 'running', 'pve-node-01', 4, 8192, 'proxmox-mad-01', 'proxmox'],
  ['api-gateway-01', 'running', 'pve-node-02', 8, 16384, 'proxmox-mad-01', 'proxmox'],
  ['postgres-primary', 'running', 'xcp-host-01', 8, 32768, 'xcpng-bcn-01', 'xcpng'],
  ['redis-cache-01', 'running', 'pve-node-01', 2, 4096, 'proxmox-mad-01', 'proxmox'],
  ['worker-batch-02', 'stopped', 'xcp-host-02', 4, 8192, 'xcpng-bcn-01', 'xcpng'],
  ['monitoring-01', 'running', 'pve-node-03', 4, 8192, 'proxmox-mad-01', 'proxmox'],
].map((v, i) => ({
  id: 'demo-' + i,
  name: v[0],
  state: v[1],
  host: v[2],
  cpus: v[3],
  memory_mb: v[4],
  infrastructure_name: v[5],
  infrastructure_type: v[6],
  kind: 'qemu',
}));
export const demoData: Record<string, Row[]> = {
  '/infrastructure': demoInfrastructure,
  '/vms': demoVMs,
  '/kubernetes/clusters': demoInfrastructure.filter((i) => i.type === 'kubernetes'),
  '/webhooks': [
    {
      id: 'demo-hook',
      name: 'Operaciones · Slack',
      url: 'https://hooks.slack.com/services/example',
      events: ['vm.stopped', 'backup.failed'],
      active: true,
      method: 'POST',
    },
  ],
  '/tokens': [
    {
      id: 'demo-token',
      name: 'Terraform · producción',
      scopes: ['infra:read', 'vms:read'],
      last_used_at: new Date().toISOString(),
      expires_at: null,
    },
  ],
  '/backups/jobs': [
    {
      id: 'demo-backup',
      name: 'Configuración · copia diaria',
      type: 'full',
      schedule: '0 2 * * *',
      retention_days: 30,
      storage_type: 's3',
      active: true,
    },
  ],
  '/backups/history': [
    {
      id: 'demo-run',
      status: 'completed',
      started_at: new Date().toISOString(),
      backup_size_bytes: 245760,
      duration_seconds: 3,
    },
  ],
  '/plugins': [
    {
      id: 'example-plugin',
      name: 'Audit extension',
      description: 'Ejemplo de hooks para ampliar NEXUS',
      version: '1.0.0',
      active: false,
    },
  ],
  '/users': [
    { id: 'demo-user', email: 'admin@m4m0.es', role: 'admin', source: 'local', active: true },
  ],
  '/audit': [
    {
      id: 1,
      action: 'infrastructure.sync',
      resource: 'proxmox-mad-01',
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      action: 'backup.completed',
      resource: 'Configuración · copia diaria',
      created_at: new Date(Date.now() - 120000).toISOString(),
    },
  ],
};
