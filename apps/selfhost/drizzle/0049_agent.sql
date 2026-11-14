-- The in-app agent (same SQL in both editions): conversations per project, their messages, the artifacts it writes and
-- the spend of every turn, which is also the ledger the project's monthly agent ceiling reads.
CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS agent_conversations_project ON agent_conversations(owner_id, project_id, updated_at);
-- One chat-completions message per row (JSON), in order.
CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_messages_conversation ON agent_messages(conversation_id, id);
-- A turn holds its reserve while it runs; a finished one counts what it cost. Rows are never deleted.
CREATE TABLE IF NOT EXISTS agent_turns (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','done','failed')),
  reserved_usd REAL NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS agent_turns_project ON agent_turns(project_id, started_at);
CREATE INDEX IF NOT EXISTS agent_turns_conversation ON agent_turns(conversation_id, status);
CREATE TABLE IF NOT EXISTS agent_artifacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  conversation_id TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('report','table','brief')),
  content TEXT NOT NULL,
  share_token TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS agent_artifacts_project ON agent_artifacts(owner_id, project_id, updated_at);
