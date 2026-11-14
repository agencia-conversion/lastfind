-- Semantic Branding, 3/11/2026: a round asks cells, and one AI has several (its interface and several models), so a round holds more
-- than one query per AI, mode and run. SQLite cannot change the UNIQUE(round_id,engine,web,run) of the table in place: it is rebuilt
-- with the same columns, ids and rows, unique per round, AI, method, model, mode and run. Readings keep pointing at the same query ids;
-- every index is created again. Same SQL in both editions.
PRAGMA defer_foreign_keys = true;
CREATE TABLE semantic_panel_queries_v3 (
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
  web INTEGER NOT NULL DEFAULT 1 CHECK(web IN (0,1)),
  run INTEGER NOT NULL DEFAULT 0 CHECK(run IN (0,1)),
  brand_order_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE(round_id,engine,method,model,web,run)
);
INSERT INTO semantic_panel_queries_v3(id,round_id,owner_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,input_json,response,sources_json,error,requested_at,started_at,completed_at,web,run,brand_order_json)
  SELECT id,round_id,owner_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,input_json,response,sources_json,error,requested_at,started_at,completed_at,web,run,brand_order_json FROM semantic_panel_queries;
DROP TABLE semantic_panel_queries;
ALTER TABLE semantic_panel_queries_v3 RENAME TO semantic_panel_queries;
CREATE INDEX idx_semantic_panel_queries_due ON semantic_panel_queries(status,requested_at);
CREATE INDEX idx_semantic_panel_queries_budget ON semantic_panel_queries(requested_at);
CREATE INDEX idx_semantic_panel_queries_project ON semantic_panel_queries(project_id,requested_at);
CREATE INDEX idx_semantic_panel_queries_spend ON semantic_panel_queries(COALESCE(started_at,requested_at),cost_usd,reserved_usd);
CREATE INDEX idx_semantic_panel_queries_project_spend ON semantic_panel_queries(project_id,COALESCE(started_at,requested_at),cost_usd,reserved_usd);
PRAGMA defer_foreign_keys = false;
