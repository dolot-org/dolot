import type { MessageCode } from '../../shared/messages';
import type { DnsMode } from '../../shared/types';
import type { Env } from '../env';
import { ApiError, fail } from './http';
import { randomId } from './util';

export interface CfZone {
  id: string;
  name: string;
  status: string;
  plan: string | null;
}

export interface CfRecordPayload {
  type: string;
  name: string;
  ttl: number;
  content?: string;
  proxied?: boolean;
  priority?: number;
  data?: Record<string, unknown>;
  comment?: string;
}

export interface CfRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

export interface DnsProvider {
  readonly mode: Exclude<DnsMode, 'unconfigured'>;
  listZones(): Promise<CfZone[]>;
  getZone(id: string): Promise<CfZone | null>;
  createRecord(zoneId: string, payload: CfRecordPayload): Promise<string>;
  updateRecord(zoneId: string, recordId: string, payload: CfRecordPayload): Promise<void>;
  deleteRecord(zoneId: string, recordId: string): Promise<void>;
  listRecords(zoneId: string, fqdn: string): Promise<CfRecord[]>;
}

export class CloudflareError extends Error {
  constructor(
    public readonly codes: number[],
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface CfEnvelope<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
  result_info?: { page: number; total_pages: number };
}

interface RawZone {
  id: string;
  name: string;
  status: string;
  plan?: { name?: string };
}

class CloudflareDns implements DnsProvider {
  readonly mode = 'cloudflare' as const;
  constructor(private readonly token: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<CfEnvelope<T>> {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      signal: AbortSignal.timeout(12_000),
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: CfEnvelope<T> | null = null;
    try {
      json = (await res.json()) as CfEnvelope<T>;
    } catch {
      json = null;
    }
    if (!res.ok || !json?.success) {
      const errors = json?.errors ?? [];
      throw new CloudflareError(
        errors.map((e) => e.code),
        errors.map((e) => e.message).join('; ') || `HTTP ${res.status}`,
        res.status,
      );
    }
    return json;
  }

  private zone(z: RawZone): CfZone {
    return { id: z.id, name: z.name.toLowerCase(), status: z.status, plan: z.plan?.name ?? null };
  }

  async listZones() {
    const zones: CfZone[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await this.call<RawZone[]>('GET', `/zones?per_page=50&page=${page}`);
      zones.push(...r.result.map((z) => this.zone(z)));
      if (!r.result_info || page >= r.result_info.total_pages) break;
    }
    return zones;
  }

  async getZone(id: string) {
    try {
      const r = await this.call<RawZone>('GET', `/zones/${id}`);
      return this.zone(r.result);
    } catch (e) {
      if (e instanceof CloudflareError && [400, 403, 404].includes(e.status)) return null;
      throw e;
    }
  }

  async createRecord(zoneId: string, payload: CfRecordPayload) {
    const r = await this.call<{ id: string }>('POST', `/zones/${zoneId}/dns_records`, payload);
    return r.result.id;
  }

  async updateRecord(zoneId: string, recordId: string, payload: CfRecordPayload) {
    await this.call('PUT', `/zones/${zoneId}/dns_records/${recordId}`, payload);
  }

  async deleteRecord(zoneId: string, recordId: string) {
    try {
      await this.call('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
    } catch (e) {
      // 已经不存在视为成功
      if (e instanceof CloudflareError && (e.status === 404 || e.codes.includes(81044))) return;
      throw e;
    }
  }

  async listRecords(zoneId: string, fqdn: string) {
    const fetchAll = async (query: string) => {
      const out: CfRecord[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await this.call<CfRecord[]>('GET', `/zones/${zoneId}/dns_records?per_page=500&page=${page}&${query}`);
        out.push(...r.result);
        if (!r.result_info || page >= r.result_info.total_pages) break;
      }
      return out;
    };
    const [exact, below] = await Promise.all([
      fetchAll(`name.exact=${encodeURIComponent(fqdn)}`),
      fetchAll(`name.endswith=${encodeURIComponent(`.${fqdn}`)}`),
    ]);
    const seen = new Map<string, CfRecord>();
    for (const r of [...exact, ...below]) seen.set(r.id, r);
    return [...seen.values()];
  }
}

/** 本地开发用 不发出任何请求 */
class MockDns implements DnsProvider {
  readonly mode = 'mock' as const;
  async listZones() {
    return [];
  }
  async getZone() {
    return null;
  }
  async createRecord() {
    return `mock${randomId(12)}`;
  }
  async updateRecord() {}
  async deleteRecord() {}
  async listRecords() {
    return [];
  }
}

export function dnsMode(env: Env): DnsMode {
  if (env.CF_MOCK === 'true') return 'mock';
  return env.CF_API_TOKEN ? 'cloudflare' : 'unconfigured';
}

export function dnsProvider(env: Env): DnsProvider {
  const mode = dnsMode(env);
  if (mode === 'mock') return new MockDns();
  if (mode === 'cloudflare' && env.CF_API_TOKEN) return new CloudflareDns(env.CF_API_TOKEN);
  fail(503, 'dns_unconfigured');
}

function mapCloudflareError(e: CloudflareError): MessageCode {
  if (e.codes.some((c) => c === 81053 || c === 81054 || c === 81055)) return 'conflict_cname';
  if (e.codes.includes(81056)) return 'conflict_ns';
  if (e.codes.includes(81057) || e.codes.includes(81058)) return 'record_duplicate';
  return 'dns_provider';
}

/** 把 Cloudflare 的错误转换成面向用户的错误 */
export async function cf<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof CloudflareError) {
      const code = mapCloudflareError(e);
      const status = code !== 'dns_provider' || (e.status >= 400 && e.status < 500) ? 400 : 502;
      fail(status, code, { detail: e.message.slice(0, 200) });
    }
    console.error('cloudflare', e);
    fail(502, 'dns_provider', { detail: '' });
  }
}
