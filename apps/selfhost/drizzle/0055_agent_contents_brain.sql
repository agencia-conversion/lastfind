-- Contents and the Brain (both editions, same SQL): how the project's members start a piece of content (the wizard or the
-- chat; NULL asks each time), and the one artifact per project that keeps what the team taught the agent about it.
ALTER TABLE projects ADD COLUMN agent_content_mode TEXT CHECK (agent_content_mode IN ('wizard', 'chat'));
ALTER TABLE agent_artifacts ADD COLUMN brain INTEGER NOT NULL DEFAULT 0 CHECK (brain IN (0, 1));
CREATE UNIQUE INDEX IF NOT EXISTS agent_artifacts_brain ON agent_artifacts(project_id) WHERE brain = 1 AND deleted_at IS NULL;
