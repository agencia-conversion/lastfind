-- Background project backups (Settings > Project data). The file is written by the project store's alarm to the private
-- bucket under backups/v1/<owner>/<project>/<id>/ in numbered parts; this row is its status for the app. At most one
-- runs per project. Expired rows keep their fingerprint (row counts and chained digests of the footer), so a file
-- Lastfind made can still be recognized when the owner restores it after its copy in storage is gone.
CREATE TABLE IF NOT EXISTS project_backups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  requested_by TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','ready','failed','expired')),
  parts INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_project_backups_project ON project_backups(project_id, owner_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_backups_running ON project_backups(project_id) WHERE status='running';
