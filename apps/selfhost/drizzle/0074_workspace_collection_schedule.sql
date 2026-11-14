-- Both editions, same SQL: the collection's day and hour are chosen in the workspace's time zone. The time zone
-- belongs to the workspace (its owner account): every workspace with a project gets America/Sao_Paulo, where it collected until now; one
-- without a project yet takes the browser's when its first project is created (none stored reads as America/Sao_Paulo).
-- `collection_hour` was a UTC hour and is now the local one: São Paulo is UTC-3 all year, so each hour moves back three and every project still collects at the same instant. `collection_day` is the weekday of a weekly collection
-- (0 Sunday to 6 Saturday): Monday, or Sunday for a Monday slot before 03:00 UTC, which was Sunday evening in São Paulo.
ALTER TABLE accounts ADD COLUMN time_zone TEXT;
UPDATE accounts SET time_zone='America/Sao_Paulo' WHERE id IN (SELECT owner_id FROM projects);
ALTER TABLE projects ADD COLUMN collection_day INTEGER NOT NULL DEFAULT 1 CHECK(collection_day BETWEEN 0 AND 6);
UPDATE projects SET collection_day=CASE WHEN collection_hour<3 THEN 0 ELSE 1 END,collection_hour=(collection_hour+21)%24;
