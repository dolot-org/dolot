import { startAuthentication, startRegistration, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type { Me } from '../../shared/types';
import { api } from './api';
import { getPreferences } from './preferences';

type Challenge<T> = { challengeId: string; options: T };

async function browserAction<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    const zh = getPreferences().lang === 'zh';
    throw new Error(zh ? 'Passkey 操作已取消或此浏览器不支持 请重试' : 'The passkey request was cancelled or is unavailable in this browser');
  }
}

export async function signIn() {
  const { challengeId, options } = await api<Challenge<PublicKeyCredentialRequestOptionsJSON>>('/auth/login/options', 'POST');
  const response = await browserAction(() => startAuthentication({ optionsJSON: options }));
  return api<Me>('/auth/login/verify', 'POST', { challengeId, response });
}

async function register<T>(path: string, data?: object) {
  const { challengeId, options } = await api<Challenge<PublicKeyCredentialCreationOptionsJSON>>(path + '/options', 'POST', data);
  const response = await browserAction(() => startRegistration({ optionsJSON: options }));
  return api<T>(path + '/verify', 'POST', { challengeId, response });
}

export const signUp = (data: { username: string; displayName: string; legalVersion: string; token?: string; fingerprint?: string }) => register<Me>('/auth/register', data);
export const addPasskey = () => register<{ id: string }>('/account/passkeys');
