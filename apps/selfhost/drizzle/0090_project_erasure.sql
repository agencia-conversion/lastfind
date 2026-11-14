-- Deleting a project (10/11/2026): `deleted_at` when the owner deleted it (it is archived and gone from every screen
-- from then on), `erased_at` when the scheduler finished erasing what it held (lib/server/project-erase.ts). The row stays as
-- a tombstone. Append-only, identical in both editions.
ALTER TABLE projects ADD COLUMN deleted_at TEXT;
ALTER TABLE projects ADD COLUMN erased_at TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_erasing ON projects(deleted_at) WHERE deleted_at IS NOT NULL AND erased_at IS NULL;
