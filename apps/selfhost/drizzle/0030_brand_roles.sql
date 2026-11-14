-- What the decision model concluded a discovered name is to a project: competitor,
-- client, supplier, partner or only a mention. One row per project, name key and
-- model, so a later analysis never asks the model again; kept (never deleted) with
-- its cost so the spend per project is auditable.
-- IF NOT EXISTS: the PR preview databases had applied this file under its first number (0026).
CREATE TABLE IF NOT EXISTS brand_role_decisions (
  project_id TEXT NOT NULL REFERENCES projects(id),
  brand_key TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('competitor','client','supplier','partner','mention','ambiguous')),
  cost_usd REAL CHECK(cost_usd IS NULL OR cost_usd>=0),
  decided_at TEXT NOT NULL,
  PRIMARY KEY(project_id,brand_key,model)
);
