import { Hono } from 'hono';
import { z } from 'zod';
import { cleanHost, isHostname, normalizeRecord, RECORD_TYPES, recordValue, zoneLine } from '../../shared/dns';
import { formatMessage } from '../../shared/messages';
import type { Availability, ResolveResult, SubdomainDetail, TransferPreview, TransferTicket } from '../../shared/types';
import type { AppEnv, Ctx } from '../env';
import { activityDto, auditStmt, type AuditRow } from '../lib/audit';
import { cf, dnsMode, dnsProvider } from '../lib/cloudflare';
import { withDomainLock } from '../lib/domain-lock';
import { checkName, getRoot, getSubJoined, recordRules, renewInfo, rootDto, subDto, SUB_SELECT, userQuota, type RootRow, type SubJoined } from '../lib/domains';
import { rateLimit } from '../lib/guard';
import { fail, readBody } from '../lib/http';
import { checkMailboxClaim, mailboxClaimStmt } from '../lib/mail';
import { extraData, findConflict, listRecordRows, publishRecords, recordDto, removeSubdomain, rowFields, toPayload } from '../lib/records';
import { currentUser, pwaGuard, requireUser } from '../lib/session';
import { DOMAIN_LIMIT_SQL, domainCapacity, getSettings } from '../lib/settings';
import { canonicalCode, cleanText, clientIp, DAY, groupCode, isUniqueError, now, randomId, sha256Hex, transferCode } from '../lib/util';

export const domains = new Hono<AppEnv>();
export const transfers = new Hono<AppEnv>();
const claimInput = z.object({ rootId: z.string().max(100), label: z.string().trim().toLowerCase().max(100), note: z.string().max(200).default('') });
const createClaimInput = claimInput.extend({ mailbox: z.boolean().optional() });
const transferInput = z.object({ code: z.string().max(40) });
const recordInput = z.object({
  type: z.enum(RECORD_TYPES), host: z.string().max(254), content: z.string().max(2048), ttl: z.number(),
  proxied: z.boolean().optional(), priority: z.number().nullish(), weight: z.number().nullish(),
  port: z.number().nullish(), flags: z.number().nullish(), tag: z.string().nullish(), comment: z.string().max(100).optional(),
});

async function owned(c: Ctx, id: string) {
  const sub = await getSubJoined(c.env.DB, id);
  if (!sub || sub.user_id !== currentUser(c).id) fail(404, 'not_found');
  const root = await getRoot(c.env.DB, sub.root_id);
  if (!root) fail(404, 'not_found');
  return { sub, root };
}

function isActive(sub: SubJoined, t = now()) {
  return sub.status === 'active' && (sub.expires_at === null || sub.expires_at > t);
}

function canEdit(sub: SubJoined) {
  if (sub.status === 'suspended') fail(409, 'subdomain_suspended');
  if (sub.status !== 'pending' && !isActive(sub)) fail(409, 'subdomain_expired');
}

function subAudit(c: Ctx, sub: SubJoined, action: string, detail: Record<string, unknown> = {}) {
  return auditStmt(c.env.DB, { actor: currentUser(c), action, targetType: 'subdomain', targetId: sub.id, targetLabel: sub.fqdn, detail, ip: clientIp(c) });
}

domains.get('/check', async (c) => {
  await rateLimit(c.env.DB, 'check:' + clientIp(c), 90, 60_000);
  const input = claimInput.safeParse(c.req.query());
  if (!input.success) fail(400, 'bad_request');
  const root = await getRoot(c.env.DB, input.data.rootId);
  if (!root) fail(404, 'not_found');
  const label = input.data.label;
  const check = await checkName(c.env.DB, root, label);
  let code = check.code ?? (root.status === 'active' ? null : 'root_unavailable');
  if (!code) {
    const capacity = await domainCapacity(c.env.DB);
    if (capacity && capacity.assigned >= capacity.limit) code = 'domain_capacity_reached';
  }
  return c.json({
    fqdn: label + '.' + root.domain, available: code === null, code,
    message: code ? formatMessage(code, c.get('lang'), check.params) : null,
    registeredAt: check.registeredAt,
  } satisfies Availability);
});

const dnsNumbers: Record<number, string> = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 257: 'CAA' };
domains.get('/resolve', async (c) => {
  const { DB } = c.env;
  await rateLimit(DB, 'resolve:' + clientIp(c), 40, 60_000);
  const name = cleanHost(c.req.query('name') ?? '');
  const type = z.enum(RECORD_TYPES).safeParse(c.req.query('type') ?? 'A');
  if (!isHostname(name) || !type.success) fail(400, 'bad_request');
  const root = await DB.prepare("SELECT id FROM roots WHERE domain = ?1 OR substr(?1, -(length(domain) + 1)) = '.' || domain")
    .bind(name).first();
  if (!root) fail(400, 'resolve_scope');
  if (dnsMode(c.env) === 'mock') {
    const { results } = await DB.prepare('SELECT name, type, ttl, content, priority, data, proxied FROM records WHERE name = ? AND (type = ? OR type = ?) AND cf_id IS NOT NULL')
      .bind(name, type.data, 'CNAME').all<Parameters<typeof rowFields>[0]>();
    return c.json({ name, type: type.data, status: 0, answers: results.map((row) => ({
      name: row.name, type: row.type, ttl: row.ttl === 1 ? 300 : row.ttl, data: recordValue(rowFields(row)),
    })) } satisfies ResolveResult);
  }
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.search = new URLSearchParams({ name, type: type.data }).toString();
  const result = await cf(async () => {
    const response = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('DNS resolver returned ' + response.status);
    return response.json<{ Status: number; Answer?: { name: string; type: number; TTL: number; data: string }[] }>();
  });
  return c.json({
    name, type: type.data, status: result.Status,
    answers: (result.Answer ?? []).map((a) => ({ name: a.name, type: dnsNumbers[a.type] ?? String(a.type), ttl: a.TTL, data: a.data })),
  } satisfies ResolveResult);
});

domains.use('*', requireUser, pwaGuard);

domains.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(SUB_SELECT + ' WHERE s.user_id = ? ORDER BY s.created_at DESC')
    .bind(currentUser(c).id).all<SubJoined>();
  return c.json(results.map(subDto));
});

domains.post('/', async (c) => {
  const user = currentUser(c);
  const { DB } = c.env;
  const body = await readBody(c, createClaimInput);
  const [root, settings] = await Promise.all([getRoot(DB, body.rootId), getSettings(DB)]);
  if (!root || root.status !== 'active') fail(400, 'root_unavailable');
  const check = await checkName(DB, root, body.label);
  if (check.code) fail(409, check.code, check.params);
  const address = body.mailbox ? await checkMailboxClaim(c.env, user.id, body.label, root.domain) : null;
  const fqdn = body.label + '.' + root.domain;
  const t = now();
  const id = randomId();
  const day = t - (t % DAY);
  const { quota } = await userQuota(DB, user, settings);
  try {
    const claim = DB.prepare(
      `INSERT INTO subdomains (id, root_id, label, fqdn, user_id, status, note, created_at, updated_at, expires_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9
       WHERE EXISTS (SELECT 1 FROM roots WHERE id = ?2 AND status = 'active')
       AND EXISTS (SELECT 1 FROM users WHERE id = ?5 AND status = 'active')
       AND NOT EXISTS (SELECT 1 FROM reserved WHERE label = ?3)
       AND (SELECT COUNT(*) FROM subdomains WHERE user_id = ?5) < ?10
       AND (SELECT COUNT(*) FROM subdomains) < ${DOMAIN_LIMIT_SQL}
       AND (?11 = 0 OR (SELECT COUNT(*) FROM audit WHERE actor_id = ?5 AND action = 'subdomain.claim' AND created_at >= ?12) < ?11)`,
    ).bind(id, root.id, body.label, fqdn, user.id, root.require_review ? 'pending' : 'active', cleanText(body.note, 200), t,
      root.require_review || !root.term_days ? null : t + root.term_days * DAY, quota,
      user.role === 'admin' ? 0 : settings.dailyClaimLimit, day);
    const claimAudit = DB.prepare(
      "INSERT INTO audit (actor_id, actor_name, action, target_type, target_id, target_label, ip, created_at) SELECT ?, ?, 'subdomain.claim', 'subdomain', id, fqdn, ?, ? FROM subdomains WHERE id = ?",
    ).bind(user.id, user.username, clientIp(c), t, id);
    const [inserted] = await DB.batch(address
      ? [claim, mailboxClaimStmt(DB, user.id, address, id), claimAudit]
      : [claim, claimAudit]);
    if (!inserted.meta.changes) {
      const latest = await userQuota(DB, user, settings);
      if (latest.used >= latest.quota) fail(409, 'quota_reached', { quota: latest.quota });
      const checkedAgain = await checkName(DB, root, body.label);
      if (checkedAgain.code) fail(409, checkedAgain.code, checkedAgain.params);
      if ((await getRoot(DB, root.id))?.status !== 'active') fail(409, 'root_unavailable');
      const capacity = await domainCapacity(DB);
      if (capacity && capacity.assigned >= capacity.limit) fail(409, 'domain_capacity_reached');
      fail(429, 'claim_limit');
    }
  } catch (e) {
    if (isUniqueError(e)) {
      if (address) await checkMailboxClaim(c.env, user.id, body.label, root.domain);
      fail(409, 'label_taken');
    }
    throw e;
  }
  const sub = await getSubJoined(DB, id);
  if (!sub) fail(404, 'not_found');
  return c.json(subDto(sub), 201);
});

domains.get('/:id', async (c) => {
  const { sub, root } = await owned(c, c.req.param('id'));
  const records = await listRecordRows(c.env.DB, sub.id);
  const renewal = renewInfo(sub, root, now());
  return c.json({
    subdomain: subDto(sub), root: rootDto(root), records: records.map((row) => recordDto(row, sub.fqdn)),
    renewable: renewal.renewable, renewOpensAt: renewal.opensAt, purgeAt: renewal.purgeAt,
  } satisfies SubdomainDetail);
});

domains.get('/:id/activity', async (c) => {
  const { sub } = await owned(c, c.req.param('id'));
  const { results } = await c.env.DB.prepare("SELECT * FROM audit WHERE target_type = 'subdomain' AND target_id = ? ORDER BY id DESC LIMIT 100")
    .bind(sub.id).all<AuditRow>();
  return c.json(results.map((row) => activityDto(row, true)));
});

domains.get('/:id/zone', async (c) => {
  const { sub } = await owned(c, c.req.param('id'));
  const records = await listRecordRows(c.env.DB, sub.id);
  return c.text(records.map((row) => zoneLine(rowFields(row))).join('\n') + '\n', 200, { 'Content-Disposition': 'attachment; filename="' + sub.fqdn + '.zone"' });
});

domains.patch('/:id', (c) => withDomainLock(c.env.DB, c.req.param('id'), async () => {
  const { sub } = await owned(c, c.req.param('id'));
  const body = await readBody(c, z.object({ note: z.string().max(200) }));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE subdomains SET note = ?, updated_at = ? WHERE id = ?').bind(cleanText(body.note, 200), now(), sub.id),
    subAudit(c, sub, 'subdomain.note'),
  ]);
  return c.json({ ok: true });
}));

domains.post('/:id/renew', (c) => withDomainLock(c.env.DB, c.req.param('id'), async () => {
  const { sub, root } = await owned(c, c.req.param('id'));
  if (!root.term_days || sub.expires_at === null) fail(409, 'renew_not_needed');
  const t = now();
  if (!renewInfo(sub, root, t).renewable || sub.status === 'pending') fail(409, 'renew_not_open');
  const expiration = Math.max(sub.expires_at, t) + root.term_days * DAY;
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE subdomains SET status = 'active', status_reason = '', expires_at = ?, updated_at = ? WHERE id = ?")
      .bind(expiration, t, sub.id),
    subAudit(c, sub, 'subdomain.renew'),
  ]);
  return c.json({ expiresAt: expiration, ...await publishRecords(c.env, root, sub) });
}));

domains.delete('/:id', (c) => withDomainLock(c.env.DB, c.req.param('id'), async () => {
  const { sub, root } = await owned(c, c.req.param('id'));
  const body = await readBody(c, z.object({ confirm: z.string().max(254) }));
  if (body.confirm !== sub.fqdn) fail(400, 'confirm_mismatch');
  await removeSubdomain(c.env, root, sub, currentUser(c), 'subdomain.release', {}, clientIp(c));
  return c.json({ ok: true });
}));

domains.post('/:id/transfer', (c) => withDomainLock(c.env.DB, c.req.param('id'), async () => {
  const { sub } = await owned(c, c.req.param('id'));
  if (!isActive(sub)) fail(409, 'transfer_blocked');
  const code = transferCode();
  const expiresAt = now() + DAY;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE subdomains SET transfer_code = ?, transfer_expires_at = ?, updated_at = ? WHERE id = ?')
      .bind(await sha256Hex(code), expiresAt, now(), sub.id),
    subAudit(c, sub, 'subdomain.transfer.create'),
  ]);
  return c.json({ code: groupCode(code), expiresAt } satisfies TransferTicket);
}));

domains.delete('/:id/transfer', (c) => withDomainLock(c.env.DB, c.req.param('id'), async () => {
  const { sub } = await owned(c, c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE subdomains SET transfer_code = NULL, transfer_expires_at = NULL, updated_at = ? WHERE id = ?').bind(now(), sub.id),
    subAudit(c, sub, 'subdomain.transfer.cancel'),
  ]);
  return c.json({ ok: true });
}));

async function saveRecord(c: Ctx, sub: SubJoined, root: RootRow, recordId?: string) {
  canEdit(sub);
  const parsed = normalizeRecord(await readBody(c, recordInput), sub.fqdn, recordRules(root));
  if (!parsed.ok) fail(400, parsed.code, parsed.params);
  const value = parsed.value;
  const { DB } = c.env;
  const records = await listRecordRows(DB, sub.id);
  const previous = records.find((row) => row.id === recordId);
  if (recordId && !previous) fail(404, 'not_found');
  if (!previous && records.length >= root.max_records) fail(409, 'records_limit', { max: root.max_records });
  const conflict = findConflict(records, value, recordId);
  if (conflict) fail(409, conflict);
  const id = previous?.id ?? randomId();
  const t = now();
  const dns = isActive(sub) ? dnsProvider(c.env) : null;
  let cfId = previous?.cf_id ?? null;
  if (dns) {
    if (cfId) {
      const existingId = cfId;
      await cf(() => dns.updateRecord(root.zone_id, existingId, toPayload(value, sub.id)));
    } else {
      cfId = await cf(() => dns.createRecord(root.zone_id, toPayload(value, sub.id)));
    }
  }
  try {
    const row = await DB.prepare(
      `INSERT INTO records (id, subdomain_id, cf_id, type, name, content, ttl, proxied, priority, data, comment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET cf_id = excluded.cf_id, type = excluded.type, name = excluded.name, content = excluded.content,
       ttl = excluded.ttl, proxied = excluded.proxied, priority = excluded.priority, data = excluded.data, comment = excluded.comment, updated_at = excluded.updated_at
       RETURNING *`,
    ).bind(id, sub.id, cfId, value.type, value.name, value.content, value.ttl, +value.proxied,
      value.priority, extraData(value), value.comment, previous?.created_at ?? t, t).first<Parameters<typeof recordDto>[0]>();
    if (!row) fail(500, 'internal');
    await subAudit(c, sub, previous ? 'record.update' : 'record.create', { type: value.type, name: value.name }).run().catch((error: unknown) => console.error('record audit', error));
    return c.json(recordDto(row, sub.fqdn), previous ? 200 : 201);
  } catch (error) {
    if (dns && cfId) {
      const repair = previous?.cf_id
        ? dns.updateRecord(root.zone_id, cfId, toPayload(rowFields(previous), sub.id))
        : dns.deleteRecord(root.zone_id, cfId);
      await repair.catch((cause: unknown) => console.error('record rollback', sub.id, cause));
    }
    throw error;
  }
}

domains.post('/:id/records', (c) => withDomainLock(c.env.DB, c.req.param('id'), async () => {
  const { sub, root } = await owned(c, c.req.param('id'));
  return saveRecord(c, sub, root);
}));

domains.patch('/:id/records/:recordId', (c) => withDomainLock(c.env.DB, c.req.param('id'), async () => {
  const { sub, root } = await owned(c, c.req.param('id'));
  return saveRecord(c, sub, root, c.req.param('recordId'));
}));

domains.delete('/:id/records/:recordId', (c) => withDomainLock(c.env.DB, c.req.param('id'), async () => {
  const { sub, root } = await owned(c, c.req.param('id'));
  canEdit(sub);
  const { DB } = c.env;
  const row = (await listRecordRows(DB, sub.id)).find((r) => r.id === c.req.param('recordId'));
  if (!row) fail(404, 'not_found');
  if (row.cf_id) {
    const id = row.cf_id;
    await cf(() => dnsProvider(c.env).deleteRecord(root.zone_id, id));
  }
  await DB.batch([
    DB.prepare('DELETE FROM records WHERE id = ? AND subdomain_id = ?').bind(row.id, sub.id),
    subAudit(c, sub, 'record.delete', { type: row.type, name: row.name }),
  ]);
  return c.json({ ok: true });
}));

transfers.use('*', requireUser, pwaGuard);
async function transferLookup(c: Ctx) {
  await rateLimit(c.env.DB, 'transfer:' + currentUser(c).id, 30, 3_600_000);
  const body = await readBody(c, transferInput);
  const code = canonicalCode(body.code);
  if (code.length !== 12) fail(404, 'transfer_invalid');
  const hash = await sha256Hex(code);
  const sub = await c.env.DB.prepare(SUB_SELECT + ' WHERE s.transfer_code = ? AND s.transfer_expires_at > ?')
    .bind(hash, now()).first<SubJoined>();
  if (!sub) fail(404, 'transfer_invalid');
  if (!isActive(sub)) fail(409, 'transfer_blocked');
  if (sub.user_id === currentUser(c).id) fail(409, 'transfer_self');
  return { sub, hash };
}

transfers.post('/lookup', async (c) => {
  const { sub } = await transferLookup(c);
  const owner = await c.env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(sub.user_id).first<{ username: string }>();
  return c.json({ fqdn: sub.fqdn, fromName: owner?.username ?? '', expiresAt: sub.expires_at, recordCount: sub.record_count } satisfies TransferPreview);
});

transfers.post('/accept', async (c) => {
  const { sub, hash } = await transferLookup(c);
  const { DB } = c.env;
  const user = currentUser(c);
  return withDomainLock(DB, sub.id, async () => {
    const { quota, used } = await userQuota(DB, user, await getSettings(DB));
    if (used >= quota) fail(409, 'quota_reached', { quota });
    const t = now();
    const result = await DB.prepare(
      `UPDATE subdomains SET user_id = ?1, transfer_code = NULL, transfer_expires_at = NULL, updated_at = ?2
       WHERE id = ?3 AND user_id = ?4 AND transfer_code = ?5 AND transfer_expires_at > ?2 AND status = 'active'
       AND (expires_at IS NULL OR expires_at > ?2)
       AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND status = 'active')
       AND (SELECT COUNT(*) FROM subdomains WHERE user_id = ?1) < ?6`,
    ).bind(user.id, t, sub.id, sub.user_id, hash, quota).run();
    if (!result.meta.changes) {
      const latest = await userQuota(DB, user, await getSettings(DB));
      if (latest.used >= latest.quota) fail(409, 'quota_reached', { quota: latest.quota });
      fail(409, 'transfer_invalid');
    }
    await subAudit(c, sub, 'subdomain.transfer.accept').run();
    return c.json({ id: sub.id });
  });
});
