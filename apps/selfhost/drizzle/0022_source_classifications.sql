CREATE TABLE source_classifications (
  kind TEXT NOT NULL CHECK(kind IN ('domain','url')),
  key TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('jev','decisions')),
  model TEXT NOT NULL,
  rubric TEXT NOT NULL,
  type TEXT NOT NULL,
  job_id TEXT,
  classified_at TEXT NOT NULL,
  PRIMARY KEY(kind,key,provider,model,rubric)
);
--> statement-breakpoint
CREATE INDEX idx_source_classifications_type ON source_classifications(provider,model,rubric,kind,type);
