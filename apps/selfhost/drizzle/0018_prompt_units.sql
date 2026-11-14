ALTER TABLE projects ADD COLUMN engines_json TEXT NOT NULL DEFAULT '["chat_gpt"]';
ALTER TABLE topics ADD COLUMN engines_override_json TEXT;
ALTER TABLE prompts ADD COLUMN unit_id TEXT;
ALTER TABLE prompts ADD COLUMN engines_override_json TEXT;
ALTER TABLE prompts ADD COLUMN subscribed INTEGER NOT NULL DEFAULT 1;
UPDATE prompts SET unit_id=(SELECT other.id FROM prompts other WHERE other.project_id=prompts.project_id AND other.text=prompts.text COLLATE NOCASE ORDER BY other.archived,other.created_at,other.id LIMIT 1);
UPDATE prompts SET engines_override_json=(SELECT json_group_array(engine) FROM (SELECT DISTINCT engine FROM prompts other WHERE other.unit_id=prompts.unit_id AND (other.archived=0 OR NOT EXISTS(SELECT 1 FROM prompts live WHERE live.unit_id=prompts.unit_id AND live.archived=0)) ORDER BY engine));
UPDATE prompts SET engines_override_json=NULL WHERE engines_override_json='[]';
UPDATE projects SET engines_json=COALESCE((SELECT json_group_array(engine) FROM (SELECT DISTINCT engine FROM prompts WHERE project_id=projects.id AND archived=0 ORDER BY engine)), '["chat_gpt"]');
UPDATE projects SET engines_json='["chat_gpt"]' WHERE engines_json='[]';
UPDATE prompts SET subscribed=0 WHERE archived=0 AND EXISTS(SELECT 1 FROM prompts other WHERE other.unit_id=prompts.unit_id AND other.engine=prompts.engine AND other.archived=0 AND other.id<prompts.id);
-- Normalize question-level metadata without reactivating a paused channel. All original IDs and runs remain intact.
UPDATE prompts SET active=COALESCE((SELECT MIN(active) FROM prompts other WHERE other.unit_id=prompts.unit_id AND other.archived=0 AND other.subscribed=1),0),
 tags_json=(SELECT json_group_array(value) FROM (SELECT DISTINCT j.value FROM prompts other,json_each(other.tags_json) j WHERE other.unit_id=prompts.unit_id ORDER BY j.value)),
 tag=(SELECT canonical.tag FROM prompts canonical WHERE canonical.id=prompts.unit_id);
UPDATE prompts SET subscribed=0 WHERE archived=1;
UPDATE prompts SET archived=(SELECT MIN(other.archived) FROM prompts other WHERE other.unit_id=prompts.unit_id);
CREATE INDEX idx_prompts_unit ON prompts(project_id,unit_id,archived,subscribed);
DROP TRIGGER IF EXISTS project_publication_prompts_insert;
DROP TRIGGER IF EXISTS project_publication_prompts_update;
DROP TRIGGER IF EXISTS project_publication_prompts_delete;
CREATE TRIGGER IF NOT EXISTS project_publication_prompts_insert AFTER INSERT ON prompts BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) SELECT id,owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE id=NEW.project_id;
  UPDATE project_stores SET source_revision=source_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=NEW.project_id;
  INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
    SELECT NEW.project_id,'prompts',NEW.id,source_revision,'upsert',json_object('id',NEW.id,'project_id',NEW.project_id,'text',NEW.text,'unit_id',NEW.unit_id,'engines_override_json',NEW.engines_override_json,'subscribed',NEW.subscribed,'engine',NEW.engine,'tag',NEW.tag,'tags_json',NEW.tags_json,'next_run_at',NEW.next_run_at,'active',NEW.active,'archived',NEW.archived,'created_at',NEW.created_at) FROM project_stores WHERE project_id=NEW.project_id
    ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,data_json=json_set(COALESCE(project_store_outbox.data_json,'{}'),'$.id',NEW.id,'$.project_id',NEW.project_id,'$.text',NEW.text,'$.unit_id',NEW.unit_id,'$.engines_override_json',NEW.engines_override_json,'$.subscribed',NEW.subscribed,'$.engine',NEW.engine,'$.tag',NEW.tag,'$.tags_json',NEW.tags_json,'$.next_run_at',NEW.next_run_at,'$.active',NEW.active,'$.archived',NEW.archived,'$.created_at',NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_publication_prompts_update AFTER UPDATE OF unit_id,engines_override_json,subscribed,text,engine,tag,tags_json,next_run_at,active,archived,created_at ON prompts WHEN OLD.unit_id IS NOT NEW.unit_id OR OLD.engines_override_json IS NOT NEW.engines_override_json OR OLD.subscribed IS NOT NEW.subscribed OR OLD.text IS NOT NEW.text OR OLD.engine IS NOT NEW.engine OR OLD.tag IS NOT NEW.tag OR OLD.tags_json IS NOT NEW.tags_json OR OLD.next_run_at IS NOT NEW.next_run_at OR OLD.active IS NOT NEW.active OR OLD.archived IS NOT NEW.archived OR OLD.created_at IS NOT NEW.created_at BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) SELECT id,owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE id=NEW.project_id;
  UPDATE project_stores SET source_revision=source_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=NEW.project_id;
  INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
    SELECT NEW.project_id,'prompts',NEW.id,source_revision,'upsert',json_object('id',NEW.id,'project_id',NEW.project_id,'text',NEW.text,'unit_id',NEW.unit_id,'engines_override_json',NEW.engines_override_json,'subscribed',NEW.subscribed,'engine',NEW.engine,'tag',NEW.tag,'tags_json',NEW.tags_json,'next_run_at',NEW.next_run_at,'active',NEW.active,'archived',NEW.archived,'created_at',NEW.created_at) FROM project_stores WHERE project_id=NEW.project_id
    ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,data_json=json_set(COALESCE(project_store_outbox.data_json,'{}'),'$.id',NEW.id,'$.project_id',NEW.project_id,'$.text',NEW.text,'$.unit_id',NEW.unit_id,'$.engines_override_json',NEW.engines_override_json,'$.subscribed',NEW.subscribed,'$.engine',NEW.engine,'$.tag',NEW.tag,'$.tags_json',NEW.tags_json,'$.next_run_at',NEW.next_run_at,'$.active',NEW.active,'$.archived',NEW.archived,'$.created_at',NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_publication_prompts_delete AFTER DELETE ON prompts BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) SELECT id,owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE id=OLD.project_id;
  UPDATE project_stores SET source_revision=source_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=OLD.project_id;
  INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
    SELECT OLD.project_id,'prompts',OLD.id,source_revision,'delete',NULL FROM project_stores WHERE project_id=OLD.project_id
    ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,data_json=NULL;
END;

UPDATE prompts SET subscribed=subscribed;
UPDATE project_stores SET source_revision=source_revision+1;
INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
 SELECT p.project_id,'prompts',p.id,s.source_revision,'upsert',json_object('id',p.id,'project_id',p.project_id,'text',p.text,'engine',p.engine,'tag',p.tag,'tags_json',p.tags_json,'next_run_at',p.next_run_at,'active',p.active,'archived',p.archived,'created_at',p.created_at,'unit_id',p.unit_id,'engines_override_json',p.engines_override_json,'subscribed',p.subscribed)
 FROM prompts p JOIN project_stores s ON s.project_id=p.project_id WHERE 1
 ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,data_json=excluded.data_json;

CREATE UNIQUE INDEX idx_prompt_unit_text ON prompts(project_id,text COLLATE NOCASE) WHERE id=unit_id AND archived=0;
CREATE UNIQUE INDEX idx_prompt_unit_engine ON prompts(unit_id,engine) WHERE subscribed=1 AND archived=0;
