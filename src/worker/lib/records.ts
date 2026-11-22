import { hostOf, type NormalizedRecord, type RecordFields, type RecordType } from '../../shared/dns';
import type { MessageCode } from '../../shared/messages';
import type { DnsRecord } from '../../shared/types';
import type { Env, UserRow } from '../env';
import { auditStmt } from './audit';
import { cf, dnsProvider, type CfRecordPayload } from './cloudflare';
import type { RootRow, SubRow } from './domains';
import { now, parseJson } from './util';

export interface RecordRow {
  id: string;
  subdomain_id: string;
  cf_id: string | null;
  type: RecordType;
  name: string;
  content: string;
  ttl: number;
  proxied: number;
  priority: number | null;
  data: string | null;
  comment: string;
  created_at: number;
  updated_at: number;
}

interface ExtraData {
  weight?: number;
  port?: number;
  flags?: number;
  tag?: string;
}

export function rowFields(row: RecordRow): RecordFields {
  const extra = parseJson<ExtraData>(row.data, {});
  return {
    type: row.type,
    name: row.name,
    content: row.content,
    ttl: row.ttl,
    proxied: !!row.proxied,
    priority: row.priority,
    weight: extra.weight ?? null,
    port: extra.port ?? null,
    flags: extra.flags ?? null,
    tag: extra.tag ?? null,
  };
}

export function extraData(r: RecordFields): string | null {
  if (r.type === 'SRV') return JSON.stringify({ weight: r.weight ?? 0, port: r.port ?? 0 });
  if (r.type === 'CAA') return JSON.stringify({ flags: r.flags ?? 0, tag: r.tag ?? 'issue' });
  return null;
}

export function recordDto(row: RecordRow, fqdn: string): DnsRecord {
  return {
    ...rowFields(row),
    id: row.id,
    host: hostOf(row.name, fqdn),
    comment: row.comment,
    published: row.cf_id !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPayload(r: RecordFields, subId: string): CfRecordPayload {
  const base = { type: r.type, name: r.name, ttl: r.ttl, comment: `dotlo:${subId}` };
  switch (r.type) {
    case 'SRV':
      return { ...base, data: { priority: r.priority ?? 0, weight: r.weight ?? 0, port: r.port ?? 0, target: r.content } };
    case 'CAA':
      return { ...base, data: { flags: r.flags ?? 0, tag: r.tag ?? 'issue', value: r.content } };
    case 'MX':
      return { ...base, content: r.content, priority: r.priority ?? 10 };
    case 'A':
    case 'AAAA':
    case 'CNAME':
      return { ...base, content: r.content, proxied: r.proxied };
    default:
      return { ...base, content: r.content };
  }
}

export async function listRecordRows(db: D1Database, subId: string) {
  const { results } = await db.prepare('SELECT * FROM records WHERE subdomain_id = ? ORDER BY name, type, created_at').bind(subId).all<RecordRow>();
  return results;
}

/** 本地先做一遍 DNS 规则检查 减少一次 Cloudflare 往返 */
export function findConflict(existing: RecordRow[], next: Pick<NormalizedRecord, 'type' | 'name' | 'content' | 'priority'>, skipId?: string): MessageCode | null {
  const others = existing.filter((r) => r.id !== skipId);
  const same = others.filter((r) => r.name === next.name);
  if (next.type === 'CNAME' && same.length) return 'conflict_cname';
  if (same.some((r) => r.type === 'CNAME')) return 'conflict_cname';
  if (next.type === 'NS' && same.some((r) => r.type !== 'NS')) return 'conflict_ns';
  if (next.type !== 'NS' && same.some((r) => r.type === 'NS')) return 'conflict_ns';
  const delegated = others.filter((r) => r.type === 'NS').map((r) => r.name);
  if (delegated.some((n) => next.name.endsWith(`.${n}`))) return 'conflict_delegated';
  if (next.type === 'NS' && others.some((r) => r.name.endsWith(`.${next.name}`))) return 'conflict_delegated';
  if (same.some((r) => r.type === next.type && r.content === next.content && r.priority === next.priority)) return 'record_duplicate';
  return null;
}

/** 把尚未发布的记录写入 Cloudflare 单条失败不影响其他记录 */
export async function publishRecords(env: Env, root: RootRow, sub: SubRow) {
  const rows = (await listRecordRows(env.DB, sub.id)).filter((r) => r.cf_id === null);
  if (!rows.length) return { published: 0, failed: 0 };
  let dns;
  try {
    dns = dnsProvider(env);
  } catch {
    return { published: 0, failed: rows.length };
  }
  let published = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const cfId = await dns.createRecord(root.zone_id, toPayload(rowFields(row), sub.id));
      await env.DB.prepare('UPDATE records SET cf_id = ?, updated_at = ? WHERE id = ?').bind(cfId, now(), row.id).run();
      published++;
    } catch (e) {
      console.error('publish', row.id, e);
      failed++;
    }
  }
  return { published, failed };
}

/** 从 Cloudflare 撤下全部记录 本地保留以便恢复 有失败时抛出 */
export async function unpublishRecords(env: Env, root: RootRow, sub: SubRow) {
  const rows = (await listRecordRows(env.DB, sub.id)).filter((r) => r.cf_id !== null);
  if (!rows.length) return;
  const dns = dnsProvider(env);
  for (const row of rows) {
    await cf(() => dns.deleteRecord(root.zone_id, row.cf_id as string));
    await env.DB.prepare('UPDATE records SET cf_id = NULL, updated_at = ? WHERE id = ?').bind(now(), row.id).run();
  }
}

/** 删除域名 先撤下解析再删库 */
export async function removeSubdomain(
  env: Env,
  root: RootRow,
  sub: SubRow,
  actor: Pick<UserRow, 'id' | 'username'> | null,
  action: string,
  detail: Record<string, unknown> = {},
  ip = '',
) {
  await unpublishRecords(env, root, sub);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM records WHERE subdomain_id = ?').bind(sub.id),
    env.DB.prepare('DELETE FROM subdomains WHERE id = ?').bind(sub.id),
    auditStmt(env.DB, { actor, action, targetType: 'subdomain', targetId: sub.id, targetLabel: sub.fqdn, detail, ip }),
  ]);
}
