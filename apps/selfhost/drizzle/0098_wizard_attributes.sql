-- The New project wizard's Semantic Branding attributes (13/11/2026, lib/new-project-ai.ts): generated in the wizard, reviewed there
-- and saved with the project, so their suggestion is one more `wizard_jobs` step. The CHECK is widened by rebuilding the table, every
-- row and id kept. Append-only, identical in both editions.
CREATE TABLE wizard_jobs_next (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  step TEXT NOT NULL CHECK(step IN ('competitors','topics','prompts','comparison','attributes')),
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('submitting','completed','unsettled','failed','unknown')),
  reserved_usd REAL NOT NULL CHECK(reserved_usd>=0),
  cost_usd REAL NOT NULL DEFAULT 0 CHECK(cost_usd>=0),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);
--> statement-breakpoint
INSERT INTO wizard_jobs_next(id,owner_id,step,model,status,reserved_usd,cost_usd,requested_at,completed_at,error)
  SELECT id,owner_id,step,model,status,reserved_usd,cost_usd,requested_at,completed_at,error FROM wizard_jobs;
--> statement-breakpoint
DROP TABLE wizard_jobs;
--> statement-breakpoint
ALTER TABLE wizard_jobs_next RENAME TO wizard_jobs;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wizard_jobs_spend ON wizard_jobs(requested_at,cost_usd,reserved_usd);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wizard_jobs_open ON wizard_jobs(status,requested_at,cost_usd,reserved_usd);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_wizard_jobs_owner ON wizard_jobs(owner_id,requested_at,cost_usd,reserved_usd);
