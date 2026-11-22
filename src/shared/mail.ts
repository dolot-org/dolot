export const MAIL_FOLDERS = ['inbox', 'starred', 'sent', 'drafts', 'archive', 'trash'] as const;
export const MAIL_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAIL_UPLOAD_FILES = 10;
export const MAIL_BODY_CHARS = 48_000;

export type MailFolder = typeof MAIL_FOLDERS[number];
export type StoredMailFolder = Exclude<MailFolder, 'starred'>;

export interface MailStatus {
  mailbox: { address: string } | null;
  domains: string[];
  canSend: boolean;
  unread: number;
  bytesUsed: number;
  bytesLimit: number;
}

export interface MailFile {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface MailSummary {
  id: string;
  folder: StoredMailFolder;
  sender: string;
  senderName: string;
  to: string[];
  subject: string;
  snippet: string;
  read: boolean;
  starred: boolean;
  hasFiles: boolean;
  sending: boolean;
  createdAt: number;
}

export interface MailDetail extends MailSummary {
  cc: string[];
  bcc: string[];
  replyTo: string[];
  body: string;
  html: string;
  files: MailFile[];
  version: string;
}

export type MailOperation = 'read' | 'unread' | 'star' | 'unstar' | 'archive' | 'inbox' | 'trash' | 'restore' | 'delete';
