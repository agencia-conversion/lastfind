-- Comparison (12/11/2026, lib/comparison.ts): for each product the project's brand sells and each persona, the AIs that take instructions
-- are asked which option is best (the brand and that product's competitors), overall and per attribute; a decision model reads each
-- answer into those orders. Append-only, identical in both editions. The tables of the October module (product_comparisons,
-- comparison_rounds, comparison_queries) stay as they were and are not read.
-- The configuration (products with their competitors and attributes, the attribute library, the personas), one revision per save.
CREATE TABLE IF NOT EXISTS comparison_configurations (
  project_id TEXT NOT NULL REFERENCES projects(id),
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  revision INTEGER NOT NULL,
  configuration_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,revision)
);
--> statement-breakpoint
-- One question to one AI for one product and persona in one period (the project's collection cadence): what it asked (roster_json, the
-- options in the order asked), what it cost (a paid ledger: reserved when the period opens, settled at the provider's cost plus the
-- reading's), the answer and its reading (reading_json: the order overall and per attribute; NULL while unread or when it could not be
-- read, never a loss).
CREATE TABLE IF NOT EXISTS comparison_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  day TEXT NOT NULL,
  period_start TEXT NOT NULL,
  product_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  question TEXT NOT NULL,
  roster_json TEXT NOT NULL,
  language_code TEXT NOT NULL,
  location_code INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','submitting','submitted','completed','absent','failed','unknown','cancelled')),
  reserved_usd REAL NOT NULL DEFAULT 0 CHECK(reserved_usd>=0),
  cost_usd REAL NOT NULL DEFAULT 0 CHECK(cost_usd>=0),
  input_json TEXT NOT NULL DEFAULT '{}',
  response TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  reading_json TEXT,
  error TEXT,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(project_id,period_start,product_id,persona_id,engine)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_runs_due ON comparison_runs(status,requested_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_runs_project ON comparison_runs(project_id,status,requested_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_runs_spend ON comparison_runs(COALESCE(started_at,requested_at),cost_usd,reserved_usd);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_runs_project_spend ON comparison_runs(project_id,COALESCE(started_at,requested_at),cost_usd,reserved_usd);
--> statement-breakpoint
-- The New project wizard's Comparison step (lib/new-project-ai.ts): its suggestion is one more `wizard_jobs` step. The CHECK is widened
-- by rebuilding the table, every row and id kept.
CREATE TABLE wizard_jobs_next (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  step TEXT NOT NULL CHECK(step IN ('competitors','topics','prompts','comparison')),
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
