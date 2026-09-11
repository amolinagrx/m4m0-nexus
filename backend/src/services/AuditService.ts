import { db } from '../config/database.js';
export async function audit(
  actor: string | null,
  action: string,
  resource: string | null = null,
  ip: string | null = null,
  details: Record<string, unknown> = {},
) {
  await db.query(
    'INSERT INTO audit_logs(actor_id,action,resource,ip,details) VALUES($1,$2,$3,$4,$5)',
    [actor, action, resource, ip, JSON.stringify(details)],
  );
}
