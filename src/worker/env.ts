import type { MailSender } from './lib/mail';
import type { Context } from 'hono';
import type { Lang } from '../shared/messages';
import type { Role, UserStatus } from '../shared/types';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MAIL_FILES?: R2Bucket;
  MAIL_DOMAINS?: string;
  MAIL_SEND_DOMAINS?: string;
  MAIL_SENDER?: MailSender;
  SOURCE_REPOSITORY?: string;
  SOURCE_REVISION?: string;
  /** Cloudflare API 令牌 需要 Zone Read 与 DNS Edit 权限 */
  CF_API_TOKEN?: string;
  /** 设为 true 时不调用 Cloudflare 只在本地模拟 */
  CF_MOCK?: string;
  RP_ID?: string;
  RP_NAME?: string;
  /** 允许的来源 逗号分隔 默认取请求自身来源 */
  ORIGINS?: string;
  /** 以这些用户名注册的账户自动成为管理员 逗号分隔 */
  ADMIN_USERNAMES?: string;
  REQUIRE_PWA?: string;
  DEVICE_FINGERPRINT_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
}

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  status: UserStatus;
  ban_reason: string | null;
  quota: number | null;
  contact: string;
  created_at: number;
  last_login_at: number | null;
}

export interface SessionState {
  id: string;
  credentialId: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: UserRow | null;
    session: SessionState | null;
    lang: Lang;
  };
};

export type Ctx = Context<AppEnv>;
