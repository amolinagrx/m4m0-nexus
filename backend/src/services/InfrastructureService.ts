import { PluginManager } from '../api/plugins/PluginManager.js';
import { db, transaction } from '../config/database.js';
import { env } from '../config/env.js';
import { decrypt } from '../utils/encrypt.js';
import { AppError } from '../utils/errors.js';
import type { Infrastructure, ConnectionConfig } from '../models/types.js';
import type { BaseConnector } from '../connectors/BaseConnector.js';
import { ProxmoxConnector } from '../connectors/ProxmoxConnector.js';
import { KubernetesConnector } from '../connectors/KubernetesConnector.js';
import { XCPngConnector } from '../connectors/XCPngConnector.js';
import { CitrixConnector } from '../connectors/CitrixConnector.js';
import { VMwareConnector } from '../connectors/VMwareConnector.js';
export class InfrastructureService {
  async withConnector<T>(
    id: string,
    fn: (connector: BaseConnector, infra: Infrastructure) => Promise<T>,
  ): Promise<T> {
    const r = await db.query<Infrastructure>('SELECT * FROM infrastructures WHERE id=$1', [id]);
    const infra = r.rows[0];
    if (!infra) throw new AppError(404, 'Infrastructure not found');
    const constructors = {
      proxmox: ProxmoxConnector,
      kubernetes: KubernetesConnector,
      xcpng: XCPngConnector,
      citrix: CitrixConnector,
      vmware: VMwareConnector,
    };
    const connector = new constructors[infra.type]();
    try {
      await connector.connect({
        ...(JSON.parse(
          decrypt(infra.credentials_encrypted, env.ENCRYPTION_KEY),
        ) as ConnectionConfig),
        endpoint: infra.endpoint,
      });
      return await fn(connector, infra);
    } finally {
      await connector.disconnect().catch(() => {});
    }
  }
  async sync(id: string) {
    try {
      return await this.withConnector(id, async (c) => {
        const vms = await c.getVMs();
        await transaction(async (tx) => {
          for (const vm of vms)
            await tx.query(
              'INSERT INTO vms(infrastructure_id,external_id,name,state,host,cpus,memory_mb,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(infrastructure_id,external_id) DO UPDATE SET name=$3,state=$4,host=$5,cpus=$6,memory_mb=$7,kind=$8,updated_at=now()',
              [id, vm.id, vm.name, vm.state, vm.host, vm.cpus, vm.memoryMB, vm.kind],
            );
          await tx.query(
            'DELETE FROM vms WHERE infrastructure_id=$1 AND NOT(external_id=ANY($2::text[]))',
            [id, vms.map((v) => v.id)],
          );
          await tx.query(
            "UPDATE infrastructures SET status='connected',last_sync=now() WHERE id=$1",
            [id],
          );
        });
        await new PluginManager()
          .emit('infrastructure.afterSync', { infrastructureId: id, vmCount: vms.length })
          .catch(() => {});
        return { synced: vms.length };
      });
    } catch (e) {
      await db.query("UPDATE infrastructures SET status='error' WHERE id=$1", [id]);
      throw e;
    }
  }
}
