import { checkLabel, DEFAULT_ALLOWED_TYPES, RECORD_TYPES, type RecordRules, type RecordType } from '../../shared/dns';
import type { MessageCode, MessageParams } from '../../shared/messages';
import type { AdminRoot, AdminSubdomain, RootDomain, RootStatus, SiteSettings, Subdomain, SubStatus } from '../../shared/types';
import type { UserRow } from '../env';
import { DAY, parseJson } from './util';

export interface RootRow {
  id: string;
  zone_id: string;
  domain: string;
  description: string;
  status: RootStatus;
  min_length: number;
  max_length: number;
  allowed_types: string;
  allow_proxied: number;
  max_records: number;
  term_days: number;
  renew_window_days: number;
  grace_days: number;
  require_review: number;
  sort: number;
  created_at: number;
}

export interface SubRow {
  id: string;
  root_id: string;
  label: string;
  fqdn: string;
  user_id: string;
  status: SubStatus;
  status_reason: string;
  note: string;
  transfer_code: string | null;
  transfer_expires_at: number | null;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
}

export type SubJoined = SubRow & { root_domain: string; record_count: number };
export type AdminSubJoined = SubJoined & { owner_name: string };

export const SUB_SELECT = `SELECT s.*, r.domain AS root_domain,
  (SELECT COUNT(*) FROM records x WHERE x.subdomain_id = s.id) AS record_count
  FROM subdomains s JOIN roots r ON r.id = s.root_id`;

export const ADMIN_SUB_SELECT = `SELECT s.*, r.domain AS root_domain, u.username AS owner_name,
  (SELECT COUNT(*) FROM records x WHERE x.subdomain_id = s.id) AS record_count
  FROM subdomains s JOIN roots r ON r.id = s.root_id JOIN users u ON u.id = s.user_id`;

export function allowedTypes(root: RootRow): RecordType[] {
  const list = parseJson<string[]>(root.allowed_types, DEFAULT_ALLOWED_TYPES);
  return RECORD_TYPES.filter((t) => list.includes(t));
}

export function recordRules(root: RootRow): RecordRules {
  return { allowedTypes: allowedTypes(root), allowProxied: !!root.allow_proxied };
}

export function rootDto(r: RootRow): RootDomain {
  return {
    id: r.id,
    domain: r.domain,
    description: r.description,
    status: r.status,
    minLength: r.min_length,
    maxLength: r.max_length,
    allowedTypes: allowedTypes(r),
    allowProxied: !!r.allow_proxied,
    maxRecords: r.max_records,
    termDays: r.term_days,
    renewWindowDays: r.renew_window_days,
    graceDays: r.grace_days,
    requireReview: !!r.require_review,
  };
}

export function adminRootDto(r: RootRow & { subdomain_count: number }): AdminRoot {
  return { ...rootDto(r), zoneId: r.zone_id, sort: r.sort, subdomainCount: r.subdomain_count, createdAt: r.created_at };
}

export function subDto(s: SubJoined): Subdomain {
  return {
    id: s.id,
    fqdn: s.fqdn,
    label: s.label,
    rootId: s.root_id,
    rootDomain: s.root_domain,
    status: s.status,
    statusReason: s.status_reason,
    note: s.note,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    expiresAt: s.expires_at,
    recordCount: s.record_count,
    transferExpiresAt: s.transfer_code && s.transfer_expires_at && s.transfer_expires_at > Date.now() ? s.transfer_expires_at : null,
  };
}

export function adminSubDto(s: AdminSubJoined): AdminSubdomain {
  return { ...subDto(s), ownerId: s.user_id, ownerName: s.owner_name };
}

export async function getRoot(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM roots WHERE id = ?').bind(id).first<RootRow>();
}

export async function getSubJoined(db: D1Database, id: string) {
  return db.prepare(`${SUB_SELECT} WHERE s.id = ?`).bind(id).first<SubJoined>();
}

export function renewInfo(sub: SubRow, root: RootRow, t: number) {
  if (root.term_days <= 0 || sub.expires_at === null) return { renewable: false, opensAt: null, purgeAt: null };
  const opensAt = sub.expires_at - root.renew_window_days * DAY;
  const purgeAt = sub.expires_at + root.grace_days * DAY;
  const renewable = (sub.status === 'active' || sub.status === 'expired') && t >= opensAt && t <= purgeAt;
  return { renewable, opensAt, purgeAt };
}

/** 返回有效配额 null 表示不限 */
export async function userQuota(db: D1Database, user: Pick<UserRow, 'id' | 'role' | 'quota'>, settings: SiteSettings) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM subdomains WHERE user_id = ?').bind(user.id).first<{ n: number }>();
  const used = row?.n ?? 0;
  const quota = user.quota ?? (user.role === 'admin' ? null : settings.defaultQuota);
  return { quota, used };
}

export async function checkName(
  db: D1Database,
  root: RootRow,
  label: string,
): Promise<{ code: MessageCode | null; params: MessageParams; registeredAt: number | null }> {
  const params = { min: root.min_length, max: root.max_length };
  const problem = checkLabel(label, root.min_length, root.max_length);
  if (problem) return { code: problem, params, registeredAt: null };
  if (label.length + 1 + root.domain.length > 253) return { code: 'fqdn_too_long', params, registeredAt: null };
  const [reserved, taken] = await Promise.all([
    db.prepare('SELECT 1 AS x FROM reserved WHERE label = ?').bind(label).first(),
    db.prepare('SELECT created_at FROM subdomains WHERE root_id = ? AND label = ?').bind(root.id, label).first<{ created_at: number }>(),
  ]);
  if (taken) return { code: 'label_taken', params, registeredAt: taken.created_at };
  if (reserved) return { code: 'label_reserved', params, registeredAt: null };
  return { code: null, params, registeredAt: null };
}
