-- New project wizard (12/11/2026): its AI suggestions of competitors, topics and prompts are asked before the project exists, so
-- each call is a row of the workspace (no project), reserved before it is sent and settled at the cost the reply reports
-- (lib/server/new-project-ai.ts). It counts in the platform's brake, the workspace's monthly cap for the wizard and, in Cloud, its
-- AI credits. Append-only, identical in both editions.
CREATE TABLE IF NOT EXISTS wizard_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  step TEXT NOT NULL CHECK(step IN ('competitors','topics','prompts')),
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('submitting','completed','unsettled','failed','unknown')),
  reserved_usd REAL NOT NULL CHECK(reserved_usd>=0),
  cost_usd REAL NOT NULL DEFAULT 0 CHECK(cost_usd>=0),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_wizard_jobs_spend ON wizard_jobs(requested_at,cost_usd,reserved_usd);
CREATE INDEX IF NOT EXISTS idx_wizard_jobs_open ON wizard_jobs(status,requested_at,cost_usd,reserved_usd);
CREATE INDEX IF NOT EXISTS idx_wizard_jobs_owner ON wizard_jobs(owner_id,requested_at,cost_usd,reserved_usd);
