import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
const enabled = process.env.NEXUS_INTEGRATION === '1';
test(
  'API integration: auth, RBAC, revocation, maintenance, backup rollback and audit',
  { skip: !enabled },
  async (t) => {
    const { buildApp } = await import('../src/app.js');
    const { db } = await import('../src/config/database.js');
    const { redis } = await import('../src/config/redis.js');
    const { env } = await import('../src/config/env.js');
    const { BackupService } = await import('../src/services/BackupService.js');
    const { WebhookService } = await import('../src/services/WebhookService.js');
    const { default: argon2 } = await import('argon2');
    assert.ok(
      new URL(env.DATABASE_URL).pathname.endsWith('_test'),
      'Use a dedicated database ending in _test',
    );
    const app = await buildApp();
    await app.ready();
    const id = randomUUID(),
      email = `admin-${id}@example.com`,
      password = 'secure-integration-password';
    await db.query("INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,'admin')", [
      id,
      email,
      await argon2.hash(password),
    ]);
    const access = app.jwt.sign({ sub: id }, { expiresIn: '15m' });
    const headers = { authorization: 'Bearer ' + access };
    try {
      await t.test('readiness checks real PostgreSQL and Redis', async () => {
        assert.equal((await app.inject('/health/ready')).statusCode, 200);
      });
      await t.test('anonymous inventory access denied', async () => {
        assert.equal((await app.inject('/api/v1/vms')).statusCode, 401);
      });
      await t.test('local login and refresh reuse revokes entire family', async () => {
        const bad = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { username: email, password: 'wrong' },
        });
        assert.equal(bad.statusCode, 401);
        const login = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { username: email, password },
        });
        assert.equal(login.statusCode, 200, login.body);
        const cookie = String(login.headers['set-cookie']);
        assert.match(cookie, /HttpOnly/);
        const first = cookie.split(';')[0]!;
        const rotate = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/refresh',
          headers: { cookie: first, origin: env.CORS_ORIGIN },
        });
        assert.equal(rotate.statusCode, 200, rotate.body);
        const second = String(rotate.headers['set-cookie']).split(';')[0]!;
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/v1/auth/refresh',
              headers: { cookie: first, origin: env.CORS_ORIGIN },
            })
          ).statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/v1/auth/refresh',
              headers: { cookie: second, origin: env.CORS_ORIGIN },
            })
          ).statusCode,
          401,
        );
      });
      await t.test('scoped API token is restricted and revocation is immediate', async () => {
        const create = await app.inject({
          method: 'POST',
          url: '/api/v1/tokens',
          headers,
          payload: { name: 'CI read', scopes: ['vms:read'] },
        });
        assert.equal(create.statusCode, 201, create.body);
        const b = create.json();
        assert.ok(b.token);
        const scoped = { authorization: 'Bearer ' + b.token };
        assert.equal((await app.inject({ url: '/api/v1/vms', headers: scoped })).statusCode, 200);
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/v1/vms/' + randomUUID() + '/start',
              headers: scoped,
              payload: {},
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (await app.inject({ method: 'DELETE', url: '/api/v1/tokens/' + b.id, headers }))
            .statusCode,
          200,
        );
        assert.equal((await app.inject({ url: '/api/v1/vms', headers: scoped })).statusCode, 401);
      });
      await t.test('current database role overrides old JWT authorization', async () => {
        const user = randomUUID();
        await db.query("INSERT INTO users(id,email,role) VALUES($1,$2,'readonly')", [
          user,
          user + '@example.com',
        ]);
        const token = app.jwt.sign({ sub: user, role: 'admin' });
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/v1/infrastructure',
              headers: { authorization: 'Bearer ' + token },
              payload: {},
            })
          ).statusCode,
          403,
        );
        await db.query('DELETE FROM users WHERE id=$1', [user]);
      });
      await t.test('credentials are encrypted and omitted from inventory', async () => {
        const r = await app.inject({
          method: 'POST',
          url: '/api/v1/infrastructure',
          headers,
          payload: {
            name: 'test-' + id,
            type: 'proxmox',
            endpoint: 'https://pve.example.com:8006',
            credentials: { tokenId: 'test@pve!ci', token: 'sensitive-provider-token' },
          },
        });
        assert.equal(r.statusCode, 201, r.body);
        assert.ok(!r.body.includes('sensitive-provider-token'));
        const record = (
          await db.query('SELECT credentials_encrypted FROM infrastructures WHERE id=$1', [
            r.json().id,
          ])
        ).rows[0];
        assert.ok(record.credentials_encrypted.startsWith('v1.'));
        assert.ok(!record.credentials_encrypted.includes('sensitive-provider-token'));
      });
      await t.test('webhook origin allowlist rejects arbitrary destinations', async () => {
        const r = await app.inject({
          method: 'POST',
          url: '/api/v1/webhooks',
          headers,
          payload: {
            name: 'Rejected',
            url: 'https://169.254.169.254/metadata',
            events: ['vm.started'],
          },
        });
        assert.equal(r.statusCode, 400, r.body);
      });
      await t.test('maintenance blocks writes and allows reads and admin disable', async () => {
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/v1/maintenance/enable',
              headers,
              payload: { message: 'Integration test' },
            })
          ).statusCode,
          200,
        );
        assert.equal((await app.inject({ url: '/api/v1/vms', headers })).statusCode, 200);
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/v1/tokens',
              headers,
              payload: { name: 'blocked', scopes: ['vms:read'] },
            })
          ).statusCode,
          503,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/api/v1/maintenance/disable',
              headers,
              payload: {},
            })
          ).statusCode,
          200,
        );
      });
      await t.test('encrypted backup roundtrip and failed import rollback', async () => {
        const service = new BackupService();
        const conf = {
          includeInfrastructures: true,
          includeUsers: true,
          includeWebhooks: false,
          includeTokens: false,
          includeAuditLogs: false,
          format: 'json' as const,
          encrypt: true,
          encryptionPassword: 'long-backup-password',
        };
        const bytes = await service.export(conf);
        assert.ok(!bytes.toString().includes(email));
        await assert.rejects(() => service.import(bytes, 'bad-password'));
        const imported = await service.import(bytes, conf.encryptionPassword);
        assert.equal(imported.restored, 0);
        const plain = await service.export({ ...conf, encrypt: false });
        const wrapper = JSON.parse(plain.toString()),
          payload = JSON.parse(wrapper.payload);
        const existing = payload.data.users.find((u: { id: string }) => u.id === id);
        const uniqueEmail = randomUUID() + '@example.com';
        payload.data.users = [
          { ...existing, id: randomUUID(), email: uniqueEmail },
          { ...existing, id: randomUUID() },
        ];
        const changed = JSON.stringify(payload);
        const invalid = Buffer.from(
          JSON.stringify({
            payload: changed,
            sha256: createHash('sha256').update(changed).digest('hex'),
          }),
        );
        await assert.rejects(() => service.import(invalid));
        assert.equal(
          (await db.query('SELECT 1 FROM users WHERE email=$1', [uniqueEmail])).rowCount,
          0,
        );
      });
      await t.test('audit table cannot be edited or truncated by app role', async () => {
        await assert.rejects(() => db.query("UPDATE audit_logs SET action='tampered'"));
        await assert.rejects(() => db.query('TRUNCATE audit_logs'));
      });
      await t.test(
        'reviewed local plugin loads, applies policy, and records hook results',
        async () => {
          const { PluginManager } = await import('../src/api/plugins/PluginManager.js');
          const manager = new PluginManager();
          await db.query("DELETE FROM plugins WHERE id='example-plugin'");
          await manager.install('example-plugin');
          await db.query("UPDATE plugins SET active=true,config=$1 WHERE id='example-plugin'", [
            JSON.stringify({ blockedVMs: ['blocked'] }),
          ]);
          try {
            await manager.emit('vm.beforeStart', { vmId: 'allowed' });
            await assert.rejects(
              () => manager.emit('vm.beforeStart', { vmId: 'blocked' }),
              /Plugin hook failed/,
            );
            const logs = await db.query(
              "SELECT action FROM audit_logs WHERE resource='plugin:example-plugin'",
            );
            assert.ok(logs.rows.some((r) => r.action === 'plugin.hook.completed'));
            assert.ok(logs.rows.some((r) => r.action === 'plugin.hook.failed'));
          } finally {
            await db.query("DELETE FROM plugins WHERE id='example-plugin'");
          }
        },
      );
      await t.test('console rejects tickets before attempting a provider connection', async () => {
        assert.equal(
          (
            await app.inject({
              url: '/api/v1/vms/' + randomUUID() + '/console',
              headers: { origin: env.CORS_ORIGIN },
            })
          ).statusCode,
          401,
        );
      });
    } finally {
      await db.query(
        'UPDATE maintenance_config SET active=false,scheduled_start=NULL,scheduled_end=NULL',
      );
      await app.close();
      await new BackupService().queue.close();
      await new WebhookService().queue.close();
      await redis.quit();
      await db.end();
    }
  },
);
