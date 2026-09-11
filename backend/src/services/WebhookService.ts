import { PluginManager } from '../api/plugins/PluginManager.js';
import { Queue, Worker } from 'bullmq';
import { createHmac, randomUUID } from 'node:crypto';
import { fetch } from 'undici';
import { db } from '../config/database.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { decrypt } from '../utils/encrypt.js';
import { AppError } from '../utils/errors.js';
import type { WebhookEvent } from '../models/types.js';
interface Delivery {
  webhookId: string;
  event: WebhookEvent;
  timestamp: string;
  data: unknown;
  deliveryId: string;
}
export function validateWebhookURL(url: string, origins = env.WEBHOOK_ALLOWED_ORIGINS) {
  const u = new URL(url);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    !origins
      .split(',')
      .map((s) => s.trim())
      .includes(u.origin)
  )
    throw new AppError(400, 'Webhook HTTPS origin is not in WEBHOOK_ALLOWED_ORIGINS');
  return u;
}
const sharedQueue = new Queue<Delivery>('webhooks', { connection: redis });
export class WebhookService {
  readonly queue = sharedQueue;
  async emit(event: WebhookEvent, data: unknown, onlyId?: string) {
    if (!onlyId) await new PluginManager().emit(event, data).catch(() => {});
    const r = await db.query(
      'SELECT id,retry_count FROM webhooks WHERE active=true AND ($1=ANY(events) OR id::text=$2)',
      [event, onlyId ?? null],
    );
    for (const hook of r.rows) {
      if (onlyId && hook.id !== onlyId) continue;
      await this.queue.add(
        event,
        {
          webhookId: hook.id,
          event,
          timestamp: new Date().toISOString(),
          data,
          deliveryId: randomUUID(),
        },
        {
          attempts: hook.retry_count,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    }
  }
  worker() {
    return new Worker<Delivery>(
      'webhooks',
      async (job) => {
        const r = await db.query('SELECT * FROM webhooks WHERE id=$1 AND active=true', [
          job.data.webhookId,
        ]);
        const h = r.rows[0];
        if (!h) return;
        const url = validateWebhookURL(h.url);
        const body = JSON.stringify({
          event: job.data.event,
          timestamp: job.data.timestamp,
          data: job.data.data,
        });
        const headers: Record<string, string> = h.headers_encrypted
          ? JSON.parse(decrypt(h.headers_encrypted, env.ENCRYPTION_KEY))
          : {};
        headers['content-type'] = 'application/json';
        headers['x-nexus-delivery'] = job.data.deliveryId;
        headers['x-nexus-timestamp'] = job.data.timestamp;
        if (h.secret_encrypted)
          headers['x-nexus-signature'] =
            'sha256=' +
            createHmac('sha256', decrypt(h.secret_encrypted, env.ENCRYPTION_KEY))
              .update(body)
              .digest('hex');
        if (h.method === 'GET') url.searchParams.set('payload', body);
        const started = Date.now();
        let status: number | undefined;
        let error: string | undefined;
        try {
          const response = await fetch(url, {
            method: h.method,
            headers,
            body: h.method === 'GET' ? undefined : body,
            signal: AbortSignal.timeout(h.timeout * 1000),
            redirect: 'error',
          });
          status = response.status;
          await response.body?.cancel();
          if (!response.ok) throw new Error(`HTTP ${status}`);
        } catch (e) {
          error = e instanceof Error ? e.message : 'Delivery failed';
          throw new Error(error);
        } finally {
          await db.query(
            'INSERT INTO webhook_logs(webhook_id,event,status_code,error,duration_ms,attempt) VALUES($1,$2,$3,$4,$5,$6)',
            [h.id, job.data.event, status, error, Date.now() - started, job.attemptsMade + 1],
          );
        }
      },
      { connection: redis, concurrency: 5 },
    );
  }
}
