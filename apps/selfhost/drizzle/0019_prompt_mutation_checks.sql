-- Fail an entire prepared batch when another edit changed the question snapshot.
CREATE TABLE prompt_mutation_checks (
  id TEXT PRIMARY KEY NOT NULL,
  unchanged INTEGER NOT NULL CONSTRAINT PROMPT_CHANGED CHECK (unchanged=1)
);
