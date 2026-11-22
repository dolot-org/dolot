import { Hono } from 'hono';
import { z } from 'zod';
import { checkLabel, cleanHost, DEFAULT_ALLOWED_TYPES, isHostname, RECORD_TYPES } from '../../shared/dns';
import { REPORT_CATEGORIES, SUB_STATUSES, type AdminReport, type AdminStats, type AdminUser, type CfZoneInfo, type Paged, type ReservedName, type SubStatus, type SyncResult } from '../../shared/types';
import type { AppEnv, Ctx, UserRow } from '../env';
import { activityDto, auditStmt, type AuditRow } from '../lib/audit';
import { cf, dnsMode, dnsProvider } from '../lib/cloudflare';
import { withDomainLock } from '../lib/domain-lock';
import { ADMIN_SUB_SELECT, adminRootDto, adminSubDto, getRoot, getSubJoined, rootDto, type AdminSubJoined, type RootRow } from '../lib/domains';
import { fail, readBody } from '../lib/http';
import { listRecordRows, publishRecords, recordDto, removeSubdomain, unpublishRecords } from '../lib/records';
import { currentUser, pwaGuard, requireAdmin, requireUser } from '../lib/session';
import { getSettings, saveSettings } from '../lib/settings';
import { cleanText, clientIp, DAY, isUniqueError, likePattern, now, pageParams, randomId } from '../lib/util';

export const admin = new Hono<AppEnv>();
admin.use('*', requireUser, requireAdmin, pwaGuard);

type Bind = string | number | null;
const rootSelect = 'SELECT r.*, (SELECT COUNT(*) FROM subdomains s WHERE s.root_id = r.id) AS subdomain_count FROM roots r';

async function paginate<Row, Result>(c: Ctx, query: string, order: string, params: Bind[], map: (row: Row) => Result): Promise<Paged<Result>> {
  const { page, pageSize, offset } = pageParams(c);
  const { DB } = c.env;
  const [rows, count] = await Promise.all([
    DB.prepare(query + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?').bind(...params, pageSize, offset).all<Row>(),
    DB.prepare('SELECT COUNT(*) AS n FROM (' + query + ')').bind(...params).first<{ n: number }>(),
  ]);
  return { items: rows.results.map(map), total: count?.n ?? 0, page, pageSize };
}

function adminAudit(c: Ctx, action: string, targetType: string, targetId: string, targetLabel: string, detail: Record<string, unknown> = {}) {
  return auditStmt(c.env.DB, {
    actor: currentUser(c), action, targetType, targetId, targetLabel, detail: { ...detail, byAdmin: true }, ip: clientIp(c),
  });
}

admin.get('/stats', async (c) => {
  const { DB } = c.env;
  type Totals = Pick<AdminStats, 'users' | 'usersWeek' | 'subdomainsWeek' | 'records' | 'roots' | 'openReports'>;
  const [counts, statuses, recent] = await Promise.all([
    DB.prepare(`SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM users WHERE created_at >= ?1) AS usersWeek,
      (SELECT COUNT(*) FROM subdomains WHERE created_at >= ?1) AS subdomainsWeek, (SELECT COUNT(*) FROM records) AS records,
      (SELECT COUNT(*) FROM roots) AS roots, (SELECT COUNT(*) FROM reports WHERE status = 'open') AS openReports`)
      .bind(now() - 7 * DAY).first<Totals>(),
    DB.prepare('SELECT status, COUNT(*) AS n FROM subdomains GROUP BY status').all<{ status: SubStatus; n: number }>(),
    DB.prepare(ADMIN_SUB_SELECT + ' ORDER BY s.created_at DESC LIMIT 8').all<AdminSubJoined>(),
  ]);
  const subdomains = { active: 0, pending: 0, suspended: 0, expired: 0 };
  for (const row of statuses.results) subdomains[row.status] = row.n;
  return c.json({
    ...(counts ?? { users: 0, usersWeek: 0, subdomainsWeek: 0, records: 0, roots: 0, openReports: 0 }),
    subdomains, dnsMode: dnsMode(c.env), recent: recent.results.map(adminSubDto),
  } satisfies AdminStats);
});

admin.get('/zones', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT zone_id FROM roots').all<{ zone_id: string }>();
  const zoneIds = new Set(results.map((r) => r.zone_id));
  const zones = await cf(() => dnsProvider(c.env).listZones());
  return c.json(zones.map((zone): CfZoneInfo => ({ ...zone, added: zoneIds.has(zone.id) })));
});

admin.get('/roots', async (c) => {
  const { results } = await c.env.DB.prepare(rootSelect + ' ORDER BY r.sort, r.domain').all<RootRow & { subdomain_count: number }>();
  return c.json(results.map(adminRootDto));
});

const rootPolicy = z.object({
  description: z.string().max(200), status: z.enum(['active', 'paused']),
  minLength: z.number().int().min(1).max(63), maxLength: z.number().int().min(1).max(63),
  allowedTypes: z.array(z.enum(RECORD_TYPES)).min(1).max(RECORD_TYPES.length),
  allowProxied: z.boolean(), maxRecords: z.number().int().min(1).max(50),
  termDays: z.number().int().min(0).max(3650), renewWindowDays: z.number().int().min(1).max(3650),
  graceDays: z.number().int().min(0).max(365), requireReview: z.boolean(),
  sort: z.number().int().min(-10000).max(10000),
});
const rootColumns = 'description, status, min_length, max_length, allowed_types, allow_proxied, max_records, term_days, renew_window_days, grace_days, require_review, sort';
function rootValues(policy: z.output<typeof rootPolicy>): Bind[] {
  if (policy.minLength > policy.maxLength) fail(400, 'length_range');
  return [
    cleanText(policy.description, 200), policy.status, policy.minLength, policy.maxLength, JSON.stringify([...new Set(policy.allowedTypes)]),
    +policy.allowProxied, policy.maxRecords, policy.termDays, policy.renewWindowDays, policy.graceDays, +policy.requireReview, policy.sort,
  ];
}

admin.post('/roots', async (c) => {
  const { DB } = c.env;
  const body = await readBody(c, rootPolicy.extend({
    zoneId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), domain: z.string().max(254),
    description: rootPolicy.shape.description.default(''), status: rootPolicy.shape.status.default('active'),
    minLength: rootPolicy.shape.minLength.default(3), maxLength: rootPolicy.shape.maxLength.default(63),
    allowedTypes: rootPolicy.shape.allowedTypes.default(DEFAULT_ALLOWED_TYPES), allowProxied: rootPolicy.shape.allowProxied.default(true),
    maxRecords: rootPolicy.shape.maxRecords.default(20), termDays: rootPolicy.shape.termDays.default(365),
    renewWindowDays: rootPolicy.shape.renewWindowDays.default(30), graceDays: rootPolicy.shape.graceDays.default(30),
    requireReview: rootPolicy.shape.requireReview.default(false), sort: rootPolicy.shape.sort.default(0),
  }));
  const domain = cleanHost(body.domain);
  if (!isHostname(domain) || domain.includes('_')) fail(400, 'zone_invalid');
  const mode = dnsMode(c.env);
  if (mode !== 'mock') {
    if (!/^[a-f0-9]{32}$/.test(body.zoneId)) fail(400, 'zone_invalid');
    const zone = await cf(() => dnsProvider(c.env).getZone(body.zoneId));
    if (zone?.name !== domain) fail(400, 'zone_inaccessible');
  }
  const id = randomId();
  try {
    const result = await DB.prepare(
      `INSERT INTO roots (id, zone_id, domain, created_at, ${rootColumns})
       SELECT ?1, ?2, ?3, ?4, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM roots WHERE domain = ?3 OR substr(domain, -(length(?3) + 1)) = '.' || ?3 OR substr(?3, -(length(domain) + 1)) = '.' || domain)`,
    ).bind(id, body.zoneId, domain, now(), ...rootValues(body)).run();
    if (!result.meta.changes) fail(409, 'root_exists');
  } catch (error) {
    if (isUniqueError(error)) fail(409, 'root_exists');
    throw error;
  }
  await adminAudit(c, 'root.create', 'root', id, domain).run();
  return c.json({ id }, 201);
});

admin.patch('/roots/:id', async (c) => {
  const { DB } = c.env;
  const root = await getRoot(DB, c.req.param('id'));
  if (!root) fail(404, 'not_found');
  const body = await readBody(c, rootPolicy.partial());
  const policy = { ...rootDto(root), sort: root.sort, ...body };
  const fields = rootColumns.split(', ').map((field) => field + ' = ?').join(', ');
  await DB.batch([
    DB.prepare('UPDATE roots SET ' + fields + ' WHERE id = ?').bind(...rootValues(policy), root.id),
    adminAudit(c, 'root.update', 'root', root.id, root.domain),
  ]);
  return c.json({ ok: true });
});

admin.delete('/roots/:id', async (c) => {
  const { DB } = c.env;
  const id = c.req.param('id');
  const deleted = await DB.prepare('DELETE FROM roots WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM subdomains WHERE root_id = ?1) RETURNING domain').bind(id).first<{ domain: string }>();
  if (!deleted) {
    if (await getRoot(DB, id)) fail(409, 'root_in_use');
    fail(404, 'not_found');
  }
  await adminAudit(c, 'root.delete', 'root', id, deleted.domain).run();
  return c.json({ ok: true });
});

admin.get('/subdomains', async (c) => {
  const q = likePattern((c.req.query('q') ?? '').slice(0, 254));
  const status = z.enum(SUB_STATUSES).safeParse(c.req.query('status'));
  const where = " WHERE s.fqdn LIKE ? ESCAPE '\\'" + (status.success ? ' AND s.status = ?' : '');
  return c.json(await paginate(c, ADMIN_SUB_SELECT + where, 's.created_at DESC, s.id DESC', status.success ? [q, status.data] : [q], adminSubDto));
});

async function adminDomain(c: Ctx, id: string) {
  const sub = await getSubJoined(c.env.DB, id);
  if (!sub) fail(404, 'not_found');
  const root = await getRoot(c.env.DB, sub.root_id);
  if (!root) fail(404, 'not_found');
  return { sub, root };
}

admin.get('/subdomains/:id', async (c) => {
  const id = c.req.param('id');
  const [sub, records] = await Promise.all([
    c.env.DB.prepare(ADMIN_SUB_SELECT + ' WHERE s.id = ?').bind(id).first<AdminSubJoined>(),
    listRecordRows(c.env.DB, id),
  ]);
  if (!sub) fail(404, 'not_found');
  return c.json({ subdomain: adminSubDto(sub), records: records.map((row) => recordDto(row, sub.fqdn)) });
});

admin.patch('/subdomains/:id', (c) => withDomainLock(c.env.DB, c.req.param('id'), async () => {
  const { DB } = c.env;
  const { sub, root } = await adminDomain(c, c.req.param('id'));
  const body = await readBody(c, z.object({ status: z.enum(['active', 'suspended']), reason: z.string().max(250).default('') }));
  const timestamp = now();
  const expiresAt = body.status === 'active'
    ? (sub.expires_at !== null && sub.expires_at > timestamp ? sub.expires_at : root.term_days ? timestamp + root.term_days * DAY : null)
    : sub.expires_at;
  if (body.status === 'suspended') await unpublishRecords(c.env, root, sub);
  await DB.batch([
    DB.prepare('UPDATE subdomains SET status = ?, status_reason = ?, expires_at = ?, updated_at = ?, transfer_code = NULL, transfer_expires_at = NULL WHERE id = ?')
      .bind(body.status, cleanText(body.reason, 250), expiresAt, timestamp, sub.id),
    adminAudit(c, 'subdomain.' + body.status, 'subdomain', sub.id, sub.fqdn),
  ]);
  const publication = body.status === 'active' ? await publishRecords(c.env, root, sub) : { published: 0, failed: 0 };
  return c.json(publication);
}));

admin.delete('/subdomains/:id', (c) => withDomainLock(c.env.DB, c.req.param('id'), async () => {
  const { sub, root } = await adminDomain(c, c.req.param('id'));
  const body = await readBody(c, z.object({ confirm: z.string().max(254) }));
  if (body.confirm !== sub.fqdn) fail(400, 'confirm_mismatch');
  await removeSubdomain(c.env, root, sub, currentUser(c), 'subdomain.remove', { byAdmin: true }, clientIp(c));
  return c.json({ ok: true });
}));

admin.post('/subdomains/:id/sync', (c) => withDomainLock(c.env.DB, c.req.param('id'), async () => {
  const { DB } = c.env;
  const { sub, root } = await adminDomain(c, c.req.param('id'));
  if (sub.status !== 'active' || (sub.expires_at !== null && sub.expires_at <= now())) fail(409, 'status_invalid');
  const dns = dnsProvider(c.env);
  const [remote, local] = await Promise.all([cf(() => dns.listRecords(root.zone_id, sub.fqdn)), listRecordRows(DB, sub.id)]);
  const remoteIds = new Set(remote.map((record) => record.id));
  const localIds = new Set(local.map((record) => record.cf_id));
  const missing = local.filter((record) => record.cf_id && !remoteIds.has(record.cf_id) && dns.mode !== 'mock');
  if (missing.length) await DB.batch(missing.map((record) => DB.prepare('UPDATE records SET cf_id = NULL WHERE id = ?').bind(record.id)));
  const { published } = await publishRecords(c.env, root, sub);
  await adminAudit(c, 'subdomain.sync', 'subdomain', sub.id, sub.fqdn, { published, missing: missing.length }).run();
  return c.json({
    republished: published, missing: missing.length,
    unmanaged: remote.filter((record) => !localIds.has(record.id)).map(({ name, type, content }) => ({ name, type, content })),
  } satisfies SyncResult);
}));

type UserCounts = UserRow & { subdomain_count: number; passkey_count: number };
admin.get('/users', async (c) => {
  const q = likePattern((c.req.query('q') ?? '').slice(0, 100));
  const query = `SELECT u.*, (SELECT COUNT(*) FROM subdomains s WHERE s.user_id = u.id) AS subdomain_count,
    (SELECT COUNT(*) FROM credentials k WHERE k.user_id = u.id) AS passkey_count
    FROM users u WHERE u.username LIKE ?1 ESCAPE '\\' OR u.display_name LIKE ?1 ESCAPE '\\'`;
  return c.json(await paginate(c, query, 'u.created_at DESC, u.id DESC', [q], (row: UserCounts): AdminUser => ({
    id: row.id, username: row.username, displayName: row.display_name, role: row.role, status: row.status,
    banReason: row.ban_reason, quota: row.quota, contact: row.contact, createdAt: row.created_at,
    lastLoginAt: row.last_login_at, subdomainCount: row.subdomain_count, passkeyCount: row.passkey_count,
  })));
});

admin.patch('/users/:id', async (c) => {
  const { DB } = c.env;
  const id = c.req.param('id');
  const body = await readBody(c, z.object({
    role: z.enum(['admin', 'user']).optional(), status: z.enum(['active', 'banned']).optional(),
    banReason: z.string().max(200).optional(), quota: z.number().int().min(0).max(1000).nullable().optional(),
  }));
  const user = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  if (!user) fail(404, 'user_not_found');
  const role = body.role ?? user.role;
  const status = body.status ?? user.status;
  if (id === currentUser(c).id && (role !== 'admin' || status !== 'active')) fail(409, 'self_action');
  const quota = body.quota === undefined ? user.quota : body.quota;
  const reason = status === 'banned' ? cleanText(body.banReason ?? user.ban_reason ?? '', 200) : null;
  const result = await DB.prepare(`UPDATE users SET role = ?1, status = ?2, ban_reason = ?3, quota = ?4 WHERE id = ?5
    AND (role <> 'admin' OR status <> 'active' OR (?1 = 'admin' AND ?2 = 'active') OR
    EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?5))`)
    .bind(role, status, reason, quota, id).run();
  if (!result.meta.changes) fail(409, 'status_invalid');
  await DB.batch([
    DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND status = 'banned')").bind(id),
    adminAudit(c, 'user.update', 'user', id, user.username, { role, status, quota }),
  ]);
  return c.json({ ok: true });
});

type ReportRow = {
  id: string; fqdn: string; subdomain_id: string | null; sub_status: SubStatus | null; owner_name: string | null;
  category: typeof REPORT_CATEGORIES[number]; details: string; contact: string; status: AdminReport['status']; resolution: string;
  created_at: number; handled_at: number | null; handler_name: string | null;
};
const reportStatuses = z.enum(['open', 'resolved', 'dismissed']);
admin.get('/reports', async (c) => {
  const status = reportStatuses.safeParse(c.req.query('status'));
  const where = status.success ? ' WHERE p.status = ?' : '';
  return c.json(await paginate(c, `SELECT p.*, s.status AS sub_status, u.username AS owner_name, h.username AS handler_name
    FROM reports p LEFT JOIN subdomains s ON p.subdomain_id = s.id LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN users h ON h.id = p.handled_by` + where, 'p.created_at DESC, p.id DESC', status.success ? [status.data] : [],
    (row: ReportRow): AdminReport => ({
      id: row.id, fqdn: row.fqdn, subdomainId: row.subdomain_id, subdomainStatus: row.sub_status, ownerName: row.owner_name,
      category: row.category, details: row.details, contact: row.contact, status: row.status, resolution: row.resolution,
      createdAt: row.created_at, handledAt: row.handled_at, handlerName: row.handler_name,
    }),
  ));
});

admin.patch('/reports/:id', async (c) => {
  const { DB } = c.env;
  const id = c.req.param('id');
  const body = await readBody(c, z.object({ status: reportStatuses, resolution: z.string().max(1000).default('') }));
  const open = body.status === 'open';
  const report = await DB.prepare('UPDATE reports SET status = ?, resolution = ?, handled_by = ?, handled_at = ? WHERE id = ? RETURNING fqdn')
    .bind(body.status, cleanText(body.resolution, 1000), open ? null : currentUser(c).id, open ? null : now(), id).first<{ fqdn: string }>();
  if (!report) fail(404, 'not_found');
  await adminAudit(c, 'report.' + body.status, 'report', id, report.fqdn).run();
  return c.json({ ok: true });
});

admin.get('/reserved', async (c) => {
  const query = "SELECT label, reason, created_at FROM reserved WHERE label LIKE ? ESCAPE '\\'";
  const q = likePattern((c.req.query('q') ?? '').slice(0, 63));
  return c.json(await paginate(c, query, 'label', [q], (row: { label: string; reason: string; created_at: number }): ReservedName => ({
    label: row.label, reason: row.reason, createdAt: row.created_at,
  })));
});

admin.post('/reserved', async (c) => {
  const { DB } = c.env;
  const body = await readBody(c, z.object({ label: z.string().trim().toLowerCase().max(63), reason: z.string().max(200).default('') }));
  const invalid = checkLabel(body.label, 1, 63);
  if (invalid) fail(400, invalid, { min: 1, max: 63 });
  await DB.batch([
    DB.prepare('INSERT INTO reserved (label, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(label) DO UPDATE SET reason = excluded.reason')
      .bind(body.label, cleanText(body.reason, 200), now()),
    adminAudit(c, 'reserved.save', 'reserved', body.label, body.label),
  ]);
  return c.json({ ok: true });
});

admin.delete('/reserved/:label', async (c) => {
  const { DB } = c.env;
  const label = c.req.param('label');
  await DB.batch([
    DB.prepare('DELETE FROM reserved WHERE label = ?').bind(label),
    adminAudit(c, 'reserved.delete', 'reserved', label, label),
  ]);
  return c.json({ ok: true });
});

admin.get('/settings', async (c) => c.json(await getSettings(c.env.DB)));
admin.patch('/settings', async (c) => {
  const body = await readBody(c, z.object({
    registrationOpen: z.boolean(), defaultQuota: z.number().int().min(0).max(1000), dailyClaimLimit: z.number().int().min(0).max(1000),
    announcement: z.string().max(1000), contactEmail: z.union([z.literal(''), z.email()]),
  }).partial());
  await saveSettings(c.env.DB, body);
  await adminAudit(c, 'settings.update', 'settings', '', '').run();
  return c.json(await getSettings(c.env.DB));
});

admin.get('/audit', async (c) => {
  const query = "SELECT * FROM audit WHERE target_label LIKE ?1 ESCAPE '\\' OR actor_name LIKE ?1 ESCAPE '\\' OR action LIKE ?1 ESCAPE '\\'";
  const q = likePattern((c.req.query('q') ?? '').slice(0, 100));
  return c.json(await paginate(c, query, 'id DESC', [q], (row: AuditRow) => activityDto(row, false)));
});
