import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { Hono } from 'hono';
import { z } from 'zod';
import { normalizeUsername, USERNAME_RE } from '../../shared/dns';
import { LEGAL_VERSION } from '../../shared/legal';
import type { Me } from '../../shared/types';
import type { AppEnv, Ctx, UserRow } from '../env';
import { auditStmt } from '../lib/audit';
import { challengeRp, credentialStatement, registrationOptions, transportsOf, verificationBody, type CredentialRow } from '../lib/credentials';
import { userQuota } from '../lib/domains';
import { adminUsernames, rateLimit, verifyTurnstile } from '../lib/guard';
import { fail, readBody } from '../lib/http';
import { createSession, currentUser, destroySession, pwaGuard, requireUser } from '../lib/session';
import { getSettings } from '../lib/settings';
import {
  assertSignupDevice, existingDevice, fingerprintInput, insertSignupDevice, signupDevice, type SignupDevice,
} from '../lib/signup-device';
import { cleanText, clientIp, isUniqueError, now, parseJson, randomId } from '../lib/util';
import { putChallenge, rpInfo, takeChallenge } from '../lib/webauthn';

export const auth = new Hono<AppEnv>();

export async function meDto(c: Ctx, user: UserRow): Promise<Me> {
  const limits = await userQuota(c.env.DB, user, await getSettings(c.env.DB));
  return {
    id: user.id, username: user.username, displayName: user.display_name,
    role: user.role, contact: user.contact, ...limits, createdAt: user.created_at,
  };
}

auth.get('/me', async (c) => {
  const user = c.get('user');
  return c.json(user ? await meDto(c, user) : null);
});
auth.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

// Enrol existing accounts when they next open the signed-in app.
auth.post('/device', requireUser, pwaGuard, async (c) => {
  const { DB, DEVICE_FINGERPRINT_SECRET } = c.env;
  if (!DEVICE_FINGERPRINT_SECRET) return c.json({ ok: true });
  const user = currentUser(c);
  if (await DB.prepare('SELECT 1 FROM signup_devices WHERE user_id = ?').bind(user.id).first()) return c.json({ ok: true });
  const { fingerprint } = await readBody(c, z.object({ fingerprint: fingerprintInput }));
  const device = await signupDevice(c, fingerprint);
  if (device) await insertSignupDevice(DB, user.id, device, true).run();
  return c.json({ ok: true });
});

auth.post('/register/options', pwaGuard, async (c) => {
  const { DB } = c.env;
  if (c.get('user')) fail(409, 'signup_device_used');
  await rateLimit(DB, 'register:' + clientIp(c), 12, 3_600_000);
  const body = await readBody(c, z.object({
    username: z.string().max(100), displayName: z.string().max(50).optional(), token: z.string().max(2048).optional(),
    legalVersion: z.string().max(40).optional(), fingerprint: fingerprintInput,
  }));
  const username = normalizeUsername(body.username);
  if (!USERNAME_RE.test(username)) fail(400, 'username_invalid');
  if (!(await getSettings(DB)).registrationOpen) fail(403, 'registration_closed');
  if (body.legalVersion !== LEGAL_VERSION) fail(400, 'legal_consent_required');
  const consent = { version: body.legalVersion, acceptedAt: now() };
  await verifyTurnstile(c, body.token);
  if (await DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()) fail(409, 'username_taken');
  const device = await signupDevice(c, body.fingerprint);
  if (device && await existingDevice(DB, device)) fail(409, 'signup_device_used');
  return c.json(await registrationOptions(c, 'register', {
    id: randomId(16), username, displayName: cleanText(body.displayName ?? '', 50), consent, device,
  }));
});

auth.post('/register/verify', pwaGuard, async (c) => {
  const { DB } = c.env;
  if (c.get('user')) fail(409, 'signup_device_used');
  await rateLimit(DB, 'register-verify:' + clientIp(c), 20, 3_600_000);
  if (!(await getSettings(DB)).registrationOpen) fail(403, 'registration_closed');
  const body = await readBody(c, verificationBody);
  const challenge = await takeChallenge(DB, body.challengeId, 'register');
  const data = parseJson<{
    username: string; displayName: string; consent?: { version: string; acceptedAt: number }; device?: SignupDevice | null;
  } | null>(challenge.data, null);
  const id = challenge.user_id;
  if (!id || !data) fail(400, 'passkey_failed');
  if (data.consent?.version !== LEGAL_VERSION) fail(400, 'legal_consent_required');
  await assertSignupDevice(c, data.device);
  const credential = await credentialStatement(c, challenge, body.response, id);
  const t = now();
  const user: UserRow = {
    id, username: data.username, display_name: data.displayName, role: adminUsernames(c.env).includes(data.username) ? 'admin' : 'user',
    status: 'active', ban_reason: null, quota: null, contact: '', created_at: t, last_login_at: t,
  };
  try {
    await DB.batch([
      DB.prepare('INSERT INTO users (id, username, display_name, role, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, user.username, user.display_name, user.role, t, t),
      ...(data.device ? [insertSignupDevice(DB, id, data.device)] : []),
      credential.statement,
      DB.prepare('INSERT INTO user_agreements (user_id, version, accepted_at) VALUES (?, ?, ?)')
        .bind(id, data.consent.version, data.consent.acceptedAt),
      auditStmt(DB, { actor: user, action: 'account.register', targetType: 'user', targetId: id, targetLabel: user.username, ip: clientIp(c) }),
    ]);
  } catch (error) {
    if (isUniqueError(error)) {
      if (data.device && await existingDevice(DB, data.device)) fail(409, 'signup_device_used');
      if (await DB.prepare('SELECT id FROM users WHERE username = ?').bind(user.username).first()) fail(409, 'username_taken');
      fail(409, 'passkey_failed');
    }
    throw error;
  }
  await createSession(c, id, credential.id);
  return c.json(await meDto(c, user), 201);
});

auth.post('/login/options', pwaGuard, async (c) => {
  const { DB } = c.env;
  await rateLimit(DB, 'login-options:' + clientIp(c), 40, 60_000);
  const rp = rpInfo(c);
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required' });
  const challengeId = await putChallenge(DB, 'login', options.challenge, null, { origin: rp.origin, rpID: rp.rpID });
  return c.json({ challengeId, options });
});

auth.post('/login/verify', pwaGuard, async (c) => {
  const { DB } = c.env;
  await rateLimit(DB, 'login-verify:' + clientIp(c), 40, 60_000);
  const body = await readBody(c, verificationBody);
  const challenge = await takeChallenge(DB, body.challengeId, 'login');
  const expected = challengeRp(c, challenge);
  const row = await DB.prepare('SELECT * FROM credentials WHERE id = ?').bind(body.response.id).first<CredentialRow>();
  if (!row) fail(400, 'passkey_unknown');
  const user = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first<UserRow>();
  if (!user) fail(400, 'passkey_unknown');
  const response = body.response as unknown as AuthenticationResponseJSON;
  const handle = response.response?.userHandle;
  if (handle && handle !== btoa(user.id).replace(/=+$/, '')) fail(400, 'passkey_failed');
  const result = await verifyAuthenticationResponse({
    response, ...expected, requireUserVerification: true,
    credential: { id: row.id, publicKey: Uint8Array.from(atob(row.public_key), (v) => v.charCodeAt(0)), counter: row.counter, transports: transportsOf(row) },
  }).catch(() => fail(400, 'passkey_failed'));
  if (!result.verified) fail(400, 'passkey_failed');
  if (user.status === 'banned') fail(403, 'banned', { reason: user.ban_reason ?? '' });
  const info = result.authenticationInfo;
  const t = now();
  const saved = await DB.prepare(
    'UPDATE credentials SET counter = ?, backed_up = ?, last_used_at = ? WHERE id = ? AND counter = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = ?)',
  ).bind(info.newCounter, +info.credentialBackedUp, t, row.id, row.counter, user.id, 'active').run();
  if (!saved.meta.changes) fail(400, 'passkey_failed');
  await DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(t, user.id).run();
  await createSession(c, user.id, row.id);
  return c.json(await meDto(c, user));
});
