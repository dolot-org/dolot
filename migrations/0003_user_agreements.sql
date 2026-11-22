CREATE TABLE user_agreements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, version)
);
