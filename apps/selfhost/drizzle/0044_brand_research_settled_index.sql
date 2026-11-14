-- The first screens' warm-up (first-screen-warm.ts) asks, for each project every few minutes, when a reading last settled
-- (sentiment, brand roles, source types): with this index that is one seek, not a read of every job row and its JSON.
CREATE INDEX IF NOT EXISTS idx_brand_research_settled ON brand_research_jobs(project_id,status,completed_at);
