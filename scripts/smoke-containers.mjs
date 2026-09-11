import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
config({ quiet: true });
const db = new URL(process.env.DATABASE_URL),
  redis = new URL(process.env.REDIS_URL);
db.hostname = 'host.docker.internal';
redis.hostname = 'host.docker.internal';
const environment = {
  ...process.env,
  DATABASE_URL: db.href,
  REDIS_URL: redis.href,
  NODE_ENV: 'production',
  BACKUP_DIR: '/data/backups',
  PLUGIN_DIR: '/opt/nexus/plugins',
};
function docker(args) {
  const r = spawnSync('docker', args, { env: environment, encoding: 'utf8' });
  if (r.status) throw new Error(r.stderr);
  return r.stdout.trim();
}
const names = [];
try {
  names.push(
    docker([
      'run',
      '--rm',
      '-d',
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '-p',
      '127.0.0.1:18080:8080',
      'm4m0-nexus-frontend',
    ]),
  );
  const args = [
    'run',
    '--rm',
    '-d',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--add-host',
    'host.docker.internal:host-gateway',
    '-p',
    '127.0.0.1:13001:3001',
  ];
  for (const key of [
    'NODE_ENV',
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'CORS_ORIGIN',
    'BACKUP_DIR',
    'PLUGIN_DIR',
  ])
    args.push('-e', key);
  args.push('m4m0-nexus-backend');
  names.push(docker(args));
  for (const url of ['http://127.0.0.1:18080/health', 'http://127.0.0.1:13001/health/ready']) {
    let ok = false;
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch(url);
        if (r.ok) {
          ok = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ok) throw new Error('Container health check failed: ' + url);
    console.log('Passed: ' + url);
  }
} finally {
  for (const name of names) docker(['stop', name]);
}
