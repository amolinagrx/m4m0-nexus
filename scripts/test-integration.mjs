import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
config({ quiet: true });
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/nexus_test';
const command = (args) => {
  const r = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.dev.yml',
      'exec',
      '-T',
      'database',
      'psql',
      '-U',
      'nexus_owner',
      ...args,
    ],
    { stdio: 'inherit' },
  );
  if (r.status) process.exit(r.status);
};
const found = spawnSync(
  'docker',
  [
    'compose',
    '-f',
    'docker-compose.dev.yml',
    'exec',
    '-T',
    'database',
    'psql',
    '-U',
    'nexus_owner',
    '-d',
    'nexus',
    '-Atc',
    "SELECT 1 FROM pg_database WHERE datname='nexus_test'",
  ],
  { encoding: 'utf8' },
);
if (!found.stdout?.trim()) {
  command(['-d', 'nexus', '-c', 'CREATE DATABASE nexus_test']);
  command([
    '-d',
    'nexus_test',
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    '/docker-entrypoint-initdb.d/001_schema.sql',
  ]);
  command([
    '-d',
    'nexus_test',
    '-c',
    'GRANT USAGE ON SCHEMA public TO nexus; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nexus; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO nexus; REVOKE UPDATE,DELETE,TRUNCATE ON audit_logs FROM nexus;',
  ]);
}
const r = spawnSync('npm', ['test'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url.toString(), NEXUS_INTEGRATION: '1' },
});
process.exitCode = r.status ?? 1;
