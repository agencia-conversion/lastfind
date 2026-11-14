-- The scheduler's and the pages' hottest D1 reads, made index reads (measured in production 6/11/2026: one tick spent about
-- 6.6 s of the database's single thread, half of it in two reads of brand_research_jobs that fetched every job row of the
-- project, about 7 KB each, to keep the few still open). Indexes only: no table, row or identity changes. Same SQL in both editions.
-- The open requests of a project by kind (`context_key LIKE 'brand-roles:%'`, `'source-types:%'`): only the rows of these
-- statuses, and the count from the index alone.
CREATE INDEX IF NOT EXISTS idx_brand_research_open ON brand_research_jobs(project_id,owner_id,status,context_key);
-- The source-type catalog's revision (COUNT and MAX(classified_at) of the rubric) from the index alone.
CREATE INDEX IF NOT EXISTS idx_source_catalog_revision ON source_catalog(rubric,classified_at);
-- A project's per-name role verdicts for the current models, from the index alone.
CREATE INDEX IF NOT EXISTS idx_brand_role_decisions_model ON brand_role_decisions(project_id,model,brand_key,role);
