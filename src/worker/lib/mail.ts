import PostalMime, { type Address } from 'postal-mime';
import { checkLabel, isHostname } from '../../shared/dns';
import type { MailDetail, MailFile, MailSummary, StoredMailFolder } from '../../shared/mail';
import type { Env } from '../env';
import { fail } from './http';
import { cleanText, DAY, now, parseJson, randomId, sha256Hex } from './util';

export const MAIL_BYTES_LIMIT = 100 * 1024 * 1024;
const INBOUND_BYTES_LIMIT = 12 * 1024 * 1024;
const MAIL_MESSAGES_LIMIT = 1_000;

export interface MailSender {
  send(message: {
    from: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    text: string;
    headers?: Record<string, string>;
    attachments?: { content: string; filename: string; type: string; disposition: 'attachment' }[];
  }): Promise<{ messageId: string }>;
}

export interface MailboxRow {
  id: string;
  address: string;
  user_id: string;
}

export interface MailRow {
  id: string;
  mailbox_id: string;
  folder: StoredMailFolder;
  sender: string;
  sender_name: string;
  recipients: string;
  cc: string;
  bcc: string;
  reply_to: string;
  subject: string;
  body: string;
  html: string;
  message_id: string;
  reply_id: string;
  refs: string;
  is_read: number;
  starred: number;
  created_at: number;
  sending_at: number | null;
  version: string;
  has_files: number;
}

export const HAS_FILES = 'EXISTS (SELECT 1 FROM mail_files f WHERE f.message_id = m.id) AS has_files';

export function mailDomains(env: Env) {
  if (!env.MAIL_FILES) return [];
  return [...new Set((env.MAIL_DOMAINS ?? '').toLowerCase().split(',').map((part) => part.trim()).filter(isHostname))];
}

export function canSendMail(env: Env, address: string) {
  const domain = address.split('@')[1];
  return !!env.MAIL_SENDER && mailDomains(env).includes(domain)
    && (env.MAIL_SEND_DOMAINS ?? '').toLowerCase().split(',').some((part) => part.trim() === domain);
}

export function mailboxForUser(db: D1Database, userId: string) {
  return db.prepare('SELECT id, address, user_id FROM mailboxes WHERE user_id = ?').bind(userId).first<MailboxRow>();
}

export async function checkMailboxClaim(env: Env, userId: string, label: string, domain: string) {
  if (!mailDomains(env).includes(domain)) fail(409, 'mail_unavailable');
  const problem = checkLabel(label, 3, 63);
  if (problem) fail(400, problem, { min: 3, max: 63 });
  const address = label + '@' + domain;
  if (address.length > 254) fail(400, 'mail_unavailable');
  const [existing, taken, reserved] = await Promise.all([
    mailboxForUser(env.DB, userId),
    env.DB.prepare('SELECT 1 FROM mailboxes WHERE address = ?').bind(address).first(),
    env.DB.prepare('SELECT 1 FROM reserved WHERE label = ?').bind(label).first(),
  ]);
  if (existing) fail(409, 'mail_already_claimed');
  if (taken) fail(409, 'mail_taken');
  if (reserved) fail(409, 'label_reserved');
  return address;
}

export function mailboxClaimStmt(db: D1Database, userId: string, address: string, domainClaimId: string | null) {
  return db.prepare(`INSERT INTO mailboxes (id, address, user_id, created_at)
    SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?3 AND status = 'active')
    AND NOT EXISTS (SELECT 1 FROM reserved WHERE label = substr(?2, 1, instr(?2, '@') - 1))
    AND (?5 IS NULL OR EXISTS (SELECT 1 FROM subdomains WHERE id = ?5))`)
    .bind(randomId(), address, userId, now(), domainClaimId);
}

export function fileName(name: string) {
  return cleanText(name, 200).replaceAll(/[/\\:*?"<>|]/g, '_').trim() || 'attachment';
}

export function fileType(type: string) {
  return /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream';
}

export function mailFiles(db: D1Database, id: string) {
  return db.prepare('SELECT id, name, type, size FROM mail_files WHERE message_id = ? ORDER BY rowid').bind(id).all<MailFile>();
}

export function summary(row: MailRow, snippet = row.body.slice(0, 200)): MailSummary {
  return {
    id: row.id, folder: row.folder, sender: row.sender, senderName: row.sender_name,
    to: parseJson<string[]>(row.recipients, []), subject: row.subject, snippet: snippet.replace(/\s+/g, ' ').trim(),
    read: !!row.is_read, starred: !!row.starred, hasFiles: !!row.has_files,
    sending: row.sending_at !== null, createdAt: row.created_at,
  };
}

export async function detail(db: D1Database, row: MailRow): Promise<MailDetail> {
  return {
    ...summary(row), cc: parseJson<string[]>(row.cc, []), bcc: parseJson<string[]>(row.bcc, []),
    replyTo: parseJson<string[]>(row.reply_to, []), body: row.body, html: row.html, version: row.version,
    files: (await mailFiles(db, row.id)).results,
  };
}

// Use the same gate for inbound mail and new drafts. The bound parameters are mailbox, owner and bytes.
export const MAIL_CAPACITY = `EXISTS (SELECT 1 FROM mailboxes x JOIN users u ON u.id = x.user_id
    WHERE x.id = ?2 AND u.id = ?3 AND u.status = 'active')
  AND (SELECT count(*) FROM mail_messages WHERE mailbox_id = ?2) < ${MAIL_MESSAGES_LIMIT}
  AND ?4 + (SELECT coalesce(sum(size), 0) FROM mail_messages WHERE mailbox_id = ?2) <= ${MAIL_BYTES_LIMIT}`;

export async function cleanupMailFiles(env: Env) {
  if (!env.MAIL_FILES) return;
  const { results } = await env.DB.prepare('SELECT key FROM mail_file_cleanup LIMIT 90').all<{ key: string }>();
  if (!results.length) return;
  const keys = results.map((row) => row.key);
  await env.MAIL_FILES.delete(keys);
  await env.DB.prepare('DELETE FROM mail_file_cleanup WHERE key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).run();
}

export async function purgeMail(env: Env) {
  await env.DB.prepare(`DELETE FROM mail_messages WHERE id IN (
    SELECT id FROM mail_messages WHERE folder = 'trash' AND trashed_at < ? ORDER BY trashed_at LIMIT 100
  )`).bind(now() - 30 * DAY).run();
  await cleanupMailFiles(env);
}

function addresses(list: Address[] | undefined): string[] {
  return (list ?? []).flatMap((item) => 'group' in item && item.group ? addresses(item.group) : item.address ? [item.address.slice(0, 254)] : [])
    .slice(0, 50);
}

export function messageIds(value: string) {
  return (value.match(/<[^<>\s@]+@[^<>\s@]+>/g) ?? []).filter((id) => /^[!-~]+$/.test(id) && id.length <= 255).slice(-15);
}

async function plainMailText(html: string) {
  let text = '';
  await new HTMLRewriter()
    .on('head, script, style, template', { element: (element) => { element.remove(); } })
    .on('br', { element: () => { text += '\n'; } })
    .on('p, div, li, tr, blockquote', { element: (element) => {
      text += '\n';
      element.onEndTag(() => { text += '\n'; });
    } })
    .onDocument({ text: (chunk) => { text += chunk.text; } })
    .transform(new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })).arrayBuffer();
  return text.trim();
}

export async function receiveMail(message: ForwardableEmailMessage, env: Env) {
  const bucket = env.MAIL_FILES;
  const address = message.to.toLowerCase();
  const domain = address.split('@')[1];
  if (!bucket || !mailDomains(env).includes(domain)) return message.setReject('Mailbox unavailable');
  if (message.rawSize > INBOUND_BYTES_LIMIT) return message.setReject('Message exceeds the 12 MiB limit');

  const mailbox = await env.DB.prepare(`SELECT m.id, m.address, m.user_id FROM mailboxes m
    JOIN users u ON u.id = m.user_id WHERE m.address = ? AND u.status = 'active'`).bind(address).first<MailboxRow>();
  if (!mailbox) return message.setReject('Mailbox unavailable');

  const raw = await new Response(message.raw).arrayBuffer();
  const digest = await sha256Hex(raw);
  const duplicate = () => env.DB.prepare('SELECT 1 FROM mail_messages WHERE mailbox_id = ? AND inbound_digest = ?')
    .bind(mailbox.id, digest).first();
  if (await duplicate()) return;
  const parsed = await PostalMime.parse(raw, { maxNestingDepth: 32, maxHeadersSize: 128 * 1024 });
  if (parsed.attachments.length > 40) return message.setReject('Message exceeds the attachment count limit');
  const id = randomId();
  const files = parsed.attachments.map((attachment) => {
    const content = attachment.content;
    if (typeof content === 'string') throw new TypeError('Expected a binary attachment');
    return { id: randomId(), name: fileName(attachment.filename ?? ''), type: fileType(attachment.mimeType), size: content.byteLength, content };
  });
  const html = (parsed.html ?? '').slice(0, 250_000);
  const body = (parsed.text ?? await plainMailText(html)).slice(0, 160_000);
  const bytes = new TextEncoder().encode(body + html).byteLength + files.reduce((sum, file) => sum + file.size, 0);
  const insert = env.DB.prepare(`INSERT INTO mail_messages (
    id, mailbox_id, folder, sender, sender_name, recipients, cc, reply_to, subject, body, html, message_id, refs, size, created_at, inbound_digest
  ) SELECT ?1, ?2, 'inbox', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?4, ?15, ?16
    WHERE ${MAIL_CAPACITY} ON CONFLICT DO NOTHING`)
    .bind(id, mailbox.id, mailbox.user_id, bytes, (parsed.from?.address || message.from).slice(0, 254),
      cleanText(parsed.from?.name ?? '', 200), JSON.stringify(addresses(parsed.to)), JSON.stringify(addresses(parsed.cc)),
      JSON.stringify(addresses(parsed.replyTo)), cleanText(parsed.subject ?? '', 500), body, html,
      messageIds(parsed.messageId ?? '')[0] ?? '', messageIds(parsed.references ?? '').join(' '), now(), digest);

  const keys = files.map((file) => id + '/' + file.id);
  try {
    for (const file of files) await bucket.put(id + '/' + file.id, file.content);
    const [result] = await env.DB.batch([insert, ...files.map((file) => env.DB.prepare(`INSERT INTO mail_files
      (id, message_id, name, type, size) SELECT ?1, ?2, ?3, ?4, ?5 FROM mail_messages WHERE id = ?2`)
      .bind(file.id, id, file.name, file.type, file.size))]);
    if (result.meta.changes) return;
  } catch (error) {
    if (keys.length) await bucket.delete(keys);
    throw error;
  }
  if (keys.length) await bucket.delete(keys);
  if (!await duplicate()) message.setReject('Mailbox unavailable or full');
}
