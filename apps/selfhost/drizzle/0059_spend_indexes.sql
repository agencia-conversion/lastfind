-- Every reservation (collection claims, sentiment, roles, source types, domains, Semantic Branding, the agent) checks the
-- account and platform ceilings, and the workspace (every app load) counts the agent's credits. Since 0045 the runs and research
-- jobs sums read only indexes; the tables added after it (Semantic Branding and comparison queries, domain lookups, agent turns)
-- were read whole, twice per check, answers included (a 3-month Semantic Branding history: 146 ms per check, 3 ms with these).
-- Each sum is "since the period began, or still in flight": the period side reads these indexes, the in-flight side the status
-- indexes (idx_semantic_panel_queries_due, idx_comparison_queries_due and the two below).
CREATE INDEX IF NOT EXISTS idx_semantic_panel_queries_spend ON semantic_panel_queries(COALESCE(started_at,requested_at),cost_usd,reserved_usd);
CREATE INDEX IF NOT EXISTS idx_comparison_queries_spend ON comparison_queries(COALESCE(started_at,requested_at),cost_usd,reserved_usd);
CREATE INDEX IF NOT EXISTS idx_brand_domain_lookups_spend ON brand_domain_lookups(spent_at,search_cost_usd,decision_cost_usd,search_reserved_usd,decision_reserved_usd);
CREATE INDEX IF NOT EXISTS idx_brand_domain_lookups_search ON brand_domain_lookups(search_status);
CREATE INDEX IF NOT EXISTS idx_brand_domain_lookups_decision ON brand_domain_lookups(decision_status);
CREATE INDEX IF NOT EXISTS idx_agent_turns_owner_spend ON agent_turns(owner_id,started_at,status,cost_usd,reserved_usd);
CREATE INDEX IF NOT EXISTS idx_agent_turns_spend ON agent_turns(started_at,status,cost_usd,reserved_usd);
