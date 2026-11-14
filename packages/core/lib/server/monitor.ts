import { warmFirstScreens } from './first-screen-warm';
import { retentionStep } from './retention';
import { syncAiBots } from './ai-bots';
import { CLOSE_RUNNING_TURNS_SQL, ORPHAN_TURN_MS } from '@/lib/agent-spend';
import { reserveCredits, settledCredits } from '@/lib/credits';
import { nextPollTime, boundedBatch, providerWindowMs } from '@/lib/collection-policy';
import { MONITOR_LEASE, overloadBackOff, renewLease, withLease } from './leases';
import type { BrandTarget, Engine } from '@/lib/types';
import { lastCollection, nextCollection, scheduleOf, quotaWeek, scheduleWindow, slotKey } from '@/lib/scheduling';
import { ENGINES, engineUnavailable } from '@/lib/engines';
import { inPool, OUTBOUND_CONNECTIONS } from '@/lib/pool';
import { claimSql, dailyRunDefault, DUE_SQL, RECONCILE_WINDOW_MS, reservationSql, SETTLE_FAILED_SQL } from '@/lib/reservations';
import { clearBlocked, dollarBlock, recordBlocked, spendGuard, type BlockReason } from './spend-guards';
import {
  accountCapabilities,
  allowedPromptIds,
  syncAccess,
  monthlyRunLimit,
  budgetCondition,
  providerSettings,
} from './capabilities';
import {
  collectionModel,
  providerPayload,
  providerTaskPending,
  providerResultPath,
  providerResultCost,
} from '@/lib/provider-contract';
import { extractResponse, matchesBrand } from '@/lib/metrics';
import { db, now, setting, appOrigin } from './env';
import { ApiError } from './http';
import {
  provider,
  ProviderError,
  rawProviderResponse,
  type ProviderTask,
} from './dataforseo';
import { archiveRawResponse, type RawProviderResponse } from '@/lib/raw-responses';
import { PRODUCT_ENGINES, extractProducts } from '@/lib/products';
import { rawResponsesBucket } from './raw-responses';
import { ownedProject } from './workspace';
import { workspaceZone } from './project-reads';
import { flushProjectStores, registerProjectStoreStatement } from './project-store';
import { eraseDeletedProjects } from './project-erase';
import { requireMonitoringStorage } from './monitoring-storage';
import { buildTargetSnapshot } from '@/lib/target-snapshot.mjs';
import { processBrandResearchJobs } from './brand-research';
import { processSourceTypeJobs } from './source-types';
import { processBrandRoles } from './brand-role-jobs';
import { processFanoutIntents } from './fanout-intents';
import { processBrandDomains } from './brand-domain-discovery';
import { startLearning, startProjectRunners, startRunners } from './project-runners';
import { processSemanticPanels } from './semantic-panel-worker';
import { processComparisons } from './comparison-worker';
type RunRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  prompt_id: string;
  prompt_text: string;
  engine: Engine;
  targets_json: string;
  location_code: number;
  language_code: string;
  provider_task_id: string | null;
  callback_token: string;
  created_at: string;
  claimed_at: string | null;
  status: string;
  cost: number;
  poll_attempts: number;
  budget_credits: number;
};
const RUN_JOB_COLUMNS = `id,workspace_id,project_id,prompt_id,prompt_text,engine,targets_json,location_code,language_code,provider_task_id,callback_token,created_at,claimed_at,status,cost,poll_attempts,budget_credits`;
const NO_CREDENTIALS = 'Monitoring is off: this installation has no search data key; add it in Admin > Providers.';
/**
 * Why a collection reserved nothing, or null when its prompts only wait for an answer still in flight (or already ran this
 * slot). One read: the plan's run counts, the account's credits, then the dollars.
 */
async function collectionBlock(owner: string, projectId: string, month: string, limit: number, day: string, globalLimit: number, free: boolean, week: string, credits: number): Promise<BlockReason | null> {
  const database = db();
  const waiting = await database
    .prepare(`SELECT COUNT(*) n FROM prompts JOIN projects ON projects.id=prompts.project_id WHERE prompts.project_id=? AND ${DUE_SQL} AND prompts.next_run_at<=?
      AND NOT EXISTS(SELECT 1 FROM runs WHERE runs.prompt_id=prompts.id AND runs.status IN ('queued','submitting','pending'))`)
    .bind(projectId, now())
    .first<{ n: number }>();
  if (!Number(waiting?.n)) return null;
  const account = budgetCondition(owner, month, credits);
  const row = await database
    .prepare(`SELECT (SELECT COUNT(*) FROM runs WHERE workspace_id=? AND created_at>=?)+1<=? monthly,
      (SELECT COUNT(*) FROM runs WHERE created_at>=?)+1<=COALESCE((SELECT json_extract(value,'$.dailyRuns') FROM system_state WHERE key='platform_limits'),?) daily,
      (?=0 OR (SELECT COUNT(*) FROM runs WHERE workspace_id=? AND created_at>=?)<10) weekly,(${account.sql}) credits`)
    .bind(owner, month, limit, day, globalLimit, Number(free), owner, week, ...account.params)
    .first<Record<string, number>>();
  // The platform's daily runs (Admin's brake) is the platform's pause, as its dollars: nothing the customer did or can change.
  if (!row?.daily) return 'platform';
  if (!row.monthly || !row.weekly) return 'run_limit';
  if (!row.credits) return 'credits';
  return (await dollarBlock(projectId, credits * 0.0012)) ?? 'operation';
}
export async function reserveRuns(
  userId: string,
  projectId: string,
  requestKey: string,
  promptId?: string,
  dueOnly = true,
) {
  requireMonitoringStorage();
  dueOnly = true;
  if (!setting('DATAFORSEO_LOGIN') || !setting('DATAFORSEO_PASSWORD'))
    // The independent owner is the operator: tell them what to do. A Cloud customer cannot fix it.
    throw new ApiError(503, providerSettings ? NO_CREDENTIALS : 'Monitoring is temporarily unavailable.');
  const p = await ownedProject(projectId, userId),
    database = db();
  const [capabilities, zone] = await Promise.all([accountCapabilities(userId), workspaceZone(userId)]);
  const free = !!capabilities.free;
  const schedule = scheduleOf(p, free, zone);
  // The slot's local date is the key: one collection per prompt per slot, whatever day and hour the admin picked. (`slot:`, not the
  // UTC-dated `daily:` keys written before the schedule moved to the workspace's time zone, so an old key never stands for a new slot.)
  requestKey = `slot:${slotKey(now(), schedule)}`;
  const current = now();
  // Free: each project's own weekly slot (its day and hour). Read once, used before and after the reservation.
  const freeProjects = free
    ? (await database.prepare('SELECT id,collection_hour,collection_day FROM projects WHERE workspace_id=? AND archived=0').bind(userId)
      .all<{ id: string; collection_hour: number; collection_day: number }>()).results.map((row) => ({ id: row.id, schedule: scheduleOf(row, true, zone) }))
    : [];
  if (freeProjects.length) {
    // A Free prompt that became due after its project's latest weekly slot (a legacy daily schedule) moves to the next slot before
    // due prompts are selected; one due since that slot, or before it, collects now.
    await database.batch(freeProjects.map((row) => database.prepare(`UPDATE prompts SET next_run_at=? WHERE active=1 AND archived=0 AND next_run_at<=?
      AND next_run_at>? AND project_id=?`)
      .bind(nextCollection(current, row.schedule), current, lastCollection(current, row.schedule), row.id)));
  }
  const allowed = await allowedPromptIds(userId);
  const prompts = (
    await database
      .prepare(
        `SELECT * FROM prompts WHERE project_id=? AND archived=0 AND subscribed=1 AND active=1${promptId ? ' AND COALESCE(unit_id,id)=(SELECT COALESCE(unit_id,id) FROM prompts WHERE id=?)' : ''}${dueOnly ? ' AND next_run_at<=?' : ''} AND engine IN (${capabilities.engines.map(() => '?').join(',')})${allowed ? ' AND id IN (SELECT value FROM json_each(?))' : ''} ORDER BY next_run_at,id LIMIT ${RESERVE_PER_PROJECT}`,
      )
      .bind(
        projectId,
        ...(promptId ? [promptId] : []),
        ...(dueOnly ? [now()] : []),
        ...capabilities.engines,
        ...(allowed ? [JSON.stringify([...allowed])] : []),
      )
      .all<{ id: string; text: string; engine: Engine }>()
  ).results.filter(
    (prompt) =>
      capabilities.engines.includes(prompt.engine) &&
      (!allowed || allowed.has(prompt.id)) &&
      // The guard at the send (7/11/2026): an AI that cannot collect in the project's market is never sent, whatever wrote the
      // prompt (an import, an operation, a market changed outside the settings); the forms refuse it too (prompts.ts).
      !engineUnavailable(prompt.engine, Number(p.location_code)),
  );
  const stamp = now(),
    month = stamp.slice(0, 7) + '-01T00:00:00.000Z',
    limit = monthlyRunLimit();
  const next = nextCollection(stamp, schedule);
  // A project whose due prompts can never be collected now (an AI outside the plan, a prompt outside its allowance) moves
  // them to the next slot, so it stops being due on every tick and taking a turn from the projects that can collect.
  const advance = () =>
    database
      .prepare(`UPDATE prompts SET next_run_at=? WHERE project_id=? AND active=1 AND archived=0 AND next_run_at<=?${promptId ? ' AND COALESCE(unit_id,id)=(SELECT COALESCE(unit_id,id) FROM prompts WHERE id=?)' : ''}
        AND NOT EXISTS(SELECT 1 FROM runs WHERE runs.prompt_id=prompts.id AND runs.status IN ('queued','submitting','pending'))`)
      .bind(next, projectId, stamp, ...(promptId ? [promptId] : []))
      .run();
  if (!prompts.length) {
    await advance();
    throw new ApiError(400, 'Add or activate a prompt to track responses.');
  }
  const targets = JSON.stringify(
    buildTargetSnapshot({
      name: String(p.name),
      domain: String(p.domain),
      aliases_json: String(p.aliases_json || '[]'),
      additional_domains_json: String(p.additional_domains_json || '[]'),
      competitors_json: String(p.competitors_json || '[]'),
    }),
  );
  // One guarded INSERT for the whole batch (reservationSql): each prompt is checked against the plan's run counts and
  // every budget with the runs before it in the same statement. Reservations count against the monthly cap even on failure;
  // archiving a project cannot reset the quota.
  // The weekly quota counts from a fixed Monday 00:00 in the workspace's zone, never from the chosen day or hour (see quotaWeek).
  const week = quotaWeek(stamp, schedule.zone);
  const globalLimit = dailyRunDefault(setting('GLOBAL_DAILY_RUN_LIMIT')) ?? Number.MAX_SAFE_INTEGER;
  const day = stamp.slice(0, 10) + 'T00:00:00.000Z';
  const batch = prompts.map((prompt) => ({ id: crypto.randomUUID(), prompt: prompt.id, text: prompt.text, engine: prompt.engine, token: crypto.randomUUID(), credits: reserveCredits(prompt.engine, prompt.text) }));
  const account = budgetCondition(userId, month, 'j.total');
  const dollars = spendGuard(projectId, 'j.total*0.0012');
  const [inserted] = await database.batch([
    database
      .prepare(reservationSql(`${account.sql}) AND (${dollars.sql}`))
      .bind(userId, projectId, requestKey, targets, p.location_code, p.language_code, stamp, JSON.stringify(batch), stamp,
        userId, month, limit, day, globalLimit, Number(free), userId, week, ...account.params, ...dollars.params),
    // Advances once this slot holds a run: the one just reserved, or one reserved earlier in the slot (the owner moved the
    // hour within the same date), which would otherwise leave the prompt due and retried on every tick.
    database
      .prepare('UPDATE prompts SET next_run_at=? WHERE id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM runs WHERE workspace_id=? AND prompt_id=prompts.id AND request_key=?)')
      .bind(next, JSON.stringify(prompts.map((prompt) => prompt.id)), userId, requestKey),
  ]);
  if (inserted.meta.changes > 0) await clearBlocked(projectId, 'collection');
  else {
    // Nothing reserved: say why, and unless the prompts are only waiting for an answer still in flight, move them to the
    // next slot. The first prompt's reserve is what did not fit.
    const reason = await collectionBlock(userId, projectId, month, limit, day, globalLimit, free, week, batch[0].credits);
    if (reason) {
      await recordBlocked(projectId, 'collection', reason);
      // The platform's pause (its dollars or its daily runs, Admin) keeps the prompts due: they collect as soon as it lifts, the
      // same day or the next, instead of silently skipping the customer's slot (8/11/2026).
      if (reason !== 'platform') await advance();
    }
  }
  if (freeProjects.length) {
    // Existing daily schedules must stop retrying once this account has used its weekly quota.
    await database.batch(freeProjects.map((row) => database.prepare(`UPDATE prompts SET next_run_at=? WHERE active=1 AND archived=0 AND next_run_at<=?
      AND project_id=?
      AND (SELECT COUNT(*) FROM runs WHERE workspace_id=? AND created_at>=?)>=10`)
      .bind(nextCollection(stamp, row.schedule), stamp, row.id, userId, week)));
  }
  const rows = (
    await database
      .prepare(
        `SELECT ${RUN_JOB_COLUMNS} FROM runs WHERE workspace_id=? AND project_id=? AND request_key=?`,
      )
      .bind(userId, projectId, requestKey)
      .all<RunRow>()
  ).results;
  if (!rows.length)
    throw new ApiError(
      409,
      'Monitoring is waiting for pending responses or the monthly credit reset.',
    );
  return rows;
}
function runScope(userId?: string, runIds?: readonly string[]) {
  if (
    runIds !== undefined &&
    (!runIds.length ||
      new Set(runIds).size !== runIds.length ||
      runIds.some((id) => typeof id !== 'string' || !id))
  )
    throw new ApiError(
      400,
      'A monitoring run allowlist must contain unique run IDs.',
    );
  const clauses: string[] = [];
  const params: string[] = [];
  if (userId) {
    clauses.push('workspace_id=?');
    params.push(userId);
  }
  if (runIds) {
    clauses.push(`id IN (${runIds.map(() => '?').join(',')})`);
    params.push(...runIds);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

// A caller which supplies runIds is asking for a closed, paid-operation
// surface: stale recovery, validation failures, claims and submission all
// remain inside that allowlist. The normal scheduler keeps its old global
// behavior by omitting it.
export async function submitQueued(
  userId?: string,
  runIds?: readonly string[],
  // The scheduler's lease renewal, asked before each paid submission; a caller outside the scheduler passes none.
  renew?: () => Promise<boolean>,
  // A Perplexity runner (Cloud, project-runners.ts): only the queued Perplexity runs of its share, for PERPLEXITY_RUNNER_MS.
  shard?: number,
) {
  requireMonitoringStorage();
  if (shard !== undefined && !(Number.isInteger(shard) && shard >= 0 && shard < PERPLEXITY_RUNNERS)) return 0;
  const database = db();
  const scope = runScope(userId, runIds);
  const stale = new Date(Date.now() - 5 * 60000).toISOString();
  await database
    .prepare(
      `UPDATE runs SET status='unknown',error='Submission unconfirmed: the scheduler reconciles it with the provider (tasks_ready) and never sends it again.',completed_at=? WHERE status='submitting' AND claimed_at<?${scope.sql}`,
    )
    .bind(now(), stale, ...scope.params)
    .run();
  await database
    .prepare(
      `UPDATE runs SET status='failed',error='Project or prompt was archived before submission.',completed_at=?,${SETTLE_FAILED_SQL} WHERE status='queued'${scope.sql} AND (EXISTS(SELECT 1 FROM projects WHERE projects.id=runs.project_id AND (${runIds ? 'projects.archived=1' : 'projects.archived=1 OR projects.daily_enabled=0'})) OR EXISTS(SELECT 1 FROM prompts WHERE prompts.id=runs.prompt_id AND (${runIds ? 'prompts.archived=1' : 'prompts.archived=1 OR prompts.active=0 OR prompts.subscribed=0'})))`,
    )
    .bind(now(), ...scope.params)
    .run();
  // Up to MONITOR_SUBMIT_BATCH of each engine (DataForSEO takes 100 tasks per POST, 10,000 calls a minute): one POST per
  // engine as before, now full. Before, the batch was shared by every engine, so 1,000 daily runs took ten ticks.
  // A project's first day goes first (12/11/2026, the first collection as fast as possible): a new project's runs never wait
  // behind a full queue of the daily slot; the rest keep their order. One project row read by key per queued run.
  const candidates = (
    await database
      .prepare(
        `SELECT ${RUN_JOB_COLUMNS} FROM (SELECT ${RUN_JOB_COLUMNS},ROW_NUMBER() OVER (PARTITION BY engine ORDER BY ${FIRST_DAY_FIRST},created_at) n FROM runs WHERE status='queued'${scope.sql}${shard === undefined ? '' : ` AND engine='perplexity' AND unicode(substr(id,-1))%${PERPLEXITY_RUNNERS}=${shard}`}) WHERE n<=${boundedBatch(setting('MONITOR_SUBMIT_BATCH'), 40, 100)} ORDER BY created_at`,
      )
      .bind(new Date(Date.now() - 86_400_000).toISOString(), ...scope.params)
      .all<RunRow>()
  ).results;
  const permissions = new Map<string, Set<string> | null>();
  // Each account's allowed prompts, a few accounts at a time instead of one round trip after another.
  await inPool([...new Set(candidates.map((r) => r.workspace_id))], OUTBOUND_CONNECTIONS, async (owner) => {
    permissions.set(owner, await allowedPromptIds(owner));
  });
  const excluded = candidates.filter(
    (r) =>
      permissions.get(r.workspace_id) &&
      !permissions.get(r.workspace_id)!.has(r.prompt_id),
  );
  if (excluded.length)
    await database.batch(
      excluded.map((r) =>
        database
          .prepare(
            `UPDATE runs SET status='failed',error='This query is not permitted by the current account capabilities.',completed_at=?,${SETTLE_FAILED_SQL} WHERE id=? AND status='queued'`,
          )
          .bind(now(), r.id),
      ),
    );
  const refused = new Set(excluded.map((r) => r.id));
  const eligible = candidates.filter((r) => !refused.has(r.id));
  const month = `${now().slice(0, 7)}-01T00:00:00.000Z`;
  const payload = (r: RunRow) =>
    providerPayload(r, {
      model: collectionModel(r.engine, setting) ?? undefined,
      callback:
        setting('ENABLE_PROVIDER_CALLBACKS') === 'true'
          ? `${appOrigin()}/api/provider/callback?run=${r.id}&token=${r.callback_token}&id=$id`
          : undefined,
    });
  // Claims runs for sending, one guarded UPDATE per project (claimSql). Before, it was one statement per run, whose budget
  // condition took ~27 ms at production sizes in workerd: a claim of 100 held the single-threaded D1 for ~2.5 s (now ~80 ms).
  const claimRuns = async (group: RunRow[]) => {
    const claim = crypto.randomUUID();
    const projects = new Map<string, RunRow[]>();
    for (const r of group) {
      const key = `${r.workspace_id}\n${r.project_id}`;
      projects.set(key, [...(projects.get(key) ?? []), r]);
    }
    await database.batch([...projects.values()].map((runs) => {
      const account = budgetCondition(runs[0].workspace_id, month, 0);
      const dollars = spendGuard(runs[0].project_id, 0);
      return database
        .prepare(claimSql(`${account.sql}) AND (${dollars.sql}`))
        .bind(now(), claim, JSON.stringify(runs.map((r) => r.id)), ...account.params, ...dollars.params);
    }));
    return (
      await database
        .prepare(`SELECT ${RUN_JOB_COLUMNS} FROM runs WHERE status='submitting' AND error=?`)
        .bind(claim)
        .all<RunRow>()
    ).results;
  };
  let submitted = 0;
  // The queued engines: one POST each, all at once (five of the invocation's six connections), so none waits for another.
  await inPool(ENGINES.filter((engine) => engine !== 'perplexity'), OUTBOUND_CONNECTIONS, async (engine) => {
    const group = eligible.filter((r) => r.engine === engine);
    if (!group.length || (renew && !(await renew()))) return;
    const rows = await claimRuns(group);
    if (!rows.length) return;
    submitted += rows.length;
    try {
      const tasks = await provider(engine, 'task_post', rows.map(payload));
      await database.batch(
        rows.map((r, i) => {
          const t = tasks.find((t) => t.data?.tag === r.id) ?? tasks[i];
          const accepted = t?.status_code === 20100 && t.id;
          return database
            .prepare(
              // A task the provider refused settles at what it charged: nothing, usually.
              'UPDATE runs SET status=?,provider_task_id=?,cost=?,budget_credits=CASE WHEN ? THEN budget_credits ELSE CAST(?/0.0012+0.99999999 AS INTEGER) END,error=?,completed_at=?,next_poll_at=? WHERE id=? AND status=?',
            )
            .bind(
              accepted ? 'pending' : 'failed',
              accepted ? t.id : null,
              t?.cost ?? 0,
              accepted ? 1 : 0,
              t?.cost ?? 0,
              accepted
                ? null
                : `DataForSEO: ${t?.status_code ?? 'resposta ausente'} — ${t?.status_message ?? 'Tarefa não confirmada'}`,
              accepted ? null : now(),
              nextPollTime(engine, 0),
              r.id,
              'submitting',
            );
        }),
      );
    } catch (error) {
      // An uncertain POST (a 5xxxx, a lost reply) may have created tasks: unknown, never resent, its credits kept. A refused
      // one (HTTP 4xx, a request-level 4xxxx: refusedRequest) created none: failed, its credits returned.
      const ambiguous = error instanceof ProviderError ? error.ambiguous : true;
      await database.batch(
        rows.map((r) =>
          database
            .prepare(`UPDATE runs SET status=?,error=?,completed_at=?${ambiguous ? '' : `,${SETTLE_FAILED_SQL}`} WHERE id=? AND status=?`)
            .bind(ambiguous ? 'unknown' : 'failed', error instanceof Error ? error.message : 'Falha no provedor', now(), r.id, 'submitting'),
        ),
      );
    }
  });
  // Perplexity is Live only: one call per run, up to 125 s each. After the POSTs, at most OUTBOUND_CONNECTIONS in flight, each
  // claimed (and, in the scheduler, the lease renewed) right before it leaves; no new one starts after PERPLEXITY_SEND_MS (the
  // first wave always goes), and the rest wait queued for the next tick. Before: three a tick, so ~170 a day took ~5 hours.
  // Cloud: the scheduler hands them to PERPLEXITY_RUNNERS runners instead, each an invocation of its own (six lanes, up to
  // 15 minutes) that sends its share for PERPLEXITY_RUNNER_MS a step and chains while it sent: ~170 a day in minutes, not ~7 ticks.
  const perplexity = eligible.filter((r) => r.engine === 'perplexity');
  if (shard === undefined && renew && perplexity.length && (await startRunners('perplexity', PERPLEXITY_SHARDS)) !== null) return submitted;
  const deadline = Date.now() + (shard !== undefined ? PERPLEXITY_RUNNER_MS : renew ? PERPLEXITY_SEND_MS : 0);
  let taken = 0;
  await inPool(perplexity, OUTBOUND_CONNECTIONS, async (candidate) => {
    if (taken++ >= OUTBOUND_CONNECTIONS && Date.now() >= deadline) return false;
    if (renew && !(await renew())) return false;
    const [r] = await claimRuns([candidate]);
    if (!r) return;
    submitted++;
    // This endpoint accepts exactly one Live task. Durable claims prevent
    // retries after ambiguous transport failures from charging twice.
    try {
      const task = (await provider('perplexity', 'live', [payload(r)]))[0];
      if (!task || task.status_code !== 20000 || !task.result?.[0])
        throw new ProviderError(
          `DataForSEO: ${task?.status_code ?? 'resposta ausente'}`,
          task?.status_code ?? 0,
          !task,
        );
      await saveResult(r, task.result[0], task.cost, 'submitting', task);
    } catch (error) {
      const definitive = error instanceof ProviderError && !error.ambiguous;
      await database
        .prepare(
          `UPDATE runs SET status=?,error=?,completed_at=?,budget_credits=CASE WHEN ? THEN CAST(cost/0.0012+0.99999999 AS INTEGER) ELSE budget_credits END WHERE id=? AND status='submitting'`,
        )
        .bind(
          definitive ? 'failed' : 'unknown',
          error instanceof Error ? error.message : 'Falha na coleta',
          now(),
          definitive ? 1 : 0,
          r.id,
        )
        .run();
    }
  });
  return submitted;
}
async function saveResult(
  row: RunRow,
  result: Record<string, unknown>,
  cost: number,
  previous: string,
  task: ProviderTask,
  raw: RawProviderResponse | undefined = rawProviderResponse(task),
) {
  const parsed = extractResponse(result, row.engine);
  const targets = JSON.parse(row.targets_json) as BrandTarget[];
  const mentions = Object.fromEntries(
    targets.map((t) => [t.name, matchesBrand(parsed.answer, t)]),
  );
  const archive = await archiveRawResponse(
    rawResponsesBucket(),
    {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      runId: row.id,
      engine: row.engine,
      taskId: row.provider_task_id || task.id,
    },
    raw,
  );
  const completedAt = now();
  const payload = {
    id: row.id,
    owner_id: row.workspace_id, // the project store's own name for the workspace
    project_id: row.project_id,
    prompt_id: row.prompt_id,
    prompt_text: row.prompt_text,
    engine: row.engine,
    status: 'complete',
    targets_json: row.targets_json,
    answer: parsed.answer.slice(0, 180000),
    model: parsed.model,
    mentions_json: JSON.stringify(mentions),
    sources_json: JSON.stringify(parsed.sources.slice(0, 200)),
    consulted_sources_json:
      parsed.consultedSources === null
        ? null
        : JSON.stringify(parsed.consultedSources.slice(0, 500)),
    search_queries_json: JSON.stringify(parsed.searchQueries),
    response_available: Number(parsed.responseAvailable),
    cost,
    error: null,
    created_at: row.created_at,
    completed_at: completedAt,
    raw_response_status: archive.status,
    raw_response_key: archive.key,
    raw_response_sha256: archive.sha256,
    raw_response_bytes: archive.bytes,
    raw_response_stored_at: archive.stored_at,
    raw_response_error: archive.error,
    // Not a run column: the store keeps the cards in run_products (an AI without cards sends none).
    ...((PRODUCT_ENGINES as readonly string[]).includes(row.engine) ? { products_json: JSON.stringify(extractProducts(result, row.engine)) } : {}),
  };
  // Stage the full normalized payload before the terminal job update, in the
  // same D1 transaction. The metadata trigger merges into this payload and
  // advances its revision; storage ACK later deletes this temporary JSON.
  // The project's store is registered in the same transaction (a read less per answer).
  await db().batch([
    registerProjectStoreStatement(row.project_id, row.workspace_id),
    db()
      .prepare(`INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json)
      SELECT r.project_id,'runs',r.id,s.source_revision+1,'upsert',? FROM runs r JOIN project_stores s ON s.project_id=r.project_id WHERE r.id=? AND r.status=?
      ON CONFLICT(project_id,entity,entity_id) DO UPDATE SET revision=excluded.revision,operation='upsert',data_json=excluded.data_json`)
      .bind(JSON.stringify(payload), row.id, previous),
    db()
      .prepare(
        `UPDATE runs SET status='complete',cost=?,budget_credits=?,raw_response_status=?,raw_response_key=?,raw_response_sha256=?,raw_response_bytes=?,raw_response_stored_at=?,raw_response_error=?,error=NULL,completed_at=? WHERE id=? AND status=?`,
      )
      .bind(
        cost,
        settledCredits(cost, row.budget_credits),
        archive.status,
        archive.key,
        archive.sha256,
        archive.bytes,
        archive.stored_at,
        archive.error,
        completedAt,
        row.id,
        previous,
      ),
  ]);
}
const WINDOW_ERROR = 'The provider did not finish collection within its processing window.';
/**
 * A paid run the window failed may still finish: its result is read again by its task id (a free GET, never a new task) at
 * most this often while it is recent (RECONCILE_WINDOW_MS), and a finished one is saved like any other (reconcileUnknown).
 */
export const LATE_READ_EVERY_MS = 3 * 3600_000;
// The provider's processing window starts when the run was sent, not when it was queued: a run that waited in the
// queue (paid once sent) is not failed before the provider had its whole window.
const outsideWindow = (row: RunRow) =>
  Date.now() - Date.parse(row.claimed_at || row.created_at) > providerWindowMs(row.engine);
export async function collectRun(row: RunRow, notified = false) {
  requireMonitoringStorage();
  if (!row.provider_task_id) return;
  const database = db();
  const claim = await database
    .prepare(
      `UPDATE runs SET polled_at=?,next_poll_at=?,poll_attempts=poll_attempts+1 WHERE id=? AND status='pending' AND (polled_at IS NULL OR polled_at<?) AND (?=1 OR next_poll_at<=?)`,
    )
    .bind(
      now(),
      nextPollTime(row.engine, row.poll_attempts + 1),
      row.id,
      new Date(Date.now() - 30000).toISOString(),
      Number(notified),
      now(),
    )
    .run();
  if (!claim.meta.changes) return;
  if (
    outsideWindow(row)
  ) {
    await database
      .prepare(`UPDATE runs SET status='failed',error=?,completed_at=?,${SETTLE_FAILED_SQL} WHERE id=? AND status='pending'`)
      .bind(WINDOW_ERROR, now(), row.id)
      .run();
    return;
  }
  try {
    const tasks = await provider(
      row.engine,
      providerResultPath(row.engine, row.provider_task_id),
    );
    const task = tasks[0];
    if (!task || task.id !== row.provider_task_id)
      throw new Error('The provider returned a different task.');
    if (providerTaskPending(task.status_code)) return;
    if (task.status_code !== 20000) {
      // A finished task with no result (Google's "No Search Results") still had its async AI Overview fee returned.
      const cost = providerResultCost(row.engine, row.cost, task.result?.[0] ?? {});
      await database
        .prepare(
          `UPDATE runs SET status='failed',error=?,completed_at=?,cost=?,budget_credits=CAST(?/0.0012+0.99999999 AS INTEGER) WHERE id=? AND status='pending'`,
        )
        .bind(
          `DataForSEO: ${task.status_code} — ${task.status_message}`,
          now(),
          cost,
          cost,
          row.id,
        )
        .run();
      return;
    }
    const result = task.result?.[0];
    if (!result) throw new Error('Resultado vazio do provedor');
    await saveResult(
      row,
      result,
      providerResultCost(row.engine, row.cost, result),
      'pending',
      task,
    );
  } catch (error) {
    if (
      outsideWindow(row)
    )
      await database
        .prepare(`UPDATE runs SET status='failed',error=?,completed_at=?,${SETTLE_FAILED_SQL} WHERE id=? AND status='pending'`)
        .bind(WINDOW_ERROR, now(), row.id)
        .run();
    else
      await database
        .prepare("UPDATE runs SET error=? WHERE id=? AND status='pending'")
        .bind(
          error instanceof Error ? error.message : 'Falha ao obter resultado',
          row.id,
        )
        .run();
  }
}
export async function collectPending(
  userId?: string,
  runIds?: readonly string[],
) {
  const scope = runScope(userId, runIds);
  const rows = (
    await db()
      .prepare(
        `SELECT ${RUN_JOB_COLUMNS} FROM runs WHERE status='pending' AND next_poll_at<=?${scope.sql} ORDER BY next_poll_at LIMIT ${boundedBatch(setting('MONITOR_COLLECT_BATCH'), 15, 50)}`,
      )
      .bind(now(), ...scope.params)
      .all<RunRow>()
  ).results;
  // A free result GET then the R2 archive per run, one connection at a time per lane: the invocation's six stay busy,
  // instead of waves of five that each waited for their slowest.
  await inPool(rows, OUTBOUND_CONNECTIONS, (row) => collectRun(row));
  return rows.length;
}
/** How often the reconcile step asks the provider (`tasks_ready` is free, 20 calls a minute: one per AI). */
export const RECONCILE_EVERY_MS = 15 * 60_000;
const RECONCILE_KEY = 'reconcile_at';
const RECONCILE_CURSOR_KEY = 'reconcile_cursor';
/** Unknown runs one reconcile turn asks about. */
export const RECONCILE_BATCH = 200;
/**
 * A paid answer whose outcome was lost (a submission left unconfirmed, a timeout on the POST, a failed save) is `unknown`.
 * Every RECONCILE_EVERY_MS the scheduler asks DataForSEO which tasks are ready (`tasks_ready`, free) and matches them by tag
 * (the run's id): a match goes back to `pending` with its task and is read now. A Live answer (Perplexity) is replayed from its
 * raw archive (R2) when one was kept before the save failed. What stays unknown past RECONCILE_WINDOW_MS cannot be recovered:
 * health counts it (`unrecoverableRuns`). A paid run the provider's window failed is read again by its task id (LATE_READ_EVERY_MS)
 * and saved when its result came in late. Returns the runs recovered.
 */
export async function reconcileUnknown() {
  requireMonitoringStorage();
  const database = db();
  const stamp = now();
  const turn = await database
    .prepare(`INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE system_state.value<?`)
    .bind(RECONCILE_KEY, stamp, new Date(Date.parse(stamp) - RECONCILE_EVERY_MS).toISOString())
    .run();
  if (!turn.meta.changes) return 0;
  // 200 a turn, from where the last turn stopped (a cursor in system_state), back to the oldest once the end is reached: after
  // a big incident every unknown run of the window is asked about in successive turns, not only the 200 oldest.
  const cursor = await database.prepare('SELECT value FROM system_state WHERE key=?').bind(RECONCILE_CURSOR_KEY).first<{ value: string }>();
  const [afterAt, afterId] = cursor ? (JSON.parse(cursor.value) as [string, string]) : ['', ''];
  const rows = (
    await database
      .prepare(`SELECT ${RUN_JOB_COLUMNS} FROM runs WHERE status='unknown' AND COALESCE(claimed_at,created_at)>=? AND (created_at,id)>(?,?) ORDER BY created_at,id LIMIT ${RECONCILE_BATCH}`)
      .bind(new Date(Date.parse(stamp) - RECONCILE_WINDOW_MS).toISOString(), afterAt, afterId)
      .all<RunRow>()
  ).results;
  const last = rows.at(-1);
  await database
    .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .bind(RECONCILE_CURSOR_KEY, JSON.stringify(rows.length === RECONCILE_BATCH && last ? [last.created_at, last.id] : ['', '']))
    .run();
  let recovered = 0;
  const standard = [...new Set(rows.filter((row) => row.engine !== 'perplexity').map((row) => row.engine))];
  await inPool(standard, OUTBOUND_CONNECTIONS, async (engine) => {
    let ready: Map<string, string>;
    try {
      const tasks = await provider(engine, 'tasks_ready');
      ready = new Map(tasks.flatMap((task) => (task.result ?? []) as { id?: string; tag?: string }[]).filter((item) => item.tag && item.id).map((item) => [item.tag!, item.id!]));
    } catch {
      return; // the next turn asks again
    }
    for (const row of rows.filter((run) => run.engine === engine && ready.has(run.id))) {
      const taskId = ready.get(row.id)!;
      const back = await database
        .prepare(`UPDATE runs SET status='pending',provider_task_id=?,error=NULL,completed_at=NULL,next_poll_at=? WHERE id=? AND status='unknown'`)
        .bind(taskId, stamp, row.id)
        .run();
      if (!back.meta.changes) continue;
      recovered++;
      // Read now: the provider's window counts from this recovery, not from the lost submission.
      await collectRun({ ...row, status: 'pending', provider_task_id: taskId, claimed_at: stamp }, true).catch(() => undefined);
    }
  });
  const bucket = rawResponsesBucket();
  for (const row of rows.filter((run) => run.engine === 'perplexity')) {
    if (!bucket) break;
    try {
      const listed = await bucket.list({ prefix: `raw/v1/${encodeURIComponent(row.workspace_id)}/${encodeURIComponent(row.project_id)}/${encodeURIComponent(row.id)}/`, limit: 1 });
      const object = listed.objects[0] && (await bucket.get(listed.objects[0].key));
      if (!object) continue;
      const body = await object.text();
      const meta = object.customMetadata ?? {};
      const task = (JSON.parse(body) as { tasks?: ProviderTask[] }).tasks?.[0];
      if (!task || task.status_code !== 20000 || !task.result?.[0]) continue;
      await saveResult(row, task.result[0], task.cost, 'unknown', task, { body, endpoint: meta.endpoint ?? '', receivedAt: meta.received_at ?? stamp, taskId: task.id });
      recovered++;
    } catch {
      // Left unknown; the next turn tries again until the window ends.
    }
  }
  const cutoff = new Date(Date.parse(stamp) - LATE_READ_EVERY_MS).toISOString();
  const late = (
    await database
      .prepare(`SELECT ${RUN_JOB_COLUMNS} FROM runs WHERE status='failed' AND error=? AND provider_task_id IS NOT NULL AND COALESCE(claimed_at,created_at)>=?
        AND COALESCE(polled_at,'')<? ORDER BY polled_at LIMIT ${RECONCILE_BATCH}`)
      .bind(WINDOW_ERROR, new Date(Date.parse(stamp) - RECONCILE_WINDOW_MS).toISOString(), cutoff)
      .all<RunRow>()
  ).results;
  await inPool(late, OUTBOUND_CONNECTIONS, async (row) => {
    const claimed = await database.prepare(`UPDATE runs SET polled_at=? WHERE id=? AND status='failed' AND COALESCE(polled_at,'')<?`).bind(stamp, row.id, cutoff).run();
    if (!claimed.meta.changes) return;
    try {
      const [task] = await provider(row.engine, providerResultPath(row.engine, row.provider_task_id!));
      const result = task?.id === row.provider_task_id && task.status_code === 20000 ? task.result?.[0] : undefined;
      if (!result) return;
      await saveResult(row, result, providerResultCost(row.engine, row.cost, result), 'failed', task);
      recovered++;
    } catch {
      // Still failed; the next read tries again while the run is recent.
    }
  });
  return recovered;
}
/**
 * Prompts one reservation takes per project (one D1 batch, each run under the same guarded INSERT): raised from 20,
 * so a project of 600 prompts is reserved in six ticks instead of thirty. Spend is unchanged; only the pace.
 */
export const RESERVE_PER_PROJECT = 100;
/** Due projects one reservation query takes; the tick takes batch after batch for up to RESERVE_TICK_MS. */
export const RESERVE_BATCH = 5;
/** How long one tick keeps reserving (D1 writes, no provider call): well inside the lease (270 s) and the Worker's limits. */
export const RESERVE_TICK_MS = 60_000;
/** How long one scheduler tick keeps starting Perplexity Live calls (each can take up to 125 s, so the step ends by ~170 s). */
export const PERPLEXITY_SEND_MS = 45_000;
/**
 * Cloud's Perplexity runners: DataForSEO takes up to 30 Live tasks at once per account and platform, and each runner keeps six in
 * flight, so four leave room under it. A run belongs to the runner of the last character of its id (a UUID: about even shares).
 */
/** Sorts the runs of a project created since the bound time (its first day) before the others. */
const FIRST_DAY_FIRST = `COALESCE((SELECT projects.created_at FROM projects WHERE projects.id=runs.project_id),'')<?`;
export const PERPLEXITY_RUNNERS = 4;
const PERPLEXITY_SHARDS = Array.from({ length: PERPLEXITY_RUNNERS }, (_, shard) => String(shard));
/** How long one runner step keeps starting Live calls (it ends by ~6 minutes, inside an alarm's 15). */
export const PERPLEXITY_RUNNER_MS = 4 * 60_000;
// Prompts become due at their project's slot (lib/scheduling.ts). The scheduler reserves a single
// run per prompt and slot, and drains the durable batch independently of browser sessions.
export async function startMonitoring(userId: string, projectId: string) {
  try {
    await reserveRuns(
      userId,
      projectId,
      `daily:${scheduleWindow(now()).slice(0, 10)}`,
      undefined,
      true,
    );
    return { queued: true };
  } catch (e) {
    if (e instanceof ApiError) return { queued: false, reason: e.message };
    throw e;
  }
}
export async function tick() {
  requireMonitoringStorage();
  const result = await withLease(MONITOR_LEASE.key, MONITOR_LEASE.ms, runTick);
  return (
    result ?? {
      ok: true,
      submitted: 0,
      collected: 0,
      skipped: 'already_running',
      heartbeat: now(),
    }
  );
}
async function runTick() {
  const database = db();
  // Each step fails on its own: a database error in the reservation or the collection no longer skips publication or the
  // heartbeat, and the next tick retries it. Before each step the lease is renewed; once it is lost (a tick that outran 270 s),
  // the rest is left to the tick that now holds it, so two never submit the same work. A step that meets an overloaded D1 waits
  // and goes again (overloadBackOff, twice): each step is safe to run again, as the next tick would.
  const failed: string[] = [];
  let lost = false;
  async function step<T>(name: string, work: () => Promise<T>, fallback: T) {
    if (lost) return fallback;
    try {
      return await overloadBackOff(async () => {
        if (!(await renewLease(MONITOR_LEASE.key, MONITOR_LEASE.ms))) {
          lost = true;
          return fallback;
        }
        return work();
      });
    } catch (error) {
      failed.push(name);
      console.error(`Scheduler step ${name} failed; it retries on the next tick.`, error instanceof Error ? error.message : String(error));
      return fallback;
    }
  }
  await step('access', syncAccess, undefined);
  // An agent turn a deploy or eviction cut and no later turn of its conversation closed (agent.ts openTurn) stops holding the budgets.
  const orphanTurns = await step('agent-orphans', async () => {
    const at = now();
    return (await database.prepare(`${CLOSE_RUNNING_TURNS_SQL} started_at<?`).bind(at, new Date(Date.parse(at) - ORPHAN_TURN_MS).toISOString()).run()).meta.changes;
  }, 0);
  // Deleted projects: what they held is erased a bounded page at a time (project-erase.ts), with or without a provider.
  const erasedProjects = await step('erase', () => eraseDeletedProjects(), 0);
  const monitoringConfigured = !!setting('DATAFORSEO_LOGIN') && !!setting('DATAFORSEO_PASSWORD');
  if (!monitoringConfigured && setting('BRAND_RESEARCH_ENABLED') !== 'true')
    throw new ApiError(503, 'Monitoring provider is unavailable.');
  const retry = { retry: true } as const;
  if (monitoringConfigured)
    await step('reserve', async () => {
      // Batches of RESERVE_BATCH due projects, until none is left or RESERVE_TICK_MS passed: a few hundred projects due at the
      // same hour are reserved in a tick or two, not five per tick. A project tried in this tick waits for the next one.
      const started = now(), deadline = Date.now() + RESERVE_TICK_MS;
      let error: unknown = null;
      for (;;) {
        const projects = (
          await database
            .prepare(
              // Due by the reservation's own predicate (DUE_SQL); a project that reserves nothing moves its prompts on.
              `SELECT projects.id,projects.workspace_id FROM
     (SELECT DISTINCT prompts.project_id FROM prompts JOIN projects ON projects.id=prompts.project_id WHERE ${DUE_SQL} AND prompts.next_run_at<=?) due
     JOIN projects ON projects.id=due.project_id
     LEFT JOIN system_state ON system_state.key='schedule_attempt:' || projects.id
     WHERE COALESCE(system_state.value,'')<? ORDER BY COALESCE(system_state.value,'') LIMIT ${RESERVE_BATCH}`,
            )
            .bind(now(), started)
            .all<{ id: string; workspace_id: string }>()
        ).results;
        // One project's failure does not hold back the other reservations.
        for (const p of projects)
          try {
            await database
              .prepare(
                'INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
              )
              .bind(`schedule_attempt:${p.id}`, now())
              .run();
            await startMonitoring(p.workspace_id, p.id);
          } catch (e) {
            error = e;
          }
        if (projects.length < RESERVE_BATCH || Date.now() >= deadline || !(await renewLease(MONITOR_LEASE.key, MONITOR_LEASE.ms))) break;
      }
      if (error) throw error;
    }, undefined);
  const submitted = monitoringConfigured
    ? await step('submit', () => submitQueued(undefined, undefined, () => renewLease(MONITOR_LEASE.key, MONITOR_LEASE.ms)), 0)
    : 0;
  const collected = monitoringConfigured ? await step('collect', () => collectPending(), 0) : 0;
  const reconciled = monitoringConfigured ? await step('reconcile', reconcileUnknown, 0) : 0;
  // With the project runners (Cloud), each project's queries are sent in an invocation of its own; this step opens the rounds.
  const semanticPanels = await step<number | typeof retry>('semantic-panel', async () => (monitoringConfigured ? processSemanticPanels((projects) => startRunners('panel', projects)) : 0), retry);
  // Comparison (lib/server/comparison-worker.ts): opens each project's due period and, with the runners (Cloud), hands its runs over.
  const comparisons = await step<number | typeof retry>('comparison', async () => (monitoringConfigured ? processComparisons((projects) => startRunners('comparison', projects)) : 0), retry);
  const brandResearchJobs = await step<number | typeof retry>('brand-research', processBrandResearchJobs, retry);
  const sourceTypeJobs = await step<number | typeof retry>('source-types', processSourceTypeJobs, retry);
  // What each name found by a finished analysis is to the project: asked here, never while a page loads. With the project
  // runners (Cloud), each project's roles and domains go on in invocations of their own and this step only starts them.
  const brandRoleJobs = await step<number | typeof retry>('brand-roles', async () => (await startProjectRunners('roles')) ?? processBrandRoles(), retry);
  // The authorized brand backfill also finds the discovered brands' domains (their favicons) without Brands open.
  const brandDomains = await step<number | typeof retry>('brand-domains', async () => (await startProjectRunners('domains')) ?? processBrandDomains(), retry);
  // Analytics publication is retryable and cannot undo a collected provider
  // response or cause another paid submission when a project store is down.
  // With the project runners (Cloud) each store behind is published in invocations of its own, until it is caught up.
  const projectStorage = await step<unknown>('publication', async () => (await startProjectRunners('publish')) ?? flushProjectStores({ projects: 2, rows: 50 }), retry);
  // The heartbeat is written on every tick, next to the names of the steps that failed (no data), which /api/health reports.
  const stamp = now();
  const upsert = 'INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value';
  await overloadBackOff(() =>
    database.batch([
      database.prepare(upsert).bind('scheduler_heartbeat', stamp),
      database.prepare(upsert).bind('scheduler_failed_steps', JSON.stringify(failed)),
    ]),
  );
  // After the heartbeat (a warm-up that runs out of time never hides the tick): the first screens of projects whose data,
  // analysis or settings changed are computed before anyone opens them (first-screen-warm.ts). Bounded; what is left waits.
  // The search intents of each project's query fan-out (Opportunities): with the project runners (Cloud) only started here;
  // inline (the independent edition) a bounded step after the heartbeat, so a slow model never hides the tick.
  const fanoutIntents = await step<number | typeof retry>('fanout-intents', async () => (await startProjectRunners('intents')) ?? processFanoutIntents(), retry);
  const firstScreens = await step<unknown>('first-screens', () => warmFirstScreens(), retry);
  // Data retention (retention.ts): at most hourly, one bounded batch of each project with a retention; NULL keeps everything.
  const retention = await step<unknown>('retention', () => retentionStep(), retry);
  // AI bots: each connected project's days from its own Cloudflare analytics (free, bounded per tick; lib/server/ai-bots.ts).
  const aiBots = await step<number | typeof retry>('ai-bots', syncAiBots, retry);
  // Last: the agent's curator (agent-curator.ts) for the projects with a conversation to read, each to its runner (Cloud);
  // inline (the independent edition) three projects a tick, so its model calls never hold the steps above.
  const agentCuration = await step<number | typeof retry>('agent-curation', startLearning, retry);
  return {
    ok: true, submitted, collected, reconciled, orphanTurns, erasedProjects, semanticPanels, comparisons, brandResearchJobs, sourceTypeJobs, brandRoleJobs, brandDomains, fanoutIntents, projectStorage,
    firstScreens, retention, aiBots, agentCuration, failed, ...(lost ? { leaseLost: true } : {}), heartbeat: stamp,
  };
}
