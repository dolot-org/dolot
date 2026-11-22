import { Hono } from 'hono';
import { z } from 'zod';
import { MAIL_BODY_CHARS, MAIL_FOLDERS, MAIL_UPLOAD_BYTES, MAIL_UPLOAD_FILES, type MailFile, type MailOperation, type MailStatus } from '../../shared/mail';
import type { AppEnv, Ctx } from '../env';
import { rateLimit } from '../lib/guard';
import { fail, readBody } from '../lib/http';
import {
  canSendMail, checkMailboxClaim, cleanupMailFiles, detail, fileName, fileType, HAS_FILES, MAIL_BYTES_LIMIT,
  MAIL_CAPACITY, mailboxClaimStmt, mailboxForUser, mailDomains, mailFiles, messageIds, summary, type MailRow,
} from '../lib/mail';
import { currentUser, pwaGuard, requireUser } from '../lib/session';
import { cleanText, isUniqueError, now, parseJson, randomId } from '../lib/util';

export const mail = new Hono<AppEnv>();
mail.use('*', requireUser, pwaGuard);

async function ownedMailbox(c: Ctx) {
  const item = await mailboxForUser(c.env.DB, currentUser(c).id);
  if (!item) fail(404, 'not_found');
  return item;
}

function getMessage(db: D1Database, mailboxId: string, id: string) {
  return db.prepare(`SELECT m.*, ${HAS_FILES} FROM mail_messages m WHERE mailbox_id = ? AND id = ?`)
    .bind(mailboxId, id).first<MailRow>();
}

function scheduleCleanup(c: Ctx) {
  c.executionCtx.waitUntil(cleanupMailFiles(c.env).catch(() => console.error('mail file cleanup failed')));
}

mail.get('/status', async (c) => {
  const mailbox = await mailboxForUser(c.env.DB, currentUser(c).id);
  const usage = mailbox && await c.env.DB.prepare(`SELECT
    coalesce(sum(folder = 'inbox' AND is_read = 0), 0) AS unread, coalesce(sum(size), 0) AS bytes
    FROM mail_messages WHERE mailbox_id = ?`).bind(mailbox.id).first<{ unread: number; bytes: number }>();
  return c.json({
    mailbox: mailbox && { address: mailbox.address }, domains: mailDomains(c.env), unread: usage?.unread ?? 0,
    canSend: !!mailbox && canSendMail(c.env, mailbox.address), bytesUsed: usage?.bytes ?? 0, bytesLimit: MAIL_BYTES_LIMIT,
  } satisfies MailStatus);
});

mail.post('/claim', async (c) => {
  const user = currentUser(c);
  const { DB } = c.env;
  await rateLimit(DB, 'mail-claim:' + user.id, 15, 3_600_000);
  const { label, domain } = await readBody(c, z.object({
    label: z.string().trim().toLowerCase().max(100), domain: z.string().trim().toLowerCase().max(253),
  }));
  const address = await checkMailboxClaim(c.env, user.id, label, domain);
  try {
    const result = await mailboxClaimStmt(DB, user.id, address, null).run();
    if (!result.meta.changes) {
      await checkMailboxClaim(c.env, user.id, label, domain);
      fail(403, 'forbidden');
    }
  } catch (error) {
    if (isUniqueError(error)) {
      await checkMailboxClaim(c.env, user.id, label, domain);
      fail(409, 'mail_taken');
    }
    throw error;
  }
  return c.json({ address }, 201);
});

mail.delete('/mailbox', async (c) => {
  const mailbox = await ownedMailbox(c);
  const { address } = await readBody(c, z.object({ address: z.string().max(254) }));
  if (address !== mailbox.address) fail(400, 'confirm_mismatch');
  const result = await c.env.DB.prepare(`UPDATE mailboxes SET user_id = NULL WHERE id = ? AND user_id = ?
    AND NOT EXISTS (SELECT 1 FROM mail_messages WHERE mailbox_id = mailboxes.id AND sending_at IS NOT NULL)`)
    .bind(mailbox.id, mailbox.user_id).run();
  if (!result.meta.changes) fail(409, 'mail_sending');
  scheduleCleanup(c);
  return c.json({ ok: true });
});

const pageSize = 25;
mail.get('/messages', async (c) => {
  const mailbox = await ownedMailbox(c);
  const { folder, q, page } = await readList(c);
  const scope = folder === 'starred' ? "AND ?2 = 'starred' AND starred = 1 AND folder <> 'trash'" : 'AND folder = ?2';
  const where = `WHERE mailbox_id = ?1 ${scope} AND (?3 = '' OR instr(lower(sender || ' ' || sender_name || ' ' ||
    recipients || ' ' || cc || ' ' || bcc || ' ' || subject || ' ' || body), lower(?3)) > 0)`;
  const [list, count] = await c.env.DB.batch<MailRow | { total: number }>([
    c.env.DB.prepare(`SELECT id, folder, sender, sender_name, recipients, subject, substr(body, 1, 200) AS body, is_read, starred,
      sending_at, created_at, ${HAS_FILES} FROM mail_messages m ${where} ORDER BY created_at DESC, id DESC LIMIT ?4 OFFSET ?5`)
      .bind(mailbox.id, folder, q, pageSize, (page - 1) * pageSize),
    c.env.DB.prepare('SELECT count(*) AS total FROM mail_messages ' + where).bind(mailbox.id, folder, q),
  ]);
  return c.json({
    items: (list.results as MailRow[]).map((row) => summary(row)), total: (count.results[0] as { total: number }).total, page, pageSize,
  });
});

function readList(c: Ctx) {
  const input = z.object({
    folder: z.enum(MAIL_FOLDERS).default('inbox'), q: z.string().trim().max(120).default(''),
    page: z.coerce.number().int().min(1).max(100).default(1),
  }).safeParse(c.req.query());
  if (!input.success) fail(400, 'bad_request');
  return input.data;
}

mail.get('/messages/:id', async (c) => {
  const mailbox = await ownedMailbox(c);
  const row = await getMessage(c.env.DB, mailbox.id, c.req.param('id'));
  if (!row) fail(404, 'not_found');
  return c.json(await detail(c.env.DB, row));
});

const OPERATIONS = ['read', 'unread', 'star', 'unstar', 'archive', 'inbox', 'trash', 'restore', 'delete'] as const satisfies readonly MailOperation[];
const assignments: Record<Exclude<MailOperation, 'delete'>, string> = {
  read: 'is_read = 1',
  unread: 'is_read = 0',
  star: 'starred = 1',
  unstar: 'starred = 0',
  archive: "folder = 'archive'",
  inbox: "folder = 'inbox'",
  trash: "restore_folder = folder, folder = 'trash', trashed_at = ?3",
  restore: 'folder = restore_folder, restore_folder = NULL, trashed_at = NULL',
};
const eligible: Partial<Record<MailOperation, string>> = {
  archive: "folder = 'inbox'",
  inbox: "folder = 'archive'",
  trash: "folder <> 'trash'",
  restore: "folder = 'trash' AND restore_folder IS NOT NULL",
};

mail.patch('/messages', async (c) => {
  const mailbox = await ownedMailbox(c);
  const { ids, operation } = await readBody(c, z.object({
    ids: z.array(z.string().max(64)).min(1).max(pageSize), operation: z.enum(OPERATIONS),
  }));
  const match = 'mailbox_id = ?1 AND id IN (SELECT value FROM json_each(?2)) AND sending_at IS NULL';
  const values = [mailbox.id, JSON.stringify(ids)];
  const db = c.env.DB;
  if (operation === 'delete') {
    await db.prepare(`DELETE FROM mail_messages WHERE ${match} AND folder = 'trash'`).bind(...values).run();
    scheduleCleanup(c);
  } else {
    const condition = eligible[operation];
    await db.prepare(`UPDATE mail_messages SET ${assignments[operation]} WHERE ${match}${condition ? ' AND ' + condition : ''}`)
      .bind(...values, ...(operation === 'trash' ? [now()] : [])).run();
  }
  return c.json({ ok: true });
});

mail.get('/messages/:id/files/:file', async (c) => {
  const mailbox = await ownedMailbox(c);
  const row = await c.env.DB.prepare(`SELECT f.id, f.name FROM mail_files f JOIN mail_messages m ON m.id = f.message_id
    WHERE m.mailbox_id = ? AND m.id = ? AND f.id = ?`).bind(mailbox.id, c.req.param('id'), c.req.param('file')).first<MailFile>();
  if (!row) fail(404, 'not_found');
  const object = await c.env.MAIL_FILES?.get(c.req.param('id') + '/' + row.id);
  if (!object) fail(404, 'not_found');
  return new Response(object.body, { headers: {
    'Content-Type': 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(row.name).replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16)),
    'Content-Length': String(object.size), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
});

const draftInput = z.object({
  version: z.string().max(64).optional(),
  to: z.array(z.string().max(254)).max(20), cc: z.array(z.string().max(254)).max(20), bcc: z.array(z.string().max(254)).max(20),
  subject: z.string().max(500), body: z.string().max(MAIL_BODY_CHARS),
  originalId: z.string().max(64).optional(),
  keep: z.array(z.string().max(64)).max(MAIL_UPLOAD_FILES),
  files: z.array(z.object({
    name: z.string().max(255), type: z.string().max(128), content: z.string().max(Math.ceil(MAIL_UPLOAD_BYTES / 3) * 4),
  })).max(MAIL_UPLOAD_FILES),
});
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

mail.put('/drafts/:id', async (c) => {
  const mailbox = await ownedMailbox(c);
  const { DB, MAIL_FILES } = c.env;
  const id = c.req.param('id');
  if (!z.uuid().safeParse(id).success) fail(400, 'bad_request');
  const input = await readBody(c, draftInput);
  const old = await getMessage(DB, mailbox.id, id);
  if (old?.sending_at != null) fail(409, 'mail_sending');
  if (old ? old.folder !== 'drafts' || old.version !== input.version : input.version !== undefined) fail(409, 'mail_conflict');
  if (input.keep.length + input.files.length > MAIL_UPLOAD_FILES) fail(400, 'mail_files_limit');
  const previousFiles = old ? (await mailFiles(DB, id)).results : [];
  const kept = previousFiles.filter((file) => input.keep.includes(file.id));
  if (kept.length !== input.keep.length) fail(409, 'mail_conflict');

  const total = kept.reduce((sum, file) => sum + file.size, 0);
  const encodedLimit = Math.ceil((MAIL_UPLOAD_BYTES - total) / 3) * 4 + 4 * input.files.length;
  if (input.files.reduce((sum, file) => sum + file.content.length, 0) > encodedLimit) fail(400, 'mail_files_limit');
  const added = input.files.map((file) => {
    let decoded: string;
    try { decoded = atob(file.content); } catch { return fail(400, 'bad_request'); }
    const content = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    return { id: randomId(), type: fileType(file.type), name: fileName(file.name), size: content.byteLength, content };
  });
  const size = total + added.reduce((sum, file) => sum + file.size, 0);
  if (size > MAIL_UPLOAD_BYTES) fail(400, 'mail_files_limit');
  if (added.length && !MAIL_FILES) fail(409, 'mail_unavailable');

  const original = !old && input.originalId ? await getMessage(DB, mailbox.id, input.originalId) : null;
  const replyId = old?.reply_id ?? messageIds(original?.message_id ?? '')[0] ?? '';
  const refs = old?.refs ?? messageIds((original?.refs ?? '') + ' ' + replyId).join(' ');
  const version = randomId();
  const fields = [id, mailbox.id, mailbox.user_id, size + bytes(input.body + input.subject), mailbox.address,
    JSON.stringify(input.to), JSON.stringify(input.cc), JSON.stringify(input.bcc), cleanText(input.subject, 500),
    input.body, replyId, refs, now(), version];
  const write = old
    ? DB.prepare(`UPDATE mail_messages SET sender = ?5, recipients = ?6, cc = ?7, bcc = ?8, subject = ?9, body = ?10,
      reply_id = ?11, refs = ?12, created_at = ?13, version = ?14, size = ?4
      WHERE id = ?1 AND mailbox_id = ?2 AND version = ?15 AND folder = 'drafts' AND sending_at IS NULL
      AND EXISTS (SELECT 1 FROM mailboxes WHERE id = ?2 AND user_id = ?3)
      AND ?4 + (SELECT coalesce(sum(size), 0) FROM mail_messages WHERE mailbox_id = ?2 AND id <> ?1) <= ${MAIL_BYTES_LIMIT}`)
      .bind(...fields, old.version)
    : DB.prepare(`INSERT INTO mail_messages (id, mailbox_id, folder, sender, recipients, cc, bcc, subject, body,
        reply_id, refs, created_at, version, size, is_read)
      SELECT ?1, ?2, 'drafts', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?4, 1 WHERE ${MAIL_CAPACITY}`).bind(...fields);
  const removed = previousFiles.filter((file) => !input.keep.includes(file.id));

  try {
    if (MAIL_FILES) for (const file of added) await MAIL_FILES.put(id + '/' + file.id, file.content);
    const [result] = await DB.batch([
      write,
      ...added.map((file) => DB.prepare(`INSERT INTO mail_files (id, message_id, name, type, size)
        SELECT ?1, ?2, ?3, ?4, ?5 FROM mail_messages WHERE id = ?2 AND version = ?6 AND mailbox_id = ?7`)
        .bind(file.id, id, file.name, file.type, file.size, version, mailbox.id)),
      ...(removed.length ? [DB.prepare(`DELETE FROM mail_files WHERE message_id = ?1 AND id IN (SELECT value FROM json_each(?2))
        AND EXISTS (SELECT 1 FROM mail_messages WHERE id = ?1 AND version = ?3 AND mailbox_id = ?4)`)
        .bind(id, JSON.stringify(removed.map((file) => file.id)), version, mailbox.id)] : []),
    ]);
    if (!result.meta.changes) {
      const latest = await getMessage(DB, mailbox.id, id);
      if (latest?.version !== old?.version || latest?.folder === 'trash' || latest?.sending_at != null) fail(409, 'mail_conflict');
      fail(409, 'mail_full');
    }
  } catch (error) {
    if (MAIL_FILES && added.length) await MAIL_FILES.delete(added.map((file) => id + '/' + file.id));
    if (isUniqueError(error)) fail(409, 'mail_conflict');
    throw error;
  }
  if (removed.length) scheduleCleanup(c);
  const row = await getMessage(DB, mailbox.id, id);
  if (!row) fail(404, 'not_found');
  return c.json(await detail(DB, row));
});

mail.post('/drafts/:id/send', async (c) => {
  const mailbox = await ownedMailbox(c);
  const { DB, MAIL_SENDER, MAIL_FILES } = c.env;
  const id = c.req.param('id');
  const row = await getMessage(DB, mailbox.id, id);
  if (!row || (row.folder !== 'drafts' && row.folder !== 'sent')) fail(404, 'not_found');
  if (row.folder === 'sent') return c.json({ ok: true });
  if (row.sending_at !== null) fail(409, 'mail_sending');
  if (!MAIL_SENDER || !canSendMail(c.env, mailbox.address)) fail(409, 'mail_send_disabled');
  const { version } = await readBody(c, z.object({ version: z.string().max(64) }));
  const seen = new Set<string>();
  const [to, cc, bcc] = [row.recipients, row.cc, row.bcc].map((field) => parseJson<string[]>(field, []).filter((address) => {
    if (!z.email().safeParse(address).success) fail(400, 'mail_recipient');
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
  if (!seen.size || seen.size > 20) fail(400, 'mail_recipient');
  if (!row.body.trim()) fail(400, 'mail_body_required');
  await rateLimit(DB, 'mail-send:' + mailbox.user_id, 25, 3_600_000);
  const sendingAt = now();
  const lock = await DB.prepare(`UPDATE mail_messages SET sending_at = ?1 WHERE id = ?2 AND mailbox_id = ?3
    AND version = ?4 AND folder = 'drafts' AND sending_at IS NULL
    AND EXISTS (SELECT 1 FROM mailboxes m JOIN users u ON u.id = m.user_id WHERE m.id = ?3 AND u.status = 'active')`)
    .bind(sendingAt, id, mailbox.id, version).run();
  if (!lock.meta.changes) fail(409, 'mail_conflict');

  let result: { messageId: string };
  try {
    const attachments: NonNullable<Parameters<typeof MAIL_SENDER.send>[0]['attachments']> = [];
    for (const file of (await mailFiles(DB, id)).results) {
      const object = await MAIL_FILES?.get(id + '/' + file.id);
      if (!object) throw new Error('Missing attachment');
      const data = new Uint8Array(await object.arrayBuffer());
      let binary = '';
      for (let index = 0; index < data.length; index += 8192) binary += String.fromCharCode(...data.subarray(index, index + 8192));
      attachments.push({ content: btoa(binary), filename: file.name, type: file.type, disposition: 'attachment' });
    }
    result = await MAIL_SENDER.send({
      from: mailbox.address, subject: row.subject, text: row.body,
      to: to.length ? to : undefined, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined,
      attachments: attachments.length ? attachments : undefined,
      headers: row.reply_id ? { 'In-Reply-To': row.reply_id, References: row.refs } : undefined,
    });
  } catch {
    await DB.prepare('UPDATE mail_messages SET sending_at = NULL WHERE id = ? AND sending_at = ?').bind(id, sendingAt).run();
    fail(502, 'mail_send_failed');
  }
  await DB.prepare(`UPDATE mail_messages SET folder = 'sent', sending_at = NULL, message_id = ?, created_at = ?
    WHERE id = ? AND sending_at = ?`).bind(result.messageId, now(), id, sendingAt).run();
  return c.json({ ok: true });
});
