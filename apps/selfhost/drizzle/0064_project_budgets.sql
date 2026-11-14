-- Each project's monthly budget, in US$, for everything it spends (collection, Semantic Branding, Products,
-- evaluations, brand domains, the agent and its learning). No row: the edition's default (Cloud: the plan's, to be decided; Unlimited
-- none). A row with NULL: no budget. A project that existed before never gets a cap on its collection it did not have. Workspace admins set it in Settings > Budget up to the plan's maximum; Lastfind
-- admins in Admin > Usage and costs. It replaces the per-project ceilings of Semantic Branding (US$ 30), automatic evaluations
-- (brand_research_configurations.monthly_ceiling_usd), the agent (agent_project_settings), brand domains (BRAND_DOMAIN_MAX_USD)
-- and Cloud's project group (system_state project_budget_group). Those columns and tables stay, no longer read.
CREATE TABLE IF NOT EXISTS project_budgets (
  project_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  monthly_usd REAL CHECK (monthly_usd IS NULL OR (monthly_usd >= 0 AND monthly_usd <= 1000000)),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
--> statement-breakpoint
-- What one project spent this month, read by every reservation (packages/core/lib/platform-spend.ts projectSpendSql): the
-- period side of each ledger by its project (the in-flight side reads the status indexes).
CREATE INDEX IF NOT EXISTS idx_runs_project_spend ON runs(project_id,created_at,cost,budget_credits);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_brand_research_project_spend ON brand_research_jobs(project_id,requested_at,cost_usd,reserved_usd);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_semantic_panel_queries_project_spend ON semantic_panel_queries(project_id,COALESCE(started_at,requested_at),cost_usd,reserved_usd);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_queries_project_spend ON comparison_queries(project_id,COALESCE(started_at,requested_at),cost_usd,reserved_usd);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_semantic_jobs_project_spend ON semantic_jobs(project_id,requested_at,cost_usd,reserved_usd);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_brand_domain_lookups_decision_project ON brand_domain_lookups(decision_project_id,spent_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_agent_turns_project_spend ON agent_turns(project_id,started_at,status,cost_usd,reserved_usd);
--> statement-breakpoint
-- The in-flight side of the agent's ledger (a turn still running from an earlier period), read by status.
CREATE INDEX IF NOT EXISTS idx_agent_turns_running ON agent_turns(status,started_at,cost_usd,reserved_usd);
--> statement-breakpoint
-- The scheduler moves next_run_at once per prompt and slot; that alone no longer republishes the prompt to its project's
-- store (no dashboard reads it there: the app reads it from this database).
DROP TRIGGER IF EXISTS project_publication_prompts_update;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_publication_prompts_update AFTER UPDATE OF unit_id,engines_override_json,subscribed,text,engine,tag,tags_json,active,archived,created_at ON prompts WHEN OLD.unit_id IS NOT NEW.unit_id OR OLD.engines_override_json IS NOT NEW.engines_override_json OR OLD.subscribed IS NOT NEW.subscribed OR OLD.text IS NOT NEW.text OR OLD.engine IS NOT NEW.engine OR OLD.tag IS NOT NEW.tag OR OLD.tags_json IS NOT NEW.tags_json OR OLD.active IS NOT NEW.active OR OLD.archived IS NOT NEW.archived OR OLD.created_at IS NOT NEW.created_at BEGIN
  INSERT OR IGNORE INTO project_stores(project_id,owner_id,generation,updated_at) SELECT id,owner_id,lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects WHERE id=NEW.project_id;
  UPDATE project_stores SET source_revision=source_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE project_id=NEW.project_id;
  INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
    SELECT NEW.project_id,'prompts',NEW.id,source_revision,'upsert',json_object('id',NEW.id,'project_id',NEW.project_id,'text',NEW.text,'unit_id',NEW.unit_id,'engines_override_json',NEW.engines_override_json,'subscribed',NEW.subscribed,'engine',NEW.engine,'tag',NEW.tag,'tags_json',NEW.tags_json,'next_run_at',NEW.next_run_at,'active',NEW.active,'archived',NEW.archived,'created_at',NEW.created_at) FROM project_stores WHERE project_id=NEW.project_id
    ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation=excluded.operation,data_json=json_set(COALESCE(project_store_outbox.data_json,'{}'),'$.id',NEW.id,'$.project_id',NEW.project_id,'$.text',NEW.text,'$.unit_id',NEW.unit_id,'$.engines_override_json',NEW.engines_override_json,'$.subscribed',NEW.subscribed,'$.engine',NEW.engine,'$.tag',NEW.tag,'$.tags_json',NEW.tags_json,'$.next_run_at',NEW.next_run_at,'$.active',NEW.active,'$.archived',NEW.archived,'$.created_at',NEW.created_at);
END;
--> statement-breakpoint
-- The installation's collection had no dollar cap before (only SELF_HOST_MONTHLY_LIMIT runs): every existing project keeps none.
-- The owner sets one in Settings > Budget; only a project created from here on takes the default (US$ 50).
INSERT OR IGNORE INTO project_budgets(project_id,owner_id,monthly_usd,updated_at,updated_by)
  SELECT id,owner_id,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'migration:existing' FROM projects;
