-- How many provider calls a sentiment reading took (one, or three when some questions came back without probabilities and only those
-- were asked again). Null for readings made before. New nullable column only: no row or identity changes. Same SQL in both editions.
ALTER TABLE brand_research_jobs ADD COLUMN calls INTEGER;
