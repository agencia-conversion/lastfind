-- v13: the project's own brand's businesses named like it elsewhere, found once by a chat model with web search, per
-- project and search key (a digest of the model and the card searched for: name, domains, category, market, topics). Its
-- questions list them as options of their own. Kept, never deleted; a changed card or model searches again.
CREATE TABLE IF NOT EXISTS brand_mention_homonyms (
  project_id TEXT NOT NULL REFERENCES projects(id),
  search_key TEXT NOT NULL,
  homonyms_json TEXT NOT NULL CHECK(length(homonyms_json)<=8000),
  model TEXT NOT NULL,
  cost_usd REAL CHECK(cost_usd IS NULL OR cost_usd>=0),
  searched_at TEXT NOT NULL,
  PRIMARY KEY(project_id,search_key)
);
-- v13: the reader's verdict on what the own brand's tie-breaker left unclear (a chat model reads the same window and quotes
-- the text that decides it), under its own key and the parent question's (`parent_key`, a brand_mention_verdicts key).
-- `entity` card, homonym, other, unclear or failed; `settled` when it decided (the card counts, another entity does not,
-- each with its quote found in the text); an unsettled one is listed in Admin for an operator.
CREATE TABLE IF NOT EXISTS brand_mention_readings (
  project_id TEXT NOT NULL REFERENCES projects(id),
  check_key TEXT NOT NULL,
  parent_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  entity TEXT NOT NULL CHECK(entity IN ('card','homonym','other','unclear','failed')),
  quote TEXT CHECK(quote IS NULL OR length(quote)<=300),
  counted INTEGER NOT NULL CHECK(counted IN (0,1)),
  settled INTEGER NOT NULL CHECK(settled IN (0,1)),
  model TEXT NOT NULL,
  cost_usd REAL CHECK(cost_usd IS NULL OR cost_usd>=0),
  decided_at TEXT NOT NULL,
  PRIMARY KEY(project_id,check_key)
);
CREATE INDEX IF NOT EXISTS idx_brand_mention_readings_parent ON brand_mention_readings(project_id,parent_key,model);
