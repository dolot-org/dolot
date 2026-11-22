import type { Ctx } from '../env';
import { fail } from './http';
import { clientIp, now } from './util';

/** 固定窗口限流 超出后抛出 429 */
export async function rateLimit(db: D1Database, key: string, limit: number, windowMs: number) {
  const t = now();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
       RETURNING count`,
    )
    .bind(key, t + windowMs, t)
    .first<{ count: number }>();
  if (row && row.count > limit) fail(429, 'rate_limited');
}

/** 配置了 TURNSTILE_SECRET 时校验人机验证 */
export async function verifyTurnstile(c: Ctx, token: string | undefined) {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) return;
  if (!token) fail(400, 'turnstile_failed');
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  const ip = clientIp(c);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const data = (await res.json().catch(() => ({ success: false }))) as { success?: boolean };
  if (!data.success) fail(400, 'turnstile_failed');
}

export function adminUsernames(env: { ADMIN_USERNAMES?: string }): string[] {
  return (env.ADMIN_USERNAMES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
