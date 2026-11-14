-- Comparison scores (13/11/2026, lib/comparison.ts COMPARISON_METHOD): the AIs are asked a score from 0 to 100 per option and attribute,
-- each with a fact, instead of the orders of 12/11/2026. `method` tells the two apart (1: the orders, kept and no longer counted; 2: the
-- scores), and a period asked one way may be asked again the other way, so it joins the run's unique key. The CHECK and the UNIQUE cannot
-- change in place: the table is rebuilt, every row and id kept (method 1). Append-only, identical in both editions.
CREATE TABLE comparison_runs_next (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  day TEXT NOT NULL,
  period_start TEXT NOT NULL,
  product_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  method INTEGER NOT NULL DEFAULT 1 CHECK(method IN (1,2)),
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
  UNIQUE(project_id,period_start,product_id,persona_id,engine,method)
);
--> statement-breakpoint
INSERT INTO comparison_runs_next(id,owner_id,project_id,day,period_start,product_id,persona_id,engine,method,question,roster_json,language_code,location_code,status,reserved_usd,cost_usd,input_json,response,sources_json,reading_json,error,requested_at,started_at,completed_at)
  SELECT id,owner_id,project_id,day,period_start,product_id,persona_id,engine,1,question,roster_json,language_code,location_code,status,reserved_usd,cost_usd,input_json,response,sources_json,reading_json,error,requested_at,started_at,completed_at FROM comparison_runs;
--> statement-breakpoint
DROP TABLE comparison_runs;
--> statement-breakpoint
ALTER TABLE comparison_runs_next RENAME TO comparison_runs;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_runs_due ON comparison_runs(status,requested_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_runs_project ON comparison_runs(project_id,status,requested_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_runs_spend ON comparison_runs(COALESCE(started_at,requested_at),cost_usd,reserved_usd);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_runs_project_spend ON comparison_runs(project_id,COALESCE(started_at,requested_at),cost_usd,reserved_usd);
--> statement-breakpoint
-- The report reads a project's scored answers of a period (method 2), by product.
CREATE INDEX IF NOT EXISTS idx_comparison_runs_report ON comparison_runs(project_id,method,status,requested_at);
