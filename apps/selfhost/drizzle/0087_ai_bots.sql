-- AI bots (10/11/2026): a project's connection to its own Cloudflare zone analytics, read-only. Append-only, identical in both
-- editions; no row or identity of an existing table changes. The daily rows the collector reads live in the project's store
-- (bot_hits, bot_days, bot_referrals, site_paths); here only the connection and where its collection stands.
-- The token is sealed under CREDENTIALS_KEY (lib/server/platform-settings.ts sealSecret) and never sent back; `token_hint` is
-- its last four characters. `state`: `zone` (token saved, zone to choose), `active` or `invalid` (`problem` says why).
-- `preview` marks example data written on a preview, never a real zone. `synced_through` is the last whole UTC day stored.
CREATE TABLE IF NOT EXISTS ai_bot_connections (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  owner_id TEXT NOT NULL,
  token_sealed TEXT,
  token_hint TEXT,
  zone_id TEXT,
  zone_name TEXT,
  plan TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL,
  problem TEXT,
  preview INTEGER NOT NULL DEFAULT 0,
  connected_at TEXT NOT NULL,
  connected_by TEXT,
  last_sync_at TEXT,
  synced_through TEXT,
  next_sync_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_bot_connections_due ON ai_bot_connections(next_sync_at) WHERE state='active' AND preview=0;
