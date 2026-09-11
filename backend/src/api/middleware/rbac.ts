import type { FastifyRequest } from 'fastify';
import type { Principal } from '../../models/types.js';
import { AppError } from '../../utils/errors.js';
export const scopes = [
  'vms:read',
  'vms:write',
  'infra:read',
  'infra:write',
  'hosts:read',
  'storage:read',
  'kubernetes:read',
  'kubernetes:write',
  'webhooks:read',
  'webhooks:write',
  'backups:read',
  'backups:write',
  'users:read',
  'users:write',
  'tokens:read',
  'tokens:write',
  'settings:read',
  'settings:write',
  'plugins:read',
  'plugins:write',
  'audit:read',
] as const;
const adminOnly = new Set([
  'infra:write',
  'users:read',
  'users:write',
  'webhooks:write',
  'settings:write',
  'settings:read',
  'plugins:write',
  'plugins:read',
  'backups:write',
  'backups:read',
  'audit:read',
]);
export function allowed(p: Principal, scope: string) {
  if (p.scopes && !p.scopes.includes(scope)) return false;
  if (adminOnly.has(scope) && p.role !== 'admin') return false;
  if (scope.endsWith(':write') && p.role === 'readonly') return false;
  return true;
}
export const requireScope = (scope: string) => async (req: FastifyRequest) => {
  if (!allowed(req.principal, scope)) throw new AppError(403, 'Insufficient permissions');
};
