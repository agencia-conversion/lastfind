-- The agent keeps each conversation's messages in the conversation's own Durable Object (worker/agent.ts), so the
-- message table of 0049 goes (it never held more than test conversations); a rating names a message by its id (text);
-- an artifact can also be a piece of content (an article, a page's copy). Same SQL in both editions.
DROP TABLE IF EXISTS agent_messages;
DROP TABLE IF EXISTS agent_feedback;
CREATE TABLE agent_feedback (
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, message_id, account_id)
);
CREATE TABLE agent_artifacts_next (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  conversation_id TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('report','table','brief','content')),
  content TEXT NOT NULL,
  share_token TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
INSERT INTO agent_artifacts_next(id,owner_id,project_id,conversation_id,title,kind,content,share_token,created_at,updated_at,deleted_at)
  SELECT id,owner_id,project_id,conversation_id,title,kind,content,share_token,created_at,updated_at,deleted_at FROM agent_artifacts;
DROP TABLE agent_artifacts;
ALTER TABLE agent_artifacts_next RENAME TO agent_artifacts;
CREATE INDEX IF NOT EXISTS agent_artifacts_project ON agent_artifacts(owner_id, project_id, updated_at);
