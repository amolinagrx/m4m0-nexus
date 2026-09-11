import { Server } from 'socket.io';
import type { FastifyInstance } from 'fastify';
import { db } from '../../config/database.js';
import { env } from '../../config/env.js';
export function metricsSocket(app: FastifyInstance) {
  const io = new Server(app.server, {
    cors: { origin: env.CORS_ORIGIN, credentials: true },
    maxHttpBufferSize: 64 * 1024,
    destroyUpgrade: false,
  });
  io.use(async (socket, next) => {
    try {
      const p = app.jwt.verify<{ sub: string; exp: number }>(socket.handshake.auth.token);
      const r = await db.query('SELECT id FROM users WHERE id=$1 AND active=true', [p.sub]);
      if (!r.rowCount) throw new Error();
      socket.data.userId = p.sub;
      socket.data.expiresAt = p.exp * 1000;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });
  const timer = setInterval(() => {
    void (async () => {
      const snapshot = {
        vms: (await db.query('SELECT state,count(*)::int AS count FROM vms GROUP BY state')).rows,
        infrastructures: (
          await db.query(
            'SELECT status,count(*)::int AS count FROM infrastructures GROUP BY status',
          )
        ).rows,
        timestamp: new Date().toISOString(),
      };
      for (const socket of io.sockets.sockets.values()) {
        const active = (
          await db.query('SELECT 1 FROM users WHERE id=$1 AND active=true', [socket.data.userId])
        ).rowCount;
        if (!active || Date.now() > socket.data.expiresAt) socket.disconnect(true);
        else socket.emit('metrics', snapshot);
      }
    })().catch(() => {});
  }, 15000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await new Promise<void>((r) => io.close(() => r()));
  };
}
