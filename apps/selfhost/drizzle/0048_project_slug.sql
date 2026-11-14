-- Project address names: each project keeps the name it got in the app's addresses (/app/<slug>), unique in its
-- workspace, and a rename never changes it. A project a plain name addresses today (letters, digits and single spaces:
-- "Conversion" is /app/conversion, the first of a name in creation order) keeps that address; the app names the others
-- the first time it lists them (app-routes.ts newProjectSlug).
ALTER TABLE projects ADD COLUMN slug TEXT;
UPDATE projects SET slug=lower(replace(trim(name),' ','-'))
WHERE archived=0 AND trim(name)<>'' AND length(trim(name))<=72 AND trim(name) NOT GLOB '*[^A-Za-z0-9 ]*' AND name NOT LIKE '%  %'
  AND lower(replace(trim(name),' ','-')) NOT IN ('admin','account','onboarding','workspaces','settings','connect','complete-profile','preview')
  AND NOT EXISTS(SELECT 1 FROM projects o WHERE o.owner_id=projects.owner_id AND o.archived=0
    AND lower(replace(trim(o.name),' ','-'))=lower(replace(trim(projects.name),' ','-'))
    AND (o.created_at<projects.created_at OR (o.created_at=projects.created_at AND o.rowid<projects.rowid)));
CREATE UNIQUE INDEX IF NOT EXISTS projects_owner_slug ON projects(owner_id,slug);
