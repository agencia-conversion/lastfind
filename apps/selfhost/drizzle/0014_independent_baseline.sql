-- Idempotent baseline for personal installations. Existing rows are never removed.
CREATE TABLE IF NOT EXISTS accounts (id text PRIMARY KEY NOT NULL, email text NOT NULL, name text NOT NULL, created_at text NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`competitors_json` text DEFAULT '[]' NOT NULL,
	`location_code` integer DEFAULT 2840 NOT NULL,
	`language_code` text DEFAULT 'en' NOT NULL,
	`daily_enabled` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL, interval_hours integer DEFAULT 24 NOT NULL, category text DEFAULT '' NOT NULL, audience text DEFAULT '' NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`text` text NOT NULL,
	`engine` text NOT NULL,
	`tag` text DEFAULT 'Geral' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL, tags_json text DEFAULT '[]' NOT NULL, next_run_at text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`prompt_id` text NOT NULL,
	`request_key` text NOT NULL,
	`prompt_text` text NOT NULL,
	`engine` text NOT NULL,
	`targets_json` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider_task_id` text,
	`callback_token` text NOT NULL,
	`cost` real DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	`polled_at` text,
	`claimed_at` text, `next_poll_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL, `poll_attempts` integer DEFAULT 0 NOT NULL, `budget_credits` integer DEFAULT 1 NOT NULL, `raw_response_status` text DEFAULT 'not_captured' NOT NULL, `raw_response_key` text, `raw_response_sha256` text, `raw_response_bytes` integer, `raw_response_stored_at` text, `raw_response_error` text,
	FOREIGN KEY (`owner_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `system_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `job_leases` (
	`key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_store_outbox` (
	`project_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`revision` integer NOT NULL,
	`operation` text NOT NULL,
	`data_json` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_stores` (
	`project_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`generation` text NOT NULL,
	`initialized` integer DEFAULT 0 NOT NULL,
	`source_revision` integer DEFAULT 0 NOT NULL,
	`applied_revision` integer DEFAULT 0 NOT NULL,
	`verification_json` text,
	`candidate_generation` text,
	`candidate_manifest_json` text,
	`last_error` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_projects_owner` ON `projects` (`owner_id`,`archived`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_prompts_project` ON `prompts` (`project_id`,`archived`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_runs_request` ON `runs` (`owner_id`,`prompt_id`,`request_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_runs_project_date` ON `runs` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_runs_owner_date` ON `runs` (`owner_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_runs_prompt_status` ON `runs` (`prompt_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_prompts_due ON prompts(active, archived, next_run_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_runs_created` ON `runs` (`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_topics_name` ON `topics` (`project_id`,`name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_runs_status_due` ON `runs` (`status`,`next_poll_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_runs_prompt_date` ON `runs` (`prompt_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_runs_project_status_complete` ON `runs` (`project_id`,`status`,`completed_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_accounts_email_lower` ON `accounts` (lower("email"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_project_outbox_entity` ON `project_store_outbox` (`project_id`,`entity`,`entity_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_outbox_revision` ON `project_store_outbox` (`project_id`,`revision`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_project_stores_updated` ON `project_stores` (`updated_at`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_storage_project_insert AFTER INSERT ON projects BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) VALUES(NEW.id,NEW.owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_publication_runs_insert AFTER INSERT ON runs BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) SELECT id,owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE id=NEW.project_id;
  UPDATE project_stores SET source_revision=source_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=NEW.project_id;
  INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
    SELECT NEW.project_id,'runs',NEW.id,source_revision,'upsert',json_object('id',NEW.id,'owner_id',NEW.owner_id,'project_id',NEW.project_id,'prompt_id',NEW.prompt_id,'prompt_text',NEW.prompt_text,'engine',NEW.engine,'status',NEW.status,'targets_json',NEW.targets_json,'cost',NEW.cost,'error',NEW.error,'created_at',NEW.created_at,'completed_at',NEW.completed_at,'raw_response_status',NEW.raw_response_status,'raw_response_key',NEW.raw_response_key,'raw_response_sha256',NEW.raw_response_sha256,'raw_response_bytes',NEW.raw_response_bytes,'raw_response_stored_at',NEW.raw_response_stored_at,'raw_response_error',NEW.raw_response_error) FROM project_stores WHERE project_id=NEW.project_id
    ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,data_json=json_set(COALESCE(project_store_outbox.data_json,'{}'),'$.id',NEW.id,'$.owner_id',NEW.owner_id,'$.project_id',NEW.project_id,'$.prompt_id',NEW.prompt_id,'$.prompt_text',NEW.prompt_text,'$.engine',NEW.engine,'$.status',NEW.status,'$.targets_json',NEW.targets_json,'$.cost',NEW.cost,'$.error',NEW.error,'$.created_at',NEW.created_at,'$.completed_at',NEW.completed_at,'$.raw_response_status',NEW.raw_response_status,'$.raw_response_key',NEW.raw_response_key,'$.raw_response_sha256',NEW.raw_response_sha256,'$.raw_response_bytes',NEW.raw_response_bytes,'$.raw_response_stored_at',NEW.raw_response_stored_at,'$.raw_response_error',NEW.raw_response_error);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_publication_runs_update AFTER UPDATE OF owner_id,prompt_id,prompt_text,engine,status,targets_json,cost,error,created_at,completed_at,raw_response_status,raw_response_key,raw_response_sha256,raw_response_bytes,raw_response_stored_at,raw_response_error ON runs WHEN OLD.owner_id IS NOT NEW.owner_id OR OLD.prompt_id IS NOT NEW.prompt_id OR OLD.prompt_text IS NOT NEW.prompt_text OR OLD.engine IS NOT NEW.engine OR OLD.status IS NOT NEW.status OR OLD.targets_json IS NOT NEW.targets_json OR OLD.cost IS NOT NEW.cost OR OLD.error IS NOT NEW.error OR OLD.created_at IS NOT NEW.created_at OR OLD.completed_at IS NOT NEW.completed_at OR OLD.raw_response_status IS NOT NEW.raw_response_status OR OLD.raw_response_key IS NOT NEW.raw_response_key OR OLD.raw_response_sha256 IS NOT NEW.raw_response_sha256 OR OLD.raw_response_bytes IS NOT NEW.raw_response_bytes OR OLD.raw_response_stored_at IS NOT NEW.raw_response_stored_at OR OLD.raw_response_error IS NOT NEW.raw_response_error BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) SELECT id,owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE id=NEW.project_id;
  UPDATE project_stores SET source_revision=source_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=NEW.project_id;
  INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
    SELECT NEW.project_id,'runs',NEW.id,source_revision,'upsert',json_object('id',NEW.id,'owner_id',NEW.owner_id,'project_id',NEW.project_id,'prompt_id',NEW.prompt_id,'prompt_text',NEW.prompt_text,'engine',NEW.engine,'status',NEW.status,'targets_json',NEW.targets_json,'cost',NEW.cost,'error',NEW.error,'created_at',NEW.created_at,'completed_at',NEW.completed_at,'raw_response_status',NEW.raw_response_status,'raw_response_key',NEW.raw_response_key,'raw_response_sha256',NEW.raw_response_sha256,'raw_response_bytes',NEW.raw_response_bytes,'raw_response_stored_at',NEW.raw_response_stored_at,'raw_response_error',NEW.raw_response_error) FROM project_stores WHERE project_id=NEW.project_id
    ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,data_json=json_set(COALESCE(project_store_outbox.data_json,'{}'),'$.id',NEW.id,'$.owner_id',NEW.owner_id,'$.project_id',NEW.project_id,'$.prompt_id',NEW.prompt_id,'$.prompt_text',NEW.prompt_text,'$.engine',NEW.engine,'$.status',NEW.status,'$.targets_json',NEW.targets_json,'$.cost',NEW.cost,'$.error',NEW.error,'$.created_at',NEW.created_at,'$.completed_at',NEW.completed_at,'$.raw_response_status',NEW.raw_response_status,'$.raw_response_key',NEW.raw_response_key,'$.raw_response_sha256',NEW.raw_response_sha256,'$.raw_response_bytes',NEW.raw_response_bytes,'$.raw_response_stored_at',NEW.raw_response_stored_at,'$.raw_response_error',NEW.raw_response_error);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_publication_runs_delete AFTER DELETE ON runs BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) SELECT id,owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE id=OLD.project_id;
  UPDATE project_stores SET source_revision=source_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=OLD.project_id;
  INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
    SELECT OLD.project_id,'runs',OLD.id,source_revision,'delete',NULL FROM project_stores WHERE project_id=OLD.project_id
    ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,data_json=NULL;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_publication_prompts_insert AFTER INSERT ON prompts BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) SELECT id,owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE id=NEW.project_id;
  UPDATE project_stores SET source_revision=source_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=NEW.project_id;
  INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
    SELECT NEW.project_id,'prompts',NEW.id,source_revision,'upsert',json_object('id',NEW.id,'project_id',NEW.project_id,'text',NEW.text,'engine',NEW.engine,'tag',NEW.tag,'tags_json',NEW.tags_json,'next_run_at',NEW.next_run_at,'active',NEW.active,'archived',NEW.archived,'created_at',NEW.created_at) FROM project_stores WHERE project_id=NEW.project_id
    ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,data_json=json_set(COALESCE(project_store_outbox.data_json,'{}'),'$.id',NEW.id,'$.project_id',NEW.project_id,'$.text',NEW.text,'$.engine',NEW.engine,'$.tag',NEW.tag,'$.tags_json',NEW.tags_json,'$.next_run_at',NEW.next_run_at,'$.active',NEW.active,'$.archived',NEW.archived,'$.created_at',NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_publication_prompts_update AFTER UPDATE OF text,engine,tag,tags_json,next_run_at,active,archived,created_at ON prompts WHEN OLD.text IS NOT NEW.text OR OLD.engine IS NOT NEW.engine OR OLD.tag IS NOT NEW.tag OR OLD.tags_json IS NOT NEW.tags_json OR OLD.next_run_at IS NOT NEW.next_run_at OR OLD.active IS NOT NEW.active OR OLD.archived IS NOT NEW.archived OR OLD.created_at IS NOT NEW.created_at BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) SELECT id,owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE id=NEW.project_id;
  UPDATE project_stores SET source_revision=source_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=NEW.project_id;
  INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
    SELECT NEW.project_id,'prompts',NEW.id,source_revision,'upsert',json_object('id',NEW.id,'project_id',NEW.project_id,'text',NEW.text,'engine',NEW.engine,'tag',NEW.tag,'tags_json',NEW.tags_json,'next_run_at',NEW.next_run_at,'active',NEW.active,'archived',NEW.archived,'created_at',NEW.created_at) FROM project_stores WHERE project_id=NEW.project_id
    ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,data_json=json_set(COALESCE(project_store_outbox.data_json,'{}'),'$.id',NEW.id,'$.project_id',NEW.project_id,'$.text',NEW.text,'$.engine',NEW.engine,'$.tag',NEW.tag,'$.tags_json',NEW.tags_json,'$.next_run_at',NEW.next_run_at,'$.active',NEW.active,'$.archived',NEW.archived,'$.created_at',NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_publication_prompts_delete AFTER DELETE ON prompts BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) SELECT id,owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE id=OLD.project_id;
  UPDATE project_stores SET source_revision=source_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=OLD.project_id;
  INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
    SELECT OLD.project_id,'prompts',OLD.id,source_revision,'delete',NULL FROM project_stores WHERE project_id=OLD.project_id
    ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,data_json=NULL;
END;
