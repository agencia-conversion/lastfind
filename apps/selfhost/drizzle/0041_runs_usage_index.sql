-- The workspace (every app load) sums the month's credits of the account's runs: with these columns in the index it
-- reads only the index, not every run row of the month (prompt text and brand snapshot included).
CREATE INDEX IF NOT EXISTS idx_runs_owner_usage ON runs(owner_id,created_at,budget_credits,cost);
