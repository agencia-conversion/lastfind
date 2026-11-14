-- An outbox row that can never be published (its payload missing or unreadable, or larger than one request to
-- the project's store) is moved here instead of holding the project's publication for good. Health and Admin count them; an
-- operator republishes the project (Admin > Overview) once the cause is fixed. Only ids, sizes and the reason: never a payload.
CREATE TABLE IF NOT EXISTS project_store_dead_letters (
  project_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('payload_missing','payload_too_large')),
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id,entity,entity_id,revision)
);
