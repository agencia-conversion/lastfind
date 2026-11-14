-- The hour (UTC) of each project's collection, chosen by its owner in Settings > Monitoring. 7 (04:00 São Paulo) keeps every
-- existing project on the window it already had; `interval_hours` (24 daily, 168 weekly) stays the frequency.
ALTER TABLE projects ADD COLUMN collection_hour INTEGER NOT NULL DEFAULT 7 CHECK(collection_hour BETWEEN 0 AND 23);
