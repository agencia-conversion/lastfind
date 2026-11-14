import type { BotDay } from './ai-bots';
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
/** `last`: when nothing is kept for the current data, the newest copy kept for `base` under any data (stale-while-revalidate). */
export type ResponseCopyProbe = { base: string; analysis?: boolean; last?: boolean };
/** The largest whole response the project store keeps (characters): the Worker does not send a larger one. */
export const MAX_KEPT_RESPONSE_CHARS = 1024 * 1024;
/** What the store answers to a copy probe: the key to keep a response under, and the kept one when there is one. */
export type ResponseCopy = { key: string; epoch: number; value?: string; storedAt?: number; last?: { value: string; storedAt: number } } | null;
export type StoreMessage = { scope: StoreScope } & (
  | { action: 'apply'; changes: StoreChange[] }
  // The project moved to another workspace (the control database records `project_move:<project>`): the store
  // re-keys its rows from `from` to the scope's owner. Only the transport sends it, after reading that record.
  | { action: 'rekey'; from: string }
  // `report`: a report read with its period bounds as asked and as the store moved them (status `bounds`); the store may
  // answer it from the results it keeps for the current data, and remembers a default first-screen read (`warm`) to recompute.
  | { action: 'query'; statements: StoreQuery[]; report?: { asked: string[]; snapped: string[]; warm?: boolean } }
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
      /**
       * `configVersion` is the project's current one, read again after a first start answered with a newer one: the newer
       * version came from elsewhere (a preview copy adopted production's job), so this one is taken, not ignored.
       */
      confirmed?: boolean;
      /** False when no decision model can be asked (no key): common-word mentions the rules leave open count, as before v9. */
      mentionModel?: boolean;
    }
  | {
      action: 'analysis-status' | 'analysis-process';
      /** Status only: brand keys (brandKey) left out of `suggestions`, and how many to return (at most 200, most mentioned first). */
      exclude?: string[];
      /** Status only: brand keys always returned (settled competitors, up to 1,000), besides the `limit` most mentioned. */
      include?: string[];
      limit?: number;
    }
  // The discoveries share of voice and position count, {brand key: its group's key} (settled competitors, not rejected), and the
  // discovered names that are a monitored brand itself (`aliases`, brand keys: a name question's alias), left out of the lists.
  | { action: 'brand-counted'; groups: Record<string, string>; aliases?: string[] }
  // The decision model's verdicts on mention questions (lib/brand-mention-check.ts, v12): [run id, target name, slot, the
  // question's JSON as the store keeps it, counted, the config (model|prompt|card digest) it was decided under].
  | { action: 'mention-verdicts'; verdicts: [string, string, 'active' | 'pending', string, boolean, string][] }
  | { action: 'analysis-freeze'; token: string; until: number }
  | { action: 'analysis-cancel'; revision: string }
  | { action: 'analysis-resume'; token: string }
  | { action: 'analysis-set-current'; revision: string }
  // The preview import: another store's competitor analysis as it is (ProjectStore.adoptAnalysis). `begin` with its job
  // (revision, targets_json and the rest of competitor_analysis_jobs) and detector, `rows` with pages of answers
  // ([id, mentions, discoveries]) and names (competitor_suggestions rows), `commit` with the discoveries it counts.
  | { action: 'analysis-adopt'; step: 'begin'; job: Record<string, StoreValue> | null; detector: string | null }
  | { action: 'analysis-adopt'; step: 'rows'; runs?: [string, string | null, string | null][]; suggestions?: Record<string, StoreValue>[] }
  | { action: 'analysis-adopt'; step: 'commit'; groups: Record<string, string> }
  | { action: 'positions-fill'; cursor?: string }
  // Data retention (lib/retention.ts): removes the text of up to `limit` answers created before `before`, oldest first; with
  // `dryRun`, only counts the answers that still hold text before it.
  | { action: 'retention-purge'; before: string; limit?: number; dryRun?: boolean }
  // `fill`: the status first saves the mention ranks that are missing (a bounded number per message).
  // `copy`: also look for a response the Worker kept for these inputs and the current data (`base` hashes the Worker's own
  // inputs; `analysis` adds the competitor analysis job to the key). `copy-get` looks without a status, `copy-put` keeps one.
  // `job`: also where the competitor analysis is (the first screens' warm-up check).
  | { action: 'status'; fill?: boolean; bounds?: string[]; copy?: ResponseCopyProbe; job?: boolean }
  | { action: 'copy-get'; copy: ResponseCopyProbe; bounds?: string[] }
  // `last`: also the newest copy of its `base`, found by a later probe with `last` whatever the data then.
  | { action: 'copy-put'; key: string; epoch: number; value: string; last?: boolean }
  | { action: 'warm' }
  // Background backup (lib/project-backups.ts): `revision` is the caught-up control revision the manifest records.
  | { action: 'backup-start'; id: string; revision: number }
  | { action: 'backup-status'; id: string }
  | { action: 'initialize' }
  // The project was deleted (lib/server/project-erase.ts): the generation's storage is wiped. Idempotent.
  | { action: 'erase' }
  // AI bots (lib/ai-bots.ts): each day replaces what the store kept for it; `bots-clear` forgets every day (a new site).
  | { action: 'bots-put'; days: BotDay[]; syncedAt: string }
  | { action: 'bots-clear' }
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
