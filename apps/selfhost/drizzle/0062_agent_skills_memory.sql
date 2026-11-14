-- Agent skills and memory (both editions, same SQL): the workspace's skills (its own, and the bundled ones it changed: same
-- name, the row wins; their history is in agent_artifact_versions), which skill version each answer used, the Brain's Memory
-- file, the reason and comment of a rating, a conversation's summary and how far the curator read it (when, up to which message), and the curator's
-- monthly cap per project (no row: the default; NULL: unlimited; 0: learning off).
CREATE TABLE IF NOT EXISTS agent_skills (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('builtin', 'user', 'agent')),
  base_hash TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_skills_name ON agent_skills(owner_id, name) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS agent_skill_uses (
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  skill TEXT NOT NULL,
  version INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, message_id, skill)
);
CREATE INDEX IF NOT EXISTS agent_skill_uses_skill ON agent_skill_uses(owner_id, skill, version, created_at);
ALTER TABLE agent_artifacts ADD COLUMN memory INTEGER NOT NULL DEFAULT 0 CHECK (memory IN (0, 1));
CREATE UNIQUE INDEX IF NOT EXISTS agent_artifacts_memory ON agent_artifacts(project_id) WHERE memory = 1 AND deleted_at IS NULL;
ALTER TABLE agent_feedback ADD COLUMN reason TEXT CHECK (reason IS NULL OR reason IN ('numbers', 'tone', 'missing', 'long', 'other'));
ALTER TABLE agent_feedback ADD COLUMN comment TEXT CHECK (comment IS NULL OR length(comment) <= 1000);
ALTER TABLE agent_conversations ADD COLUMN summary TEXT;
ALTER TABLE agent_conversations ADD COLUMN curated_at TEXT;
ALTER TABLE agent_conversations ADD COLUMN curated_through TEXT;
CREATE TABLE IF NOT EXISTS agent_curation_settings (
  project_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  monthly_usd REAL CHECK (monthly_usd IS NULL OR monthly_usd >= 0),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
