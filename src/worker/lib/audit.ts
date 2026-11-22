import type { ActivityItem } from '../../shared/types';
import type { UserRow } from '../env';
import { now, parseJson } from './util';

export interface AuditInput {
  actor: Pick<UserRow, 'id' | 'username'> | null;
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  detail?: Record<string, unknown>;
  ip?: string;
}

export function auditStmt(db: D1Database, a: AuditInput): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO audit (actor_id, actor_name, action, target_type, target_id, target_label, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      a.actor?.id ?? null,
      a.actor?.username ?? null,
      a.action,
      a.targetType ?? '',
      a.targetId ?? '',
      a.targetLabel ?? '',
      JSON.stringify(a.detail ?? {}),
      a.ip ?? '',
      now(),
    );
}

export async function audit(db: D1Database, a: AuditInput) {
  await auditStmt(db, a).run();
}

export interface AuditRow {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string;
  target_id: string;
  target_label: string;
  detail: string;
  ip: string;
  created_at: number;
}

/** forUser 为真时隐藏管理员身份与 IP */
export function activityDto(row: AuditRow, forUser: boolean): ActivityItem {
  const detail = parseJson<Record<string, unknown>>(row.detail, {});
  const byAdmin = detail.byAdmin === true;
  return {
    id: row.id,
    action: row.action,
    actorName: forUser && byAdmin ? null : row.actor_name,
    byAdmin,
    targetType: row.target_type,
    targetLabel: row.target_label,
    detail,
    ip: forUser ? null : row.ip || null,
    createdAt: row.created_at,
  };
}
