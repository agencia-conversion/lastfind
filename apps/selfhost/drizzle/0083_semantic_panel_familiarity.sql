-- How well the AI said it knows the brand behind a Semantic Branding note (6/11/2026): 'high', 'medium' or 'low'. The question asks
-- every note with this instead of "only what you are sure of". NULL on every note stored before (asked the old way) and on notes read
-- out of a text (an AI Overview). Adds a nullable column only: no row or identity changes. Same SQL in both editions.
ALTER TABLE semantic_panel_readings ADD COLUMN familiarity TEXT;
