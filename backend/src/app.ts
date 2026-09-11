import { createServer } from 'node:http';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { db } from './config/database.js';
import { redis } from './config/redis.js';
import { AppError } from './utils/errors.js';
import { authenticate } from './api/middleware/auth.js';
import { tokenRateLimit } from './api/middleware/ratelimit.js';
import { authRoutes } from './api/routes/auth.js';
import { infrastructureRoutes } from './api/routes/infrastructure.js';
import { vmRoutes } from './api/routes/vms.js';
import { tokenRoutes } from './api/routes/tokens.js';
import { webhookRoutes } from './api/routes/webhooks.js';
import { userRoutes } from './api/routes/users.js';
import { settingsRoutes, maintenanceGuard } from './api/routes/settings.js';
import { backupRoutes } from './api/routes/backup.js';
import { pluginRoutes } from './api/routes/plugins.js';
import { kubernetesRoutes } from './api/routes/kubernetes.js';
import { kubernetesStreams } from './api/websocket/kubernetes.js';
import { consoleRoutes } from './api/websocket/console.js';
import { PluginManager } from './api/plugins/PluginManager.js';
import { audit } from './services/AuditService.js';
export async function buildApp() {
  const app = Fastify({
    logger:
      process.env.NEXUS_INTEGRATION === '1'
        ? false
        : {
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers.sec-websocket-protocol',
            ],
          },
    bodyLimit: 30 * 1024 * 1024,
    trustProxy: false,
  });
  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { iss: 'm4m0-nexus', aud: 'nexus-api' },
    verify: { allowedIss: 'm4m0-nexus', allowedAud: 'nexus-api' },
  });
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(helmet);
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', redis });
  // Route raw console/Kubernetes upgrades independently from Engine.IO.
  // Both handlers otherwise consume the same socket and corrupt WebSocket frames.
  const consoleUpgradeServer = createServer();
  await app.register(websocket, {
    options: { server: consoleUpgradeServer, maxPayload: 1024 * 1024 },
  });
  const routeUpgrade = (
    request: import('node:http').IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ) => {
    if (request.url?.startsWith('/socket.io/')) return;
    consoleUpgradeServer.emit('upgrade', request, socket, head);
  };
  app.server.on('upgrade', routeUpgrade);
  app.addHook('onClose', async () => {
    app.server.removeListener('upgrade', routeUpgrade);
    consoleUpgradeServer.removeAllListeners();
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'm4m0 NEXUS API', version: '0.1.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    },
  });
  app.setErrorHandler((e, req, reply) => {
    if (e instanceof ZodError)
      return reply.code(400).send({
        error: 'Validation failed',
        issues: e.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    if ((e as { code?: string }).code === '23505')
      return reply.code(409).send({ error: 'Resource already exists' });
    if (e instanceof AppError) return reply.code(e.statusCode).send({ error: e.message });
    const status = (e as { statusCode?: number }).statusCode;
    if (status && status < 500)
      return reply.code(status).send({ error: e instanceof Error ? e.message : 'Request failed' });
    req.log.error(
      { requestId: req.id, errorType: e instanceof Error ? e.name : 'UnknownError' },
      'Request failed',
    );
    return reply.code(500).send({ error: 'Internal server error', requestId: req.id });
  });
  app.get('/health/live', async () => ({ ok: true }));
  app.get('/health/ready', async () => {
    await db.query('SELECT 1');
    await redis.ping();
    return { ok: true };
  });
  await app.register(
    async (api) => {
      api.addHook('preHandler', async (req) => {
        const route = req.routeOptions.url ?? '';
        const publicRoutes = [
          '/api/v1/auth/login',
          '/api/v1/auth/refresh',
          '/api/v1/auth/logout',
          '/api/v1/maintenance/status',
        ];
        if (publicRoutes.includes(route)) return;
        // Console WebSockets authenticate using a short-lived, single-use ticket in their own preHandler.
        if (
          route === '/api/v1/vms/:id/console' ||
          ['/exec', '/logs/stream', '/port-forward'].some(
            (s) => route === '/api/v1/kubernetes/clusters/:id/namespaces/:ns/pods/:pod' + s,
          )
        )
          return;
        await authenticate(req);
        await tokenRateLimit(req);
        await maintenanceGuard(req);
        await new PluginManager().emit('api.beforeRequest', {
          method: req.method,
          route,
          userId: req.principal.id,
        });
      });
      api.addHook('onResponse', async (req) => {
        if (req.principal && !['GET', 'HEAD', 'OPTIONS'].includes(req.method))
          await audit(
            req.principal.id,
            `api.${req.method.toLowerCase()}`,
            req.routeOptions.url ?? null,
            req.ip,
          );
      });
      for (const routes of [
        authRoutes,
        infrastructureRoutes,
        vmRoutes,
        tokenRoutes,
        webhookRoutes,
        userRoutes,
        settingsRoutes,
        backupRoutes,
        pluginRoutes,
        kubernetesRoutes,
        consoleRoutes,
        kubernetesStreams,
      ])
        await api.register(routes);
    },
    { prefix: '/api/v1' },
  );
  await app.register(swaggerUI, {
    routePrefix: '/docs',
    uiHooks: {
      onRequest: async (req) => {
        await authenticate(req);
      },
    },
  });
  return app;
}
