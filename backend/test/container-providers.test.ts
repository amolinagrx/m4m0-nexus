import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DockerConnector,
  decodeDockerLogs,
  containerCreateSchema,
} from '../src/connectors/DockerConnector.js';
import { ZerobyteConnector, zerobyteJobSchema } from '../src/connectors/ZerobyteConnector.js';
import { managedEndpoint, remoteId } from '../src/connectors/ManagedEndpoint.js';
import { allowed } from '../src/api/middleware/rbac.js';

test('managed endpoints reject credential forwarding, traversal and plain HTTP', () => {
  for (const endpoint of [
    'http://localhost:2375',
    'https://user:secret@host',
    'https://host/api',
    'https://host/?token=x',
    'https://host/#x',
  ])
    assert.equal(managedEndpoint.safeParse(endpoint).success, false);
  for (const id of ['..', '../name', 'foo/bar', 'foo?bar', '%2e%2e'])
    assert.equal(remoteId.safeParse(id).success, false);
  for (const target of ['/../data', '/data/../other', 'relative']) {
    assert.equal(
      containerCreateSchema.safeParse({
        name: 'test',
        image: 'nginx',
        volumes: [{ name: 'data', target }],
      }).success,
      false,
    );
  }
  assert.equal(
    containerCreateSchema.safeParse({ name: 'bad', image: 'nginx', privileged: true }).success,
    false,
  );
  assert.equal(
    zerobyteJobSchema.safeParse({
      name: 'bad',
      volumeId: 'source',
      repositoryId: 'repo',
      cronExpression: 'invalid',
    }).success,
    false,
  );
});
test('Docker logs decode framed streams, preserve TTY text and reject corrupt frames', () => {
  const frame = (s: string, stream: number) => {
    const text = Buffer.from(s);
    const h = Buffer.alloc(8);
    h[0] = stream;
    h.writeUInt32BE(text.length, 4);
    return Buffer.concat([h, text]);
  };
  const raw = Buffer.concat([frame('stdout\n', 1), frame('stderr\n', 2)]);
  assert.equal(decodeDockerLogs(raw, false), 'stdout\nstderr\n');
  assert.equal(decodeDockerLogs(Buffer.from('terminal'), true), 'terminal');
  assert.throws(() => decodeDockerLogs(raw.subarray(0, -1), false), /Truncated/);
});
test('Docker write/log scopes and backup scopes remain administrator-only', () => {
  for (const role of ['user', 'readonly'] as const)
    for (const scope of ['docker:write', 'docker:logs', 'backups:read', 'backups:write'])
      assert.equal(allowed({ id: 'u', role }, scope), false);
  assert.equal(allowed({ id: 'u', role: 'readonly' }, 'docker:read'), true);
  assert.equal(allowed({ id: 'u', role: 'admin', scopes: ['docker:read'] }, 'docker:write'), false);
});
test('Docker mTLS and Zerobyte v0.42 contract, async status, redaction and error handling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-contract-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  const cert = await readFile(join(directory, 'cert.pem'), 'utf8'),
    key = await readFile(join(directory, 'key.pem'), 'utf8');
  const calls: { method: string; path: string; body: unknown }[] = [];
  let mode = 'normal';
  const job = {
    id: 1,
    shortId: 'job1',
    name: 'Docker data',
    volumeId: 1,
    repositoryId: 'repo-id',
    enabled: true,
    cronExpression: '0 2 * * *',
    retentionPolicy: { keepLast: 7, keepDaily: 30 },
    maxRetries: 5,
    retryDelay: 20,
    includePaths: [],
    excludePatterns: [],
    lastBackupAt: null,
    lastBackupStatus: null,
    nextBackupAt: null,
    credentials: 'MUST-NOT-LEAK',
  };
  const server = createServer(
    { cert, key, ca: cert, requestCert: true, rejectUnauthorized: false },
    async (req, res) => {
      let raw = '';
      for await (const b of req) raw += b.toString();
      calls.push({ method: req.method!, path: req.url!, body: raw ? JSON.parse(raw) : undefined });
      const send = (data: unknown, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.url?.startsWith('/api/v1')) {
        if (req.headers['x-api-key'] !== 'fixture-api-key-12345')
          return send({ password: 'MUST-NOT-LEAK' }, 401);
        if (mode === 'redirect') {
          res.writeHead(302, { location: 'https://localhost/steal' });
          return res.end();
        }
        if (req.url === '/api/v1/backups/job1/run')
          return send({ taskId: 'task1', status: 'started' }, 202);
        if (req.url === '/api/v1/backups')
          return send(req.method === 'POST' ? job : [job], req.method === 'POST' ? 201 : 200);
        if (req.url === '/api/v1/backups/job1') return send(job);
        if (req.url === '/api/v1/volumes')
          return send([
            { id: 1, shortId: 'vol1', name: 'Docker volume', password: 'MUST-NOT-LEAK' },
          ]);
        if (req.url === '/api/v1/repositories')
          return send([
            {
              id: 'repo-id',
              shortId: 'repo1',
              name: 'Local',
              config: { password: 'MUST-NOT-LEAK' },
            },
          ]);
        if (req.url === '/api/v1/tasks/history?page=1')
          return send({
            items: [
              {
                id: 'task1',
                kind: 'backup',
                status: 'success',
                startedAt: 1000,
                finishedAt: 2000,
                message: 'MUST-NOT-LEAK',
              },
            ],
          });
        if (req.url === '/api/v1/repositories/repo1/snapshots')
          return send([
            { short_id: 'abcd1234', time: 2000, size: 42, paths: ['/source'], tags: [] },
          ]);
        return send({}, 404);
      }
      if (!req.socket || !(req.socket as import('node:tls').TLSSocket).authorized)
        return send({}, 403);
      if (req.url === '/version')
        return send({ Version: '29.0', ApiVersion: '1.54', MinAPIVersion: '1.44' });
      if (req.url === '/v1.47/containers/json?all=true')
        return send([
          {
            Id: 'container1',
            Names: ['/web'],
            Image: 'nginx',
            State: 'running',
            Status: 'Up',
            Labels: { 'com.docker.compose.project': 'demo', password: 'MUST-NOT-LEAK' },
            Mounts: null,
            Ports: null,
          },
        ]);
      if (req.url === '/v1.47/images/json')
        return send([{ Id: 'image1', RepoTags: ['nginx'], Size: 100, Created: 1 }]);
      if (req.url === '/v1.47/volumes')
        return send({
          Volumes: [{ Name: 'data', Driver: 'local', Options: { password: 'MUST-NOT-LEAK' } }],
        });
      if (req.url === '/v1.47/networks')
        return send([
          {
            Id: 'network1',
            Name: 'bridge',
            Driver: 'bridge',
            Scope: 'local',
            Options: { password: 'MUST-NOT-LEAK' },
          },
        ]);
      if (req.url === '/v1.47/containers/container1/json')
        return send({ State: { Running: true }, Config: { Tty: false } });
      if (req.url === '/v1.47/containers/container1/stop?t=30') {
        res.writeHead(204);
        return res.end();
      }
      return send({ password: 'MUST-NOT-LEAK' }, 404);
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `https://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const docker = new DockerConnector(endpoint, { caCert: cert, clientCert: cert, clientKey: key });
  const zerobyte = new ZerobyteConnector(endpoint, {
    caCert: cert,
    apiKey: 'fixture-api-key-12345',
  });
  const invalid = new ZerobyteConnector(endpoint, { caCert: cert, apiKey: 'wrong-key' });
  try {
    await docker.connect();
    const inventory = await docker.inventory();
    assert.equal(inventory.containers[0]?.project, 'demo');
    assert.ok(!JSON.stringify(inventory).includes('MUST-NOT-LEAK'));
    await docker.action('container1', 'stop');
    await assert.rejects(() => docker.action('container1', 'remove'), /Stop the container/);
    assert.equal(
      calls.some((c) => c.method === 'DELETE'),
      false,
    );
    const before = calls.length;
    await assert.rejects(() => docker.action('../other', 'start'));
    assert.equal(calls.length, before);
    assert.equal((await zerobyte.run('job1')).status, 'started');
    const jobBody = zerobyteJobSchema.parse({
      name: 'Docker data',
      volumeId: 'vol1',
      repositoryId: 'repo-id',
      cronExpression: '0 2 * * *',
    });
    await zerobyte.createJob(jobBody);
    await zerobyte.updateJob('job1', jobBody);
    const update = calls.find((c) => c.method === 'PATCH');
    assert.ok(update);
    assert.ok(!('volumeId' in (update.body as object)));
    assert.equal((update.body as { maxRetries: number }).maxRetries, 5);
    assert.equal(
      (update.body as { retentionPolicy: { keepDaily: number } }).retentionPolicy.keepDaily,
      30,
    );
    for (const result of [
      await zerobyte.jobs(),
      await zerobyte.resources(),
      await zerobyte.history(),
    ])
      assert.ok(!JSON.stringify(result).includes('MUST-NOT-LEAK'));
    assert.equal((await zerobyte.snapshots('repo1'))[0]?.time, 2000);
    await assert.rejects(() => invalid.jobs(), { message: 'Zerobyte returned HTTP 401' });
    mode = 'redirect';
    await assert.rejects(() => zerobyte.jobs(), /connection failed/);
  } finally {
    await Promise.all([docker.close(), zerobyte.close(), invalid.close()]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
