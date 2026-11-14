-- What the decision model said about one answer's mention of a monitored brand whose name is also a common word
-- ("Conversion" in "conversion rate"): whether that answer names the company (1) or uses the word (0). One row per project,
-- answer and brand key, so a reprocess or a rebuilt project store never asks again; kept (never deleted) with its cost.
CREATE TABLE IF NOT EXISTS brand_mention_decisions (
  project_id TEXT NOT NULL REFERENCES projects(id),
  run_id TEXT NOT NULL,
  brand_key TEXT NOT NULL,
  model TEXT NOT NULL,
  mentioned INTEGER NOT NULL CHECK(mentioned IN (0,1)),
  cost_usd REAL CHECK(cost_usd IS NULL OR cost_usd>=0),
  decided_at TEXT NOT NULL,
  PRIMARY KEY(project_id,run_id,brand_key)
);
-- The checks' total (MENTION_CHECK_CAP_USD) is summed by context in every reservation.
CREATE INDEX IF NOT EXISTS idx_brand_research_context_spend ON brand_research_jobs(context_key,cost_usd,reserved_usd);
