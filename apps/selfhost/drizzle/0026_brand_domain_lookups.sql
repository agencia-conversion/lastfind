-- Domains found for discovered brands: the permanent cache of the paid steps and the ledger of what they cost.
-- One row per account, normalized brand and country, so a Google search is never repeated, not even when it came back empty,
-- and no account reads another's rows. Written by the discovery request (never by reading a report); a user's domain decision
-- stays in brand_decision_events and always wins over this row.
CREATE TABLE brand_domain_lookups (
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  brand_key TEXT NOT NULL,
  location_code INTEGER NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  brand_name TEXT NOT NULL,
  -- Registrable domains the answers named for the brand (step 1), kept for the model's decision.
  candidates_json TEXT NOT NULL DEFAULT '[]',
  query TEXT,
  -- NULL: not searched. 'submitting': reserved and sent, outcome unknown until 'done'. 'unknown': the reply was lost; never resent.
  search_status TEXT CHECK(search_status IS NULL OR search_status IN ('submitting','done','unknown')),
  search_json TEXT,
  search_attempts INTEGER NOT NULL DEFAULT 0,
  search_cost_usd REAL NOT NULL DEFAULT 0,
  decision_attempts INTEGER NOT NULL DEFAULT 0,
  decision_cost_usd REAL NOT NULL DEFAULT 0,
  reserved_usd REAL NOT NULL DEFAULT 0,
  domain TEXT,
  confidence REAL,
  source TEXT CHECK(source IS NULL OR source IN ('answers','search')),
  model TEXT,
  error TEXT,
  requested_at TEXT NOT NULL,
  spent_at TEXT,
  decided_at TEXT,
  PRIMARY KEY(owner_id,brand_key,location_code)
);
--> statement-breakpoint
CREATE INDEX idx_brand_domain_lookups_project ON brand_domain_lookups(project_id,spent_at);
