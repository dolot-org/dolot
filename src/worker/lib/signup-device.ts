import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { isIPv4, isIPv6 } from '../../shared/dns';
import type { Ctx } from '../env';
import { fail } from './http';
import { DAY, randomToken } from './util';

const COOKIE = '__Host-dotlo-device';
const BROWSER_ID = /^[A-Za-z0-9_-]{43}$/;
export const fingerprintInput = z.string().regex(/^[0-9a-f]{64}$/).optional();

export interface SignupDevice {
  browserKey: string;
  fingerprintKey: string | null;
}

function networkPrefix(ip: string): string | null {
  if (isIPv4(ip)) return ip.split('.').slice(0, 3).join('.');
  if (!isIPv6(ip)) return null;
  const ip4Start = ip.includes('.') ? ip.lastIndexOf(':') + 1 : -1;
  const head = ip4Start < 0 ? ip : ip.slice(0, ip4Start) + '0:0';
  const [left, right] = head.split('::');
  const before = left ? left.split(':') : [];
  const after = right ? right.split(':') : [];
  const zeroes = right === undefined ? [] : Array<string>(8 - before.length - after.length).fill('0');
  return [...before, ...zeroes, ...after].slice(0, 4).map((part) => parseInt(part, 16).toString(16)).join(':');
}

const encoder = new TextEncoder();
function signingKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function deviceKey(key: CryptoKey, input: string) {
  const hash = await crypto.subtle.sign('HMAC', key, encoder.encode(input));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readDeviceCookie(c: Ctx) {
  const value = getCookie(c, COOKIE);
  return value && BROWSER_ID.test(value) ? value : undefined;
}

export async function signupDevice(c: Ctx, fingerprint: string | undefined): Promise<SignupDevice | null> {
  const secret = c.env.DEVICE_FINGERPRINT_SECRET;
  if (!secret) return null;
  if (!fingerprint) fail(400, 'signup_device_required');
  const browser = readDeviceCookie(c) ?? randomToken();
  setCookie(c, COOKIE, browser, { path: '/', secure: true, httpOnly: true, sameSite: 'Lax', maxAge: 365 * DAY / 1000 });
  // Keep common hardware profiles on different networks from blocking one another.
  const network = networkPrefix(c.req.header('cf-connecting-ip') ?? '');
  const key = await signingKey(secret);
  const [browserKey, fingerprintKey] = await Promise.all([
    deviceKey(key, 'browser:' + browser),
    network ? deviceKey(key, 'fingerprint:' + network + '/' + fingerprint) : null,
  ]);
  return { browserKey, fingerprintKey };
}

export async function assertSignupDevice(c: Ctx, device: SignupDevice | null | undefined) {
  const secret = c.env.DEVICE_FINGERPRINT_SECRET;
  if (!secret) return;
  const browser = readDeviceCookie(c);
  if (!device || !browser || await deviceKey(await signingKey(secret), 'browser:' + browser) !== device.browserKey) {
    fail(400, 'signup_device_required');
  }
  if (await existingDevice(c.env.DB, device)) fail(409, 'signup_device_used');
}

export function existingDevice(db: D1Database, device: SignupDevice) {
  return db.prepare('SELECT 1 FROM signup_devices WHERE browser_key = ? OR fingerprint_key = ?')
    .bind(device.browserKey, device.fingerprintKey).first();
}

export function insertSignupDevice(db: D1Database, userId: string, device: SignupDevice, ignoreConflict = false) {
  const sql = 'INSERT INTO signup_devices (user_id, browser_key, fingerprint_key) VALUES (?, ?, ?)';
  return db.prepare(sql + (ignoreConflict ? ' ON CONFLICT DO NOTHING' : '')).bind(userId, device.browserKey, device.fingerprintKey);
}
