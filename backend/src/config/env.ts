import { config } from 'dotenv';
config({ path: new URL('../../../.env', import.meta.url), quiet: true });
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().optional(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  CORS_ORIGIN: z.string().url(),
  BACKUP_DIR: z.string().default('/data/backups'),
  PLUGIN_DIR: z.string().default('/opt/nexus/plugins'),
  WEBHOOK_ALLOWED_ORIGINS: z.string().default(''),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(16).optional(),
});
export const env = schema.parse(process.env);
