-- Brand variants affect only newly reserved run snapshots.
ALTER TABLE projects ADD COLUMN aliases_json text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE projects ADD COLUMN additional_domains_json text NOT NULL DEFAULT '[]';
