-- Project codes: the app's address names a project as /app/<slug>-<code>. The code is six lowercase base36
-- characters, stored once and unique among all projects, so a link names one project whatever workspace is open (the
-- slug before it is only its name). The app stores it at creation and, for the projects that exist today, the first
-- time it lists them (app-routes.ts projectCode); a collision draws the next one.
ALTER TABLE projects ADD COLUMN code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS projects_code ON projects(code);
