-- The store of the public search data the agent pays for (Google results, keyword volumes, keyword and domain data, backlinks),
-- per workspace: the same request of the same workspace within its lifetime is answered from here, free, with the day it was
-- read. Keyed by a digest of the workspace and the request (path and payload); nothing is shared across workspaces. Google results
-- live a day, volumes 30 days, other keyword, domain and backlink data 7 days.
-- Also an index for sharing a brand's paid domain search across accounts (same brand, country and search). New table and index
-- only: no row or identity changes. Same SQL in both editions.
CREATE TABLE IF NOT EXISTS search_data (
  request_key TEXT PRIMARY KEY,
  path TEXT NOT NULL CHECK(length(path)<=200),
  result_json TEXT NOT NULL CHECK(length(result_json)<=400000),
  read_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_data_expires ON search_data(expires_at);
CREATE INDEX IF NOT EXISTS idx_brand_domain_lookups_brand ON brand_domain_lookups(brand_key,location_code);
