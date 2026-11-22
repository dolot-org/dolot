import type { Ctx } from '../env';

export const DAY = 86_400_000;
export const now = () => Date.now();

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

function base32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function randomId(bytes = 10): string {
  return base32(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomToken(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let s = '';
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 12 位转移码 去掉分隔符后参与哈希 */
export function transferCode(): string {
  return randomId(8).slice(0, 12);
}

export function canonicalCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function groupCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function clientIp(c: Ctx): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? '';
}

export function userAgent(c: Ctx): string {
  return (c.req.header('user-agent') ?? '').slice(0, 300);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function isUniqueError(e: unknown): boolean {
  return String(e).includes('UNIQUE constraint failed');
}

export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function pageParams(c: Ctx, pageSize = 30) {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(c.req.query('page') ?? '1', 10) || 1));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function guessDeviceName(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Passkey';
}

export function cleanText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
