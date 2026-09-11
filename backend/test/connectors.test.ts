import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProxmoxConnector } from '../src/connectors/ProxmoxConnector.js';
import { KubernetesConnector } from '../src/connectors/KubernetesConnector.js';
class MockProxmox extends ProxmoxConnector {
  calls: { method: string; path: string; body?: Record<string, string | number | boolean> }[] = [];
  taskExit = 'OK';
  override async request<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, string | number | boolean>,
  ): Promise<T> {
    this.calls.push({ method, path, body });
    if (path === '/cluster/resources')
      return [
        {
          id: 'qemu/101',
          vmid: 101,
          node: 'pve-1',
          type: 'qemu',
          name: 'web',
          status: 'running',
          maxcpu: 4,
          maxmem: 8589934592,
        },
        {
          id: 'lxc/102',
          vmid: 102,
          node: 'pve-1',
          type: 'lxc',
          name: 'cache',
          status: 'stopped',
          maxcpu: 2,
          maxmem: 1073741824,
        },
        {
          id: 'node/pve-1',
          node: 'pve-1',
          type: 'node',
          status: 'online',
          maxcpu: 32,
          maxmem: 137438953472,
        },
        { id: 'storage/pve-1/local', node: 'pve-1', type: 'storage', maxdisk: 1000, disk: 400 },
      ] as T;
    if (path.includes('/tasks/')) return { status: 'stopped', exitstatus: this.taskExit } as T;
    return 'UPID:pve-1:test' as T;
  }
}
test('Proxmox normalizes QEMU and LXC inventory without treating nodes as VMs', async () => {
  const c = new MockProxmox(),
    vms = await c.getVMs();
  assert.equal(vms.length, 2);
  assert.equal(vms[0]?.id, 'pve-1/qemu/101');
  assert.equal(vms[0]?.memoryMB, 8192);
  assert.equal(vms[1]?.kind, 'lxc');
  const hosts = await c.getHosts();
  assert.equal(hosts[0]?.cpus, 32);
  const storage = await c.getStorage();
  assert.equal(storage[0]?.usedBytes, 400);
});
test('Proxmox waits for task success and uses graceful shutdown', async () => {
  const c = new MockProxmox();
  await c.stopVM('pve-1/qemu/101');
  assert.equal(c.calls[0]?.path, '/nodes/pve-1/qemu/101/status/shutdown');
  assert.ok(c.calls.some((x) => x.path.includes('/tasks/UPID%3A')));
  c.taskExit = 'ERROR';
  await assert.rejects(() => c.startVM('pve-1/qemu/101'), /task failed/);
});
test('Proxmox rejects path traversal before dispatch', async () => {
  const c = new MockProxmox();
  await assert.rejects(() => c.startVM('../qemu/101'), /Invalid/);
  assert.equal(c.calls.length, 0);
});
test('kubeconfig cannot execute credential plugins on the server', async () => {
  const c = new KubernetesConnector();
  await assert.rejects(
    () =>
      c.connect({
        endpoint: 'https://cluster.example.com',
        kubeconfig: JSON.stringify({
          apiVersion: 'v1',
          kind: 'Config',
          clusters: [{ name: 'test', cluster: { server: 'https://cluster.example.com' } }],
          users: [
            {
              name: 'test',
              user: {
                exec: {
                  apiVersion: 'client.authentication.k8s.io/v1',
                  command: '/bin/sh',
                  args: ['-c', 'exit 1'],
                },
              },
            },
          ],
          contexts: [{ name: 'test', context: { cluster: 'test', user: 'test' } }],
          'current-context': 'test',
        }),
      }),
    /exec, auth-provider and local paths are prohibited/,
  );
});
