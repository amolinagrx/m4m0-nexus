import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { db, transaction } from '../../config/database.js';
import { requireScope } from '../middleware/rbac.js';
import { idParam } from '../middleware/validation.js';
import { AppError } from '../../utils/errors.js';
export async function userRoutes(app: FastifyInstance) {
  app.get(
    '/users',
    { preHandler: requireScope('users:read') },
    async () =>
      (await db.query('SELECT id,email,role,source,active,created_at FROM users ORDER BY email'))
        .rows,
  );
  app.get('/users/:id', { preHandler: requireScope('users:read') }, async (req) => {
    const r = await db.query('SELECT id,email,role,source,active FROM users WHERE id=$1', [
      idParam.parse(req.params).id,
    ]);
    if (!r.rows[0]) throw new AppError(404, 'User not found');
    return r.rows[0];
  });
  app.post('/users', { preHandler: requireScope('users:write') }, async (req, reply) => {
    const b = z
      .object({
        email: z.string().email(),
        password: z.string().min(16).max(1024),
        role: z.enum(['admin', 'user', 'readonly']),
        active: z.boolean().default(true),
      })
      .strict()
      .parse(req.body);
    const r = await db.query(
      'INSERT INTO users(email,password_hash,role,active) VALUES($1,$2,$3,$4) RETURNING id,email,role,active',
      [b.email.toLowerCase(), await argon2.hash(b.password), b.role, b.active],
    );
    return reply.code(201).send(r.rows[0]);
  });
  app.put('/users/:id', { preHandler: requireScope('users:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z
      .object({
        role: z.enum(['admin', 'user', 'readonly']),
        active: z.boolean(),
        password: z.string().min(16).max(1024).optional(),
      })
      .strict()
      .parse(req.body);
    if (id === req.principal.id && (!b.active || b.role !== 'admin'))
      throw new AppError(400, 'Cannot remove your own administrative access');
    return transaction(async (tx) => {
      await tx.query('LOCK TABLE users IN EXCLUSIVE MODE');
      const r = await tx.query(
        'UPDATE users SET role=$2,active=$3,password_hash=COALESCE($4,password_hash) WHERE id=$1 RETURNING id,email,role,active',
        [id, b.role, b.active, b.password ? await argon2.hash(b.password) : null],
      );
      if (!r.rowCount) throw new AppError(404, 'User not found');
      await tx.query('DELETE FROM refresh_tokens WHERE user_id=$1', [id]);
      return r.rows[0];
    });
  });
  app.delete('/users/:id', { preHandler: requireScope('users:write') }, async (req) => {
    const { id } = idParam.parse(req.params);
    if (id === req.principal.id) throw new AppError(400, 'Cannot delete yourself');
    await db.query('DELETE FROM users WHERE id=$1', [id]);
    return { ok: true };
  });
}
