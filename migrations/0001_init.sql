-- Dotlo 初始结构 时间均为毫秒时间戳

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  ban_reason TEXT,
  quota INTEGER,
  contact TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL DEFAULT 'singleDevice',
  backed_up INTEGER NOT NULL DEFAULT 0,
  aaguid TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX idx_credentials_user ON credentials(user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  challenge TEXT NOT NULL,
  user_id TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  expires_at INTEGER NOT NULL
);

CREATE TABLE roots (
  id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  min_length INTEGER NOT NULL DEFAULT 3,
  max_length INTEGER NOT NULL DEFAULT 63,
  allowed_types TEXT NOT NULL DEFAULT '["A","AAAA","CNAME","TXT","MX","CAA","SRV"]',
  allow_proxied INTEGER NOT NULL DEFAULT 1,
  max_records INTEGER NOT NULL DEFAULT 20,
  term_days INTEGER NOT NULL DEFAULT 365,
  renew_window_days INTEGER NOT NULL DEFAULT 30,
  grace_days INTEGER NOT NULL DEFAULT 30,
  require_review INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE subdomains (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL REFERENCES roots(id),
  label TEXT NOT NULL,
  fqdn TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspended', 'expired')),
  status_reason TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  transfer_code TEXT,
  transfer_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  UNIQUE (root_id, label)
);
CREATE INDEX idx_subdomains_user ON subdomains(user_id);
CREATE INDEX idx_subdomains_status ON subdomains(status, expires_at);
CREATE INDEX idx_subdomains_created ON subdomains(created_at);
CREATE UNIQUE INDEX idx_subdomains_transfer ON subdomains(transfer_code) WHERE transfer_code IS NOT NULL;

CREATE TABLE records (
  id TEXT PRIMARY KEY,
  subdomain_id TEXT NOT NULL REFERENCES subdomains(id) ON DELETE CASCADE,
  cf_id TEXT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  ttl INTEGER NOT NULL DEFAULT 1,
  proxied INTEGER NOT NULL DEFAULT 0,
  priority INTEGER,
  data TEXT,
  comment TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_records_subdomain ON records(subdomain_id);

CREATE TABLE reserved (
  label TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  fqdn TEXT NOT NULL,
  subdomain_id TEXT,
  category TEXT NOT NULL,
  details TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  reporter_id TEXT,
  ip_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution TEXT NOT NULL DEFAULT '',
  handled_by TEXT,
  handled_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_reports_status ON reports(status, created_at);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  target_label TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_target ON audit(target_type, target_id, id);
CREATE INDEX idx_audit_actor ON audit(actor_id, id);
CREATE INDEX idx_audit_created ON audit(created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- 默认保留名称 管理员可在后台增删
INSERT INTO reserved (label, reason, created_at) VALUES
  ('www', 'system', 0), ('mail', 'system', 0), ('email', 'system', 0), ('smtp', 'system', 0),
  ('imap', 'system', 0), ('pop', 'system', 0), ('pop3', 'system', 0), ('mx', 'system', 0),
  ('ns', 'system', 0), ('ns1', 'system', 0), ('ns2', 'system', 0), ('dns', 'system', 0),
  ('ftp', 'system', 0), ('api', 'system', 0), ('app', 'system', 0), ('cdn', 'system', 0),
  ('static', 'system', 0), ('assets', 'system', 0), ('admin', 'system', 0), ('root', 'system', 0),
  ('administrator', 'system', 0), ('hostmaster', 'system', 0), ('webmaster', 'system', 0),
  ('postmaster', 'system', 0), ('abuse', 'system', 0), ('security', 'system', 0),
  ('support', 'system', 0), ('help', 'system', 0), ('status', 'system', 0), ('docs', 'system', 0),
  ('blog', 'system', 0), ('dotlo', 'system', 0), ('login', 'system', 0), ('signin', 'system', 0),
  ('signup', 'system', 0), ('register', 'system', 0), ('account', 'system', 0), ('auth', 'system', 0),
  ('oauth', 'system', 0), ('sso', 'system', 0), ('id', 'system', 0), ('pay', 'system', 0),
  ('billing', 'system', 0), ('wallet', 'system', 0), ('bank', 'system', 0), ('secure', 'system', 0),
  ('verify', 'system', 0), ('update', 'system', 0), ('localhost', 'system', 0), ('test', 'system', 0),
  ('autodiscover', 'system', 0), ('autoconfig', 'system', 0), ('wpad', 'system', 0), ('isatap', 'system', 0),
  ('_dmarc', 'system', 0), ('_domainkey', 'system', 0);
