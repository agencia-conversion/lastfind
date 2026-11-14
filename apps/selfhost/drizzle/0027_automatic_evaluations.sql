ALTER TABLE brand_research_configurations ADD COLUMN automatic INTEGER NOT NULL DEFAULT 0 CHECK(automatic IN (0,1));
ALTER TABLE brand_research_configurations ADD COLUMN monthly_ceiling_usd REAL CHECK(monthly_ceiling_usd IS NULL OR monthly_ceiling_usd>=0);
