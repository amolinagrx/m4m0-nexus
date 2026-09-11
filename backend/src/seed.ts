import argon2 from 'argon2';
import { db } from './config/database.js';
import { env } from './config/env.js';
if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD)
  throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD required');
try {
  await db.query(
    "INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin') ON CONFLICT(email) DO NOTHING",
    [env.ADMIN_EMAIL.toLowerCase(), await argon2.hash(env.ADMIN_PASSWORD)],
  );
} finally {
  await db.end();
}
