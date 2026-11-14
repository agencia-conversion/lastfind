-- Per-user hidden columns for each analytical table. Survives browsers and devices.
CREATE TABLE IF NOT EXISTS table_column_preferences (
  user_id TEXT NOT NULL REFERENCES accounts(id),
  table_key TEXT NOT NULL,
  hidden_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, table_key)
);
