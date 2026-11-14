-- Domain discovery ledger: the cost of a paid step belongs to the project that triggered it (the row is
-- shared by the account, brand and country, so project_id only says who created the free result), each unpriced step keeps
-- its own reserve, and the decision is claimed durably (decision_status) before it is sent, so it is never sent twice.
ALTER TABLE brand_domain_lookups ADD COLUMN paid_project_id TEXT REFERENCES projects(id);
--> statement-breakpoint
ALTER TABLE brand_domain_lookups ADD COLUMN search_reserved_usd REAL NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE brand_domain_lookups ADD COLUMN decision_reserved_usd REAL NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE brand_domain_lookups ADD COLUMN decision_status TEXT CHECK(decision_status IS NULL OR decision_status IN ('submitting','unknown'));
--> statement-breakpoint
-- Rows from before this change (previews only): the whole old reserve stays held, on the project that created the row.
UPDATE brand_domain_lookups SET paid_project_id=project_id,decision_reserved_usd=reserved_usd WHERE search_attempts>0 OR reserved_usd>0;
--> statement-breakpoint
DROP INDEX idx_brand_domain_lookups_project;
--> statement-breakpoint
ALTER TABLE brand_domain_lookups DROP COLUMN reserved_usd;
--> statement-breakpoint
CREATE INDEX idx_brand_domain_lookups_paid_project ON brand_domain_lookups(paid_project_id,spent_at);
