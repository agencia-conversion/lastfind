-- Semantic Branding, 31/10/2026: each AI is asked more than once per round (with and without web search, and twice with the brands
-- in reversed order), so a round holds several queries per AI. SQLite cannot drop the UNIQUE(round_id,engine) of 0025 in place:
-- the table is rebuilt with the same columns, ids and rows, plus `web` (1: the AI searched the web; every earlier query did), `run`
-- (0 or 1: the order of the brands, the second run reverses the first) and `brand_order_json` (the brands in the order asked; '[]'
-- for earlier queries, which always listed the project's brand first). Readings keep pointing at the same query ids. Same SQL in
-- both editions.
PRAGMA defer_foreign_keys = true;
CREATE TABLE semantic_panel_queries_v2 (
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
  UNIQUE(round_id,engine,web,run)
);
INSERT INTO semantic_panel_queries_v2(id,round_id,owner_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,input_json,response,sources_json,error,requested_at,started_at,completed_at)
  SELECT id,round_id,owner_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,input_json,response,sources_json,error,requested_at,started_at,completed_at FROM semantic_panel_queries;
DROP TABLE semantic_panel_queries;
ALTER TABLE semantic_panel_queries_v2 RENAME TO semantic_panel_queries;
CREATE INDEX idx_semantic_panel_queries_due ON semantic_panel_queries(status,requested_at);
CREATE INDEX idx_semantic_panel_queries_budget ON semantic_panel_queries(requested_at);
CREATE INDEX idx_semantic_panel_queries_project ON semantic_panel_queries(project_id,requested_at);
PRAGMA defer_foreign_keys = false;
