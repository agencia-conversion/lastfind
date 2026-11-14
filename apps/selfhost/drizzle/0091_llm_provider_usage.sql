-- Model providers in order (12/11/2026): the day's tally per provider and task that Admin > Providers and Admin > Usage and
-- costs show (lib/server/model-routes.ts): calls served, what they cost (computed from the provider's tokens and list price,
-- or OpenRouter's reported cost; `unpriced` counts calls with no computable cost), and the failures that moved a call to the
-- next provider, with the last reason. One row per day, provider and task; a call adds to it. Append-only, identical in both
-- editions.
CREATE TABLE IF NOT EXISTS llm_provider_usage (
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  task TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  failovers INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  unpriced INTEGER NOT NULL DEFAULT 0,
  last_at TEXT,
  last_model TEXT,
  last_error TEXT,
  last_error_at TEXT,
  PRIMARY KEY (day, provider, task)
);
