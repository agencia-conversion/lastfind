import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
/** A person: the login identity (migration 0111 Cloud, 0101 independent). Their workspaces are in `workspaces`. */
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => [index('idx_accounts_email_lower').on(sql`lower(${t.email})`)]);
/** A workspace: its projects, members and (Cloud) plan belong to it; `ownerId` is the person who owns it. */
export const workspaceColumns = {
  id: text('id').primaryKey(),
  name: text('name'),
  ownerId: text('owner_id').references(() => accounts.id),
  createdAt: text('created_at').notNull(),
  // The workspace's IANA time zone for its collection schedule (lib/scheduling.ts); NULL is America/Sao_Paulo.
  timeZone: text('time_zone'),
};
export const workspaces = sqliteTable('workspaces', workspaceColumns, (t) => [index('workspaces_owner').on(t.ownerId)]);
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    domain: text('domain').notNull(),
    aliasesJson: text('aliases_json').notNull().default('[]'),
    additionalDomainsJson: text('additional_domains_json')
      .notNull()
      .default('[]'),
    competitorsJson: text('competitors_json').notNull().default('[]'),
    // {topic name: relative weight} for the aggregate metrics; null counts every answer the same (lib/topic-weights).
    topicWeightsJson: text('topic_weights_json'),
    competitorTargetsRevision: integer('competitor_targets_revision')
      .notNull()
      .default(0),
    locationCode: integer('location_code').notNull().default(2840),
    languageCode: text('language_code').notNull().default('en'),
    dailyEnabled: integer('daily_enabled').notNull().default(0),
    intervalHours: integer('interval_hours').notNull().default(24),
    // The collection's hour and weekday (0 Sunday) in the workspace's time zone (lib/scheduling.ts). New rows are written with
    // DEFAULT_COLLECTION_HOUR: the column's default, 7, predates the local hour.
    collectionHour: integer('collection_hour').notNull().default(7),
    collectionDay: integer('collection_day').notNull().default(1),
    offersJson: text('offers_json').notNull().default('[]'),
    enginesJson: text('engines_json').notNull().default('["chat_gpt"]'),
    category: text('category').notNull().default(''),
    audience: text('audience').notNull().default(''),
    archived: integer('archived').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_projects_owner').on(t.workspaceId, t.archived)],
);
export const prompts = sqliteTable(
  'prompts',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    text: text('text').notNull(),
    unitId: text('unit_id'),
    enginesOverrideJson: text('engines_override_json'),
    subscribed: integer('subscribed').notNull().default(1),
    engine: text('engine').notNull(),
    tag: text('tag').notNull().default('Geral'),
    tagsJson: text('tags_json').notNull().default('[]'),
    nextRunAt: text('next_run_at')
      .notNull()
      .default('1970-01-01T00:00:00.000Z'),
    active: integer('active').notNull().default(1),
    archived: integer('archived').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_prompts_project').on(t.projectId, t.archived),
    index('idx_prompts_due').on(t.active, t.archived, t.nextRunAt),
  ],
);
export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    promptId: text('prompt_id')
      .notNull()
      .references(() => prompts.id),
    requestKey: text('request_key').notNull(),
    promptText: text('prompt_text').notNull(),
    engine: text('engine').notNull(),
    targetsJson: text('targets_json').notNull(),
    locationCode: integer('location_code').notNull(),
    languageCode: text('language_code').notNull(),
    status: text('status').notNull().default('queued'),
    providerTaskId: text('provider_task_id'),
    callbackToken: text('callback_token').notNull(),
    rawResponseStatus: text('raw_response_status')
      .notNull()
      .default('not_captured'),
    rawResponseKey: text('raw_response_key'),
    rawResponseSha256: text('raw_response_sha256'),
    rawResponseBytes: integer('raw_response_bytes'),
    rawResponseStoredAt: text('raw_response_stored_at'),
    rawResponseError: text('raw_response_error'),
    cost: real('cost').notNull().default(0),
    budgetCredits: integer('budget_credits').notNull().default(1),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
    polledAt: text('polled_at'),
    nextPollAt: text('next_poll_at')
      .notNull()
      .default('1970-01-01T00:00:00.000Z'),
    pollAttempts: integer('poll_attempts').notNull().default(0),
    claimedAt: text('claimed_at'),
  },
  (t) => [
    uniqueIndex('idx_runs_request').on(t.workspaceId, t.promptId, t.requestKey),
    index('idx_runs_project_date').on(t.projectId, t.createdAt),
    index('idx_runs_project_status_complete').on(
      t.projectId,
      t.status,
      t.completedAt,
    ),
    index('idx_runs_owner_date').on(t.workspaceId, t.createdAt),
    // Migration 0043 (Cloud) / 0041 (independent): the month's usage reads only this index.
    index('idx_runs_owner_usage').on(t.workspaceId, t.createdAt, t.budgetCredits, t.cost),
    index('idx_runs_created').on(t.createdAt),
    index('idx_runs_status_due').on(t.status, t.nextPollAt),
    index('idx_runs_prompt_date').on(t.promptId, t.createdAt, t.id),
    index('idx_runs_prompt_status').on(t.promptId, t.status),
  ],
);
export const jobLeases = sqliteTable('job_leases', {
  key: text('key').primaryKey(),
  owner: text('owner').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const systemState = sqliteTable('system_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const topics = sqliteTable(
  'topics',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    enginesOverrideJson: text('engines_override_json'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('idx_topics_name').on(t.projectId, t.name)],
);

export const projectStores = sqliteTable(
  'project_stores',
  {
    projectId: text('project_id')
      .primaryKey()
      .references(() => projects.id),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    generation: text('generation').notNull(),
    initialized: integer('initialized').notNull().default(0),
    sourceRevision: integer('source_revision').notNull().default(0),
    appliedRevision: integer('applied_revision').notNull().default(0),
    verificationJson: text('verification_json'),
    candidateGeneration: text('candidate_generation'),
    candidateManifestJson: text('candidate_manifest_json'),
    lastError: text('last_error'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('idx_project_stores_updated').on(t.updatedAt)],
);
export const projectStoreOutbox = sqliteTable(
  'project_store_outbox',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    revision: integer('revision').notNull(),
    operation: text('operation').notNull(),
    dataJson: text('data_json'),
  },
  (t) => [
    uniqueIndex('idx_project_outbox_entity').on(
      t.projectId,
      t.entity,
      t.entityId,
    ),
    index('idx_project_outbox_revision').on(t.projectId, t.revision),
  ],
);

export const semanticConfigurations = sqliteTable('semantic_configurations', {
  projectId: text('project_id').notNull().references(() => projects.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  revision: integer('revision').notNull(),
  configurationJson: text('configuration_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const semanticJobs = sqliteTable('semantic_jobs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  runId: text('run_id').notNull().references(() => runs.id),
  configRevision: integer('config_revision').notNull(),
  status: text('status').notNull(),
  reservedUsd: real('reserved_usd').notNull(),
  costUsd: real('cost_usd').notNull().default(0),
  inputJson: text('input_json').notNull(),
  answerSha256: text('answer_sha256').notNull(),
  requestedAt: text('requested_at').notNull(),
  completedAt: text('completed_at'),
  error: text('error'),
});

export const semanticEvaluations = sqliteTable('semantic_evaluations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  runId: text('run_id').notNull().references(() => runs.id),
  configRevision: integer('config_revision').notNull(),
  assessmentJson: text('assessment_json').notNull(),
  answerSha256: text('answer_sha256').notNull(),
  rubric: text('rubric').notNull(),
  model: text('model').notNull(),
  coverage: text('coverage').notNull(),
  costUsd: real('cost_usd').notNull(),
  createdAt: text('created_at').notNull(),
});

export const semanticPanelSettings = sqliteTable('semantic_panel_settings', {
  projectId: text('project_id').primaryKey().references(() => projects.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  frequency: text('frequency').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const semanticPanelRounds = sqliteTable('semantic_panel_rounds', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  day: text('day').notNull(),
  frequency: text('frequency').notNull(),
  periodStart: text('period_start').notNull(),
  configRevision: integer('config_revision').notNull(),
  languageCode: text('language_code').notNull(),
  locationCode: integer('location_code').notNull(),
  rosterJson: text('roster_json').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
});

export const semanticPanelQueries = sqliteTable('semantic_panel_queries', {
  id: text('id').primaryKey(),
  roundId: text('round_id').notNull().references(() => semanticPanelRounds.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  engine: text('engine').notNull(),
  method: text('method').notNull(),
  model: text('model').notNull(),
  question: text('question').notNull(),
  status: text('status').notNull(),
  reservedUsd: real('reserved_usd').notNull(),
  costUsd: real('cost_usd').notNull().default(0),
  inputJson: text('input_json').notNull().default('{}'),
  response: text('response'),
  sourcesJson: text('sources_json').notNull().default('[]'),
  error: text('error'),
  requestedAt: text('requested_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
});

export const semanticPanelReadings = sqliteTable('semantic_panel_readings', {
  queryId: text('query_id').notNull().references(() => semanticPanelQueries.id),
  roundId: text('round_id').notNull().references(() => semanticPanelRounds.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  engine: text('engine').notNull(),
  brand: text('brand').notNull(),
  attribute: text('attribute').notNull(),
  score: integer('score').notNull(),
  reason: text('reason'),
  evidence: text('evidence'),
});

export const productComparisons = sqliteTable('product_comparisons', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  product: text('product').notNull(),
  rivalsJson: text('rivals_json').notNull(),
  sector: text('sector').notNull(),
  dimensionsJson: text('dimensions_json').notNull(),
  archived: integer('archived').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const comparisonRounds = sqliteTable('comparison_rounds', {
  id: text('id').primaryKey(),
  comparisonId: text('comparison_id').notNull().references(() => productComparisons.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  day: text('day').notNull(),
  periodStart: text('period_start').notNull(),
  languageCode: text('language_code').notNull(),
  locationCode: integer('location_code').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
});

export const comparisonQueries = sqliteTable('comparison_queries', {
  id: text('id').primaryKey(),
  roundId: text('round_id').notNull().references(() => comparisonRounds.id),
  comparisonId: text('comparison_id').notNull().references(() => productComparisons.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  projectId: text('project_id').notNull().references(() => projects.id),
  engine: text('engine').notNull(),
  repetition: integer('repetition').notNull(),
  question: text('question').notNull(),
  orderJson: text('order_json').notNull(),
  status: text('status').notNull(),
  reservedUsd: real('reserved_usd').notNull(),
  costUsd: real('cost_usd').notNull().default(0),
  inputJson: text('input_json').notNull().default('{}'),
  response: text('response'),
  sourcesJson: text('sources_json').notNull().default('[]'),
  rawResponseKey: text('raw_response_key'),
  readingJson: text('reading_json'),
  readAttempts: integer('read_attempts').notNull().default(0),
  readCostUsd: real('read_cost_usd').notNull().default(0),
  error: text('error'),
  requestedAt: text('requested_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
});

/** Columns the signed-in user hid on an analytical table (`table_key` is stable, e.g. `brands`). */
export const tableColumnPreferences = sqliteTable(
  'table_column_preferences',
  {
    userId: text('user_id')
      .notNull()
      .references(() => accounts.id),
    tableKey: text('table_key').notNull(),
    hiddenJson: text('hidden_json').notNull().default('[]'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tableKey] })],
);
