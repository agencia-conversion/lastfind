-- Editable artifacts: a version the editor sends back (a write against an older one is refused, nothing is lost), whether
-- the artifact's data blocks follow the project's data (live) or keep the figures they were written with, who wrote
-- last, and the history of its versions. Same SQL in both editions.
ALTER TABLE agent_artifacts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_artifacts ADD COLUMN live INTEGER NOT NULL DEFAULT 0 CHECK (live IN (0, 1));
ALTER TABLE agent_artifacts ADD COLUMN updated_by TEXT;
CREATE TABLE IF NOT EXISTS agent_artifact_versions (
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  conversation_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, version)
);
