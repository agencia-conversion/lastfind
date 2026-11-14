-- Settings an admin saves in the app (Admin > Providers, Admin > Classifiers). A provider credential (secret=1) is
-- sealed with AES-GCM under a key derived from SESSION_SECRET before it is written; a classifier model (secret=0) is
-- plain text. A Worker variable or secret with the same name wins over a stored credential; a stored model wins over
-- LASTFIND_CLASSIFIER_MODELS. The audit log keeps who changed which key and when, never a value.
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  secret INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  key TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_at ON admin_audit_log(at);
