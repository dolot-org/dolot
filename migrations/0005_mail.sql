CREATE TABLE mailboxes (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE COLLATE NOCASE,
  user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE mail_messages (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
  folder TEXT NOT NULL CHECK (folder IN ('inbox', 'archive', 'sent', 'drafts', 'trash')),
  restore_folder TEXT,
  sender TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  recipients TEXT NOT NULL DEFAULT '[]',
  cc TEXT NOT NULL DEFAULT '[]',
  bcc TEXT NOT NULL DEFAULT '[]',
  reply_to TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  html TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  inbound_digest TEXT,
  reply_id TEXT NOT NULL DEFAULT '',
  refs TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  trashed_at INTEGER,
  sending_at INTEGER,
  version TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_mail_messages_folder ON mail_messages(mailbox_id, folder, created_at DESC, id DESC);
CREATE UNIQUE INDEX idx_mail_messages_digest ON mail_messages(mailbox_id, inbound_digest) WHERE inbound_digest IS NOT NULL;
CREATE INDEX idx_mail_messages_trash ON mail_messages(trashed_at) WHERE folder = 'trash';

CREATE TABLE mail_files (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL
);
CREATE INDEX idx_mail_files_message ON mail_files(message_id);

CREATE TABLE mail_file_cleanup (
  key TEXT PRIMARY KEY
);

CREATE TRIGGER mail_files_cleanup AFTER DELETE ON mail_files
BEGIN
  INSERT OR IGNORE INTO mail_file_cleanup (key) VALUES (OLD.message_id || '/' || OLD.id);
END;

-- Retire released addresses so another account cannot receive mail intended for their previous owner
CREATE TRIGGER mailboxes_release AFTER UPDATE OF user_id ON mailboxes
WHEN OLD.user_id IS NOT NULL AND NEW.user_id IS NULL
BEGIN
  DELETE FROM mail_messages WHERE mailbox_id = OLD.id;
END;
