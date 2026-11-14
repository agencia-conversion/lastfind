-- Workspaces (13/11/2026): the same model as Cloud's 0111, with one workspace. The installation's account row becomes its
-- workspace (`accounts` renamed `workspaces`, so every table that pointed at it now points at the workspace, with no copy of the
-- data) and keeps its id; a new `accounts` holds the person (email, name) with the same id. The tables that point at a person
-- (column preferences, AI app tokens) are rebuilt to point at the new `accounts`. `owner_id` columns that named the workspace
-- are renamed `workspace_id`; `workspaces.owner_id` is the person who owns it.
PRAGMA defer_foreign_keys = on;
DROP INDEX IF EXISTS idx_accounts_email_lower;
ALTER TABLE accounts RENAME TO workspaces;
CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO accounts(id,email,name,created_at) SELECT id,email,name,created_at FROM workspaces;
CREATE INDEX idx_accounts_email_lower ON accounts(lower(email));
ALTER TABLE workspaces DROP COLUMN email;
ALTER TABLE workspaces ADD COLUMN owner_id TEXT REFERENCES accounts(id);
UPDATE workspaces SET owner_id=id;
CREATE INDEX workspaces_owner ON workspaces(owner_id);

CREATE TABLE table_column_preferences_next (
  user_id TEXT NOT NULL REFERENCES accounts(id),
  table_key TEXT NOT NULL,
  hidden_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, table_key)
);
INSERT INTO table_column_preferences_next SELECT user_id,table_key,hidden_json,updated_at FROM table_column_preferences;
DROP TABLE table_column_preferences;
ALTER TABLE table_column_preferences_next RENAME TO table_column_preferences;

-- AI app tokens: api_tokens (ON DELETE CASCADE) is rebuilt with them, pointing at the new table before either old one is
-- dropped, so dropping the old credentials deletes no token.
CREATE TABLE api_credentials_next (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  workspace_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('pat','oauth')),
  name TEXT NOT NULL,
  client_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('lastfind:read','lastfind:read lastfind:write')),
  resource TEXT NOT NULL,
  hint TEXT,
  refresh_hash TEXT UNIQUE,
  previous_refresh_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  rate_window INTEGER NOT NULL DEFAULT 0,
  rate_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  CHECK ((kind = 'oauth') = (client_id IS NOT NULL))
);
INSERT INTO api_credentials_next SELECT id,account_id,workspace_id,kind,name,client_id,scope,resource,hint,refresh_hash,previous_refresh_hash,expires_at,created_at,last_used_at,rate_window,rate_count,revoked_at FROM api_credentials;
CREATE TABLE api_tokens_next (
  token_hash TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES api_credentials_next(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
INSERT INTO api_tokens_next SELECT token_hash,credential_id,expires_at FROM api_tokens;
DROP TABLE api_tokens;
DROP TABLE api_credentials;
ALTER TABLE api_credentials_next RENAME TO api_credentials;
ALTER TABLE api_tokens_next RENAME TO api_tokens;
CREATE INDEX api_credentials_account ON api_credentials(account_id, revoked_at);
CREATE INDEX api_credentials_previous_refresh ON api_credentials(previous_refresh_hash);
CREATE INDEX api_credentials_expires ON api_credentials(expires_at);
CREATE INDEX api_credentials_client ON api_credentials(client_id);
CREATE INDEX api_tokens_credential ON api_tokens(credential_id);
CREATE INDEX api_tokens_expires ON api_tokens(expires_at);

ALTER TABLE agent_artifacts RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE agent_conversations RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE agent_curation_settings RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE agent_project_settings RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE agent_skill_kinds RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE agent_skill_uses RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE agent_skills RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE agent_turns RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE ai_bot_connections RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE api_audit_log RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE brand_decision_events RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE brand_domain_lookups RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE brand_mention_settings RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE brand_research_configurations RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE brand_research_jobs RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE comparison_configurations RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE comparison_queries RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE comparison_rounds RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE comparison_runs RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE product_comparisons RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE project_backups RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE project_budgets RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE project_restores RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE project_stores RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE projects RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE runs RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE semantic_configurations RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE semantic_evaluations RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE semantic_jobs RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE semantic_panel_queries RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE semantic_panel_rounds RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE semantic_panel_settings RENAME COLUMN owner_id TO workspace_id;
ALTER TABLE wizard_jobs RENAME COLUMN owner_id TO workspace_id;

-- The installation's workspace has its owner's id: created with the owner's account.
CREATE TRIGGER accounts_first_workspace AFTER INSERT ON accounts BEGIN
  INSERT OR IGNORE INTO workspaces(id,name,owner_id,created_at) VALUES(NEW.id,NEW.name,NEW.id,NEW.created_at);
END;
