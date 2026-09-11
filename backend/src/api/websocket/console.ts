import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { z } from 'zod';
import { redis } from '../../config/redis.js';
import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
import { newToken, hashToken, encrypt, decrypt } from '../../utils/encrypt.js';
import { requireScope, allowed } from '../middleware/rbac.js';
import { idParam } from '../middleware/validation.js';
import { VMService } from '../../services/VMService.js';
import { InfrastructureService } from '../../services/InfrastructureService.js';
import { maintenanceStatus } from '../routes/settings.js';
import { audit } from '../../services/AuditService.js';
import { AppError } from '../../utils/errors.js';
import type { Principal, ConsoleConfig } from '../../models/types.js';
export async function consoleRoutes(app: FastifyInstance) {
  app.get('/vms/:id/console/token', { preHandler: requireScope('vms:write') }, async (req) => {
    if ((await maintenanceStatus()).active)
      throw new AppError(503, 'Console disabled during maintenance');
    const { id } = idParam.parse(req.params);
    const vm = await new VMService().find(id);
    const config = await new InfrastructureService().withConnector(vm.infrastructure_id, (c) =>
      c.getConsoleURL(vm.external_id),
    );
    const token = newToken();
    await redis.set(
      'console:' + hashToken(token),
      JSON.stringify({
        vmId: id,
        principal: req.principal,
        config: encrypt(JSON.stringify(config), env.ENCRYPTION_KEY),
      }),
      'EX',
      30,
    );
    return { token, expiresIn: 30, type: 'vnc', password: config.password };
  });
  app.get(
    '/vms/:id/console',
    {
      websocket: true,
      preHandler: async (req) => {
        if (req.headers.origin !== env.CORS_ORIGIN)
          throw new AppError(403, 'Console origin rejected');
        const { id } = idParam.parse(req.params);
        const protocol = req.headers['sec-websocket-protocol']
          ?.split(',')
          .map((v) => v.trim())
          .find((v) => v.startsWith('nexus-ticket.'));
        if (!protocol) throw new AppError(401, 'Console ticket required');
        const raw = await redis.getdel('console:' + hashToken(protocol.slice(13)));
        if (!raw) throw new AppError(401, 'Invalid or consumed console ticket');
        const ticket = JSON.parse(raw) as { vmId: string; principal: Principal; config: string };
        if (ticket.vmId !== id) throw new AppError(403, 'Ticket target mismatch');
        const user = (
          await db.query('SELECT role FROM users WHERE id=$1 AND active=true', [
            ticket.principal.id,
          ])
        ).rows[0];
        if (!user) throw new AppError(401, 'User disabled');
        req.principal = { ...ticket.principal, role: user.role };
        (req as typeof req & { consoleConfig: ConsoleConfig }).consoleConfig = JSON.parse(
          decrypt(ticket.config, env.ENCRYPTION_KEY),
        ) as ConsoleConfig;
        if (!allowed(req.principal, 'vms:write'))
          throw new AppError(403, 'Console permission denied');
        if (
          req.principal.tokenId &&
          !(
            await db.query(
              'SELECT 1 FROM api_tokens WHERE id=$1 AND (expires_at IS NULL OR expires_at>now())',
              [req.principal.tokenId],
            )
          ).rowCount
        )
          throw new AppError(401, 'API token revoked');
        if ((await maintenanceStatus()).active)
          throw new AppError(503, 'Console disabled during maintenance');
      },
    },
    (socket, req) => {
      let upstream: WebSocket | undefined;
      let closed = false;
      const timer = setTimeout(() => socket.close(1000, 'Session expired'), 15 * 60 * 1000);
      const revalidate = setInterval(() => {
        void (async () => {
          const u = (
            await db.query('SELECT role FROM users WHERE id=$1 AND active=true', [req.principal.id])
          ).rows[0];
          if (
            !u ||
            !allowed({ ...req.principal, role: u.role }, 'vms:write') ||
            (await maintenanceStatus()).active
          )
            socket.close(1008, 'Session access revoked');
          if (
            req.principal.tokenId &&
            !(
              await db.query(
                'SELECT 1 FROM api_tokens WHERE id=$1 AND (expires_at IS NULL OR expires_at>now())',
                [req.principal.tokenId],
              )
            ).rowCount
          )
            socket.close(1008, 'API token revoked');
        })().catch(() => socket.close(1011, 'Authorization check failed'));
      }, 10000);
      const queued: Buffer[] = [];
      let queuedSize = 0;
      socket.on('message', (data, isBinary) => {
        if (!isBinary) {
          socket.close(1003, 'Binary data required');
          return;
        }
        const bytes = Buffer.from(data as Buffer);
        if (upstream?.readyState === WebSocket.OPEN) {
          if (upstream.bufferedAmount > 4 * 1024 * 1024) {
            socket.close(1013, 'Backpressure');
            return;
          }
          upstream.send(bytes);
        } else if ((queuedSize += bytes.length) < 1024 * 1024) queued.push(bytes);
        else socket.close(1009, 'Buffer exceeded');
      });
      socket.on('close', () => {
        closed = true;
        clearTimeout(timer);
        clearInterval(revalidate);
        upstream?.close();
      });
      socket.on('error', () => upstream?.close());
      void (async () => {
        const { id } = idParam.parse(req.params);
        const config = (req as typeof req & { consoleConfig: ConsoleConfig }).consoleConfig;
        if (closed) return;
        if (config.type !== 'vnc' || !config.url)
          throw new AppError(501, 'Console transport unavailable');
        await audit(req.principal.id, 'console.open', id, req.ip);
        if (closed) return;
        upstream = new WebSocket(config.url, {
          headers: config.headers,
          ca: config.caCert || undefined,
          rejectUnauthorized: true,
          handshakeTimeout: 10000,
          maxPayload: 4 * 1024 * 1024,
        });
        await new Promise<void>((resolve) => {
          upstream!.on('open', () => {
            for (const bytes of queued) upstream!.send(bytes);
            queued.length = 0;
          });
          upstream!.on('message', (data, binary) => {
            if (socket.readyState === WebSocket.OPEN) {
              if (socket.bufferedAmount > 4 * 1024 * 1024) socket.close(1013, 'Backpressure');
              else socket.send(data, { binary });
            }
          });
          upstream!.on('close', () => {
            socket.close();
            resolve();
          });
          upstream!.on('error', () => {
            socket.close(1011, 'Console transport failed');
            resolve();
          });
        });
        await audit(req.principal.id, 'console.close', id, req.ip);
      })().catch(() => socket.close(1011, 'Console connection failed'));
    },
  );
  app.post('/vms/:id/console/send-keys', { preHandler: requireScope('vms:write') }, async () => {
    throw new AppError(501, 'Send keys through the authenticated noVNC session');
  });
}
