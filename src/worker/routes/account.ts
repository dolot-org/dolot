import { Hono } from 'hono';
import { z } from 'zod';
import type { PasskeyInfo, SessionInfo } from '../../shared/types';
import type { AppEnv } from '../env';
import { auditStmt } from '../lib/audit';
import { credentialStatement, registrationOptions, verificationBody, type CredentialRow } from '../lib/credentials';
import { rateLimit } from '../lib/guard';
import { fail, readBody } from '../lib/http';
import { clearSessionCookie, currentUser, pwaGuard, requireUser } from '../lib/session';
import { cleanText, clientIp, isUniqueError, now, parseJson } from '../lib/util';
import { takeChallenge } from '../lib/webauthn';
import { meDto } from './auth';

export const account = new Hono<AppEnv>();
account.use('*', requireUser, pwaGuard);

account.patch('/profile', async (c) => {
  const user = currentUser(c);
  const body = await readBody(c, z.object({ displayName: z.string().max(50), contact: z.string().max(150) }));
  user.display_name = cleanText(body.displayName, 50);
  user.contact = cleanText(body.contact, 150);
  await c.env.DB.prepare('UPDATE users SET display_name = ?, contact = ? WHERE id = ?')
    .bind(user.display_name, user.contact, user.id).run();
  return c.json(await meDto(c, user));
});

account.get('/passkeys', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at')
    .bind(currentUser(c).id).all<CredentialRow>();
  return c.json(results.map((row): PasskeyInfo => ({
    id: row.id, name: row.name, deviceType: row.device_type, backedUp: !!row.backed_up, createdAt: row.created_at,
    lastUsedAt: row.last_used_at, current: row.id === c.get('session')?.credentialId,
  })));
});

account.post('/passkeys/options', async (c) => {
  const user = currentUser(c);
  await rateLimit(c.env.DB, 'passkey:' + user.id, 20, 3_600_000);
  const { results } = await c.env.DB.prepare('SELECT * FROM credentials WHERE user_id = ?').bind(user.id).all<CredentialRow>();
  if (results.length >= 25) fail(400, 'status_invalid');
  return c.json(await registrationOptions(c, 'add-passkey', { id: user.id, username: user.username, displayName: user.display_name }, results));
});

account.post('/passkeys/verify', async (c) => {
  const user = currentUser(c);
  const body = await readBody(c, verificationBody);
  const challenge = await takeChallenge(c.env.DB, body.challengeId, 'add-passkey');
  const data = parseJson<{ sessionId?: string }>(challenge.data, {});
  if (challenge.user_id !== user.id || data.sessionId !== c.get('session')?.id) fail(403, 'forbidden');
  const credential = await credentialStatement(c, challenge, body.response, user.id);
  try {
    await credential.statement.run();
  } catch (error) {
    if (isUniqueError(error)) fail(409, 'passkey_failed');
    throw error;
  }
  return c.json({ id: credential.id }, 201);
});

account.patch('/passkeys/:id', async (c) => {
  const body = await readBody(c, z.object({ name: z.string().trim().min(1).max(50) }));
  const result = await c.env.DB.prepare('UPDATE credentials SET name = ? WHERE id = ? AND user_id = ?')
    .bind(cleanText(body.name, 50), c.req.param('id'), currentUser(c).id).run();
  if (!result.meta.changes) fail(404, 'not_found');
  return c.json({ ok: true });
});

account.delete('/passkeys/:id', async (c) => {
  const { DB } = c.env;
  const user = currentUser(c);
  const id = c.req.param('id');
  const result = await DB.prepare(
    'DELETE FROM credentials WHERE id = ?1 AND user_id = ?2 AND EXISTS (SELECT 1 FROM credentials WHERE user_id = ?2 AND id <> ?1)',
  ).bind(id, user.id).run();
  if (!result.meta.changes) {
    if (await DB.prepare('SELECT id FROM credentials WHERE id = ? AND user_id = ?').bind(id, user.id).first()) fail(409, 'passkey_last');
    fail(404, 'not_found');
  }
  await DB.prepare('DELETE FROM sessions WHERE user_id = ? AND credential_id = ?').bind(user.id, id).run();
  if (id === c.get('session')?.credentialId) clearSessionCookie(c);
  return c.json({ ok: true });
});

account.get('/sessions', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC')
    .bind(currentUser(c).id, now()).all<{ id: string; created_at: number; last_seen_at: number; ip: string; user_agent: string }>();
  return c.json(results.map((row): SessionInfo => ({
    id: row.id, createdAt: row.created_at, lastSeenAt: row.last_seen_at, ip: row.ip,
    userAgent: row.user_agent, current: row.id === c.get('session')?.id,
  })));
});

account.delete('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?').bind(currentUser(c).id, id).run();
  if (id === c.get('session')?.id) clearSessionCookie(c);
  return c.json({ ok: true });
});

account.delete('/', async (c) => {
  const user = currentUser(c);
  const { DB } = c.env;
  const body = await readBody(c, z.object({ confirm: z.string().max(100) }));
  if (body.confirm !== user.username) fail(400, 'confirm_mismatch');
  if (user.role === 'admin' && !(await DB.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND id <> ? LIMIT 1").bind(user.id).first())) fail(409, 'status_invalid');
  const result = await DB.prepare(
    'DELETE FROM users WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM subdomains WHERE user_id = ?1) AND (role <> ?2 OR EXISTS (SELECT 1 FROM users WHERE role = ?2 AND status = ?3 AND id <> ?1))',
  ).bind(user.id, 'admin', 'active').run();
  if (!result.meta.changes) fail(409, 'account_in_use');
  await auditStmt(DB, { actor: user, action: 'account.delete', targetType: 'user', targetId: user.id, targetLabel: user.username, ip: clientIp(c) }).run();
  clearSessionCookie(c);
  return c.json({ ok: true });
});
