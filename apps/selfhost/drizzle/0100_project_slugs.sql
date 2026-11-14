-- Project slugs (13/11/2026; before 0.1, no older address kept): the app's addresses name a project by its slug, unique in
-- its workspace (projects_owner_slug), drawn from its name (its own name, else the brand's) as app-routes.ts slugBase does:
-- accents folded, lowercase ASCII, other characters a single hyphen, cut to 40. A repeated name in a workspace, or a reserved
-- word, takes the next number in creation order ("conversion-2", "admin-2"), the active projects first. Every project is
-- named again here, so the older slugs (some ended in four characters drawn from the id) follow the same rule. A slug this
-- leaves out (a name another project's numbered slug already took) is given by the app on its first read (storeProjectSlugs).
-- The six-character project code is gone from the addresses: its index and column are dropped.
UPDATE projects SET slug=NULL;
CREATE TABLE project_slug_backfill AS
WITH RECURSIVE chars(id,owner_id,archived,created_at,rest,out) AS (
  SELECT id,owner_id,archived,created_at,lower(substr(trim(COALESCE(NULLIF(trim(display_name),''),name)),1,80)),'' FROM projects
  UNION ALL
  SELECT id,owner_id,archived,created_at,substr(rest,2),out||CASE
    WHEN substr(rest,1,1) GLOB '[a-z0-9]' THEN substr(rest,1,1)
    WHEN instr('àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',substr(rest,1,1))>0 THEN substr('aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy',instr('àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',substr(rest,1,1)),1)
    WHEN out='' OR substr(out,-1)='-' THEN ''
    ELSE '-' END
  FROM chars WHERE rest<>''
),
bases AS (SELECT id,owner_id,archived,created_at,COALESCE(NULLIF(rtrim(substr(out,1,40),'-'),''),'untitled') base FROM chars WHERE rest=''),
numbered AS (SELECT id,base,ROW_NUMBER() OVER (PARTITION BY owner_id,base ORDER BY archived,created_at,id)+(base IN ('app','admin','api','settings','new','login','logout','signin','sign-in','signup','sign-up','register','onboarding','connect','complete-profile','preview','setup','account','accounts','workspace','workspaces','project','projects','demo','docs','help','support','billing','oauth','mcp','shared','artifact','static','assets','public','www','lastfind')) n FROM bases)
SELECT id,CASE WHEN n=1 THEN base ELSE base||'-'||n END slug FROM numbered;
UPDATE OR IGNORE projects SET slug=(SELECT slug FROM project_slug_backfill b WHERE b.id=projects.id);
DROP TABLE project_slug_backfill;
DROP INDEX IF EXISTS projects_code;
ALTER TABLE projects DROP COLUMN code;
