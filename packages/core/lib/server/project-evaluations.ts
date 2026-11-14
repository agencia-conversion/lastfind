import { dollarBlock } from '@/lib/server/spend-guards';
import { db, now, setting } from '@/lib/server/env';
import { ApiError } from '@/lib/server/http';
import { BRAND_RESEARCH_RUBRIC, EVALUATED_BRANDS, SENTIMENT_QUESTIONS_VERSION, sentimentReprocessKey } from '@/lib/brand-research';
import {
  researchBudgetCondition,
  researchModel,
  sentimentRoots,
  unevaluatedResearch,
} from '@/lib/server/brand-research';
import {
  decisionRequest,
  parseDecisionResponse,
  RESEARCH_RESERVE_USD,
  steadySentiment,
} from '@/lib/brand-research-provider';
import { OPERATIONS_LEASE, renewLease, withLease } from '@/lib/server/leases';
import { inPool, OUTBOUND_CONNECTIONS } from '@/lib/pool';
import { postDecisions, refusal } from '@/lib/server/decisions-api';
import { readOperation, writer, type Operation } from './operation-state';
import {
  automaticTargets,
  sentimentRunnerProjects,
  evaluationSpent,
  firstCycle,
  monthStart,
  reservationGuard,
  sentimentSpent,
  sentimentStateKey,
  storeRevisions,
  SENTIMENT_JOB_PREFIX,
  SENTIMENT_USD_PER_ANSWER,
  tickState,
  whyRefused,
  type AutomaticTarget,
} from './automatic-evaluations';
import { decisionKeyConfigured } from '@/lib/server/model-routes';

/**
 * Sentiment of the answers of every project on automatic evaluations (`enabled=1, automatic=1`; both editions, from the
 * scheduler's project operations). Each project has its own state in
 * `system_state`. Sentiment and source types of a project share one monthly ceiling (its configuration row, US$ 10 by default).
 */
/** Most the operation spends on one project in one round (from the first answer found until nothing is left). */
export const SENTIMENT_ROUND_CEILING_USD = 2;
/**
 * Answers one invocation sends for one project (Worker setting of the same name), and for all of them. Their inputs are built
 * as they leave (~160 ms of CPU each in workerd), so a full invocation stays near 15 s of the 30 s of CPU a Worker may use.
 */
export const SENTIMENT_PER_TICK = 90;
export const SENTIMENT_TICK_TOTAL = 90;
/**
 * Answers of one project in flight at once: Cloudflare's six outbound connections per invocation (OUTBOUND_CONNECTIONS). A
 * reservation is still one guarded INSERT each, so concurrent answers never pass a ceiling. Worker setting of the same name.
 */
export const SENTIMENT_CONCURRENCY = OUTBOUND_CONNECTIONS;
const SYSTEMIC_STATUSES = [401, 402, 403, 429];
/** With nothing left to evaluate the operation looks for new answers only this often; a stopped one retries after the same wait. */
export const SENTIMENT_RECHECK_MS = 60 * 60_000;
/**
 * Per-invocation limits, shared by every project of the tick. Reads: scope pages (each up to 1,000 answers or
 * 4 million characters) read from the project stores. Time: wall clock from the start of the tick; no new answer is reserved
 * past it (a request already sent is finished and recorded). Work beyond either is left for the next tick: the read resumes
 * at the saved page cursor and an answer with no job is simply found again, so nothing is lost or sent twice.
 * The Worker settings of the same name override the defaults (positive numbers only).
 */
export const SENTIMENT_READ_PAGES_PER_TICK = 4;
export const SENTIMENT_TICK_BUDGET_MS = 45_000;
const tickLimit = (name: string, fallback: number) => {
  const value = Number(setting(name));
  return Number.isFinite(value) && value >= 0 && setting(name) !== '' ? value : fallback;
};
type TickBudget = { pages: number; deadline: number; busy?: boolean };
const outOfTime = (tick: TickBudget) => Date.now() >= tick.deadline;
/**
 * One project is evaluated by one invocation at a time (the scheduler's, or a preview step's): its lease guards the
 * "left in flight by a tick that died" check below, which would otherwise take a live request of another invocation for a dead one.
 */
const sentimentLease = (projectId: string) => `sentiment:${projectId}`;
export { sentimentStateKey, automaticTargets, sentimentRunnerProjects };

/**
 * One project's tick (under its own lease, `sentimentLease`): evaluates its answers that have no job yet, up to
 * SENTIMENT_CONCURRENCY at a time, never past the round, month and global ceilings, so repeating is safe. An outcome that is
 * uncertain after the request left is recorded and never resent.
 */
async function sentimentTick(target: AutomaticTarget, limit: number, tick: TickBudget) {
  const { projectId, workspaceId, sentimentProvider: provider } = target;
  const database = db();
  const key = sentimentStateKey(projectId);
  // A project turned on after the last request starts by itself; the request only exists to reopen a stopped one.
  await database
    .prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)')
    .bind(key, JSON.stringify({ status: 'requested', requestedAt: now() }))
    .run();
  const found = await readOperation(key);
  if (!found) return 0;
  const { operation } = found;
  // A stopped operation (failed, or a full round) reopens by itself an hour later; the first-cycle ceiling only once that
  // cycle is over (completed or its window passed). An answer with an uncertain outcome keeps its job row, so reopening never resends it.
  const reopens =
    operation.status === 'failed' || (operation.status === 'capped' && (!operation.cycleCeiling || !(await firstCycle())));
  if (!['requested', 'running', 'idle'].includes(String(operation.status)) && !reopens) return 0;
  const since = operation.status === 'idle' ? operation.checkedAt : reopens ? (operation.failedAt ?? operation.cappedAt) : undefined;
  // Read before the scope: answers published while this tick reads move it again, so the next tick looks.
  const revisions = await storeRevisions([projectId]);
  // An idle project looks again as soon as new answers reach its store, otherwise hourly; a stopped one waits its hour.
  if (since !== undefined && Date.now() - Date.parse(String(since)) < SENTIMENT_RECHECK_MS && (operation.status !== 'idle' || operation.revisions === revisions))
    return 0;
  const save = writer(key, operation, found.raw);
  const fail = (error: string, progress: Operation = {}) => save({ ...progress, status: 'failed', failedAt: now(), error });
  try {
    if (!decisionKeyConfigured()) {
      await fail('The OpenRouter server key is not configured.');
      return 0;
    }
    // An answer left in flight by a tick that died has an uncertain outcome: never resend it.
    const stale = await database
      .prepare("UPDATE brand_research_jobs SET status='unknown',error='Tick ended before the outcome was recorded.' WHERE project_id=? AND (id LIKE ? OR id LIKE 'netflix-sentiment:%') AND status='submitting'")
      .bind(projectId, `${SENTIMENT_JOB_PREFIX}%`)
      .run();
    if (stale.meta.changes) {
      await fail('A previous evaluation has an unknown outcome and was not resent.');
      return 0;
    }

    const progress = {
      evaluated: Number(operation.evaluated || 0),
      failed: Number(operation.failed || 0),
      roundStartedAt: operation.status === 'running' ? String(operation.roundStartedAt) : now(),
      // Where this round's read resumes; a new round starts at the newest answer.
      cursor: operation.status === 'running' ? (operation.cursor as { at: string; id: string } | undefined) : undefined,
    };
    const month = monthStart();
    const ceilings = async () => {
      const [round, spent, block] = await Promise.all([sentimentSpent(projectId, progress.roundStartedAt), evaluationSpent(projectId, month), dollarBlock(projectId, RESEARCH_RESERVE_USD)]);
      return {
        round,
        month: spent,
        roundFull: round + RESEARCH_RESERVE_USD > SENTIMENT_ROUND_CEILING_USD,
        // The project's budget (Settings > Monitoring > Budget) has no room for one more answer.
        monthFull: block === 'project_budget',
      };
    };
    const note = (text: string, spent: Awaited<ReturnType<typeof ceilings>>) => ({
      ...progress,
      status: 'running',
      note: text,
      roundUsd: spent.round,
      monthUsd: spent.month,
      updatedAt: now(),
    });
    const before = await ceilings();
    // The month ceiling resets by itself; the operation just waits, without reading any answer.
    if (before.monthFull) {
      await save(note('Month ceiling reached; waiting for the next month.', before));
      return 0;
    }
    if (tick.pages <= 0 || outOfTime(tick)) return 0;
    const pending = await unevaluatedResearch(projectId, workspaceId, provider, Math.min(tickLimit('SENTIMENT_PER_TICK', SENTIMENT_PER_TICK), limit), {
      from: progress.cursor,
      maxPages: tick.pages,
    });
    tick.pages -= pending.pages;
    if (!pending.count) {
      // Pages are left to read: the next tick goes on from there. Only a read that reached the end of the scope is idle.
      if (pending.next) await save({ ...progress, cursor: pending.next, status: 'running', note: 'Read limit reached; continuing next tick.', roundUsd: before.round, monthUsd: before.month, updatedAt: now() });
      // Answers held for the brand analysis (a new project's first ones) are looked at again on the next tick, not in an hour: the
      // analysis finishing moves no revision (13/11/2026: a new project's first answers read "Not evaluated" for an hour).
      else await save({ ...progress, cursor: undefined, status: 'idle', checkedAt: now(), revisions: pending.waiting ? null : revisions, roundUsd: before.round, monthUsd: before.month });
      return 0;
    }
    const model = researchModel(provider);
    // Each project's common words, read once per tick for the decision roots (sentimentRoots).
    const commons = {};
    let sent = 0;
    // The cursor moves past the pages read only when every answer found was handled; otherwise they are read again.
    let handled = true;
    // Why the pool stopped: the state it leaves (a failure outranks a ceiling), or `lost` (lease lost, project switched off: no state).
    let stop: Operation | null = null;
    let lost = false;
    const halt = (next?: Operation) => {
      handled = false;
      if (next && (!stop || next.status === 'failed')) stop = next;
      return false;
    };
    await inPool(pending.runs, tickLimit('SENTIMENT_CONCURRENCY', SENTIMENT_CONCURRENCY), async (run) => {
      if (stop || lost || outOfTime(tick)) return halt();
      // A lease that expired may already belong to another tick: nothing is reserved or sent without it.
      if (!(await renewLease(sentimentLease(projectId), OPERATIONS_LEASE.ms))) {
        lost = true;
        return halt();
      }
      const stamp = now();
      // An answer that names no brand has nothing to read (the decision model refuses a request with no question): it is
      // kept as read, with no readings and no cost, so it is neither sent nor offered again.
      // Decision roots (sentimentRoots): readings the saved windows and the rules settle need no call. When they settle every
      // brand, the answer is kept as read at no cost, outside the reservation, like an answer that names none.
      const roots = run.input.options.length ? await sentimentRoots(run.input, projectId, workspaceId, model, commons) : null;
      if (roots && !roots.ask) {
        const readings = await roots.keep([], model);
        await database
          .prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,cost_usd,input_json,result_json,requested_at,started_at,completed_at,calls)
          VALUES(?,?,?,?,?,?,?,?,'completed',0,0,?,?,?,?,?,0) ON CONFLICT(project_id,input_key) DO NOTHING`)
          .bind(`${SENTIMENT_JOB_PREFIX}${crypto.randomUUID()}`, workspaceId, projectId, run.inputKey, pending.contextKey, run.answerHash, provider, model, JSON.stringify(run.input), JSON.stringify(readings), stamp, stamp, stamp)
          .run();
        progress.evaluated++;
        return true;
      }
      if (!roots) {
        await database
          .prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,cost_usd,input_json,result_json,requested_at,started_at,completed_at)
          VALUES(?,?,?,?,?,?,?,?,'completed',0,0,?,'[]',?,?,?) ON CONFLICT(project_id,input_key) DO NOTHING`)
          .bind(`${SENTIMENT_JOB_PREFIX}${crypto.randomUUID()}`, workspaceId, projectId, run.inputKey, pending.contextKey, run.answerHash, provider, model, JSON.stringify(run.input), stamp, stamp, stamp)
          .run();
        return true;
      }
      const budget = researchBudgetCondition(RESEARCH_RESERVE_USD, projectId, { owner: workspaceId, module: 'sentiment' });
      const guard = reservationGuard(target, RESEARCH_RESERVE_USD, { since: progress.roundStartedAt, ceiling: SENTIMENT_ROUND_CEILING_USD });
      const id = `${SENTIMENT_JOB_PREFIX}${crypto.randomUUID()}`;
      // Reserve before sending: the global budget and this project's month, round and first-cycle ceilings are checked in the
      // INSERT itself, so answers reserved side by side can never pass them together.
      const reserved = await database
        .prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at,started_at)
        SELECT ?,?,?,?,?,?,?,?,'submitting',?,?,?,? WHERE ${budget.sql} AND ${guard.sql}
        ON CONFLICT(project_id,input_key) DO NOTHING`)
        .bind(
          id,
          workspaceId,
          projectId,
          run.inputKey,
          pending.contextKey,
          run.answerHash,
          provider,
          model,
          RESEARCH_RESERVE_USD,
          JSON.stringify(run.input),
          stamp,
          stamp,
          ...budget.params,
          ...guard.params,
        )
        .run();
      if (!reserved.meta.changes) {
        // Either a job for this answer appeared meanwhile (skip it) or a ceiling is full: the state says which.
        const exists = await database
          .prepare('SELECT 1 AS found FROM brand_research_jobs WHERE project_id=? AND input_key=?')
          .bind(projectId, run.inputKey)
          .first();
        if (exists) return true;
        const why = await whyRefused(target, RESEARCH_RESERVE_USD, { since: progress.roundStartedAt, ceiling: SENTIMENT_ROUND_CEILING_USD });
        if (why === 'inactive') {
          lost = true;
          return halt();
        }
        const spent = await ceilings();
        if (why === 'month') return halt(note('Month ceiling reached; waiting for the next month.', spent));
        if (why === 'budget') return halt(note('Research budget is full; waiting.', spent));
        return halt({ status: 'capped', cappedAt: now(), roundUsd: spent.round, monthUsd: spent.month, ...(why === 'cycle' ? { cycleCeiling: true } : { roundCeilingUsd: SENTIMENT_ROUND_CEILING_USD }) });
      }
      sent++;
      let delivered = false;
      let cost: number | null = null;
      let status = 0;
      try {
        const ask = roots.ask!;
        const payload = decisionRequest(ask, provider, model);
        // From here on the request may be served and billed, whatever happens to the connection.
        delivered = true;
        const response = await steadySentiment(postDecisions)(payload);
        status = response.status;
        // A client error other than a timeout was rejected before any evaluation: not billed, outcome certain.
        if (response.status >= 400 && response.status < 500 && response.status !== 408) delivered = false;
        if (!response.ok) throw new Error(await refusal(response));
        const raw = (await response.json()) as { usage?: { cost?: unknown } };
        if (typeof raw.usage?.cost === 'number' && Number.isFinite(raw.usage.cost) && raw.usage.cost >= 0)
          cost = raw.usage.cost;
        // Checked against the model that was sent (Admin may run another model on this provider): once, the switch to Jev
        // failed every answer as an unexpected model.
        const result = parseDecisionResponse(raw, ask, provider, model);
        cost = result.cost;
        const readings = await roots.keep(result.readings, model);
        await database
          .prepare("UPDATE brand_research_jobs SET status=?,result_json=?,cost_usd=?,reserved_usd=?,completed_at=?,error=?,calls=? WHERE id=? AND status='submitting'")
          .bind(
            cost === null ? 'unsettled' : 'completed',
            JSON.stringify(readings),
            cost ?? 0,
            cost ?? RESEARCH_RESERVE_USD,
            now(),
            cost === null ? 'Usage cost is unavailable; the conservative reservation is retained.' : null,
            result.calls,
            id,
          )
          .run();
        progress.evaluated++;
        return true;
      } catch (error) {
        // Key, credit or rate-limit errors hit every answer: release this one and stop, so a new request retries it.
        if (!delivered && SYSTEMIC_STATUSES.includes(status)) {
          tickState.stopped = true;
          await database.prepare("DELETE FROM brand_research_jobs WHERE id=? AND status='submitting'").bind(id).run();
          const said = error instanceof Error ? error.message : `OpenRouter returned HTTP ${status}.`;
          // A rate limit that outlasted the retries passes by itself: the next tick goes on, without the hour a key or credit refusal waits.
          if (status === 429) return halt({ status: 'running', note: `${said} Continuing next tick.`, updatedAt: now() });
          return halt({ status: 'failed', failedAt: now(), error: `${said} The evaluation stopped and will retry on a new request.` });
        }
        const unknown = delivered && cost === null;
        await database
          .prepare("UPDATE brand_research_jobs SET status=?,reserved_usd=?,cost_usd=?,completed_at=?,error=? WHERE id=? AND status='submitting'")
          .bind(
            unknown ? 'unknown' : 'failed',
            unknown ? RESEARCH_RESERVE_USD : cost || 0,
            cost || 0,
            now(),
            error instanceof Error ? error.message.slice(0, 200) : 'Sentiment evaluation failed.',
            id,
          )
          .run();
        if (unknown) {
          tickState.stopped = true;
          return halt({ status: 'failed', failedAt: now(), error: 'An evaluation has an unknown outcome and was not resent.' });
        }
        // A certain failure is never resent either; no new answer leaves in this tick (a provider rejecting every answer
        // would otherwise mark them all failed), and the next tick moves on to the following ones.
        progress.failed++;
        return halt();
      }
    });
    if (lost) return sent;
    if (stop) {
      // The counters as they ended (answers in flight when the pool stopped were still recorded).
      await save({ ...(stop as Operation), ...progress });
      return sent;
    }
    const after = await ceilings();
    if (handled) progress.cursor = pending.next;
    await save({
      ...progress,
      status: 'running',
      remaining: pending.count - sent,
      more: Boolean(pending.next),
      truncated: pending.truncated,
      roundUsd: after.round,
      monthUsd: after.month,
      updatedAt: now(),
    });
    return sent;
  } catch (error) {
    // A busy or restarting project store (a detection running on the same project) passes by itself: the next tick goes on.
    if (error instanceof Error && error.name === 'ProjectStoreUnavailableError') {
      tick.busy = true;
      await save({ ...operation, status: 'running', note: 'Project storage was busy; continuing next tick.', updatedAt: now() });
      return 0;
    }
    // The error class names the stage that broke without exposing provider content or database details.
    await fail(`Evaluation failed (${error instanceof Error ? error.name : 'unknown'}).`);
    return 0;
  }
}

/**
 * Scheduler hook (every 5 minutes): the sentiment of each automatic project, the one waiting longest first, so a project
 * with a long backlog never starves the others. At most SENTIMENT_TICK_TOTAL answers, SENTIMENT_READ_PAGES_PER_TICK pages and SENTIMENT_TICK_BUDGET_MS per tick.
 */
export async function applyProjectSentiment() {
  const targets = await automaticTargets();
  const waited = await Promise.all(
    targets.map(async (target) => {
      const found = await readOperation(sentimentStateKey(target.projectId));
      return { target, since: String(found?.operation.updatedAt ?? found?.operation.checkedAt ?? '') };
    }),
  );
  let sent = 0;
  tickState.stopped = false;
  const tick: TickBudget = {
    pages: tickLimit('SENTIMENT_READ_PAGES_PER_TICK', SENTIMENT_READ_PAGES_PER_TICK),
    deadline: Date.now() + tickLimit('SENTIMENT_TICK_BUDGET_MS', SENTIMENT_TICK_BUDGET_MS),
  };
  for (const { target } of waited.sort((a, b) => a.since.localeCompare(b.since))) {
    // A rejected key, credit or rate limit, or an uncertain outcome, stops every evaluation of this tick, not only that project's.
    if (sent >= SENTIMENT_TICK_TOTAL || tickState.stopped || tick.pages <= 0 || outOfTime(tick)) break;
    // A project another invocation is evaluating (a preview step) is left to it.
    sent += (await withLease(sentimentLease(target.projectId), OPERATIONS_LEASE.ms, () => sentimentTick(target, SENTIMENT_TICK_TOTAL - sent, tick))) ?? 0;
  }
  return sent;
}

/**
 * The same tick for one project, in an invocation of its own (the preview's reprocess runs one per project side by side, each
 * with its own six connections). `busy`: its store or its lease was taken, so nothing was done and the step is worth repeating.
 */
export async function projectSentimentStep(projectId: string) {
  const target = (await automaticTargets()).find((item) => item.projectId === projectId);
  if (!target) return { done: 0, busy: false };
  const tick: TickBudget = {
    pages: tickLimit('SENTIMENT_READ_PAGES_PER_TICK', SENTIMENT_READ_PAGES_PER_TICK),
    deadline: Date.now() + tickLimit('SENTIMENT_TICK_BUDGET_MS', SENTIMENT_TICK_BUDGET_MS),
  };
  const done = await withLease(sentimentLease(projectId), OPERATIONS_LEASE.ms, () => sentimentTick(target, SENTIMENT_PER_TICK, tick));
  return { done: done ?? 0, busy: done === null || !!tick.busy };
}

/** The periods a sentiment reprocess reads again (Admin > Algorithms), in days; the first is the default. */
export const SENTIMENT_REPROCESS_DAYS = [7, 30, 90] as const;
export const sentimentReprocessDays = (value: unknown) =>
  SENTIMENT_REPROCESS_DAYS.find((days) => days === Number(value)) ?? SENTIMENT_REPROCESS_DAYS[0];

/**
 * Admin > Algorithms, sentiment: per project on automatic evaluations, the latest answers of the last `days` (7, 30 or 90)
 * that a reprocess reads again under the current rule, every brand they name, with the readings of an earlier rule of the
 * 90-day window, and what that would cost at the observed price. A free read of the saved answers and jobs; nothing is sent.
 * `requestedAt`: a reprocess already asked for that project.
 */
export async function sentimentReprocessEstimate(daysValue?: unknown) {
  const days = sentimentReprocessDays(daysValue);
  const database = db();
  const targets = await automaticTargets();
  // A reading costs more the more brands it reads (every brand an answer names), so the price is per brand read:
  // the new rule's own once it has 20 answers; before that the previous rule's (its request is smaller); else the pilot's.
  const price = (current: boolean) =>
    database
      .prepare(
        `SELECT COUNT(*) n,AVG(cost_usd/MAX(1,json_array_length(input_json,'$.options'))) usd FROM brand_research_jobs WHERE id LIKE ? AND status='completed' AND cost_usd>0${current ? " AND json_extract(input_json,'$.rubric')=?" : ''}`,
      )
      .bind(`${SENTIMENT_JOB_PREFIX}%`, ...(current ? [BRAND_RESEARCH_RUBRIC] : []))
      .first<{ n: number; usd: number | null }>();
  const [own, previous, names, flags] = await Promise.all([
    price(true),
    price(false),
    database
      .prepare('SELECT id,name,domain FROM projects WHERE id IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(targets.map((target) => target.projectId)))
      .all<{ id: string; name: string; domain: string | null }>(),
    database
      .prepare('SELECT key,value FROM system_state WHERE key IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(targets.map((target) => sentimentReprocessKey(target.projectId))))
      .all<{ key: string; value: string }>(),
  ]);
  const basis = own && own.n >= 20 && own.usd ? 'current' : previous && previous.n >= 20 && previous.usd ? 'previous' : 'default';
  const usdPerBrand = basis === 'current' ? own!.usd! : basis === 'previous' ? previous!.usd! : SENTIMENT_USD_PER_ANSWER / EVALUATED_BRANDS;
  const projects = [];
  for (const target of targets) {
    const project = names.results.find((row) => row.id === target.projectId);
    let flag: { rubric?: string; requestedAt?: string } = {};
    try {
      flag = JSON.parse(flags.results.find((row) => row.key === sentimentReprocessKey(target.projectId))?.value ?? '{}');
    } catch {
      // Unreadable: shown as not requested.
    }
    const row = {
      id: target.projectId,
      name: project?.name ?? target.projectId,
      domain: project?.domain ?? null,
      ceilingUsd: target.ceilingUsd,
      requestedAt: flag.rubric === BRAND_RESEARCH_RUBRIC ? (flag.requestedAt ?? null) : null,
      legacy: null as number | null,
      legacyBrands: null as number | null,
      pending: null as number | null,
      truncated: false,
    };
    try {
      const scope = await unevaluatedResearch(target.projectId, target.workspaceId, target.sentimentProvider, 0, { rereadDays: days });
      Object.assign(row, { legacy: scope.legacy, legacyBrands: scope.legacyBrands, pending: scope.count, truncated: scope.truncated });
    } catch {
      // An unreadable project shows no numbers (never zero).
    }
    projects.push({ ...row, estimateUsd: row.legacyBrands === null ? null : row.legacyBrands * usdPerBrand });
  }
  return {
    rubric: BRAND_RESEARCH_RUBRIC,
    days,
    periods: SENTIMENT_REPROCESS_DAYS,
    usdPerBrand,
    priceBasis: basis,
    roundCeilingUsd: SENTIMENT_ROUND_CEILING_USD,
    estimateUsd: projects.reduce((sum, project) => sum + (project.estimateUsd ?? 0), 0),
    complete: projects.every((project) => project.legacy !== null),
    projects,
  };
}

/**
 * "Reprocess everything with the new rule" for these projects on automatic evaluations: their readings of an earlier rule stop
 * holding their answers (`sentimentReprocessKey`), so the scheduler reads those answers again, under the same reservation
 * guard and ceilings as every evaluation (round, month, first cycle, global). An idle project looks at once instead of within
 * the hour. Nothing is sent here; repeating is harmless. Logged with the admin's address.
 */
export async function requestSentimentReprocess(value: Record<string, unknown>, actor: string) {
  const { projectIds } = value;
  const days = sentimentReprocessDays(value.days);
  const targets = await automaticTargets();
  if (
    !Array.isArray(projectIds) ||
    !projectIds.length ||
    !projectIds.every((id) => typeof id === 'string' && targets.some((target) => target.projectId === id))
  )
    throw new ApiError(400, 'Choose projects on automatic evaluations.');
  const stamp = now();
  const database = db();
  await database.batch(
    [...new Set(projectIds as string[])].flatMap((id) => [
      database
        .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .bind(sentimentReprocessKey(id), JSON.stringify({ rubric: BRAND_RESEARCH_RUBRIC, questions: SENTIMENT_QUESTIONS_VERSION, brands: 'every', requestedAt: stamp, days })),
      database
        .prepare("UPDATE system_state SET value=json_set(value,'$.status','requested','$.requestedAt',?) WHERE key=? AND json_extract(value,'$.status')='idle'")
        .bind(stamp, sentimentStateKey(id)),
      database
        .prepare('INSERT INTO admin_audit_log(at,actor,action,key) VALUES(?,?,?,?)')
        .bind(stamp, actor, 'set', sentimentReprocessKey(id)),
    ]),
  );
}
