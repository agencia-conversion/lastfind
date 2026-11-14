-- Reads that ran on every scheduler tick and read a whole project's history (11/11/2026). Indexes only: no
-- table, row or identity changes. Same SQL in both editions.
-- The Semantic Branding sources the first screens borrow (semantic-source-rows.ts): each round's completed scraped queries by
-- the round, instead of every query of the project once per round.
CREATE INDEX IF NOT EXISTS idx_semantic_panel_queries_round ON semantic_panel_queries(round_id,status,method);
-- A reservation's runs of the slot (monitor.ts reserveRuns): by the slot's key, instead of every run the project ever had.
CREATE INDEX IF NOT EXISTS idx_runs_project_request ON runs(project_id,request_key);
