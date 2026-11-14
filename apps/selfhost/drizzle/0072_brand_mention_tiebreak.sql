-- The project's own brand's tie-breaker. When its two questions disagree or are unsure (`unclear`),
-- a stronger model reads the whole answer; its verdict is a row of its own (`stage` 'tiebreak') under its own key, pointing
-- to the question it breaks (`parent_key`). Earlier rows are the questions themselves (`stage` 'main').
ALTER TABLE brand_mention_verdicts ADD COLUMN stage TEXT NOT NULL DEFAULT 'main' CHECK(stage IN ('main','tiebreak'));
ALTER TABLE brand_mention_verdicts ADD COLUMN parent_key TEXT;
CREATE INDEX IF NOT EXISTS idx_brand_mention_verdicts_parent ON brand_mention_verdicts(project_id,parent_key,model);
