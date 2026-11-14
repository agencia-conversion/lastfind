-- Domain discovery: who pays the decision is kept apart from who paid the search, so a decision that was
-- surely not billed can be finished by another active project when the one that paid the search cannot resume it.
-- NULL = still the search's payer (rows from before this change).
ALTER TABLE brand_domain_lookups ADD COLUMN decision_project_id TEXT REFERENCES projects(id);
