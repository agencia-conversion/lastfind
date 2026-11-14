-- What the decision model concluded a discovered name is to a project in the answers to one question (the
-- buyer's question read with the answers' excerpts): competitor, client, supplier, partner or only a mention.
-- One row per project, question, name key and model, so a name is never asked again for that question; kept
-- (never deleted) with its cost share. The project's role of a name is the aggregate of its rows.
CREATE TABLE IF NOT EXISTS brand_question_roles (
  project_id TEXT NOT NULL REFERENCES projects(id),
  question_key TEXT NOT NULL,
  brand_key TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('competitor','client','supplier','partner','mention','ambiguous')),
  question TEXT NOT NULL,
  cost_usd REAL CHECK(cost_usd IS NULL OR cost_usd>=0),
  decided_at TEXT NOT NULL,
  PRIMARY KEY(project_id,question_key,brand_key,model)
);
