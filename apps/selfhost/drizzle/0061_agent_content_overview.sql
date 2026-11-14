-- A content's Overview (both editions, same SQL): its publication fields and the comparison with Google's top 3 for
-- its main keyword, as JSON (lib/content-overview.ts).
ALTER TABLE agent_artifacts ADD COLUMN overview TEXT NOT NULL DEFAULT '';
