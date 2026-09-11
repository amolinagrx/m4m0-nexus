import { buildApp } from './app.js';
import { env } from './config/env.js';
import { db } from './config/database.js';
import { redis } from './config/redis.js';
import { WebhookService } from './services/WebhookService.js';
import { BackupService } from './services/BackupService.js';
import { LDAPService } from './services/LDAPService.js';
import { metricsSocket } from './api/websocket/metrics.js';
const app = await buildApp();
const closeMetrics = metricsSocket(app);
const webhooks = new WebhookService(),
  backups = new BackupService();
const workers = [webhooks.worker(), backups.worker()];
for (const w of workers) w.on('error', () => app.log.error('Background worker failed'));
await backups.reconcile();
let running = false;
const scheduler = setInterval(() => {
  if (running) return;
  running = true;
  void (async () => {
    const acquired = await redis.set('ldap-sync-lock', '1', 'EX', 300, 'NX');
    if (!acquired) return;
    try {
      const ldap = new LDAPService(),
        config = await ldap.config();
      const row = (await db.query('SELECT last_sync FROM ldap_config WHERE id=1')).rows[0];
      if (
        config?.active &&
        (!row?.last_sync ||
          Date.now() - new Date(row.last_sync).getTime() > config.syncInterval * 1000)
      )
        await ldap.syncUsers();
    } finally {
      await redis.del('ldap-sync-lock');
    }
  })()
    .catch(() => app.log.error('LDAP scheduler failed'))
    .finally(() => {
      running = false;
    });
}, 60000);
scheduler.unref();
await app.listen({
  host: env.HOST ?? (env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  port: env.PORT,
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void (async () => {
      clearInterval(scheduler);
      await closeMetrics();
      await app.close();
      await Promise.all(workers.map((w) => w.close()));
      await webhooks.queue.close();
      await backups.queue.close();
      await redis.quit();
      await db.end();
    })().catch(() => {
      process.exitCode = 1;
    });
  });
