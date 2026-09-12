// Real, isolated Docker/Zerobyte smoke. Requires built backend, Docker and OpenSSL.
// Creates only uniquely named test containers/volume; removes them on completion.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:https';
import { request } from 'node:http';
import {
  DockerConnector,
  containerCreateSchema,
} from '../backend/dist/connectors/DockerConnector.js';
import {
  ZerobyteConnector,
  zerobyteJobSchema,
} from '../backend/dist/connectors/ZerobyteConnector.js';
const name = 'nexus-provider-smoke-' + randomBytes(5).toString('hex');
const dir = await mkdtemp(join(tmpdir(), name));
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const servers = [],
  clients = [];
let containerId;
try {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  const cert = await readFile(join(dir, 'cert.pem'), 'utf8'),
    key = await readFile(join(dir, 'key.pem'), 'utf8');
  async function bridge(target, mutual) {
    const server = createServer(
      { cert, key, ca: cert, requestCert: mutual, rejectUnauthorized: mutual },
      (req, res) => {
        const upstream = request(
          { ...target, method: req.method, path: req.url, headers: req.headers },
          (remote) => {
            res.writeHead(remote.statusCode, remote.headers);
            remote.pipe(res);
          },
        );
        upstream.on('error', () => {
          res.writeHead(502);
          res.end();
        });
        req.pipe(upstream);
      },
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return `https://127.0.0.1:${server.address().port}`;
  }
  const context = JSON.parse(docker('context', 'inspect'))[0];
  const host = process.env.DOCKER_HOST || context.Endpoints.docker.Host;
  assert.ok(host.startsWith('unix://'), 'Smoke requires a local Docker Unix socket');
  const dockerEndpoint = await bridge({ socketPath: host.slice(7) }, true);
  const engine = new DockerConnector(dockerEndpoint, {
    caCert: cert,
    clientCert: cert,
    clientKey: key,
  });
  clients.push(engine);
  await engine.connect();
  await engine.createVolume(name);
  docker(
    'run',
    '--rm',
    '-v',
    `${name}:/source`,
    'node:22-bookworm-slim',
    'node',
    '-e',
    "require('fs').writeFileSync('/source/proof.txt','nexus docker backup proof')",
  );
  const created = await engine.create(
    containerCreateSchema.parse({
      name: name + '-managed',
      image: 'node:22-bookworm-slim',
      volumes: [{ name, target: '/source' }],
    }),
  );
  containerId = created.Id;
  await engine.action(containerId, 'start');
  await delay(500);
  const inventory = await engine.inventory();
  assert.ok(inventory.containers.some((c) => c.id === containerId));
  assert.ok(inventory.volumes.some((v) => v.Name === name));
  await engine.logs(containerId, 10);
  // Stop only this test container before removing it (its restart policy can restart Node).
  await engine.action(containerId, 'stop');
  await engine.action(containerId, 'remove');
  containerId = undefined;
  console.log('Real Docker passed: mTLS, negotiated API, inventory, create/start/remove and logs.');
  const appSecret = randomBytes(32).toString('hex');
  docker(
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '-p',
    '127.0.0.1::4096',
    '--tmpfs',
    '/var/lib/zerobyte:rw,size=1g',
    '--tmpfs',
    '/restore:rw,size=16m',
    '-v',
    `${name}:/source:ro`,
    '-e',
    'BASE_URL=http://localhost:4096',
    '-e',
    'APP_SECRET=' + appSecret,
    '-e',
    'TZ=UTC',
    'ghcr.io/nicotsx/zerobyte:v0.42.0',
  );
  const port = Number(
    JSON.parse(docker('inspect', name))[0].NetworkSettings.Ports['4096/tcp'][0].HostPort,
  );
  const origin = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 60; n++) {
    try {
      if ((await fetch(origin + '/api/v1/auth/status')).ok) break;
    } catch {}
    await delay(1000);
  }
  let cookie = '';
  const password = randomBytes(20).toString('hex');
  async function upstream(path, body, apiKey) {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:4096',
        ...(cookie ? { cookie } : {}),
        ...(apiKey ? { 'x-api-key': apiKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    assert.ok(response.ok, `Zerobyte ${path}: HTTP ${response.status}`);
    return response.json();
  }
  await upstream('/api/auth/sign-up/email', {
    email: 'smoke@example.com',
    name: 'smoke',
    username: 'smoke',
    displayUsername: 'smoke',
    password,
  });
  const token = await upstream('/api/v1/auth/api-keys', { name: 'NEXUS isolated smoke', password });
  const source = await upstream(
    '/api/v1/volumes',
    { name: 'Docker test volume', config: { backend: 'directory', path: '/source' } },
    token.key,
  );
  const repo = await upstream(
    '/api/v1/repositories',
    {
      name: 'Smoke repository',
      config: { backend: 'local', path: '/var/lib/zerobyte/repositories/smoke' },
    },
    token.key,
  );
  const endpoint = await bridge({ hostname: '127.0.0.1', port }, false);
  const backup = new ZerobyteConnector(endpoint, { caCert: cert, apiKey: token.key });
  clients.push(backup);
  const resources = await backup.resources();
  assert.ok(resources.volumes.length);
  assert.ok(resources.repositories.length);
  const job = await backup.createJob(
    zerobyteJobSchema.parse({
      name: 'Docker smoke backup',
      volumeId: source.shortId,
      repositoryId: repo.repository.id,
      enabled: false,
      cronExpression: '0 2 * * *',
    }),
  );
  await backup.updateJob(
    job.shortId,
    zerobyteJobSchema.parse({
      name: 'Docker smoke backup updated',
      volumeId: source.shortId,
      repositoryId: repo.repository.id,
      enabled: false,
      cronExpression: '0 3 * * *',
    }),
  );
  const started = await backup.run(job.shortId);
  assert.equal(started.status, 'started');
  let state;
  for (let n = 0; n < 90; n++) {
    state = (await backup.jobs()).find((j) => j.shortId === job.shortId)?.lastBackupStatus;
    if (state === 'success' || state === 'error' || state === 'warning') break;
    await delay(1000);
  }
  assert.equal(state, 'success', 'A real Restic backup must finish successfully');
  const snapshots = await backup.snapshots(repo.repository.shortId);
  assert.ok(snapshots.length > 0);
  assert.ok(snapshots[0].size > 0);
  assert.ok((await backup.history()).items.length > 0);
  await upstream(
    `/api/v1/repositories/${repo.repository.shortId}/restore`,
    { snapshotId: snapshots[0].short_id, targetPath: '/restore', overwrite: 'never' },
    token.key,
  );
  let restored = '';
  for (let n = 0; n < 60; n++) {
    try {
      restored = docker('exec', name, 'cat', '/restore/proof.txt');
      if (restored) break;
    } catch {}
    await delay(1000);
  }
  assert.equal(
    restored,
    'nexus docker backup proof',
    'The restored file must match its original contents',
  );
  await backup.deleteJob(job.shortId);
  console.log(
    'Real Zerobyte v0.42.0 passed: API key, sources/repos, create/update/run, successful Restic backup of a Docker volume, snapshots, history and verified file restore.',
  );
} finally {
  for (const client of clients) await client.close().catch(() => {});
  for (const server of servers) await new Promise((resolve) => server.close(() => resolve()));
  if (containerId)
    try {
      docker('rm', '-f', containerId);
    } catch {}
  try {
    docker('rm', '-f', name);
  } catch {}
  try {
    docker('volume', 'rm', name);
  } catch {}
  await rm(dir, { recursive: true, force: true });
}
