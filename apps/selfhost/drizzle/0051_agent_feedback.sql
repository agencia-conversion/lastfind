-- The person's rating of an agent answer (same SQL in both editions): one per answer and account, +1 or -1.
CREATE TABLE IF NOT EXISTS agent_feedback (
  conversation_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, message_id, account_id)
);
