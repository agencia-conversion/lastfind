-- AI apps (MCP): personal access tokens and OAuth 2.1 for AI apps (Claude, ChatGPT, Cursor), both editions with the same SQL.
-- Only hashes of tokens, refresh tokens, codes and client secrets are stored. A credential is one grant (a personal access
-- token, or one app connection) of one account, bound to one workspace or to all of the account's; its tokens act as that
-- account through the edition's membership check on every call. Removing a row never touches projects or reports.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('registered','metadata')),
  name TEXT NOT NULL,
  client_uri TEXT,
  redirect_uris_json TEXT NOT NULL,
  secret_hash TEXT,
  fetched_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_clients_created ON oauth_clients(kind, created_at);
CREATE TABLE IF NOT EXISTS api_credentials (
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
CREATE INDEX IF NOT EXISTS api_credentials_account ON api_credentials(account_id, revoked_at);
CREATE INDEX IF NOT EXISTS api_credentials_previous_refresh ON api_credentials(previous_refresh_hash);
CREATE INDEX IF NOT EXISTS api_credentials_expires ON api_credentials(expires_at);
CREATE INDEX IF NOT EXISTS api_credentials_client ON api_credentials(client_id);
CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL REFERENCES api_credentials(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_tokens_credential ON api_tokens(credential_id);
CREATE INDEX IF NOT EXISTS api_tokens_expires ON api_tokens(expires_at);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  workspace_id TEXT,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_codes_expires ON oauth_codes(expires_at);
CREATE TABLE IF NOT EXISTS api_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  target TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','error','denied'))
);
CREATE INDEX IF NOT EXISTS api_audit_log_credential ON api_audit_log(credential_id, id);
CREATE INDEX IF NOT EXISTS api_audit_log_at ON api_audit_log(at);
