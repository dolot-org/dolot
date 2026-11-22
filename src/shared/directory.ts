import type { RecordType } from './dns';

export interface DirectoryDomain {
  fqdn: string;
  registeredAt: number;
  expiresAt: number | null;
}

export interface DirectoryRecord {
  name: string;
  type: RecordType;
}

export interface DirectoryDetail {
  domain: DirectoryDomain;
  records: DirectoryRecord[];
}
