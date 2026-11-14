-- Brands and its sentiment read the jobs of the answers on screen (by answer hash) and the per-question roles of a project
-- (counted per name): without these indexes both read every job or verdict row of the project, prompts and excerpts included.
CREATE INDEX IF NOT EXISTS idx_brand_research_answer ON brand_research_jobs(project_id,owner_id,answer_sha256);
CREATE INDEX IF NOT EXISTS idx_brand_question_roles_names ON brand_question_roles(project_id,model,brand_key,role);
