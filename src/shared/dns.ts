import type { MessageCode, MessageParams } from './messages';

export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'CAA', 'SRV', 'NS'] as const;
export type RecordType = (typeof RECORD_TYPES)[number];
export const PROXIABLE_TYPES: readonly RecordType[] = ['A', 'AAAA', 'CNAME'];
export const DEFAULT_ALLOWED_TYPES: RecordType[] = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'CAA', 'SRV'];
export const TTL_OPTIONS = [1, 60, 300, 600, 1800, 3600, 7200, 18000, 43200, 86400] as const;
export const CAA_TAGS = ['issue', 'issuewild', 'iodef'] as const;
export type CaaTag = (typeof CAA_TAGS)[number];

export const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export type LabelProblem = 'label_empty' | 'label_short' | 'label_long' | 'label_charset' | 'label_hyphen' | 'label_punycode';

export function checkLabel(label: string, min: number, max: number): LabelProblem | null {
  if (!label) return 'label_empty';
  if (!/^[a-z0-9-]+$/.test(label)) return 'label_charset';
  if (label.startsWith('-') || label.endsWith('-')) return 'label_hyphen';
  if (label.length >= 4 && label.slice(2, 4) === '--') return 'label_punycode';
  if (label.length < min) return 'label_short';
  if (label.length > max) return 'label_long';
  return null;
}

export function isIPv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255);
}

export function isIPv6(value: string): boolean {
  if (!value || value.length > 45 || !/^[0-9a-fA-F:.]+$/.test(value)) return false;
  let head = value;
  if (value.includes('.')) {
    const cut = value.lastIndexOf(':');
    if (cut < 0 || !isIPv4(value.slice(cut + 1))) return false;
    head = `${value.slice(0, cut + 1)}0:0`;
  }
  const halves = head.split('::');
  if (halves.length > 2) return false;
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const all = [...groups(halves[0]), ...(halves.length === 2 ? groups(halves[1]) : [])];
  if (!all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return halves.length === 2 ? all.length < 8 : all.length === 8;
}

const LABEL_RE = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

export function cleanHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

export function isHostname(value: string): boolean {
  if (!value || value.length > 253) return false;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  if (/^\d+$/.test(labels[labels.length - 1])) return false;
  return labels.every((l) => LABEL_RE.test(l));
}

export type HostResult = { ok: true; name: string; host: string } | { ok: false; code: MessageCode };

/** 把相对主机名 @ www _dmarc 等转换为完整名称 只允许落在 fqdn 之内 */
export function resolveHost(input: string, fqdn: string): HostResult {
  let h = cleanHost(input);
  if (h === '' || h === '@' || h === fqdn) return { ok: true, name: fqdn, host: '@' };
  if (h.endsWith(`.${fqdn}`)) h = h.slice(0, -(fqdn.length + 1));
  const labels = h.split('.');
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l === '*' && i === 0) continue;
    if (!LABEL_RE.test(l)) return { ok: false, code: 'host_invalid' };
  }
  const name = `${h}.${fqdn}`;
  if (name.length > 253) return { ok: false, code: 'host_too_long' };
  return { ok: true, name, host: h };
}

export function hostOf(name: string, fqdn: string): string {
  if (name === fqdn) return '@';
  return name.endsWith(`.${fqdn}`) ? name.slice(0, -(fqdn.length + 1)) : name;
}

export interface RecordFields {
  type: RecordType;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority: number | null;
  weight: number | null;
  port: number | null;
  flags: number | null;
  tag: string | null;
}

export interface NormalizedRecord extends RecordFields {
  host: string;
  comment: string;
}

export interface RecordInput {
  type: RecordType;
  host: string;
  content: string;
  ttl: number;
  proxied?: boolean;
  priority?: number | null;
  weight?: number | null;
  port?: number | null;
  flags?: number | null;
  tag?: string | null;
  comment?: string;
}

export interface RecordRules {
  allowedTypes: readonly RecordType[];
  allowProxied: boolean;
}

export type RecordField = 'type' | 'host' | 'content' | 'ttl' | 'proxied' | 'priority' | 'weight' | 'port' | 'flags' | 'tag' | 'comment';

export type RecordCheck =
  | { ok: true; value: NormalizedRecord }
  | { ok: false; field: RecordField; code: MessageCode; params?: MessageParams };

function u16(n: unknown): number | null {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 65535 ? n : null;
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export function normalizeRecord(input: RecordInput, fqdn: string, rules: RecordRules): RecordCheck {
  const bad = (field: RecordField, code: MessageCode, params?: MessageParams): RecordCheck => ({ ok: false, field, code, params });
  const type = input.type;
  if (!RECORD_TYPES.includes(type) || !rules.allowedTypes.includes(type)) return bad('type', 'type_not_allowed', { type });

  const h = resolveHost(input.host, fqdn);
  if (!h.ok) return bad('host', h.code);
  if (type === 'SRV' && !/^_[a-z0-9-]+\._(tcp|udp|tls)(\.|$)/.test(h.host)) return bad('host', 'srv_host');

  const proxied = !!input.proxied && PROXIABLE_TYPES.includes(type);
  if (proxied && !rules.allowProxied) return bad('proxied', 'proxy_disabled');

  let ttl = input.ttl;
  if (!(ttl === 1 || (Number.isInteger(ttl) && ttl >= 60 && ttl <= 86400))) return bad('ttl', 'ttl_invalid');
  if (proxied) ttl = 1;

  const raw = (input.content ?? '').trim();
  let content = raw;
  let priority: number | null = null;
  let weight: number | null = null;
  let port: number | null = null;
  let flags: number | null = null;
  let tag: string | null = null;

  switch (type) {
    case 'A':
      if (!isIPv4(raw)) return bad('content', 'content_ipv4');
      break;
    case 'AAAA':
      if (!isIPv6(raw)) return bad('content', 'content_ipv6');
      content = raw.toLowerCase();
      break;
    case 'CNAME':
    case 'NS':
      content = cleanHost(raw);
      if (!isHostname(content)) return bad('content', 'content_host');
      if (content === h.name) return bad('content', 'content_self');
      break;
    case 'MX': {
      content = cleanHost(raw);
      if (!isHostname(content)) return bad('content', 'content_host');
      priority = u16(input.priority);
      if (priority === null) return bad('priority', 'priority_invalid');
      break;
    }
    case 'TXT':
      if (!raw) return bad('content', 'content_empty');
      if (raw.length > 2048) return bad('content', 'content_long', { max: 2048 });
      if (CONTROL_CHARS.test(raw)) return bad('content', 'content_text');
      break;
    case 'CAA': {
      if (input.flags !== 0 && input.flags !== 128) return bad('flags', 'caa_flags');
      if (!CAA_TAGS.includes(input.tag as CaaTag)) return bad('tag', 'caa_tag');
      if (!raw || raw.length > 255 || raw.includes('"') || CONTROL_CHARS.test(raw)) return bad('content', 'caa_value');
      flags = input.flags;
      tag = input.tag as CaaTag;
      break;
    }
    case 'SRV': {
      content = raw === '.' ? '.' : cleanHost(raw);
      if (content !== '.' && !isHostname(content)) return bad('content', 'content_host');
      priority = u16(input.priority);
      if (priority === null) return bad('priority', 'priority_invalid');
      weight = u16(input.weight);
      if (weight === null) return bad('weight', 'weight_invalid');
      port = u16(input.port);
      if (port === null) return bad('port', 'port_invalid');
      break;
    }
  }

  const comment = (input.comment ?? '').trim();
  if (comment.length > 100) return bad('comment', 'comment_long', { max: 100 });

  return { ok: true, value: { type, name: h.name, host: h.host, content, ttl, proxied, priority, weight, port, flags, tag, comment } };
}

/** 记录值的展示形式 */
export function recordValue(r: RecordFields): string {
  switch (r.type) {
    case 'MX':
      return `${r.priority ?? 0} ${r.content}`;
    case 'SRV':
      return `${r.priority ?? 0} ${r.weight ?? 0} ${r.port ?? 0} ${r.content}`;
    case 'CAA':
      return `${r.flags ?? 0} ${r.tag ?? 'issue'} "${r.content}"`;
    default:
      return r.content;
  }
}

/** BIND 区域文件中的一行 */
export function zoneLine(r: RecordFields): string {
  const ttl = r.ttl === 1 ? 300 : r.ttl;
  const fq = (h: string) => (h === '.' ? '.' : `${h}.`);
  let value: string;
  switch (r.type) {
    case 'CNAME':
    case 'NS':
      value = fq(r.content);
      break;
    case 'MX':
      value = `${r.priority ?? 0} ${fq(r.content)}`;
      break;
    case 'SRV':
      value = `${r.priority ?? 0} ${r.weight ?? 0} ${r.port ?? 0} ${fq(r.content)}`;
      break;
    case 'TXT':
      value = `"${r.content.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      break;
    case 'CAA':
      value = `${r.flags ?? 0} ${r.tag ?? 'issue'} "${r.content}"`;
      break;
    default:
      value = r.content;
  }
  return `${r.name}.\t${ttl}\tIN\t${r.type}\t${value}`;
}
