CREATE TABLE brand_research_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  input_key TEXT NOT NULL,
  context_key TEXT NOT NULL,
  answer_sha256 TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','submitting','completed','unsettled','failed','unknown','cancelled')),
  reserved_usd REAL NOT NULL CHECK(reserved_usd>=0),
  cost_usd REAL NOT NULL DEFAULT 0 CHECK(cost_usd>=0),
  input_json TEXT NOT NULL,
  result_json TEXT,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  UNIQUE(project_id,input_key)
);
--> statement-breakpoint
CREATE INDEX idx_brand_research_due ON brand_research_jobs(status,requested_at);
--> statement-breakpoint
CREATE INDEX idx_brand_research_scope ON brand_research_jobs(project_id,owner_id,context_key);
