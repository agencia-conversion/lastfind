-- Decision roots (9/11/2026): what the deterministic steps in front of the decision model remember. Append-only, identical in both
-- editions; no row or identity of an existing table changes.
-- A brand's sentiment reading per project, keyed by a digest of the rubric, the adapter, the model, the brand and the evidence
-- windows the model read: the same windows read on another day take the saved reading instead of a new call. Per project only.
CREATE TABLE IF NOT EXISTS sentiment_window_readings (
  project_id TEXT NOT NULL REFERENCES projects(id),
  window_key TEXT NOT NULL,
  reading_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,window_key)
);
-- A domain decision taken over public facts only (the search results, no domain from the account's answers), keyed by a digest
-- of the rubric, the brand, the country, the language, the category and the candidates: another lookup with the same key takes
-- the domain without a call. Null for decisions that weighed an account's answers (never shared) and for earlier rows.
ALTER TABLE brand_domain_lookups ADD COLUMN decision_key TEXT;
CREATE INDEX IF NOT EXISTS idx_brand_domain_lookups_decision ON brand_domain_lookups(decision_key) WHERE decision_key IS NOT NULL;
-- The digest of the project category a role verdict was given under: another project of the same workspace with the same
-- category reuses a verdict that does not depend on its tracked brands (competitor, no brand). Null for earlier verdicts.
ALTER TABLE brand_role_decisions ADD COLUMN category_digest TEXT;
CREATE INDEX IF NOT EXISTS idx_brand_role_decisions_category ON brand_role_decisions(category_digest,model,brand_key) WHERE category_digest IS NOT NULL;
