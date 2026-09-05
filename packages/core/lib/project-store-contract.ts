export const RUN_STORE_COLUMNS = [
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
export const PROMPT_STORE_COLUMNS = [
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
export type StoreEntity = 'runs' | 'prompts';
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
  | { action: 'status' | 'initialize' }
);
export const storeColumns = (entity: StoreEntity) =>
  entity === 'runs' ? RUN_STORE_COLUMNS : PROMPT_STORE_COLUMNS;
export const storeIdentity = (scope: StoreScope) =>
  `${scope.projectId}:${scope.generation}`;
export function canonicalStoreRow(entity: StoreEntity, row: StoreRow) {
  return JSON.stringify(
    storeColumns(entity).map((column) => row[column] ?? null),
  );
}
export async function extendStoreDigest(
  previous: string,
  entity: StoreEntity,
  rows: StoreRow[],
) {
  const bytes = new TextEncoder().encode(
    previous +
      '\n' +
      rows.map((row) => canonicalStoreRow(entity, row)).join('\n'),
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
] as const;
export const CONTROL_RUN_COLUMNS = RUN_STORE_COLUMNS.filter(
  (column) =>
    !ANALYTIC_ONLY_RUN_COLUMNS.includes(
      column as (typeof ANALYTIC_ONLY_RUN_COLUMNS)[number],
    ),
);
