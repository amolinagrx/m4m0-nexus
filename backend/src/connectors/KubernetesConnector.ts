import * as k8s from '@kubernetes/client-node';
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
export class KubernetesConnector implements BaseConnector {
  readonly kube = new k8s.KubeConfig();
  core!: k8s.CoreV1Api;
  apps!: k8s.AppsV1Api;
  network!: k8s.NetworkingV1Api;
  async connect(c: ConnectionConfig) {
    if (c.kubeconfig) {
      const imported = new k8s.KubeConfig();
      imported.loadFromString(c.kubeconfig);
      const user = imported.getCurrentUser(),
        cluster = imported.getCurrentCluster();
      if (
        !user ||
        !cluster ||
        user.exec ||
        user.authProvider ||
        user.certFile ||
        user.keyFile ||
        cluster.caFile ||
        cluster.skipTLSVerify
      )
        throw new AppError(
          400,
          'Kubeconfig must use inline token/certificates with verified TLS; exec, auth-provider and local paths are prohibited',
        );
      if (cluster.server.replace(/\/$/, '') !== c.endpoint.replace(/\/$/, ''))
        throw new AppError(400, 'Kubeconfig server must match the infrastructure endpoint');
      c = {
        ...c,
        token: user.token,
        caCert: cluster.caData ? Buffer.from(cluster.caData, 'base64').toString() : undefined,
        clientCert: user.certData ? Buffer.from(user.certData, 'base64').toString() : undefined,
        clientKey: user.keyData ? Buffer.from(user.keyData, 'base64').toString() : undefined,
      };
    }
    if (new URL(c.endpoint).protocol !== 'https:')
      throw new AppError(400, 'HTTPS endpoint required');
    if (!c.token && !(c.clientCert && c.clientKey))
      throw new AppError(400, 'Kubernetes requires token or client certificate');
    this.kube.loadFromOptions({
      clusters: [
        {
          name: 'nexus',
          server: c.endpoint,
          skipTLSVerify: false,
          caData: c.caCert ? Buffer.from(c.caCert).toString('base64') : undefined,
        },
      ],
      users: [
        {
          name: 'nexus',
          token: c.token,
          certData: c.clientCert ? Buffer.from(c.clientCert).toString('base64') : undefined,
          keyData: c.clientKey ? Buffer.from(c.clientKey).toString('base64') : undefined,
        },
      ],
      contexts: [{ name: 'nexus', cluster: 'nexus', user: 'nexus' }],
      currentContext: 'nexus',
    });
    this.core = this.kube.makeApiClient(k8s.CoreV1Api);
    this.apps = this.kube.makeApiClient(k8s.AppsV1Api);
    this.network = this.kube.makeApiClient(k8s.NetworkingV1Api);
    await this.core.listNamespace();
  }
  async disconnect() {}
  async namespaces() {
    return (await this.core.listNamespace()).items;
  }
  async pods(namespace: string) {
    return (await this.core.listNamespacedPod({ namespace })).items;
  }
  async deployments(namespace: string) {
    return (await this.apps.listNamespacedDeployment({ namespace })).items;
  }
  async services(namespace: string) {
    return (await this.core.listNamespacedService({ namespace })).items;
  }
  async ingress(namespace: string) {
    return (await this.network.listNamespacedIngress({ namespace })).items;
  }
  async pvcs(namespace: string) {
    return (await this.core.listNamespacedPersistentVolumeClaim({ namespace })).items;
  }
  async configmaps(namespace: string) {
    return (await this.core.listNamespacedConfigMap({ namespace })).items;
  }
  async secrets(namespace: string) {
    return (await this.core.listNamespacedSecret({ namespace })).items.map((s) => ({
      metadata: s.metadata,
      type: s.type,
      keys: Object.keys(s.data ?? {}),
    }));
  }
  async scale(namespace: string, name: string, replicas: number) {
    const scale = await this.apps.readNamespacedDeploymentScale({ namespace, name });
    scale.spec = { replicas };
    return this.apps.replaceNamespacedDeploymentScale({ namespace, name, body: scale });
  }
  async restartDeployment(namespace: string, name: string) {
    const d = await this.apps.readNamespacedDeployment({ namespace, name });
    if (!d.spec) throw new AppError(400, 'Missing deployment spec');
    d.spec.template.metadata ??= {};
    d.spec.template.metadata.annotations = {
      ...d.spec.template.metadata.annotations,
      'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
    };
    return this.apps.replaceNamespacedDeployment({ namespace, name, body: d });
  }
  async logs(namespace: string, name: string, container?: string) {
    return this.core.readNamespacedPodLog({
      namespace,
      name,
      container,
      tailLines: 500,
      timestamps: true,
    });
  }
  async getVMs(): Promise<VM[]> {
    return (await this.core.listPodForAllNamespaces()).items.map((p) => ({
      id: `${p.metadata?.namespace}/${p.metadata?.name}`,
      name: p.metadata?.name ?? '',
      state: p.status?.phase?.toLowerCase() ?? 'unknown',
      host: p.spec?.nodeName ?? '',
      cpus: 0,
      memoryMB: 0,
      kind: 'pod',
    }));
  }
  async getHosts(): Promise<Host[]> {
    return (await this.core.listNode()).items.map((n) => ({
      id: n.metadata?.name ?? '',
      name: n.metadata?.name ?? '',
      state: n.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True')
        ? 'online'
        : 'offline',
      cpus: Number(n.status?.capacity?.cpu ?? 0),
      memoryMB: quantity(n.status?.capacity?.memory ?? '0') / 1048576,
    }));
  }
  async getStorage(): Promise<Storage[]> {
    return (await this.core.listPersistentVolume()).items.map((v) => ({
      id: v.metadata?.name ?? '',
      name: v.metadata?.name ?? '',
      type: v.spec?.storageClassName ?? 'persistent-volume',
      capacityBytes: quantity(v.spec?.capacity?.storage ?? '0'),
      usedBytes: 0,
    }));
  }
  async getNetworks(): Promise<Network[]> {
    return (await this.core.listServiceForAllNamespaces()).items.map((s) => ({
      id: `${s.metadata?.namespace}/${s.metadata?.name}`,
      name: s.metadata?.name ?? '',
      type: s.spec?.type ?? 'ClusterIP',
    }));
  }
  async startVM(_id: string): Promise<void> {
    unsupported('Pod start; use deployment scale');
  }
  async stopVM(_id: string): Promise<void> {
    unsupported('Pod stop; use deployment scale');
  }
  async restartVM(_id: string): Promise<void> {
    unsupported('Pod restart; use deployment rollout');
  }
  async snapshotVM(_id: string, _name: string): Promise<void> {
    unsupported('Kubernetes VolumeSnapshot requires CSI integration');
  }
  async migrateVM(_id: string, _target: string): Promise<void> {
    unsupported('Pod migration');
  }
  async deleteVM(id: string) {
    const [namespace, name] = id.split('/');
    if (!namespace || !name) throw new AppError(400, 'Invalid pod ID');
    await this.core.deleteNamespacedPod({ namespace, name });
  }
  async getMetrics(id: string): Promise<VMMetrics> {
    const [namespace, name] = id.split('/');
    const r = (await this.kube.makeApiClient(k8s.CustomObjectsApi).getNamespacedCustomObject({
      group: 'metrics.k8s.io',
      version: 'v1beta1',
      namespace: namespace!,
      plural: 'pods',
      name: name!,
    })) as { containers: { usage: { cpu: string; memory: string } }[] };
    return {
      cpu: r.containers.reduce((s, c) => s + quantity(c.usage.cpu), 0),
      memoryBytes: r.containers.reduce((s, c) => s + quantity(c.usage.memory), 0),
      networkInBytes: 0,
      networkOutBytes: 0,
      timestamp: new Date().toISOString(),
    };
  }
  async getConsoleURL(_id: string): Promise<ConsoleConfig> {
    return unsupported('VNC on Kubernetes; use exec');
  }
}
export function quantity(input: string): number {
  const m = /^([0-9.]+)([a-zA-Z]*)$/.exec(input);
  if (!m) return 0;
  const units: Record<string, number> = {
    n: 1e-9,
    u: 1e-6,
    m: 1e-3,
    Ki: 1024,
    Mi: 1048576,
    Gi: 1073741824,
    Ti: 1099511627776,
    k: 1000,
    M: 1e6,
    G: 1e9,
  };
  return Number(m[1]) * (units[m[2] ?? ''] ?? 1);
}
