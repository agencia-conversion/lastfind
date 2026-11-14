-- Skill lifecycle and learning from repeated work (both editions, same SQL): a skill's status and why, the skill it merged
-- into, a change the agent proposes that waits for a person (it learned it from a conversation that read third-party
-- content), each conversation's class of task and whether it worked, and what the curator decided for each class.
ALTER TABLE agent_skills ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'deprecated', 'merged'));
ALTER TABLE agent_skills ADD COLUMN status_reason TEXT CHECK (status_reason IS NULL OR status_reason IN ('person', 'unused', 'degraded', 'full', 'merged', 'review'));
ALTER TABLE agent_skills ADD COLUMN merged_into TEXT;
ALTER TABLE agent_skills ADD COLUMN proposal TEXT;
UPDATE agent_skills SET status = 'deprecated', status_reason = 'person' WHERE enabled = 0;
ALTER TABLE agent_conversations ADD COLUMN task_kind TEXT;
ALTER TABLE agent_conversations ADD COLUMN task_ok INTEGER CHECK (task_ok IS NULL OR task_ok IN (0, 1));
CREATE INDEX IF NOT EXISTS agent_conversations_task ON agent_conversations(owner_id, task_kind, updated_at) WHERE task_kind IS NOT NULL;
CREATE TABLE IF NOT EXISTS agent_skill_kinds (
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  skill TEXT,
  conversations INTEGER NOT NULL,
  projects INTEGER NOT NULL,
  people INTEGER NOT NULL,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, kind)
);
