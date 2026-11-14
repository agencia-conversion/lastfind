-- The agent's monthly ceiling a project sets for itself (same SQL in both editions); without a row the installation default applies.
CREATE TABLE IF NOT EXISTS agent_project_settings (
  project_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  monthly_ceiling_usd REAL NOT NULL CHECK (monthly_ceiling_usd >= 0 AND monthly_ceiling_usd <= 1000),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
