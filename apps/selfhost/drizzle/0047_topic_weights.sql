-- Topic weights: how much each topic counts in the project's aggregate metrics, {topic name: relative weight}.
-- Null keeps every answer counting the same. Additive and nullable: existing projects and reports are unchanged.
ALTER TABLE projects ADD COLUMN topic_weights_json TEXT;
