-- Artifacts (both editions, same SQL): a conversation may belong to one artifact (its chat beside it, as many as the
-- person starts), a content keeps its outline and its research beside the text, and the Brain becomes a set of files.
ALTER TABLE agent_conversations ADD COLUMN artifact_id TEXT;
CREATE INDEX IF NOT EXISTS agent_conversations_artifact ON agent_conversations(artifact_id, account_id) WHERE artifact_id IS NOT NULL;
ALTER TABLE agent_artifacts ADD COLUMN outline TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_artifacts ADD COLUMN research TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS agent_artifacts_brain;
