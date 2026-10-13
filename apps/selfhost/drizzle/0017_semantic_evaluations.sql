CREATE TABLE semantic_configurations (
  project_id TEXT NOT NULL REFERENCES projects(id),
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  revision INTEGER NOT NULL,
  configuration_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,revision)
);
--> statement-breakpoint
CREATE TABLE semantic_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  config_revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  reserved_usd REAL NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL,
  answer_sha256 TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT,
  UNIQUE(run_id,config_revision)
);
--> statement-breakpoint
CREATE INDEX idx_semantic_jobs_due ON semantic_jobs(status,requested_at);
--> statement-breakpoint
CREATE INDEX idx_semantic_jobs_budget ON semantic_jobs(requested_at);
--> statement-breakpoint
CREATE TABLE semantic_evaluations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  config_revision INTEGER NOT NULL,
  assessment_json TEXT NOT NULL,
  answer_sha256 TEXT NOT NULL,
  rubric TEXT NOT NULL,
  model TEXT NOT NULL,
  coverage TEXT NOT NULL,
  cost_usd REAL NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id,config_revision)
);
--> statement-breakpoint
CREATE INDEX idx_semantic_evaluations_project_date ON semantic_evaluations(project_id,created_at);
--> statement-breakpoint
CREATE TRIGGER project_publication_semantic_insert AFTER INSERT ON semantic_evaluations BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at)
    VALUES(NEW.project_id,NEW.owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  UPDATE project_stores SET source_revision=source_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE project_id=NEW.project_id;
  INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
    SELECT NEW.project_id,'semantic_evaluations',NEW.id,source_revision,'upsert',
      json_object('id',NEW.id,'owner_id',NEW.owner_id,'project_id',NEW.project_id,
        'run_id',NEW.run_id,'config_revision',NEW.config_revision,
        'assessment_json',NEW.assessment_json,'answer_sha256',NEW.answer_sha256,
        'rubric',NEW.rubric,'model',NEW.model,'coverage',NEW.coverage,
        'cost_usd',NEW.cost_usd,'created_at',NEW.created_at)
    FROM project_stores WHERE project_id=NEW.project_id;
END;
