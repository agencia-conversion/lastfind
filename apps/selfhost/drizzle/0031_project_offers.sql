-- Plans or services a project registers to see which ones the answers cite (Products, "Cited in text").
-- A JSON list of { name, aliases }; empty means the feature has nothing to look for. Append-only.
ALTER TABLE projects ADD COLUMN offers_json TEXT NOT NULL DEFAULT '[]';
