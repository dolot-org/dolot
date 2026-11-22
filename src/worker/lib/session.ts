import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, Ctx, UserRow } from '../env';
import { fail } from './http';
import { clientIp, DAY, now, randomToken, sha256Hex, userAgent } from './util';

const COOKIE = '__Host-dotlo';
const TTL = 30 * DAY;
const cookieOptions = { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' as const };

export async function createSession(c: Ctx, userId: string, credentialId: string | null) {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const t = now();
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, credential_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, userId, credentialId, t, t, t + TTL, clientIp(c), userAgent(c))
    .run();
  setCookie(c, COOKIE, token, { ...cookieOptions, maxAge: TTL / 1000 });
}

export function clearSessionCookie(c: Ctx) {
  deleteCookie(c, COOKIE, cookieOptions);
}

export async function destroySession(c: Ctx) {
  const session = c.get('session');
  if (session) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();
  clearSessionCookie(c);
}

type Joined = UserRow & { sid: string; s_credential: string | null; s_expires: number; s_seen: number };

function pickUser(row: Joined): UserRow {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    status: row.status,
    ban_reason: row.ban_reason,
    quota: row.quota,
    contact: row.contact,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', null);
  c.set('session', null);
  const token = getCookie(c, COOKIE);
  if (token) {
    const id = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT u.*, s.id AS sid, s.credential_id AS s_credential, s.expires_at AS s_expires, s.last_seen_at AS s_seen
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
      .bind(id)
      .first<Joined>();
    const t = now();
    if (row && row.s_expires > t && row.status === 'active') {
      c.set('user', pickUser(row));
      c.set('session', { id: row.sid, credentialId: row.s_credential });
      // 滑动续期 每小时最多写一次
      if (t - row.s_seen > 3_600_000) {
        c.executionCtx.waitUntil(
          c.env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ?, ip = ?, user_agent = ? WHERE id = ?')
            .bind(t, t + TTL, clientIp(c), userAgent(c), row.sid)
            .run(),
        );
        setCookie(c, COOKIE, token, { ...cookieOptions, maxAge: TTL / 1000 });
      }
    } else {
      if (row) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
      clearSessionCookie(c);
    }
  }
  await next();
});

export function currentUser(c: Ctx): UserRow {
  const user = c.get('user');
  if (!user) fail(401, 'unauthorized');
  return user;
}

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) fail(401, 'unauthorized');
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user')?.role !== 'admin') fail(403, 'forbidden');
  await next();
});

/** 只接受已安装应用发出的请求 服务端只能做到这一层 真正的拦截在前端 */
export const pwaGuard = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.REQUIRE_PWA !== 'false' && c.req.header('x-dotlo-display') !== 'standalone') fail(428, 'pwa_required');
  await next();
});
