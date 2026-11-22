import {
  generateRegistrationOptions, verifyRegistrationResponse,
  type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';
import type { Ctx } from '../env';
import { fail } from './http';
import { guessDeviceName, now, parseJson, userAgent } from './util';
import { putChallenge, rpInfo, type ChallengeRow } from './webauthn';

export interface CredentialRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string;
  device_type: string;
  backed_up: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export const verificationBody = z.object({
  challengeId: z.string().min(1).max(100),
  response: z.looseObject({ id: z.string().min(1).max(2048) }),
});

export function transportsOf(row: CredentialRow) {
  return parseJson<AuthenticatorTransportFuture[]>(row.transports, []);
}

export async function registrationOptions(
  c: Ctx,
  kind: 'register' | 'add-passkey',
  user: { id: string; username: string; displayName: string; consent?: { version: string; acceptedAt: number } },
  existing: CredentialRow[] = [],
) {
  const rp = rpInfo(c);
  const options = await generateRegistrationOptions({
    rpID: rp.rpID, rpName: rp.rpName, userID: new Uint8Array(new TextEncoder().encode(user.id)),
    userName: user.username, userDisplayName: user.displayName || user.username,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: existing.map((row) => ({ id: row.id, transports: transportsOf(row) })),
  });
  const challengeId = await putChallenge(c.env.DB, kind, options.challenge, user.id, {
    ...user, origin: rp.origin, rpID: rp.rpID, sessionId: c.get('session')?.id ?? null,
  });
  return { challengeId, options };
}

export function challengeRp(c: Ctx, challenge: ChallengeRow) {
  const rp = rpInfo(c);
  const data = parseJson<{ origin?: string; rpID?: string }>(challenge.data, {});
  if (data.origin !== rp.origin || data.rpID !== rp.rpID) fail(400, 'passkey_failed');
  return { expectedOrigin: rp.origin, expectedRPID: rp.rpID, expectedChallenge: challenge.challenge };
}

export async function credentialStatement(c: Ctx, challenge: ChallengeRow, response: unknown, userId: string) {
  const expected = challengeRp(c, challenge);
  const result = await verifyRegistrationResponse({
    response: response as RegistrationResponseJSON, ...expected, requireUserVerification: true,
  }).catch(() => fail(400, 'passkey_failed'));
  if (!result.verified) fail(400, 'passkey_failed');
  const info = result.registrationInfo;
  const credential = info.credential;
  const publicKey = btoa(String.fromCharCode(...credential.publicKey));
  const statement = c.env.DB.prepare(
    'INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type, backed_up, aaguid, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(credential.id, userId, publicKey, credential.counter, JSON.stringify(credential.transports ?? []),
    info.credentialDeviceType, +info.credentialBackedUp, info.aaguid, guessDeviceName(userAgent(c)), now());
  return { id: credential.id, statement };
}
