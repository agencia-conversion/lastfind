import { db, now } from './env';
import { readOperation, writer, type Operation } from './operation-state';
import { OPERATIONS_LEASE, renewLease, withLease } from './leases';
import { inPool, OUTBOUND_CONNECTIONS } from '../pool';
import type { ResearchProvider } from '../brand-research';
import {
  AUTO_LEDGER,
  automaticTargets,
  closeFirstCycle,
  firstCycle,
  storeRevisions,
  reservationGuard,
  tickState,
  whyRefused,
  type AutomaticTarget,
} from './automatic-evaluations';
import { answersWithoutSentiment, AUTO_CLASSIFICATION_KEY, researchBudgetCondition } from './brand-research';
import { dollarBlock } from './spend-guards';
import { reportContext, sourceCounts, SOURCE_COUNT_PAGE, sourcesReport } from './reports';
import {
  PUBLIC_DEMO_CLASSIFIER,
  demoClassifierEngines,
  projectClassifierEngines,
  SYSTEMIC_PROVIDER_STATUSES,
  SourceTypeProviderError,
  cachedSourceTypes,
  catalogKey,
  catalogWrite,
  domainSamples,
  requestSourceTypes,
  sourceTypeJobInput,
  withSamples,
} from './source-types';
import { SOURCE_TYPE_BATCH_SIZE, SOURCE_TYPE_RESERVE_USD, type SourceTypeItem, type SourceTypeKind } from '../source-types';
import { decisionKeyConfigured } from './model-routes';
export { AUTO_CLASSIFICATION_KEY };

/**
 * Source typing over a scope of projects, in both editions: the automatic scope (every project on automatic evaluations, forever,
 * within each project's budget) runs from the scheduler here; the hosted edition adds its requested operator scopes on the same
 * `applyClassification`. Typing is global (`source_catalog`), so an item shared by two projects, or already typed by another scope,
 * is classified once and costs nothing the second time. Items typed under another rubric are not read as typed (the catalog
 * lookup is per rubric), so they are untyped here and go back to the queue.
 */
/** A requested (operator) scope sends this many batches a tick, one at a time; the automatic scope SOURCE_TYPE_BATCHES_PER_TICK. */
export const REQUESTED_BATCHES_PER_TICK = 5;
/**
 * The automatic scope (every project on automatic evaluations): batches one invocation sends, and how many are in flight at
 * once (Cloudflare's six outbound connections per invocation). Its ceilings are conditions of each reservation's INSERT, so
 * batches side by side never pass them; the requested operator scopes check their ledger before the
 * INSERT, so they stay one batch at a time.
 */
export const SOURCE_TYPE_BATCHES_PER_TICK = 30;
export const SOURCE_TYPE_CONCURRENCY = OUTBOUND_CONNECTIONS;
/**
 * The automatic scope's own lease: its state and the ledger it checks for batches a dead tick left in flight are shared by every
 * project, so one invocation at a time types them, whoever runs it (the operations tick, its project runner, a preview step),
 * without holding the operations lease the other operations need.
 */
export const AUTO_SOURCES_LEASE = { key: 'auto-sources', ms: 270_000 } as const;
/** Same windows the reports read, so every item the account can see typed is covered. */
export const RANKED_WINDOWS = { domain: 2000, url: 1000 } as const;
/** With nothing left to classify, or after a rejected batch, the scope is looked at again only this often. */
export const AUTO_RECHECK_MS = 60 * 60_000;
export type Target = { projectId: string; workspaceId: string; domain: string; account?: string; ceilingUsd?: number; sourceProvider?: ResearchProvider };
export type Scope = {
  estimateKey: string;
  classificationKey: string;
  ledger: string;
  ceilingUsd: number;
  scopeError: string;
  /** Read every cited domain and URL, page by page (all projects), instead of the reports' ranked window (a requested operator scope). */
  paged: boolean;
  /** The ceiling is each project's own, per calendar month, over all its automatic evaluations; a capped project is skipped, not fatal. */
  perProject?: boolean;
  /** The projects to work on now, or null when the scope no longer holds. */
  targets: () => Promise<Target[] | null>;
};
export async function hash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
/** Everything a ledger has spent or still holds, in dollars, over all its projects. */
export async function ledgerSpent(ledger: string) {
  const row = await db()
    .prepare('SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) spent FROM brand_research_jobs WHERE context_key=?')
    .bind(ledger)
    .first<{ spent: number }>();
  return Number(row?.spent || 0);
}
export const AUTO_SCOPE: Scope = {
  estimateKey: '',
  classificationKey: AUTO_CLASSIFICATION_KEY,
  ledger: AUTO_LEDGER,
  ceilingUsd: 0,
  scopeError: 'The project list could not be read.',
  paged: true,
  perProject: true,
  targets: automaticTargets,
};
/** Items of batches whose outcome is uncertain (`unknown`): they may already be billed, so they are never resent. */
export async function uncertainSources(ledger: string, kind: SourceTypeKind) {
  const { results } = await db()
    .prepare("SELECT input_json FROM brand_research_jobs WHERE context_key=? AND status='unknown'")
    .bind(ledger)
    .all<{ input_json: string | null }>();
  const keys = new Set<string>();
  for (const job of results) {
    try {
      const input = JSON.parse(job.input_json || '{}') as { kind?: string; items?: { key?: unknown }[] };
      if (input.kind !== kind || !Array.isArray(input.items)) continue;
      for (const item of input.items) if (typeof item?.key === 'string') keys.add(item.key);
    } catch {
      // A malformed ledger input only means there is nothing to exclude from it.
    }
  }
  return keys;
}

type Cited = { key: string; domain: string; title: string };

/**
 * Cited domains or URLs of one project, a page at a time. A ranked scope reads the reports' ranked window; a paged
 * scope reads every key, as the type summaries do, so no tail is left untyped.
 */
export async function* citedPages(scope: Scope, target: Target, kind: SourceTypeKind) {
  const query = new URLSearchParams({ project: target.projectId, days: '90', kind: 'cited', group: kind, page: '1' });
  const context = await reportContext(target.workspaceId, query);
  if (!scope.paged) {
    const window = await sourcesReport(context, query, RANKED_WINDOWS[kind]);
    yield { context, rows: window.rows.filter((row) => row.key !== '') as Cited[], complete: !window.hasMore };
    return;
  }
  for (let offset = 0; ; offset += SOURCE_COUNT_PAGE) {
    const page = await sourceCounts(context, query, offset);
    yield { context, rows: page.rows.filter((row) => row.key !== ''), complete: !page.hasMore };
    if (!page.hasMore) return;
  }
}

/**
 * Cited domains or URLs of one project that have no type in the global catalog and
 * were not part of a batch with an uncertain outcome. Items already typed, including through another
 * project or the demo, are not listed.
 */
export async function uncachedSources(scope: Scope, target: Target, kind: SourceTypeKind, limit: number, withUncertain = false) {
  // `withUncertain` also lists the sources of an unknown-outcome batch (never resent, but still without a type): the first-cycle check counts them.
  const uncertain = withUncertain ? new Set<string>() : await uncertainSources(scope.ledger, kind);
  const items: SourceTypeItem[] = [];
  const queued = new Set<string>();
  let context: Awaited<ReturnType<typeof reportContext>> | undefined;
  for await (const { rows, context: read } of citedPages(scope, target, kind)) {
    context = read;
    const cached = await cachedSourceTypes(kind, rows.map((row) => row.key), PUBLIC_DEMO_CLASSIFIER);
    for (const row of rows) {
      const key = catalogKey(kind, row.key);
      if (cached.has(row.key) || uncertain.has(key) || queued.has(key) || items.length >= limit) continue;
      queued.add(key);
      items.push({ kind, key, domain: row.domain, title: kind === 'url' ? row.title : undefined });
    }
    if (items.length >= limit) break;
  }
  // A domain goes with the pages AI answers cited from it (evidence for a site the evaluator does not know).
  if (kind !== 'domain' || !items.length || !context || withUncertain) return items;
  return withSamples(items, await domainSamples(context, new URLSearchParams({ project: target.projectId, days: '90' })));
}

/** How many of a project's cited domains and URLs (90 days) have a type in the catalog; the preview's validation summary. */
export async function sourceCoverage(target: Target) {
  const coverage = { domain: { total: 0, typed: 0 }, url: { total: 0, typed: 0 } };
  for (const kind of ['domain', 'url'] as const)
    for await (const { rows } of citedPages(AUTO_SCOPE, target, kind)) {
      const cached = await cachedSourceTypes(kind, rows.map((row) => row.key), PUBLIC_DEMO_CLASSIFIER);
      coverage[kind].total += rows.length;
      coverage[kind].typed += rows.filter((row) => cached.has(row.key)).length;
    }
  return coverage;
}

/**
 * Fixed, requested operator action (the hosted edition's requested scopes):
 * classifies the scope's projects' cited domains and URLs that still have no type, with the approved OpenRouter evaluator. Each
 * tick sends at most REQUESTED_BATCHES_PER_TICK batches one at a time (the automatic scope SOURCE_TYPE_BATCHES_PER_TICK,
 * SOURCE_TYPE_CONCURRENCY at a time), only for uncached items, and never past the cost ceiling, so repeating the request is safe. An outcome that is uncertain after the request left is
 * recorded and never resent. The enclosing monitor lease serializes ticks.
 */
export async function applyClassification(scope: Scope, lease: string = OPERATIONS_LEASE.key) {
  const database = db();
  const found = await readOperation(scope.classificationKey);
  if (!found) return 0;
  const { operation } = found;
  if (operation.status !== 'requested' && operation.status !== 'running') return 0;
  const save = writer(scope.classificationKey, operation, found.raw);
  const fail = (error: string, progress: Operation = {}) => save({ ...progress, status: 'failed', failedAt: now(), error });
  try {
    const targets = await scope.targets();
    if (!targets) {
      await fail(scope.scopeError);
      return 0;
    }
    if (!decisionKeyConfigured()) {
      await fail('The OpenRouter server key is not configured.');
      return 0;
    }
    // A batch left in flight by a tick that died has an uncertain outcome: never resend it.
    const stale = await database
      .prepare("UPDATE brand_research_jobs SET status='unknown',error='Tick ended before the outcome was recorded.' WHERE context_key=? AND status='submitting'")
      .bind(scope.ledger)
      .run();
    if (stale.meta.changes) {
      await fail('A previous batch has an unknown outcome and was not resent.');
      return 0;
    }

    const progress = { classified: Number(operation.classified || 0), batches: Number(operation.batches || 0), unreadableProjects: 0, cappedProjects: 0 };
    const unreadable = new Set<string>();
    const perTick = scope.perProject ? SOURCE_TYPE_BATCHES_PER_TICK : REQUESTED_BATCHES_PER_TICK;
    let sent = 0;
    // Batches started (reserved or refused): counted before the reservation leaves, so the pool never starts more than perTick.
    let started = 0;
    for (const kind of ['domain', 'url'] as const) {
      for (const target of targets) {
        if (started >= perTick) break;
        // Asked after the previous batch was written, so an item typed through another project is not listed again.
        // A project whose store cannot be read is skipped and counted, never fatal to the round.
        const items = await uncachedSources(scope, target, kind, (perTick - started) * SOURCE_TYPE_BATCH_SIZE).catch(() => {
          unreadable.add(target.projectId);
          progress.unreadableProjects = unreadable.size;
          return [] as SourceTypeItem[];
        });
        const batches = [];
        for (let offset = 0; offset < items.length; offset += SOURCE_TYPE_BATCH_SIZE) batches.push(items.slice(offset, offset + SOURCE_TYPE_BATCH_SIZE));
        // How the pool ended for this project: `next` (go on with the next project) or `stop` (the tick ends here, with this
        // state saved, or nothing saved when it is null). A failure outranks the rest.
        let leave: 'next' | null = null;
        let stop: { state: Operation | null } | null = null;
        const halt = (state: Operation | null) => {
          if (!stop || state?.status === 'failed') stop = { state };
          return false;
        };
        await inPool(batches, scope.perProject ? SOURCE_TYPE_CONCURRENCY : 1, async (batch) => {
          if (stop || leave || started >= perTick) return false;
          started++;
          // The automatic scope also stops after an earlier rejection or uncertain outcome of this tick.
          if (scope.perProject && tickState.stopped) return halt(null);
          // An operator's operation stops at its authorized total; an automatic project at its budget, checked again in the INSERT.
          if (scope.perProject) {
            if ((await dollarBlock(target.projectId, SOURCE_TYPE_RESERVE_USD)) === 'project_budget') {
              // Its month is spent: the other projects go on, and this one is looked at again with the next month.
              if (!leave) progress.cappedProjects++;
              leave = 'next';
              started--;
              return false;
            }
          } else {
            const spent = await ledgerSpent(scope.ledger);
            if (spent + SOURCE_TYPE_RESERVE_USD > scope.ceilingUsd) return halt({ ...progress, status: 'capped', cappedAt: now(), spentUsd: spent, ceilingUsd: scope.ceilingUsd });
          }
          // A lease that expired may already belong to another tick: nothing is reserved or sent without it.
          if (!(await renewLease(lease, OPERATIONS_LEASE.ms))) return halt(null);
          const stamp = now();
          const budget = researchBudgetCondition(SOURCE_TYPE_RESERVE_USD, scope.perProject ? target.projectId : null, scope.perProject ? { owner: target.workspaceId, module: 'sourceTypes' } : undefined);
          const id = crypto.randomUUID();
          // Each automatic project types with its own source-type provider, as the manual classification does.
          const provider = scope.perProject ? (target.sourceProvider ?? PUBLIC_DEMO_CLASSIFIER.provider) : PUBLIC_DEMO_CLASSIFIER.provider;
          const engines = scope.perProject ? projectClassifierEngines(provider) : demoClassifierEngines();
          const inputKey = await hash(`${scope.ledger}:${id}`);
          // The automatic scope's per-project ceilings and first-cycle total are checked in the INSERT that holds the money.
          const guard = scope.perProject ? reservationGuard(target as AutomaticTarget, SOURCE_TYPE_RESERVE_USD) : null;
          // Reserve before sending, under the same global budget as every other provider spend.
          const reserved = await database
            .prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at,started_at)
            SELECT ?,?,?,?,?,?,?,?,'submitting',?,?,?,? WHERE ${budget.sql}${guard ? ` AND ${guard.sql}` : ''}`)
            .bind(
              id,
              target.workspaceId,
              target.projectId,
              inputKey,
              scope.ledger,
              inputKey,
              provider,
              engines.model,
              SOURCE_TYPE_RESERVE_USD,
              JSON.stringify(sourceTypeJobInput(kind, batch)),
              stamp,
              stamp,
              ...budget.params,
              ...(guard?.params ?? []),
            )
            .run();
          if (!reserved.meta.changes) {
            const why = guard ? await whyRefused(target as AutomaticTarget, SOURCE_TYPE_RESERVE_USD) : 'budget';
            // Turned off or archived meanwhile: this project is done for the tick.
            if (why === 'inactive' || why === 'month') {
              if (why === 'month' && !leave) progress.cappedProjects++;
              leave = 'next';
              started--;
              return false;
            }
            // The first cycle's total is spent: only a new estimate and `evaluations-enable` go on.
            if (why === 'cycle') return halt({ ...progress, status: 'failed', failedAt: now(), error: 'The first-cycle ceiling was reached; ask for a new estimate.', cycleCeiling: true });
            // A full global budget is temporary: keep the operation running for a later tick.
            return halt({ ...progress, status: 'running', note: 'Research budget is full; waiting.', updatedAt: now() });
          }
          sent++;
          try {
            const result = await requestSourceTypes(batch, engines.model, engines.fallback);
            const done = now();
            const cost = result.cost;
            await database.batch([
              database
                .prepare("UPDATE brand_research_jobs SET status=?,result_json=?,cost_usd=?,reserved_usd=?,completed_at=?,error=?,model=? WHERE id=? AND status='submitting'")
                .bind(
                  cost === null ? 'unsettled' : 'completed',
                  JSON.stringify(result.types),
                  cost ?? 0,
                  cost ?? SOURCE_TYPE_RESERVE_USD,
                  done,
                  cost === null ? 'Usage cost is unavailable; the conservative reservation is retained.' : null,
                  result.model,
                  id,
                ),
              ...result.types.map((item) => catalogWrite(database, item, { id, provider, model: result.model }, done)),
            ]);
            progress.classified += result.types.length;
            progress.batches += 1;
            return true;
          } catch (error) {
            const unknown = error instanceof SourceTypeProviderError && error.unknown;
            const cost = error instanceof SourceTypeProviderError ? error.cost || 0 : 0;
            await database
              .prepare("UPDATE brand_research_jobs SET status=?,reserved_usd=?,cost_usd=?,completed_at=?,error=? WHERE id=? AND status='submitting'")
              .bind(
                unknown ? 'unknown' : 'failed',
                unknown ? SOURCE_TYPE_RESERVE_USD : cost,
                cost,
                now(),
                error instanceof Error ? error.message.slice(0, 200) : 'Source classification failed.',
                id,
              )
              .run();
            // A key, credit or rate-limit rejection stops the whole tick, like an uncertain outcome. The rejection was certain and unbilled, so
            // the automatic scope retries it an hour later (it stopped every project's source types for days on 21/10); an uncertain outcome is not retried.
            const systemic = error instanceof SourceTypeProviderError && SYSTEMIC_PROVIDER_STATUSES.includes(error.status);
            if (scope.perProject && (unknown || systemic)) tickState.stopped = true;
            // A batch rejected for certain by this item set was not billed; the automatic scope tries its items again later (see applyAutoClassification).
            return halt({ ...progress, status: 'failed', failedAt: now(), error: unknown ? 'A batch has an unknown outcome and was not resent.' : systemic ? 'The provider refused the key or the credit; classification stopped.' : 'The provider rejected a batch.', retryable: !unknown });
          }
        });
        const ended = stop as { state: Operation | null } | null;
        if (ended) {
          // The counters as they ended (batches in flight when the pool stopped were still recorded).
          if (ended.state) await save({ ...ended.state, classified: progress.classified, batches: progress.batches });
          return sent;
        }
      }
    }
    // A tick that did not use all its batches sent everything uncached; otherwise more may remain.
    const spentUsd = await ledgerSpent(scope.ledger);
    const done = started < perTick;
    await save({
      ...progress,
      status: done ? 'applied' : 'running',
      [done ? 'appliedAt' : 'updatedAt']: now(),
      spentUsd,
      ceilingUsd: scope.ceilingUsd,
    });
    return sent;
  } catch (error) {
    // The error class names the stage that broke without exposing provider content or database details.
    await fail(`Scope validation or classification failed (${error instanceof Error ? error.name : 'unknown'}).`);
    return 0;
  }
}
/**
 * Pending work in the current data of every automatic project: sources with no type (including those of a batch whose outcome
 * is unknown) and answers with no valid sentiment (not evaluated, or evaluated with a failure that is never resent). A project
 * that cannot be read counts as pending.
 */
export async function pendingEvaluations(targets: AutomaticTarget[]) {
  let sources = 0;
  let answers = 0;
  for (const target of targets) {
    try {
      for (const kind of ['domain', 'url'] as const) sources += (await uncachedSources(AUTO_SCOPE, target, kind, 1, true)).length;
      const gaps = await answersWithoutSentiment(target.projectId, target.workspaceId, target.sentimentProvider);
      answers += gaps.missing + gaps.failed + gaps.unreadable;
    } catch {
      sources++;
    }
    if (sources || answers) break;
  }
  return sources + answers;
}

/**
 * Scheduler hook: keeps the sources of the automatic projects typed. It reopens its own finished state
 * hourly (new sources arrive all the time) and after a certain, unbilled rejection; an uncertain outcome stays failed
 * until `evaluations-enable` is run again. Sources already typed through any project or the catalog cost nothing.
 */
export const applyAutoClassification = async () => (await autoClassificationStep()) ?? 0;
/** The automatic source typing under its own lease; null while another invocation holds it. */
export function autoClassificationStep() {
  return withLease(AUTO_SOURCES_LEASE.key, AUTO_SOURCES_LEASE.ms, async () => {
    const found = await readOperation(AUTO_CLASSIFICATION_KEY);
    const state = found?.operation;
    // Stopped by the first-cycle ceiling: free again once that cycle is over (completed or its window passed).
    const released = state?.status === 'failed' && !!state.cycleCeiling && !(await firstCycle());
    const stamp = String(state?.appliedAt ?? (state?.retryable || released ? state.failedAt : '') ?? '');
    const reopen = state?.status === 'applied' || (state?.status === 'failed' && (state.retryable || released));
    const targets = await automaticTargets();
    // Read before the pass: sources published while it reads move them again, so the next step looks.
    const revisions = await storeRevisions(targets.map((target) => target.projectId));
    // A finished typing looks again as soon as new answers reach a store, otherwise hourly.
    const moved = state?.status === 'applied' && state.revisions !== revisions;
    if (!state || (reopen && (moved || Date.now() - Date.parse(stamp) >= AUTO_RECHECK_MS))) {
      if (!targets.length) return 0;
      await db()
        .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE system_state.value=?')
        .bind(AUTO_CLASSIFICATION_KEY, JSON.stringify({ ...state, status: 'requested', requestedAt: now() }), found?.raw ?? '')
        .run();
    }
    const sent = await applyClassification(AUTO_SCOPE, AUTO_SOURCES_LEASE.key);
    await db()
      .prepare("UPDATE system_state SET value=json_set(value,'$.revisions',?) WHERE key=? AND json_extract(value,'$.status')='applied'")
      .bind(revisions, AUTO_CLASSIFICATION_KEY)
      .run();
    await closeFirstCycle(pendingEvaluations);
    return sent;
  });
}
