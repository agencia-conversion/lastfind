-- Project-scoped brand decisions (confirm, reject, alias, domain, rename, undo).
-- Append-only: an undo is a new row that references the row it reverses; the state
-- (confirmed, rejected, aliases, domains) is always derived from the active rows.
-- Lives in the control database next to the competitor settings it adjusts, so the
-- D1 export already covers it.
CREATE TABLE brand_decision_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  seq INTEGER NOT NULL CHECK(seq>=1),
  kind TEXT NOT NULL CHECK(kind IN ('confirm','reject','alias','domain','rename','undo')),
  brand_key TEXT NOT NULL,
  undoes TEXT REFERENCES brand_decision_events(id),
  payload_json TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id,seq),
  UNIQUE(undoes),
  CHECK((kind='undo')=(undoes IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX idx_brand_decision_events_brand ON brand_decision_events(project_id,brand_key);
--> statement-breakpoint
CREATE TRIGGER brand_decision_events_no_update BEFORE UPDATE ON brand_decision_events BEGIN
  SELECT RAISE(ABORT,'brand_decision_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER brand_decision_events_no_delete BEFORE DELETE ON brand_decision_events BEGIN
  SELECT RAISE(ABORT,'brand_decision_events is append-only');
END;
