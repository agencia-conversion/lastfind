-- New project (12/11/2026): Semantic Branding set up with the project by default. `semantic_setup_at` marks a project whose setup
-- the scheduler still has to run (its attribute suggestion takes longer than a request may wait); it is cleared when the scheduler
-- takes it. Only new projects ever hold it, so the partial index is empty almost always and the scheduler's look reads nothing.
-- Append-only, identical in both editions.
ALTER TABLE projects ADD COLUMN semantic_setup_at TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_semantic_setup ON projects(semantic_setup_at) WHERE semantic_setup_at IS NOT NULL;
