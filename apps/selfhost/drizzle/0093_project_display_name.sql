-- A project's own name, apart from its brand (12/11/2026): `name` stays the brand that answers are read for; `display_name` is
-- what the switcher and Settings > Projects show. Null means the brand's name, so every existing project keeps its name with no
-- write. Append-only, identical in both editions.
ALTER TABLE projects ADD COLUMN display_name TEXT;
