import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const accountColumns = {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
};
export const accounts = sqliteTable(
  'accounts',
  accountColumns,
  (t) => [index('idx_accounts_email_lower').on(sql`lower(${t.email})`)],
);
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => accounts.id),
    name: text('name').notNull(),
    domain: text('domain').notNull(),
    competitorsJson: text('competitors_json').notNull().default('[]'),
    locationCode: integer('location_code').notNull().default(2840),
    languageCode: text('language_code').notNull().default('en'),
    dailyEnabled: integer('daily_enabled').notNull().default(0),
    intervalHours: integer('interval_hours').notNull().default(24),
    category: text('category').notNull().default(''),
    audience: text('audience').notNull().default(''),
    archived: integer('archived').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_projects_owner').on(t.ownerId, t.archived)],
);
export const prompts = sqliteTable(
  'prompts',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    text: text('text').notNull(),
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
    ownerId: text('owner_id')
      .notNull()
      .references(() => accounts.id),
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
    uniqueIndex('idx_runs_request').on(t.ownerId, t.promptId, t.requestKey),
    index('idx_runs_project_date').on(t.projectId, t.createdAt),
    index('idx_runs_project_status_complete').on(
      t.projectId,
      t.status,
      t.completedAt,
    ),
    index('idx_runs_owner_date').on(t.ownerId, t.createdAt),
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
    ownerId: text('owner_id')
      .notNull()
      .references(() => accounts.id),
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
