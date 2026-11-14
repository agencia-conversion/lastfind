-- Background project restores (Settings > Project data). The owner uploads the file once to the private bucket under
-- restores/v1/<owner>/<project>/<id>.ndjson (or picks a stored backup); a restore driver's alarm then makes the
-- automatic backup of the current state, uploads the verified rows into a new generation and switches it, so closing the
-- page does not stop it. This row is its status for the app. At most one uploads or runs per project.
CREATE TABLE IF NOT EXISTS project_restores (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  requested_by TEXT,
  status TEXT NOT NULL CHECK (status IN ('uploading','running','done','failed')),
  step TEXT NOT NULL DEFAULT 'saving' CHECK (step IN ('saving','uploading','verifying')),
  label TEXT NOT NULL,
  backup_id TEXT,
  object_key TEXT,
  upload_id TEXT,
  upload_parts_json TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT,
  generation TEXT,
  safety_backup_id TEXT,
  state_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_restores_project ON project_restores(project_id, owner_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_restores_active ON project_restores(project_id) WHERE status IN ('uploading','running');
-- The publication revision a backup was made at: a second request for the same unchanged data gets that backup back.
ALTER TABLE project_backups ADD COLUMN revision INTEGER;
