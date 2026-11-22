CREATE TABLE signup_devices (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  browser_key TEXT NOT NULL UNIQUE,
  fingerprint_key TEXT UNIQUE
);
