ALTER TABLE brand_research_configurations ADD COLUMN sentiment_provider TEXT CHECK(sentiment_provider IS NULL OR sentiment_provider IN ('liquid','jev','decisions'));
