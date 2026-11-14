-- v12: the decision model's verdict on one question about a mention of a monitored brand whose name is also a
-- common word, keyed by the exact question asked and the model asked (check_key: a digest of the model, the fixed
-- instructions and criteria of the prompt version, and the evidence). A changed answer, card, prompt or model is another
-- key, so a verdict is never applied to evidence it did not judge. `choice` is what it picked (same_business, own_offering,
-- common_word, option_1..4, other_entity or unclear), `counted` whether that counts, `p_counted` the probability mass on the
-- counting choices (NULL when the model returned none), `canary` a monitor question with a fake card (never applied).
-- brand_mention_decisions (v9) is kept and no longer read.
CREATE TABLE IF NOT EXISTS brand_mention_verdicts (
  project_id TEXT NOT NULL REFERENCES projects(id),
  check_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  brand_key TEXT NOT NULL,
  choice TEXT NOT NULL CHECK(length(choice) BETWEEN 1 AND 40),
  counted INTEGER NOT NULL CHECK(counted IN (0,1)),
  p_counted REAL CHECK(p_counted IS NULL OR (p_counted>=0 AND p_counted<=1)),
  canary INTEGER NOT NULL DEFAULT 0 CHECK(canary IN (0,1)),
  model TEXT NOT NULL,
  cost_usd REAL CHECK(cost_usd IS NULL OR cost_usd>=0),
  decided_at TEXT NOT NULL,
  -- The project's own brand (asked twice, stricter). Its question is kept when the verdict is unclear (Admin lists it for an
  -- operator, who settles it: choice 'operator').
  own INTEGER NOT NULL DEFAULT 0 CHECK(own IN (0,1)),
  request_json TEXT CHECK(request_json IS NULL OR length(request_json)<=20000),
  PRIMARY KEY(project_id,check_key)
);
CREATE INDEX IF NOT EXISTS idx_brand_mention_verdicts_unclear ON brand_mention_verdicts(project_id,own,choice);
CREATE INDEX IF NOT EXISTS idx_brand_mention_verdicts_mix ON brand_mention_verdicts(project_id,brand_key,canary,choice);
-- What each project's store still has to ask, and its common-word counters, written by the Worker at each check step so
-- Admin reads one table instead of every project store.
CREATE TABLE IF NOT EXISTS brand_mention_status (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  pending INTEGER NOT NULL CHECK(pending>=0),
  common_json TEXT,
  -- Bumped by an operator's decision in Admin: the project's questions re-open once and take the kept verdicts again.
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
-- What a project's checks may spend each month (no row: MENTION_CHECK_MONTHLY_USD; NULL: unlimited; 0: no checks), set in
-- its Settings > Competitors, the same shape as agent_curation_settings.
CREATE TABLE IF NOT EXISTS brand_mention_settings (
  project_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  monthly_usd REAL CHECK (monthly_usd IS NULL OR monthly_usd >= 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
