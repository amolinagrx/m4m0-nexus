import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, passwordEncrypt, passwordDecrypt } from '../src/utils/encrypt.js';
import { allowed } from '../src/api/middleware/rbac.js';
import { quantity } from '../src/connectors/KubernetesConnector.js';
test('AES-GCM uses unique nonces and rejects modified data', () => {
  const key = randomBytes(32).toString('hex'),
    a = encrypt('provider-password', key),
    b = encrypt('provider-password', key);
  assert.notEqual(a, b);
  assert.equal(decrypt(a, key), 'provider-password');
  const parts = a.split('.');
  parts[3] = Buffer.from('tampered').toString('base64');
  assert.throws(() => decrypt(parts.join('.'), key));
  assert.throws(() => decrypt(a, randomBytes(32).toString('hex')));
});
test('password backups reject wrong password and authenticate content', () => {
  const data = passwordEncrypt('configuration', 'a-very-long-backup-password');
  assert.equal(passwordDecrypt(data, 'a-very-long-backup-password'), 'configuration');
  assert.throws(() => passwordDecrypt(data, 'wrong-password'));
});
test('RBAC intersects API scopes and current user role', () => {
  assert.equal(allowed({ id: 'u', role: 'readonly' }, 'vms:write'), false);
  assert.equal(allowed({ id: 'u', role: 'user' }, 'infra:write'), false);
  assert.equal(allowed({ id: 'u', role: 'admin', scopes: ['vms:read'] }, 'vms:write'), false);
  assert.equal(allowed({ id: 'u', role: 'readonly', scopes: ['vms:write'] }, 'vms:write'), false);
  assert.equal(allowed({ id: 'u', role: 'admin', scopes: ['vms:read'] }, 'vms:read'), true);
  assert.equal(allowed({ id: 'u', role: 'user' }, 'vms:write'), true);
});
test('Kubernetes quantities preserve CPU nanocores and binary memory', () => {
  assert.equal(quantity('100m'), 0.1);
  assert.equal(quantity('250000000n'), 0.25);
  assert.equal(quantity('2Gi'), 2147483648);
  assert.equal(quantity('512Mi'), 536870912);
});
