-- Idempotent: the previews created these tables under the name 0031_product_comparisons before the number was taken on main.
-- Products > Comparisons. A comparison sets the client's product against 1 to 3 rivals on up to 5 dimensions. Every week a round asks the
-- AIs a neutral purchase question (3 repetitions each, the order of the products rotating) and a cheap classifier reads who each answer chose.
-- Additive: nothing existing changes. A round keeps the comparison as it was asked (snapshot), so editing it later never rewrites history.
CREATE TABLE IF NOT EXISTS product_comparisons (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  product TEXT NOT NULL,
  rivals_json TEXT NOT NULL,
  sector TEXT NOT NULL,
  dimensions_json TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_product_comparisons_project ON product_comparisons(project_id,archived);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS comparison_rounds (
  id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL REFERENCES product_comparisons(id),
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  day TEXT NOT NULL,
  period_start TEXT NOT NULL,
  language_code TEXT NOT NULL,
  location_code INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','done')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(comparison_id,period_start)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_rounds_project ON comparison_rounds(project_id,day);
--> statement-breakpoint
-- One question to one AI (repetition 1 to 3). `reading_json` is what the classifier read: the overall winner, the winner of each dimension and
-- which products the AI did not know. An answer that is not read yet, or whose reading failed, has no reading: absent, never a loss.
CREATE TABLE IF NOT EXISTS comparison_queries (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES comparison_rounds(id),
  comparison_id TEXT NOT NULL REFERENCES product_comparisons(id),
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  engine TEXT NOT NULL,
  repetition INTEGER NOT NULL,
  question TEXT NOT NULL,
  order_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','submitting','submitted','completed','absent','failed','unknown','cancelled')),
  reserved_usd REAL NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL DEFAULT '{}',
  response TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  raw_response_key TEXT,
  reading_json TEXT,
  read_attempts INTEGER NOT NULL DEFAULT 0,
  read_cost_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE(round_id,engine,repetition)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_queries_due ON comparison_queries(status,requested_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_queries_budget ON comparison_queries(requested_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_comparison_queries_comparison ON comparison_queries(comparison_id,requested_at);
