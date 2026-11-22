import { fail } from './http';
import { now, randomId } from './util';

export async function withDomainLock<T>(db: D1Database, id: string, run: () => Promise<T>): Promise<T> {
  const token = randomId();
  const t = now();
  const lock = await db.prepare(
    'INSERT INTO domain_locks (subdomain_id, token, expires_at) VALUES (?, ?, ?) ON CONFLICT(subdomain_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at WHERE domain_locks.expires_at <= ?',
  ).bind(id, token, t + 30 * 60_000, t).run();
  if (!lock.meta.changes) fail(409, 'busy');
  try {
    return await run();
  } finally {
    await db.prepare('DELETE FROM domain_locks WHERE subdomain_id = ? AND token = ?').bind(id, token).run();
  }
}
