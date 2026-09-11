import type { FastifyRequest } from 'fastify';
import { redis } from '../../config/redis.js';
import { AppError } from '../../utils/errors.js';
export async function tokenRateLimit(req: FastifyRequest) {
  if (!req.principal.tokenId) return;
  const key = `rate:${req.principal.tokenId}:${Math.floor(Date.now() / 60000)}`;
  const count = await redis.eval(
    "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],61) end; return n",
    1,
    key,
  );
  if (Number(count) > 300) throw new AppError(429, 'API token rate limit exceeded');
}
