import { AGENT_MODEL } from '@/lib/agent';
import { intentTokenKey, normalizeQuery } from '@/lib/fanout';
import {
  INTENT_BATCH,
  INTENT_CONTEXT,
  INTENT_MONTHLY_MAX_USD,
  INTENT_RESERVE_USD,
  INTENT_RETRY_AFTER_MS,
  intentRequest,
  MAX_INTENTS,
  parseIntentResponse,
  readEntities,
  type IntentContext,
  type IntentQuery,
} from '@/lib/fanout-intents';
import type { FanoutIntent } from '@/lib/report-types';
import { db, now } from './env';
import { postChat } from './decisions-api';
import { claimDecisionJob, completeDecisionJob, failDecisionJob, hash, markStaleUnknown, requestDecisions } from './decision-jobs';
import { classifierModels } from './classifier-models';
import { waitUntil } from 'cloudflare:workers';
import { cachedAnalyticsQuery } from './analytics-query-cache';
import { projectReadDatabase } from './project-store-read';
import { COLLECTED_ENGINES_SQL } from '@/lib/engines';
import { ownedProject } from './workspace';
import { modelKeyConfigured } from './model-routes';

/** A project's searches are looked at again no sooner than this (new searches arrive with the daily collection). */
const CHECK_EVERY_MS = 60 * 60_000;
const PROJECTS_PER_TICK = 3;
/** Requests one step sends for a project, one after the other: each one sees the intents the previous one created. */
const REQUESTS_PER_STEP = 4;
/** No request starts after this; one already sent is finished (CALL_TIMEOUT_MS at most). */
const STEP_BUDGET_MS = 60_000;
const CALL_TIMEOUT_MS = 60_000;
/** The searches of the reports' longest period, the most frequent first (a search seen once waits for the frequent ones). */
const WINDOW_MS = 90 * 86400000;
const QUERY_ROWS = 5000;
const upsert = 'INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value';
const checkedKey = (projectId: string) => `fanout-intents-checked:${projectId}`;
/** Written whenever a project's intents change: what a kept report of its fan-out or opportunities depends on. */
const revisionKey = (projectId: string) => `fanout-intents:${projectId}`;

export const intentModels = () => classifierModels('fanout_intents', AGENT_MODEL);
/** The revision of the project's intents (one row), read beside the report's other D1 reads. */
export const intentRevisionStatement = (projectId: string) => db().prepare('SELECT value FROM system_state WHERE key=?').bind(revisionKey(projectId));

export type ProjectIntents = { revision: string; intents: FanoutIntent[]; assignments: [string, string][] };
/**
 * The project's intents and the intent of each classified search key ('' fits none). Kept per isolate for the revision,
 * so a report that is computed again does not read them again.
 */
export async function projectIntents(projectId: string, revision: string): Promise<ProjectIntents> {
  if (!revision) return { revision, intents: [], assignments: [] };
  return cachedAnalyticsQuery(`fanout-intents:${projectId}:${revision}`, async () => {
    const [intents, assignments] = await db().batch<Record<string, unknown>>([
      db().prepare('SELECT id,name,description,entities_json FROM fanout_intents WHERE project_id=? ORDER BY created_at,id').bind(projectId),
      db().prepare("SELECT query_key k,COALESCE(intent_id,'') i FROM fanout_query_intents WHERE project_id=?").bind(projectId),
    ]);
    return {
      revision,
      intents: intents.results.map((row) => ({ id: String(row.id), name: String(row.name), description: String(row.description), entities: readEntities(row.entities_json) })),
      assignments: assignments.results.map((row) => [String(row.k), String(row.i)] as [string, string]),
    };
  }, { keep: waitUntil });
}

/** The project's distinct searches of the last 90 days, by key, the most frequent first. */
async function projectQueries(projectId: string, workspaceId: string): Promise<IntentQuery[]> {
  const store = await projectReadDatabase(projectId, workspaceId);
  const { results } = await store
    .prepare(
      `SELECT q.value text,COUNT(*) n FROM runs r,json_each(r.search_queries_json) q
       WHERE r.project_id=? AND r.workspace_id=? AND r.engine IN ${COLLECTED_ENGINES_SQL} AND r.status='complete' AND r.response_available=1 AND r.created_at>=?
       AND json_array_length(r.search_queries_json)>0 AND q.type='text' GROUP BY q.value ORDER BY n DESC LIMIT ${QUERY_ROWS}`,
    )
    .bind(projectId, workspaceId, new Date(Date.now() - WINDOW_MS).toISOString())
    .all<{ text: string; n: number }>();
  // Rows arrive most frequent first: a key is shown as its most frequent form.
  const keys = new Map<string, { text: string; count: number }>();
  for (const row of results) {
    const key = normalizeQuery(String(row.text));
    if (!key || key.length > 400) continue;
    const found = keys.get(key) ?? { text: String(row.text), count: 0 };
    keys.set(key, found);
    found.count += Number(row.n);
  }
  return [...keys].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).map(([key, { text }]) => ({ key, text }));
}

/**
 * One request for up to INTENT_BATCH searches, kept as a `brand_research_jobs` row (keyed by the model and the exact keys),
 * so a second isolate, a restart or a repeated tick asks nothing twice. The reservation counts in the platform's day and
 * month ceilings and in this project's monthly ceiling for intents. The new intents and every search's intent are written
 * in the batch that closes the job, and only if the job is still the one this call took.
 */
async function askBatch(projectId: string, workspaceId: string, context: IntentContext, intents: FanoutIntent[], batch: IntentQuery[]) {
  const { model, fallback } = intentModels();
  const room = Math.max(0, MAX_INTENTS - intents.length);
  const inputKey = await hash(`${INTENT_CONTEXT}:${model}:${batch.map((query) => query.key).sort().join('\n')}`);
  const jobId = await claimDecisionJob({
    projectId,
    workspaceId,
    contextKey: INTENT_CONTEXT,
    provider: 'fanout-intents',
    model,
    inputKey,
    reserveUsd: INTENT_RESERVE_USD,
    inputJson: JSON.stringify({ keys: batch.map((query) => query.key) }),
    retryAfterMs: INTENT_RETRY_AFTER_MS,
    cap: {
      sql: '(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs WHERE project_id=? AND context_key=? AND requested_at>=?)+?<=?',
      params: [projectId, INTENT_CONTEXT, `${now().slice(0, 7)}-01T00:00:00.000Z`, INTENT_RESERVE_USD, INTENT_MONTHLY_MAX_USD],
    },
  });
  if (!jobId) return null;
  try {
    const result = await requestDecisions(model, fallback, {
      label: 'Fan-out intents',
      post: (payload, timeoutMs) => postChat(payload, timeoutMs, 'fanout_intents'),
      timeoutMs: CALL_TIMEOUT_MS,
      payload: (m) => intentRequest(m, context, intents, batch, room),
      parse: (raw) => parseIntentResponse(raw, intents, batch, room),
    });
    const done = now();
    const created = result.created.map((intent) => ({ ...intent, id: crypto.randomUUID() }));
    const idOf = new Map(created.map((intent) => [intent.ref, intent.id]));
    const kept = `EXISTS(SELECT 1 FROM brand_research_jobs WHERE id=? AND completed_at=? AND status IN ('completed','unsettled'))`;
    const database = db();
    const [completed] = await database.batch([
      completeDecisionJob(jobId, result, JSON.stringify({ created: created.length, assigned: result.assignments.size }), INTENT_RESERVE_USD, done),
      database
        .prepare(
          `INSERT INTO fanout_intents(id,project_id,name,description,entities_json,created_at)
           SELECT json_extract(i.value,'$.id'),?,json_extract(i.value,'$.name'),json_extract(i.value,'$.description'),json_extract(i.value,'$.entities'),? FROM json_each(?) i WHERE ${kept}`,
        )
        .bind(projectId, done, JSON.stringify(created.map((intent) => ({ ...intent, entities: JSON.stringify(intent.entities) }))), jobId, done),
      database
        .prepare(
          `INSERT INTO fanout_query_intents(project_id,query_key,intent_id,model,decided_at)
           SELECT ?,json_extract(a.value,'$[0]'),json_extract(a.value,'$[1]'),?,? FROM json_each(?) a WHERE ${kept}
           ON CONFLICT(project_id,query_key) DO NOTHING`,
        )
        .bind(projectId, result.model, done, JSON.stringify([...result.assignments].map(([key, target]) => [key, target ? (idOf.get(target) ?? target) : null])), jobId, done),
      database.prepare(upsert).bind(revisionKey(projectId), done),
    ]);
    // A job marked uncertain meanwhile kept nothing: this step stops rather than point at intents that were not written.
    if (!completed?.meta.changes) return 'failed' as const;
    intents.push(...created.map(({ ref: _ref, ...intent }) => intent));
    return 'answered' as const;
  } catch (error) {
    await failDecisionJob(jobId, error, INTENT_RESERVE_USD, 'Fan-out intents');
    console.warn(`Fan-out intents: ${error instanceof Error ? error.message : 'failed'}; the searches wait for a later step.`);
    return 'failed' as const;
  }
}

/**
 * One bounded step of one project: its searches without an intent, the most frequent first, INTENT_BATCH at a time, until
 * REQUESTS_PER_STEP requests, the time budget or the first request that is not answered (a failure, a ceiling, a request
 * cooling down). Searches in a request that may have been billed (or is in flight) are never sent again in a new one.
 * Returns the requests answered.
 */
export async function classifyIntents(projectId: string, workspaceId: string, deadline = Date.now() + STEP_BUDGET_MS) {
  const queries = await projectQueries(projectId, workspaceId);
  if (!queries.length) return 0;
  const database = db();
  const [decided, intentRows, open] = await database.batch<Record<string, unknown>>([
    database.prepare('SELECT query_key k,intent_id i FROM fanout_query_intents WHERE project_id=?').bind(projectId),
    database.prepare('SELECT id,name,description,entities_json FROM fanout_intents WHERE project_id=? ORDER BY created_at,id').bind(projectId),
    database
      .prepare("SELECT input_json FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND context_key=? AND status IN ('pending','submitting','unknown','failed') AND (status<>'failed' OR cost_usd>0)")
      .bind(projectId, workspaceId, INTENT_CONTEXT),
  ]);
  const settled = new Set(decided.results.map((row) => String(row.k)));
  for (const row of open.results)
    try {
      for (const key of (JSON.parse(String(row.input_json)) as { keys: string[] }).keys) settled.add(key);
    } catch {
      /* A row that cannot be read holds no searches. */
    }
  // ponytail: a billed answer that could not be read leaves its searches waiting for good; a manual reprocess would free them.
  let left = queries.filter((query) => !settled.has(query.key));
  if (!left.length) return 0;
  // A decision root (9/11/2026): a search whose words match an assigned one's (intentTokenKey: order, accents and stop words
  // aside) takes that search's intent without a call. Within the searches still to ask, one per key goes to the model; the
  // others take its intent on a later step.
  const byTokens = new Map<string, string | null>();
  for (const row of decided.results) {
    const tokens = intentTokenKey(String(row.k));
    if (tokens && !byTokens.has(tokens)) byTokens.set(tokens, row.i == null ? null : String(row.i));
  }
  const matched = left.filter((query) => byTokens.has(intentTokenKey(query.key)));
  if (matched.length) {
    await database.batch([
      database
        .prepare(
          `INSERT INTO fanout_query_intents(project_id,query_key,intent_id,model,decided_at)
           SELECT ?,json_extract(a.value,'$[0]'),json_extract(a.value,'$[1]'),'tokens',? FROM json_each(?) a WHERE 1 ON CONFLICT(project_id,query_key) DO NOTHING`,
        )
        .bind(projectId, now(), JSON.stringify(matched.map((query) => [query.key, byTokens.get(intentTokenKey(query.key))]))),
      database.prepare(upsert).bind(revisionKey(projectId), now()),
    ]);
    left = left.filter((query) => !matched.includes(query));
  }
  const asking = new Set<string>();
  left = left.filter((query) => {
    const tokens = intentTokenKey(query.key);
    if (tokens && asking.has(tokens)) return false;
    asking.add(tokens);
    return true;
  });
  if (!left.length) return 0;
  const project = await ownedProject(projectId, workspaceId);
  const context: IntentContext = { brand: String(project.name), category: String(project.category ?? ''), language: String(project.language_code ?? 'en') };
  const intents: FanoutIntent[] = intentRows.results.map((row) => ({ id: String(row.id), name: String(row.name), description: String(row.description), entities: readEntities(row.entities_json) }));
  let asked = 0;
  while (left.length && asked < REQUESTS_PER_STEP && Date.now() < deadline) {
    const outcome = await askBatch(projectId, workspaceId, context, intents, left.slice(0, INTENT_BATCH));
    if (outcome !== 'answered') break;
    asked++;
    left = left.slice(INTENT_BATCH);
  }
  return asked;
}

/**
 * Scheduler step (and each project runner's): a few projects with a store, the least recently looked at first (or only
 * `projectIds`), each marked before it is classified so one that fails or is slow does not starve the others. Never runs
 * while a page loads. Returns the requests answered.
 */
export async function processFanoutIntents(projectIds?: readonly string[]) {
  if (!modelKeyConfigured()) return 0;
  // An answer that never came back (the Worker stopped mid-call) is uncertain: it is not resent.
  await markStaleUnknown(INTENT_CONTEXT, INTENT_RESERVE_USD);
  const database = db();
  const due = (
    await database
      .prepare(
        `SELECT p.id id,p.workspace_id workspace_id FROM projects p
         JOIN project_stores s ON s.project_id=p.id AND s.workspace_id=p.workspace_id AND s.initialized=1
         LEFT JOIN system_state c ON c.key='fanout-intents-checked:'||p.id
         WHERE p.archived=0 AND COALESCE(c.value,'')<?${projectIds ? ' AND p.id IN (SELECT value FROM json_each(?))' : ''} ORDER BY COALESCE(c.value,'') LIMIT ?`,
      )
      .bind(new Date(Date.now() - CHECK_EVERY_MS).toISOString(), ...(projectIds ? [JSON.stringify(projectIds)] : []), PROJECTS_PER_TICK)
      .all<{ id: string; workspace_id: string }>()
  ).results;
  const deadline = Date.now() + STEP_BUDGET_MS;
  let asked = 0;
  for (const item of due) {
    if (Date.now() > deadline) break;
    await database.prepare(upsert).bind(checkedKey(item.id), now()).run();
    try {
      asked += await classifyIntents(item.id, item.workspace_id, deadline);
    } catch (error) {
      // A busy store or an unreadable project waits for a later look; the other projects go on.
      console.warn(`Fan-out intents: ${error instanceof Error ? error.message : 'failed'}.`);
    }
  }
  return asked;
}
