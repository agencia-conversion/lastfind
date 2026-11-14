import { db, now } from './env';
import { postDecisions } from './decisions-api';
import { mayUseFallback } from '@/lib/provider-fallback';
import { researchBudgetCondition } from './brand-research';
import { recordRefusal } from './spend-guards';
import { moduleOfContext } from '@/lib/platform-spend';


/** A call that may have been billed without a reported cost is `unknown` and never resent automatically. */
export class DecisionProviderError extends Error {
  constructor(
    message: string,
    readonly unknown: boolean,
    readonly cost: number | null,
    readonly status = 0,
  ) {
    super(message);
  }
}
const CALL_TIMEOUT_MS = 20_000;

export async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

type Call<T> = {
  payload: (model: string) => unknown;
  parse: (raw: unknown, model: string) => T & { cost: number | null };
  label: string;
  /** Another OpenRouter endpoint (a chat completion) and its timeout; the Decisions API by default. */
  post?: (payload: unknown, timeoutMs: number) => Promise<Response>;
  timeoutMs?: number;
};

async function callOnce<T>(model: string, call: Call<T>) {
  let sent = false;
  let status = 0;
  let cost: number | null = null;
  try {
    const payload = call.payload(model);
    sent = true;
    const response = await (call.post ?? postDecisions)(payload, call.timeoutMs ?? CALL_TIMEOUT_MS);
    status = response.status;
    if (!response.ok) {
      // An error answer carries no completion and OpenRouter bills none: a refusal before any work (429 included) or the
      // provider failing (408, 5xx). Only a call with no answer at all (a timeout here, a reset connection) stays uncertain.
      sent = false;
      throw new Error(`OpenRouter returned HTTP ${response.status}.`);
    }
    const raw = (await response.json()) as { usage?: { cost?: unknown } };
    if (typeof raw.usage?.cost === 'number' && Number.isFinite(raw.usage.cost) && raw.usage.cost >= 0) cost = raw.usage.cost;
    return { ...call.parse(raw, model), model };
  } catch (error) {
    throw new DecisionProviderError(error instanceof Error ? error.message.slice(0, 200) : `${call.label} request failed.`, sent && cost === null, cost, status);
  }
}

/** One request, then the previous engine when the configured model fails and `mayUseFallback` allows it (the same rule as source types). */
export async function requestDecisions<T>(model: string, fallback: string | null, call: Call<T>) {
  try {
    return await callOnce(model, call);
  } catch (error) {
    if (!fallback || !(error instanceof DecisionProviderError) || !mayUseFallback(error)) throw error;
    console.warn(`${call.label}: ${model} failed (${error.message}); retrying on ${fallback}.`);
    const spent = error.unknown ? null : (error.cost ?? 0);
    try {
      const result = await callOnce(fallback, call);
      return { ...result, cost: result.cost === null || spent === null ? null : result.cost + spent };
    } catch (second) {
      if (!(second instanceof DecisionProviderError)) throw second;
      throw new DecisionProviderError(second.message, second.unknown || spent === null, (second.cost ?? 0) + (spent ?? 0), second.status);
    }
  }
}

export type DecisionJob = {
  projectId: string;
  workspaceId: string;
  contextKey: string;
  provider: string;
  model: string;
  inputKey: string;
  reserveUsd: number;
  inputJson: string;
  retryAfterMs: number;
  /** An extra cap on top of the global research budget (for example a per-project monthly ceiling); `?` placeholders bound to `params`. */
  cap?: { sql: string; params: unknown[] };
};

/**
 * Reserves one `brand_research_jobs` row for this exact request and takes it (`submitting`). Null when the
 * request is already pending, running, answered, uncertain or cooling down, or a budget is full.
 */
export async function claimDecisionJob(job: DecisionJob) {
  const database = db();
  const stamp = now();
  // With the plan's monthly count of the module for the whole workspace (8/11/2026), in the same INSERT.
  const budget = researchBudgetCondition(job.reserveUsd, job.projectId, { owner: job.workspaceId, module: moduleOfContext(job.contextKey) });
  const cap = job.cap ?? { sql: '1=1', params: [] as (string | number)[] };
  // RETURNING: the row it queued, without a second read.
  const row = await database
    .prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at)
    SELECT ?,?,?,?,?,?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived=0) AND ${budget.sql} AND ${cap.sql}
    ON CONFLICT(project_id,input_key) DO UPDATE SET status='pending',reserved_usd=excluded.reserved_usd,input_json=excluded.input_json,requested_at=excluded.requested_at,completed_at=NULL,error=NULL
    WHERE brand_research_jobs.workspace_id=excluded.workspace_id AND brand_research_jobs.status IN ('failed','cancelled') AND brand_research_jobs.cost_usd=0
    AND COALESCE(brand_research_jobs.completed_at,brand_research_jobs.requested_at)<? RETURNING id`)
    .bind(
      crypto.randomUUID(),
      job.workspaceId,
      job.projectId,
      job.inputKey,
      job.contextKey,
      job.inputKey,
      job.provider,
      job.model,
      job.reserveUsd,
      job.inputJson,
      stamp,
      job.projectId,
      job.workspaceId,
      ...budget.params,
      ...cap.params,
      new Date(Date.now() - job.retryAfterMs).toISOString(),
    )
    .first<{ id: string }>();
  if (!row) {
    // When it is a limit (not a request already pending, answered or cooling down), say which, once.
    const fits = await database
      .prepare(`SELECT (${budget.sql}) AND (${cap.sql}) ok`)
      .bind(...budget.params, ...cap.params)
      .first<{ ok: number }>()
      .catch(() => null);
    if (fits && !fits.ok) await recordRefusal(job.projectId, moduleOfContext(job.contextKey), job.reserveUsd);
    return null;
  }
  const claimBudget = researchBudgetCondition(0, job.projectId);
  const claimed = await database
    .prepare(`UPDATE brand_research_jobs SET status='submitting',started_at=? WHERE id=? AND status='pending'
    AND EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived=0) AND ${claimBudget.sql}`)
    .bind(stamp, row.id, job.projectId, job.workspaceId, ...claimBudget.params)
    .run();
  return claimed.meta.changes ? row.id : null;
}

/** The statement that closes a taken row with the provider's answer; callers batch it with what they keep. */
export function completeDecisionJob(jobId: string, result: { cost: number | null; model: string }, resultJson: string, reserveUsd: number, done: string) {
  return db()
    .prepare("UPDATE brand_research_jobs SET status=?,result_json=?,cost_usd=?,reserved_usd=?,completed_at=?,error=?,model=? WHERE id=? AND status='submitting'")
    .bind(
      result.cost === null ? 'unsettled' : 'completed',
      resultJson,
      result.cost ?? 0,
      result.cost ?? reserveUsd,
      done,
      result.cost === null ? 'Usage cost is unavailable; the conservative reservation is retained.' : null,
      result.model,
      jobId,
    );
}

export async function failDecisionJob(jobId: string, error: unknown, reserveUsd: number, label: string) {
  const provider = error instanceof DecisionProviderError ? error : null;
  await db()
    .prepare("UPDATE brand_research_jobs SET status=?,reserved_usd=?,cost_usd=?,completed_at=?,error=? WHERE id=? AND status='submitting'")
    .bind(
      provider?.unknown ? 'unknown' : 'failed',
      provider?.unknown ? reserveUsd : (provider?.cost ?? 0),
      provider?.cost ?? 0,
      now(),
      error instanceof Error ? error.message.slice(0, 200) : `${label} request failed.`,
      jobId,
    )
    .run();
}

/** A submission that never came back (the Worker stopped mid-call) is uncertain: it is not resent. */
export async function markStaleUnknown(contextPrefix: string, reserveUsd: number) {
  await db()
    .prepare(
      `UPDATE brand_research_jobs SET status='unknown',reserved_usd=MAX(reserved_usd,?),completed_at=?,error='Submission outcome is unknown; automatic retry is disabled.'
       WHERE context_key LIKE ? AND status='submitting' AND started_at<?`,
    )
    .bind(reserveUsd, now(), `${contextPrefix}%`, new Date(Date.now() - 5 * 60_000).toISOString())
    .run();
}
