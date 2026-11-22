import type { Ctx } from '../env';
import { fail } from './http';
import { now, randomId } from './util';

export function rpInfo(c: Ctx) {
  const self = new URL(c.req.url).origin;
  const origin = c.req.header('origin') ?? self;
  const allowed = (c.env.ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const origins = allowed.length ? allowed : [self];
  if (!origins.includes(origin)) fail(403, 'csrf');
  return {
    rpID: c.env.RP_ID || new URL(origin).hostname,
    rpName: c.env.RP_NAME || 'Dotlo',
    origin,
  };
}

export type ChallengeKind = 'register' | 'login' | 'add-passkey';

export interface ChallengeRow {
  id: string;
  kind: ChallengeKind;
  challenge: string;
  user_id: string | null;
  data: string;
  expires_at: number;
}

export async function putChallenge(db: D1Database, kind: ChallengeKind, challenge: string, userId: string | null, data: unknown = {}) {
  const id = randomId(16);
  await db
    .prepare('INSERT INTO challenges (id, kind, challenge, user_id, data, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, kind, challenge, userId, JSON.stringify(data), now() + 5 * 60_000)
    .run();
  return id;
}

export async function takeChallenge(db: D1Database, id: string, kind: ChallengeKind): Promise<ChallengeRow> {
  const row = await db.prepare('DELETE FROM challenges WHERE id = ? AND kind = ? RETURNING *').bind(id, kind).first<ChallengeRow>();
  if (!row || row.expires_at < now()) fail(400, 'challenge_expired');
  return row;
}
