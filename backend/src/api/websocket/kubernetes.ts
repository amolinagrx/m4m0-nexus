import type { FastifyInstance } from 'fastify';
import { PassThrough, Writable } from 'node:stream';
import { Exec, Log, PortForward } from '@kubernetes/client-node';
import { z } from 'zod';
import { db } from '../../config/database.js';
import { redis } from '../../config/redis.js';
import { env } from '../../config/env.js';
import { newToken, hashToken } from '../../utils/encrypt.js';
import { AppError } from '../../utils/errors.js';
import { allowed, requireScope } from '../middleware/rbac.js';
import { maintenanceStatus } from '../routes/settings.js';
import { withKubernetes } from '../routes/kubernetes.js';
import { audit } from '../../services/AuditService.js';
import type { Principal } from '../../models/types.js';
const dns = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,252}$/);
const params = z.object({ id: z.string().uuid(), ns: dns, pod: dns });
const sessionSchema = z
  .object({
    namespace: dns,
    pod: dns,
    container: dns,
    mode: z.enum(['exec', 'logs', 'port-forward']),
    command: z.array(z.string().max(500)).min(1).max(20).default(['/bin/sh']),
    port: z.number().int().min(1).max(65535).optional(),
  })
  .strict();
type Ticket = { clusterId: string; principal: Principal; session: z.infer<typeof sessionSchema> };
export async function kubernetesStreams(app: FastifyInstance) {
  app.post(
    '/kubernetes/clusters/:id/session/token',
    { preHandler: requireScope('kubernetes:read') },
    async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const session = sessionSchema.parse(req.body);
      if (session.mode !== 'logs' && !allowed(req.principal, 'kubernetes:write'))
        throw new AppError(403, 'Kubernetes write scope required');
      if (session.mode === 'port-forward' && !session.port)
        throw new AppError(400, 'Target port required');
      const token = newToken();
      await redis.set(
        'k8s-session:' + hashToken(token),
        JSON.stringify({ clusterId: id, principal: req.principal, session }),
        'EX',
        30,
      );
      return { token, expiresIn: 30 };
    },
  );
  for (const mode of ['exec', 'logs', 'port-forward'] as const) {
    const suffix = mode === 'logs' ? 'logs/stream' : mode;
    app.get(
      `/kubernetes/clusters/:id/namespaces/:ns/pods/:pod/${suffix}`,
      {
        websocket: true,
        preHandler: async (req) => {
          if (req.headers.origin !== env.CORS_ORIGIN) throw new AppError(403, 'Origin rejected');
          const p = params.parse(req.params);
          const protocol = req.headers['sec-websocket-protocol']
            ?.split(',')
            .map((s) => s.trim())
            .find((s) => s.startsWith('nexus-ticket.'));
          if (!protocol) throw new AppError(401, 'Session ticket required');
          const raw = await redis.getdel('k8s-session:' + hashToken(protocol.slice(13)));
          if (!raw) throw new AppError(401, 'Expired or consumed session ticket');
          const ticket = JSON.parse(raw) as Ticket;
          if (
            ticket.clusterId !== p.id ||
            ticket.session.namespace !== p.ns ||
            ticket.session.pod !== p.pod ||
            ticket.session.mode !== mode
          )
            throw new AppError(403, 'Session target mismatch');
          const user = (
            await db.query('SELECT role FROM users WHERE id=$1 AND active=true', [
              ticket.principal.id,
            ])
          ).rows[0];
          if (!user) throw new AppError(401, 'Account disabled');
          req.principal = { ...ticket.principal, role: user.role };
          if (!allowed(req.principal, mode === 'logs' ? 'kubernetes:read' : 'kubernetes:write'))
            throw new AppError(403, 'Permission denied');
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
          if (mode !== 'logs' && (await maintenanceStatus()).active)
            throw new AppError(503, 'Maintenance active');
          (req as typeof req & { sessionTicket: Ticket }).sessionTicket = ticket;
        },
      },
      (socket, req) => {
        const ticket = (req as typeof req & { sessionTicket: Ticket }).sessionTicket;
        const stdin = new PassThrough({ highWaterMark: 65536 });
        let closeUpstream = () => {};
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          clearTimeout(timeout);
          clearInterval(revalidate);
          stdin.destroy();
          closeUpstream();
        };
        const timeout = setTimeout(() => socket.close(1000, 'Session expired'), 15 * 60 * 1000);
        const revalidate = setInterval(() => {
          void (async () => {
            const u = (
              await db.query('SELECT role FROM users WHERE id=$1 AND active=true', [
                req.principal.id,
              ])
            ).rows[0];
            if (
              !u ||
              !allowed(
                { ...req.principal, role: u.role },
                mode === 'logs' ? 'kubernetes:read' : 'kubernetes:write',
              )
            )
              socket.close(1008, 'Access revoked');
            if (
              req.principal.tokenId &&
              !(
                await db.query(
                  'SELECT 1 FROM api_tokens WHERE id=$1 AND (expires_at IS NULL OR expires_at>now())',
                  [req.principal.tokenId],
                )
              ).rowCount
            )
              socket.close(1008, 'Token revoked');
            if (mode !== 'logs' && (await maintenanceStatus()).active)
              socket.close(1008, 'Maintenance active');
          })().catch(() => socket.close(1011, 'Authorization check failed'));
        }, 10000);
        socket.on('close', close);
        socket.on('error', close);
        socket.on('message', (data) => {
          if (mode === 'logs') return;
          if (!stdin.write(Buffer.from(data as Buffer))) socket.close(1013, 'Input rate exceeded');
        });
        const output = new Writable({
          write(chunk: Buffer, _encoding, callback) {
            if (socket.readyState !== 1) {
              callback();
              return;
            }
            if (socket.bufferedAmount > 1024 * 1024) {
              socket.close(1013, 'Output rate exceeded');
              callback();
              return;
            }
            socket.send(
              mode === 'port-forward' ? chunk : chunk.toString('utf8'),
              { binary: mode === 'port-forward' },
              () => callback(),
            );
          },
        });
        void withKubernetes(ticket.clusterId, async (c) => {
          if (closed) return;
          const s = ticket.session;
          await audit(
            req.principal.id,
            `kubernetes.${mode}.open`,
            `${ticket.clusterId}/${s.namespace}/${s.pod}`,
            req.ip,
          );
          if (mode === 'logs') {
            const controller = await new Log(c.kube).log(s.namespace, s.pod, s.container, output, {
              follow: true,
              tailLines: 200,
              timestamps: true,
            });
            closeUpstream = () => controller.abort();
          } else if (mode === 'exec') {
            const ws = await new Exec(c.kube).exec(
              s.namespace,
              s.pod,
              s.container,
              s.command,
              output,
              output,
              stdin,
              true,
              () => socket.close(1000, 'Process exited'),
            );
            closeUpstream = () => ws.close();
            ws.on('close', () => socket.close());
            ws.on('error', () => socket.close(1011, 'Exec stream failed'));
          } else {
            const result = await new PortForward(c.kube).portForward(
              s.namespace,
              s.pod,
              [s.port!],
              output,
              null,
              stdin,
            );
            closeUpstream = () => {
              const ws = typeof result === 'function' ? result() : result;
              ws?.close();
            };
          }
          if (closed) closeUpstream();
        }).catch(() => socket.close(1011, 'Kubernetes stream failed'));
      },
    );
  }
}
