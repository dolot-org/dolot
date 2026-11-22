import type { RecordFields, RecordType } from './dns';
import type { MessageCode } from './messages';

export type Role = 'user' | 'admin';
export type UserStatus = 'active' | 'banned';
export type SubStatus = 'active' | 'pending' | 'suspended' | 'expired';
export type RootStatus = 'active' | 'paused';
export type ReportCategory = 'phishing' | 'malware' | 'spam' | 'illegal' | 'abuse' | 'other';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';
export type DnsMode = 'cloudflare' | 'mock' | 'unconfigured';

export const REPORT_CATEGORIES: readonly ReportCategory[] = ['phishing', 'malware', 'spam', 'illegal', 'abuse', 'other'];
export const SUB_STATUSES: readonly SubStatus[] = ['active', 'pending', 'suspended', 'expired'];
export const MAX_DOMAINS_PER_ACCOUNT = 1;

export interface Me {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  contact: string;
  /** null 表示不限 */
  quota: number | null;
  used: number;
  createdAt: number;
}

export interface PasskeyInfo {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: number;
  lastUsedAt: number | null;
  current: boolean;
}

export interface SessionInfo {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  ip: string;
  userAgent: string;
  current: boolean;
}

export interface RootDomain {
  id: string;
  domain: string;
  description: string;
  status: RootStatus;
  minLength: number;
  maxLength: number;
  allowedTypes: RecordType[];
  allowProxied: boolean;
  maxRecords: number;
  termDays: number;
  renewWindowDays: number;
  graceDays: number;
  requireReview: boolean;
}

export interface AdminRoot extends RootDomain {
  zoneId: string;
  sort: number;
  subdomainCount: number;
  createdAt: number;
}

export interface Subdomain {
  id: string;
  fqdn: string;
  label: string;
  rootId: string;
  rootDomain: string;
  status: SubStatus;
  statusReason: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  recordCount: number;
  transferExpiresAt: number | null;
}

export interface AdminSubdomain extends Subdomain {
  ownerId: string;
  ownerName: string;
}

export interface DnsRecord extends RecordFields {
  id: string;
  host: string;
  comment: string;
  published: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SubdomainDetail {
  subdomain: Subdomain;
  root: RootDomain;
  records: DnsRecord[];
  renewable: boolean;
  renewOpensAt: number | null;
  purgeAt: number | null;
}

export interface ActivityItem {
  id: number;
  action: string;
  actorName: string | null;
  byAdmin: boolean;
  targetType: string;
  targetLabel: string;
  detail: Record<string, unknown>;
  ip: string | null;
  createdAt: number;
}

export interface PublicConfig {
  siteName: string;
  registrationOpen: boolean;
  requirePwa: boolean;
  turnstileSiteKey: string | null;
  announcement: string;
  contactEmail: string;
  roots: RootDomain[];
  stats: { subdomains: number; users: number };
  domainCapacity: { assigned: number; limit: number };
}

export interface Availability {
  fqdn: string;
  available: boolean;
  code: MessageCode | null;
  message: string | null;
  registeredAt: number | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminStats {
  users: number;
  usersWeek: number;
  subdomains: Record<SubStatus, number>;
  subdomainsWeek: number;
  records: number;
  roots: number;
  openReports: number;
  dnsMode: DnsMode;
  recent: AdminSubdomain[];
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  banReason: string | null;
  quota: number | null;
  contact: string;
  createdAt: number;
  lastLoginAt: number | null;
  subdomainCount: number;
  passkeyCount: number;
}

export interface AdminReport {
  id: string;
  fqdn: string;
  subdomainId: string | null;
  subdomainStatus: SubStatus | null;
  ownerName: string | null;
  category: ReportCategory;
  details: string;
  contact: string;
  status: ReportStatus;
  resolution: string;
  createdAt: number;
  handledAt: number | null;
  handlerName: string | null;
}

export interface ReservedName {
  label: string;
  reason: string;
  createdAt: number;
}

export interface SiteSettings {
  registrationOpen: boolean;
  defaultQuota: number;
  totalDomainLimit: number;
  dailyClaimLimit: number;
  announcement: string;
  contactEmail: string;
}

export interface CfZoneInfo {
  id: string;
  name: string;
  status: string;
  plan: string | null;
  added: boolean;
}

export interface TransferPreview {
  fqdn: string;
  fromName: string;
  expiresAt: number | null;
  recordCount: number;
}

export interface TransferTicket {
  code: string;
  expiresAt: number;
}

export interface ResolveResult {
  name: string;
  type: string;
  status: number;
  answers: { name: string; type: string; ttl: number; data: string }[];
}

export interface SyncResult {
  republished: number;
  missing: number;
  unmanaged: { type: string; name: string; content: string }[];
}
