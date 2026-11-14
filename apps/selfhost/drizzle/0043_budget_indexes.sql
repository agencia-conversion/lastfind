-- The account ceilings (US$ 2.000 a month, US$ 64 a day) are checked inside every reservation of sentiment, roles, source types and
-- domains: they sum this month's and today's runs and research jobs. Split from the jobs still in flight, those sums read only these
-- indexes instead of every row of both tables (115k rows and ~300 ms per reservation in a preview, which reset D1 under load).
CREATE INDEX IF NOT EXISTS idx_runs_spend ON runs(created_at,cost,budget_credits);
CREATE INDEX IF NOT EXISTS idx_runs_day_spend ON runs(COALESCE(claimed_at,created_at),cost,budget_credits);
CREATE INDEX IF NOT EXISTS idx_brand_research_spend ON brand_research_jobs(requested_at,cost_usd,reserved_usd);
