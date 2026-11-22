import type { Env } from '../env';
import { auditStmt } from './audit';
import { getSubJoined, type RootRow, type SubRow } from './domains';
import { withDomainLock } from './domain-lock';
import { ApiError } from './http';
import { removeSubdomain, unpublishRecords } from './records';
import { DAY, now } from './util';

type SubWithRoot = SubRow & { r_json: string };

async function withRoots(db: D1Database, sql: string, ...binds: unknown[]) {
  const { results } = await db.prepare(sql).bind(...binds).all<SubWithRoot>();
  return results.map((row) => ({ sub: row as SubRow, root: JSON.parse(row.r_json) as RootRow }));
}

const ROOT_JSON = `json_object('id', r.id, 'zone_id', r.zone_id, 'domain', r.domain, 'grace_days', r.grace_days) AS r_json`;

/** 定时任务 到期撤下解析 过宽限期回收 清理过期数据 */
export async function maintenance(env: Env) {
  const db = env.DB;
  const t = now();

  const expiring = await withRoots(
    db,
    `SELECT s.*, ${ROOT_JSON} FROM subdomains s JOIN roots r ON r.id = s.root_id
     WHERE s.status = 'active' AND s.expires_at IS NOT NULL AND s.expires_at < ? LIMIT 50`,
    t,
  );
  for (const { sub, root } of expiring) {
    try {
      await withDomainLock(db, sub.id, async () => {
        const current = await getSubJoined(db, sub.id);
        if (!current || current.status !== 'active' || current.expires_at === null || current.expires_at >= t) return;
        await unpublishRecords(env, root, current);
        await db.batch([
          db.prepare("UPDATE subdomains SET status = 'expired', transfer_code = NULL, transfer_expires_at = NULL, updated_at = ? WHERE id = ?").bind(t, sub.id),
          auditStmt(db, { actor: null, action: 'subdomain.expire', targetType: 'subdomain', targetId: sub.id, targetLabel: sub.fqdn }),
        ]);
      });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'busy')) console.error('expire', sub.fqdn, e);
    }
  }

  const purging = await withRoots(
    db,
    `SELECT s.*, ${ROOT_JSON} FROM subdomains s JOIN roots r ON r.id = s.root_id
     WHERE s.status = 'expired' AND s.expires_at IS NOT NULL AND s.expires_at + r.grace_days * ? < ? LIMIT 50`,
    DAY,
    t,
  );
  for (const { sub, root } of purging) {
    try {
      await withDomainLock(db, sub.id, async () => {
        const current = await getSubJoined(db, sub.id);
        if (!current || current.status !== 'expired' || current.expires_at === null || current.expires_at + root.grace_days * DAY >= t) return;
        await removeSubdomain(env, root, current, null, 'subdomain.purge');
      });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'busy')) console.error('purge', sub.fqdn, e);
    }
  }

  await db.batch([
    db.prepare('DELETE FROM challenges WHERE expires_at < ?').bind(t),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
    db.prepare('DELETE FROM domain_locks WHERE expires_at < ?').bind(t),
    db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(t),
    db.prepare('UPDATE subdomains SET transfer_code = NULL, transfer_expires_at = NULL WHERE transfer_expires_at < ?').bind(t),
    db.prepare('DELETE FROM audit WHERE created_at < ?').bind(t - 365 * DAY),
  ]);
}
