import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, transaction } from '../../config/database.js';
import { newToken, hashToken } from '../../utils/encrypt.js';
import { AppError } from '../../utils/errors.js';
import { scopes, allowed, requireScope } from '../middleware/rbac.js';
import { idParam, nameSchema } from '../middleware/validation.js';
export async function tokenRoutes(app: FastifyInstance) {
  app.get(
    '/tokens',
    { preHandler: requireScope('tokens:read') },
    async (req) =>
      (
        await db.query(
          'SELECT id,name,scopes,expires_at,last_used_at,created_at FROM api_tokens WHERE user_id=$1 ORDER BY created_at DESC',
          [req.principal.id],
        )
      ).rows,
  );
  app.get('/tokens/:id', { preHandler: requireScope('tokens:read') }, async (req) => {
    const r = await db.query(
      'SELECT id,name,scopes,expires_at FROM api_tokens WHERE id=$1 AND user_id=$2',
      [idParam.parse(req.params).id, req.principal.id],
    );
    if (!r.rows[0]) throw new AppError(404, 'Token not found');
    return r.rows[0];
  });
  app.post('/tokens', { preHandler: requireScope('tokens:write') }, async (req, reply) => {
    const b = z
      .object({
        name: nameSchema,
        scopes: z.array(z.enum(scopes)).min(1),
        expiresAt: z
          .string()
          .datetime()
          .refine((v) => new Date(v) > new Date(), 'Expiration must be in the future')
          .optional(),
      })
      .strict()
      .parse(req.body);
    if (req.principal.tokenId) {
      const parent = (
        await db.query('SELECT expires_at FROM api_tokens WHERE id=$1', [req.principal.tokenId])
      ).rows[0];
      if (!parent) throw new AppError(401, 'Parent token revoked');
      if (
        parent.expires_at &&
        (!b.expiresAt || new Date(b.expiresAt) > new Date(parent.expires_at))
      )
        throw new AppError(403, 'Child token expiration must not exceed parent token expiration');
    }
    if (b.scopes.some((s) => !allowed(req.principal, s)))
      throw new AppError(403, 'Cannot grant scopes beyond your role');
    const token = 'nexus_token_' + newToken();
    const r = await db.query(
      'INSERT INTO api_tokens(name,token_hash,user_id,scopes,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING id,name,scopes,expires_at',
      [b.name, hashToken(token), req.principal.id, b.scopes, b.expiresAt ?? null],
    );
    return reply.code(201).send({ ...r.rows[0], token });
  });
  app.delete('/tokens/:id', { preHandler: requireScope('tokens:write') }, async (req) => {
    await db.query('DELETE FROM api_tokens WHERE id=$1 AND user_id=$2', [
      idParam.parse(req.params).id,
      req.principal.id,
    ]);
    return { ok: true };
  });
  app.post('/tokens/:id/rotate', { preHandler: requireScope('tokens:write') }, async (req) => {
    if (req.principal.tokenId) throw new AppError(403, 'Interactive session required');
    const { id } = idParam.parse(req.params);
    const token = 'nexus_token_' + newToken();
    const r = await transaction(async (tx) =>
      tx.query(
        'UPDATE api_tokens SET token_hash=$3,last_used_at=NULL WHERE id=$1 AND user_id=$2 RETURNING id,name,scopes,expires_at',
        [id, req.principal.id, hashToken(token)],
      ),
    );
    if (!r.rowCount) throw new AppError(404, 'Token not found');
    return { ...r.rows[0], token };
  });
}
