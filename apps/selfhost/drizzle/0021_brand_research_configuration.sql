CREATE TABLE brand_research_configurations (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  provider TEXT NOT NULL CHECK(provider IN ('jev','decisions')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision>=1),
  updated_at TEXT NOT NULL
);
