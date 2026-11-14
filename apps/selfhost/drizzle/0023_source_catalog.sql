-- One row per domain or URL and rubric, whatever project, prompt, day or evaluator
-- asked. The evaluator that wrote it (provider, model) is only provenance, so
-- switching evaluators never reclassifies; a new rubric is the deliberate way to.
-- source_classifications stays as it is (append-only) and is no longer written; the Worker
-- folds its rows into this table (canonical keys, newest first, no provider call).
CREATE TABLE source_catalog (
  kind TEXT NOT NULL CHECK(kind IN ('domain','url')),
  key TEXT NOT NULL,
  rubric TEXT NOT NULL,
  type TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('jev','decisions')),
  model TEXT NOT NULL,
  job_id TEXT,
  classified_at TEXT NOT NULL,
  PRIMARY KEY(kind,key,rubric)
);
--> statement-breakpoint
CREATE INDEX idx_source_catalog_type ON source_catalog(rubric,kind,type);
