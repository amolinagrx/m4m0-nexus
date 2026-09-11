import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { PluginManager } from '../plugins/PluginManager.js';
import { AuthService } from '../../services/AuthService.js';
import { audit } from '../../services/AuditService.js';
import { WebhookService } from '../../services/WebhookService.js';
import { AppError } from '../../utils/errors.js';
import type { User } from '../../models/types.js';
export async function authRoutes(app: FastifyInstance) {
  const auth = new AuthService();
  const cookie = (reply: FastifyReply, token: string) =>
    reply.setCookie('nexus_refresh', token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 604800,
    });
  const result = (user: User) => ({
    accessToken: app.jwt.sign({ sub: user.id }, { expiresIn: '15m' }),
    user: { id: user.id, email: user.email, role: user.role },
  });
  const origin = (req: FastifyRequest) => {
    if (req.headers.origin !== env.CORS_ORIGIN) throw new AppError(403, 'Origin rejected');
  };
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z
        .object({
          username: z.string().min(1).max(254),
          password: z.string().min(1).max(1024),
          source: z.enum(['local', 'ldap']).default('local'),
        })
        .strict()
        .parse(req.body);
      const user = await auth.login(body.username, body.password, body.source);
      cookie(reply, await auth.createRefresh(user.id));
      await audit(user.id, 'user.login', null, req.ip);
      await new WebhookService().emit('user.login', { userId: user.id });
      await new PluginManager().emit('user.afterLogin', { userId: user.id }).catch(() => {});
      return result(user);
    },
  );
  app.post('/auth/refresh', async (req, reply) => {
    origin(req);
    const token = req.cookies.nexus_refresh;
    if (!token) throw new AppError(401, 'Refresh token required');
    const r = await auth.rotate(token);
    cookie(reply, r.refreshToken);
    return result(r.user);
  });
  app.post('/auth/logout', async (req, reply) => {
    origin(req);
    if (req.cookies.nexus_refresh) await auth.logout(req.cookies.nexus_refresh);
    reply.clearCookie('nexus_refresh', { path: '/api/v1/auth' });
    return { ok: true };
  });
  app.get('/auth/me', async (req) => {
    const { db } = await import('../../config/database.js');
    return (
      await db.query('SELECT id,email,role,source FROM users WHERE id=$1', [req.principal.id])
    ).rows[0];
  });
}
