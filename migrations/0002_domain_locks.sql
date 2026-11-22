CREATE TABLE domain_locks (
  subdomain_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
