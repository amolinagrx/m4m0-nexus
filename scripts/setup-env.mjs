import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
const secret = () => randomBytes(24).toString('hex');
const postgres = secret(),
  database = secret(),
  redis = secret(),
  admin = secret();
const dev = process.argv.includes('--dev');
const values = {
  NODE_ENV: dev ? 'development' : 'production',
  NEXUS_HOST: process.env.NEXUS_HOST || 'nexus.example.com',
  ACME_EMAIL: process.env.ACME_EMAIL || 'admin@example.com',
  POSTGRES_PASSWORD: postgres,
  APP_DB_PASSWORD: database,
  REDIS_PASSWORD: redis,
  DATABASE_URL: `postgres://nexus:${database}@${dev ? '127.0.0.1' : 'database'}:5432/nexus`,
  REDIS_URL: `redis://:${redis}@${dev ? '127.0.0.1' : 'redis'}:6379`,
  JWT_SECRET: secret(),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  CORS_ORIGIN: dev ? 'http://127.0.0.1:5173' : 'https://nexus.example.com',
  ADMIN_EMAIL: 'admin@m4m0.es',
  ADMIN_PASSWORD: admin,
  PORT: '3001',
  BACKUP_DIR: dev ? fileURLToPath(new URL('../backups/', import.meta.url)) : '/data/backups',
  PLUGIN_DIR: dev ? fileURLToPath(new URL('../plugins/', import.meta.url)) : '/opt/nexus/plugins',
  WEBHOOK_ALLOWED_ORIGINS: 'https://hooks.slack.com',
};
await writeFile(
  '.env',
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n',
  { mode: 0o600, flag: 'wx' },
);
console.log('Created .env with random secrets. Read ADMIN_PASSWORD locally to sign in.');
