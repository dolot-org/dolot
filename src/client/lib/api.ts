import { QueryClient, useQuery } from '@tanstack/react-query';
import { formatMessage, MESSAGES, type MessageCode } from '../../shared/messages';
import type { Me, PublicConfig } from '../../shared/types';
import { getPreferences } from './preferences';
import { isStandalone } from './pwa';

export class ApiError extends Error {
  constructor(public status: number, public code: MessageCode, message: string) {
    super(message);
  }
}

async function apiRequest(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
  const { lang } = getPreferences();
  let response: Response;
  try {
    const headers = new Headers({ 'accept-language': lang, 'x-dotlo-client': 'web', 'x-dotlo-display': isStandalone() ? 'standalone' : 'browser' });
    if (body !== undefined) headers.set('content-type', 'application/json');
    response = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(lang === 'zh' ? '无法连接到 Dotlo 请检查网络后重试' : 'Could not reach Dotlo Check your connection and try again');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { code?: string; message?: string } | null;
    const code = error?.code && Object.hasOwn(MESSAGES, error.code) ? error.code as MessageCode : 'internal';
    if (response.status === 401) setMe(null);
    throw new ApiError(response.status, code, error?.message || formatMessage(code, lang));
  }
  return response;
}

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  return (await apiRequest(path, method, body, signal)).json().catch(() => null) as Promise<T>;
}

export async function apiBlob(path: string) {
  return (await apiRequest(path)).blob();
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
});

export function useApiQuery<T>(path: string, key: readonly unknown[] = [path]) {
  return useQuery({ queryKey: key, queryFn: ({ signal }) => api<T>(path, 'GET', undefined, signal) });
}

export function useConfig() {
  return useApiQuery<PublicConfig>('/config', ['config']);
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: ({ signal }) => api<Me | null>('/auth/me', 'GET', undefined, signal) });
}

export function setMe(me: Me | null) {
  if (queryClient.getQueryData<Me | null>(['me'])?.id !== me?.id) {
    queryClient.removeQueries({ predicate: (query) => !['me', 'config'].includes(String(query.queryKey[0])) });
  }
  queryClient.setQueryData(['me'], me);
}

export async function invalidate(...keys: string[]) {
  await Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}
