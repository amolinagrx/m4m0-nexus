import { db } from '../config/database.js';
import { InfrastructureService } from './InfrastructureService.js';
import { WebhookService } from './WebhookService.js';
import { PluginManager } from '../api/plugins/PluginManager.js';
import { AppError } from '../utils/errors.js';
import { audit } from './AuditService.js';
import type { WebhookEvent } from '../models/types.js';
export class VMService {
  async find(id: string) {
    const r = await db.query('SELECT * FROM vms WHERE id=$1', [id]);
    if (!r.rows[0]) throw new AppError(404, 'VM not found');
    return r.rows[0];
  }
  async action(
    id: string,
    action: 'start' | 'stop' | 'restart' | 'snapshot' | 'migrate' | 'delete',
    actor: string,
    value?: string,
  ) {
    const vm = await this.find(id);
    const plugins = new PluginManager();
    if (action === 'start') await plugins.emit('vm.beforeStart', { vmId: id });
    await audit(actor, `vm.${action}.requested`, id);
    await new InfrastructureService().withConnector(vm.infrastructure_id, async (c) => {
      switch (action) {
        case 'start':
          return c.startVM(vm.external_id);
        case 'stop':
          return c.stopVM(vm.external_id);
        case 'restart':
          return c.restartVM(vm.external_id);
        case 'snapshot':
          return c.snapshotVM(vm.external_id, value!);
        case 'migrate':
          return c.migrateVM(vm.external_id, value!);
        case 'delete':
          return c.deleteVM(vm.external_id);
      }
    });
    if (action === 'delete') await db.query('DELETE FROM vms WHERE id=$1', [id]);
    else await new InfrastructureService().sync(vm.infrastructure_id);
    await audit(actor, `vm.${action}.completed`, id);
    const events: Partial<Record<typeof action, WebhookEvent>> = {
      start: 'vm.started',
      stop: 'vm.stopped',
      migrate: 'vm.migrated',
      delete: 'vm.deleted',
    };
    const event = events[action];
    if (event)
      await new WebhookService().emit(event, {
        vmId: id,
        vmName: vm.name,
        infrastructure: vm.infrastructure_id,
        host: vm.host,
        triggeredBy: actor,
      });
    if (action === 'stop') await plugins.emit('vm.afterStop', { vmId: id });
    return { ok: true };
  }
}
