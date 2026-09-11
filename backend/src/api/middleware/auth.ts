import type { FastifyRequest } from 'fastify';
import { db } from '../../config/database.js';
import { hashToken } from '../../utils/encrypt.js';
import { AppError } from '../../utils/errors.js';
import type { Principal, Role } from '../../models/types.js';
declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
  }
}
export async function authenticate(req: FastifyRequest) {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  if (!token) throw new AppError(401, 'Authentication required');
  if (token.startsWith('nexus_token_')) {
    const r = await db.query<{ id: string; user_id: string; role: Role; scopes: string[] }>(
      'SELECT t.id,t.user_id,u.role,t.scopes FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND u.active=true AND (t.expires_at IS NULL OR t.expires_at>now())',
      [hashToken(token)],
    );
    const t = r.rows[0];
    if (!t) throw new AppError(401, 'Invalid API token');
    req.principal = { id: t.user_id, role: t.role, scopes: t.scopes, tokenId: t.id };
    await db.query('UPDATE api_tokens SET last_used_at=now() WHERE id=$1', [t.id]);
  } else {
    try {
      const p = await req.jwtVerify<{ sub: string }>();
      const r = await db.query<{ role: Role }>(
        'SELECT role FROM users WHERE id=$1 AND active=true',
        [p.sub],
      );
      if (!r.rows[0]) throw new Error();
      req.principal = { id: p.sub, role: r.rows[0].role };
    } catch {
      throw new AppError(401, 'Invalid access token');
    }
  }
}
