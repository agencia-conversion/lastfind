-- Artifacts gain a general kind, document: what the agent writes when nobody asked for a report, a table, a brief or a piece
-- of marketing content. SQLite cannot change a CHECK in place, so the table is rebuilt with every row and column as it is
-- (Brain and Memory files included) and its indexes; no foreign key or trigger points at it. Same SQL in both editions.
CREATE TABLE agent_artifacts_next (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  conversation_id TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('report','table','brief','content','document')),
  content TEXT NOT NULL,
  share_token TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  live INTEGER NOT NULL DEFAULT 0 CHECK (live IN (0, 1)),
  updated_by TEXT,
  brain INTEGER NOT NULL DEFAULT 0 CHECK (brain IN (0, 1)),
  outline TEXT NOT NULL DEFAULT '',
  research TEXT NOT NULL DEFAULT '',
  overview TEXT NOT NULL DEFAULT '',
  memory INTEGER NOT NULL DEFAULT 0 CHECK (memory IN (0, 1))
);
INSERT INTO agent_artifacts_next(id,owner_id,project_id,conversation_id,title,kind,content,share_token,created_at,updated_at,deleted_at,version,live,updated_by,brain,outline,research,overview,memory)
  SELECT id,owner_id,project_id,conversation_id,title,kind,content,share_token,created_at,updated_at,deleted_at,version,live,updated_by,brain,outline,research,overview,memory FROM agent_artifacts;
DROP TABLE agent_artifacts;
ALTER TABLE agent_artifacts_next RENAME TO agent_artifacts;
CREATE INDEX IF NOT EXISTS agent_artifacts_project ON agent_artifacts(owner_id, project_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS agent_artifacts_memory ON agent_artifacts(project_id) WHERE memory = 1 AND deleted_at IS NULL;
