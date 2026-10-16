export const COLLECTION_RUN_STORE_COLUMNS = [
  'id',
  'owner_id',
  'project_id',
  'prompt_id',
  'prompt_text',
  'engine',
  'status',
  'targets_json',
  'answer',
  'model',
  'mentions_json',
  'sources_json',
  'consulted_sources_json',
  'search_queries_json',
  'response_available',
  'cost',
  'error',
  'created_at',
  'completed_at',
  'raw_response_status',
  'raw_response_key',
  'raw_response_sha256',
  'raw_response_bytes',
  'raw_response_stored_at',
  'raw_response_error',
] as const;
export const RUN_STORE_COLUMNS = [
  ...COLLECTION_RUN_STORE_COLUMNS,
  // Collection targets and mentions remain immutable. These optional columns
  // hold the current analytical interpretation after a target-list change.
  'analysis_revision',
  'analysis_targets_json',
  'analysis_mentions_json',
] as const;
export const LEGACY_PROMPT_STORE_COLUMNS = [
  'id',
  'project_id',
  'text',
  'engine',
  'tag',
  'tags_json',
  'next_run_at',
  'active',
  'archived',
  'created_at',
] as const;
export const PROMPT_STORE_COLUMNS = [...LEGACY_PROMPT_STORE_COLUMNS, 'unit_id', 'engines_override_json', 'subscribed'] as const;
export const SEMANTIC_STORE_COLUMNS = [
  'id', 'owner_id', 'project_id', 'run_id', 'config_revision',
  'assessment_json', 'answer_sha256', 'rubric', 'model', 'coverage',
  'cost_usd', 'created_at',
] as const;
export type StoreEntity = 'runs' | 'prompts' | 'semantic_evaluations';
export type StoreValue = string | number | null;
export type StoreRow = Record<string, StoreValue>;
export type StoreScope = {
  ownerId: string;
  projectId: string;
  generation: string;
};
export type StoreChange = {
  entity: StoreEntity;
  id: string;
  revision: number;
  data: StoreRow | null;
};
export type StoreQuery = { sql: string; params: StoreValue[] };
export type StoreMessage = { scope: StoreScope } & (
  | { action: 'apply'; changes: StoreChange[] }
  | { action: 'query'; statements: StoreQuery[] }
  | { action: 'scan'; entity: StoreEntity; cursor?: string; limit?: number }
  | {
      action: 'analysis-start';
      revision: string;
      configVersion: number;
      targets: Array<{
        name: string;
        domain: string;
        aliases?: string[];
        domains?: string[];
      }>;
      cutoff: string;
      maxRuns: number;
      restart?: boolean;
    }
  | {
      action: 'analysis-status' | 'analysis-process';
    }
  | { action: 'analysis-freeze'; token: string; until: number }
  | { action: 'analysis-cancel'; revision: string }
  | { action: 'analysis-resume'; token: string }
  | { action: 'analysis-set-current'; revision: string }
  | { action: 'status' | 'initialize' }
);
export const storeColumns = (entity: StoreEntity) =>
  entity === 'runs' ? RUN_STORE_COLUMNS : entity === 'prompts' ? PROMPT_STORE_COLUMNS : SEMANTIC_STORE_COLUMNS;
export const storeIdentity = (scope: StoreScope) =>
  `${scope.projectId}:${scope.generation}`;
export function canonicalStoreRow(
  entity: StoreEntity,
  row: StoreRow,
  schema: 1 | 2 | 3 | 4 = 1,
) {
  const columns =
    entity === 'prompts' && schema < 4 ? LEGACY_PROMPT_STORE_COLUMNS :
    entity === 'runs' && schema === 1
      ? COLLECTION_RUN_STORE_COLUMNS
      : storeColumns(entity);
  return JSON.stringify(columns.map((column) => row[column] ?? null));
}
export async function extendStoreDigest(
  previous: string,
  entity: StoreEntity,
  rows: StoreRow[],
  schema: 1 | 2 | 3 | 4 = 1,
) {
  const bytes = new TextEncoder().encode(
    previous +
      '\n' +
      rows.map((row) => canonicalStoreRow(entity, row, schema)).join('\n'),
  );
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
export function validStoreScope(scope: StoreScope) {
  return (
    !!scope &&
    ['ownerId', 'projectId', 'generation'].every(
      (key) =>
        typeof scope[key as keyof StoreScope] === 'string' &&
        scope[key as keyof StoreScope].length > 0 &&
        scope[key as keyof StoreScope].length <= 200,
    )
  );
}

export const ANALYTIC_ONLY_RUN_COLUMNS = [
  'answer',
  'model',
  'mentions_json',
  'sources_json',
  'consulted_sources_json',
  'search_queries_json',
  'response_available',
  'analysis_revision',
  'analysis_targets_json',
  'analysis_mentions_json',
] as const;
export const CONTROL_RUN_COLUMNS = RUN_STORE_COLUMNS.filter(
  (column) =>
    !ANALYTIC_ONLY_RUN_COLUMNS.includes(
      column as (typeof ANALYTIC_ONLY_RUN_COLUMNS)[number],
    ),
);
