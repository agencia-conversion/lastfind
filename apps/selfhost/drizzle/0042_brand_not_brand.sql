-- A sixth verdict of the decision model (structure-v6): not_brand, a name that is no company, product line,
-- service or organization at all (the title of a work, a person, a heading); it leaves the Brands list and stays out.
-- SQLite cannot widen a CHECK in place, so both verdict tables are rebuilt with the same columns, keys and index.
-- Per question, the rows settled as "mention" or "ambiguous" under the old criteria (which bundled titles and fragments
-- with cited sources) are not carried over, so the next pass (a new detector) asks those names again. Every per-name
-- verdict is kept: a name met only in running text is asked per name once, and without its verdict it would wait in
-- review for good. The spend stays audited in brand_research_jobs, which is untouched.
CREATE TABLE brand_role_decisions_v2 (
  project_id TEXT NOT NULL REFERENCES projects(id),
  brand_key TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('competitor','client','supplier','partner','mention','not_brand','ambiguous')),
  cost_usd REAL CHECK(cost_usd IS NULL OR cost_usd>=0),
  decided_at TEXT NOT NULL,
  PRIMARY KEY(project_id,brand_key,model)
);
INSERT INTO brand_role_decisions_v2(project_id,brand_key,model,role,cost_usd,decided_at)
  SELECT project_id,brand_key,model,role,cost_usd,decided_at FROM brand_role_decisions;
DROP TABLE brand_role_decisions;
ALTER TABLE brand_role_decisions_v2 RENAME TO brand_role_decisions;

CREATE TABLE brand_question_roles_v2 (
  project_id TEXT NOT NULL REFERENCES projects(id),
  question_key TEXT NOT NULL,
  brand_key TEXT NOT NULL,
  model TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('competitor','client','supplier','partner','mention','not_brand','ambiguous')),
  question TEXT NOT NULL,
  cost_usd REAL CHECK(cost_usd IS NULL OR cost_usd>=0),
  decided_at TEXT NOT NULL,
  PRIMARY KEY(project_id,question_key,brand_key,model)
);
INSERT INTO brand_question_roles_v2(project_id,question_key,brand_key,model,role,question,cost_usd,decided_at)
  SELECT project_id,question_key,brand_key,model,role,question,cost_usd,decided_at FROM brand_question_roles WHERE role NOT IN ('mention','ambiguous');
DROP TABLE brand_question_roles;
ALTER TABLE brand_question_roles_v2 RENAME TO brand_question_roles;
CREATE INDEX IF NOT EXISTS idx_brand_question_roles_names ON brand_question_roles(project_id,model,brand_key,role);
