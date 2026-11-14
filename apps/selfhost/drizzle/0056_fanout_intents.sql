-- The search intents of a project's query fan-out. A generative model groups the searches the AIs ran into
-- intents (a short name, a one-line description, the main entities) and assigns each normalized search key to one of
-- them, or to none (`intent_id` NULL: a search that fits no intent). Only searches without a row are ever asked, so a
-- search is classified once; intents are kept (never deleted) so a project's grouping stays stable. Same SQL in both editions.
CREATE TABLE IF NOT EXISTS fanout_intents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  entities_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fanout_intents_project ON fanout_intents(project_id);
CREATE TABLE IF NOT EXISTS fanout_query_intents (
  project_id TEXT NOT NULL REFERENCES projects(id),
  query_key TEXT NOT NULL,
  intent_id TEXT REFERENCES fanout_intents(id),
  model TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (project_id, query_key)
);
