-- The Semantic Branding panel collects on its own. Per period, one round per project asks each AI one question that covers
-- every brand and attribute; the notes, their reasons, the cited sources and the cost are kept here. Additive: nothing existing changes.
-- The frequency of a project lives in its own table (absent row = weekly), so `projects` is not rewritten.
CREATE TABLE semantic_panel_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly','monthly')),
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
-- A round is the roster (brands, attributes, category) as it was asked, so a later change of the project never rewrites it.
-- `day` is the 04:00 Brasilia window of the round; the report buckets days into periods of the project's current frequency.
-- (project, frequency, period_start) is unique: a retried tick cannot open a second round for the same period.
CREATE TABLE semantic_panel_rounds (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  day TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly','monthly')),
  period_start TEXT NOT NULL,
  config_revision INTEGER NOT NULL,
  language_code TEXT NOT NULL,
  location_code INTEGER NOT NULL,
  roster_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','done')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(project_id,frequency,period_start)
);
--> statement-breakpoint
CREATE INDEX idx_semantic_panel_rounds_project_day ON semantic_panel_rounds(project_id,day);
--> statement-breakpoint
CREATE INDEX idx_semantic_panel_rounds_status ON semantic_panel_rounds(status);
--> statement-breakpoint
-- One question to one AI. An AI that gives no notes leaves no readings: absent, never a zero. `unknown` is a call whose outcome is not
-- known (the reply was lost); it stays reserved and is never sent again.
CREATE TABLE semantic_panel_queries (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES semantic_panel_rounds(id),
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  engine TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('llm','scrape')),
  model TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','submitting','submitted','completed','absent','failed','unknown','cancelled')),
  reserved_usd REAL NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL DEFAULT '{}',
  response TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(round_id,engine)
);
--> statement-breakpoint
CREATE INDEX idx_semantic_panel_queries_due ON semantic_panel_queries(status,requested_at);
--> statement-breakpoint
CREATE INDEX idx_semantic_panel_queries_budget ON semantic_panel_queries(requested_at);
--> statement-breakpoint
CREATE INDEX idx_semantic_panel_queries_project ON semantic_panel_queries(project_id,requested_at);
--> statement-breakpoint
CREATE TABLE semantic_panel_readings (
  query_id TEXT NOT NULL REFERENCES semantic_panel_queries(id),
  round_id TEXT NOT NULL REFERENCES semantic_panel_rounds(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  engine TEXT NOT NULL,
  brand TEXT NOT NULL,
  attribute TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
  reason TEXT,
  evidence TEXT,
  PRIMARY KEY(query_id,brand,attribute)
);
--> statement-breakpoint
CREATE INDEX idx_semantic_panel_readings_round ON semantic_panel_readings(round_id);
