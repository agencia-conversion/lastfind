-- Data retention (11/11/2026): how long a project keeps the raw form of its answers (text, provider response, the
-- excerpts the decision models read), in days; NULL keeps everything. A new project takes 90 days (the column's default);
-- every project that exists now is set to NULL, so nothing is removed until its owner or the operator chooses. Append-only:
-- no row, identity or other value changes.
ALTER TABLE projects ADD COLUMN raw_retention_days INTEGER DEFAULT 90;
UPDATE projects SET raw_retention_days=NULL;
-- When a run's original provider response was removed by retention (its other columns stay, so publication is untouched).
ALTER TABLE runs ADD COLUMN raw_purged_at TEXT;
-- The runs whose raw form is still kept, by project and date: the retention step reads only those.
CREATE INDEX IF NOT EXISTS idx_runs_raw_kept ON runs(project_id,created_at) WHERE raw_purged_at IS NULL;
-- The decision-model jobs and Semantic Branding questions that still hold the raw text they read or answered: the retention
-- step reads only those, never the ones it already emptied.
CREATE INDEX IF NOT EXISTS idx_brand_research_raw_kept ON brand_research_jobs(project_id,requested_at) WHERE input_json<>'{}';
CREATE INDEX IF NOT EXISTS idx_semantic_panel_queries_raw_kept ON semantic_panel_queries(project_id,requested_at) WHERE response IS NOT NULL OR input_json<>'{}';
