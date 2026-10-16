import { reserveCredits, settledCredits } from '@/lib/credits';
import { nextPollTime, boundedBatch } from '@/lib/collection-policy';
import { withLease } from './leases';
import type { BrandTarget, Engine } from '@/lib/types';
import { nextRunTime, nextWeeklyRunTime, weeklyWindow, positiveLimit, scheduleWindow } from '@/lib/scheduling';
import { ENGINES } from '@/lib/engines';
import { reservationSql } from '@/lib/reservations';
import {
  accountCapabilities,
  allowedPromptIds,
  syncAccess,
  monthlyRunLimit,
  budgetCondition,
} from './capabilities';
import {
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
import { archiveRawResponse } from '@/lib/raw-responses';
import { rawResponsesBucket } from './raw-responses';
import { ownedProject } from './workspace';
import { flushProjectStores, registerProjectStore } from './project-store';
import { requireMonitoringStorage } from './monitoring-storage';
import { buildTargetSnapshot } from '@/lib/target-snapshot.mjs';
import { processBrandResearchJobs } from './brand-research';
import { processSourceTypeJobs } from './source-types';
import { processSemanticJobs, processProjectOperations } from './capabilities';
type RunRow = {
  id: string;
  owner_id: string;
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
  status: string;
  cost: number;
  poll_attempts: number;
  budget_credits: number;
};
const RUN_JOB_COLUMNS = `id,owner_id,project_id,prompt_id,prompt_text,engine,targets_json,location_code,language_code,provider_task_id,callback_token,created_at,status,cost,poll_attempts,budget_credits`;
export async function reserveRuns(
  userId: string,
  projectId: string,
  requestKey: string,
  promptId?: string,
  dueOnly = true,
) {
  requireMonitoringStorage();
  dueOnly = true;
  requestKey = `daily:${scheduleWindow(now()).slice(0, 10)}`;
  if (!setting('DATAFORSEO_LOGIN') || !setting('DATAFORSEO_PASSWORD'))
    throw new ApiError(503, 'Monitoring is temporarily unavailable.');
  const p = await ownedProject(projectId, userId),
    database = db();
  const capabilities = await accountCapabilities(userId);
  const free = capabilities.promptLimit === 10;
  const current = now();
  if (free) {
    // Move legacy daily Free schedules to Monday before selecting due prompts.
    await database.prepare(`UPDATE prompts SET next_run_at=? WHERE active=1 AND archived=0 AND next_run_at<=?
      AND (strftime('%w',next_run_at)<>'1' OR strftime('%H:%M',next_run_at)<>'07:00')
      AND project_id IN (SELECT id FROM projects WHERE owner_id=? AND archived=0)`)
      .bind(nextWeeklyRunTime(current), current, userId).run();
  }
  const allowed = await allowedPromptIds(userId);
  const prompts = (
    await database
      .prepare(
        `SELECT * FROM prompts WHERE project_id=? AND archived=0 AND subscribed=1 AND active=1${promptId ? ' AND COALESCE(unit_id,id)=(SELECT COALESCE(unit_id,id) FROM prompts WHERE id=?)' : ''}${dueOnly ? ' AND next_run_at<=?' : ''} AND engine IN (${capabilities.engines.map(() => '?').join(',')})${allowed ? ' AND id IN (SELECT value FROM json_each(?))' : ''} ORDER BY next_run_at,id LIMIT 20`,
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
      (!allowed || allowed.has(prompt.id)),
  );
  if (!prompts.length)
    throw new ApiError(400, 'Add or activate a prompt to track responses.');
  const stamp = now(),
    month = stamp.slice(0, 7) + '-01T00:00:00.000Z',
    limit = monthlyRunLimit();
  const targets = JSON.stringify(
    buildTargetSnapshot({
      name: String(p.name),
      domain: String(p.domain),
      aliases_json: String(p.aliases_json || '[]'),
      additional_domains_json: String(p.additional_domains_json || '[]'),
      competitors_json: String(p.competitors_json || '[]'),
    }),
  );
  // Conditional inserts execute inside one D1 transaction. Reservations count against
  // the monthly cap even on failure; archiving a project cannot reset the quota.
  const next = free ? nextWeeklyRunTime(stamp) : nextRunTime(stamp, Number(p.interval_hours));
  const week = weeklyWindow(stamp);
  const globalLimit = positiveLimit(setting('GLOBAL_DAILY_RUN_LIMIT'), 1000);
  const day = stamp.slice(0, 10) + 'T00:00:00.000Z';
  await database.batch(
    prompts.flatMap((prompt) => {
      const id = crypto.randomUUID();
      const budget = budgetCondition(
        userId,
        month,
        reserveCredits(prompt.engine, prompt.text),
      );
      return [
        database
          .prepare(reservationSql(budget.sql))
          .bind(
            id,
            userId,
            projectId,
            prompt.id,
            requestKey,
            prompt.text,
            prompt.engine,
            targets,
            p.location_code,
            p.language_code,
            crypto.randomUUID(),
            stamp,
            reserveCredits(prompt.engine, prompt.text),
            userId,
            month,
            limit,
            day,
            globalLimit,
            Number(free),
            userId,
            week,
            ...budget.params,
            prompt.id,
            prompt.id,
            ...(dueOnly ? [stamp] : []),
          ),
        database
          .prepare(
            'UPDATE prompts SET next_run_at=? WHERE id=? AND EXISTS(SELECT 1 FROM runs WHERE id=?)',
          )
          .bind(next, prompt.id, id),
      ];
    }),
  );
  if (free) {
    // Existing daily schedules must stop retrying once this account has used its weekly quota.
    await database.prepare(`UPDATE prompts SET next_run_at=? WHERE active=1 AND archived=0 AND next_run_at<=?
      AND project_id IN (SELECT id FROM projects WHERE owner_id=? AND archived=0)
      AND (SELECT COUNT(*) FROM runs WHERE owner_id=? AND created_at>=?)>=10`)
      .bind(next, stamp, userId, userId, week).run();
  }
  const rows = (
    await database
      .prepare(
        `SELECT ${RUN_JOB_COLUMNS} FROM runs WHERE owner_id=? AND project_id=? AND request_key=?`,
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
    clauses.push('owner_id=?');
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
) {
  requireMonitoringStorage();
  const database = db();
  const scope = runScope(userId, runIds);
  const stale = new Date(Date.now() - 5 * 60000).toISOString();
  await database
    .prepare(
      `UPDATE runs SET status='unknown',error='Submission unconfirmed. The operator must reconcile the provider task before retrying.',completed_at=? WHERE status='submitting' AND claimed_at<?${scope.sql}`,
    )
    .bind(now(), stale, ...scope.params)
    .run();
  await database
    .prepare(
      `UPDATE runs SET status='failed',error='Project or prompt was archived before submission.',completed_at=? WHERE status='queued'${scope.sql} AND (EXISTS(SELECT 1 FROM projects WHERE projects.id=runs.project_id AND (${runIds ? 'projects.archived=1' : 'projects.archived=1 OR projects.daily_enabled=0'})) OR EXISTS(SELECT 1 FROM prompts WHERE prompts.id=runs.prompt_id AND (${runIds ? 'prompts.archived=1' : 'prompts.archived=1 OR prompts.active=0 OR prompts.subscribed=0'})))`,
    )
    .bind(now(), ...scope.params)
    .run();
  const candidates = (
    await database
      .prepare(
        `SELECT ${RUN_JOB_COLUMNS} FROM runs WHERE status='queued'${scope.sql} AND (engine<>'perplexity' OR id IN (SELECT id FROM runs WHERE status='queued' AND engine='perplexity'${scope.sql} ORDER BY created_at LIMIT 3)) ORDER BY created_at LIMIT ${boundedBatch(setting('MONITOR_SUBMIT_BATCH'), 40, 100)}`,
      )
      .bind(...scope.params, ...scope.params)
      .all<RunRow>()
  ).results;
  const permissions = new Map<string, Set<string> | null>();
  for (const owner of new Set(candidates.map((r) => r.owner_id)))
    permissions.set(owner, await allowedPromptIds(owner));
  const excluded = candidates.filter(
    (r) =>
      permissions.get(r.owner_id) &&
      !permissions.get(r.owner_id)!.has(r.prompt_id),
  );
  if (excluded.length)
    await database.batch(
      excluded.map((r) =>
        database
          .prepare(
            "UPDATE runs SET status='failed',error='This query is not permitted by the current account capabilities.',completed_at=? WHERE id=? AND status='queued'",
          )
          .bind(now(), r.id),
      ),
    );
  const eligible = candidates.filter(
    (r) => !excluded.some((x) => x.id === r.id),
  );
  for (const engine of ENGINES) {
    const group = eligible
      .filter((r) => r.engine === engine)
      .slice(0, engine === 'perplexity' ? 3 : 100);
    if (!group.length) continue;
    const claim = crypto.randomUUID();
    await database.batch(group.map((r) => {
      const budget = budgetCondition(r.owner_id, `${now().slice(0, 7)}-01T00:00:00.000Z`, 0);
      return database.prepare(`UPDATE runs SET status='submitting',claimed_at=?,error=? WHERE id=? AND status='queued' AND (${budget.sql})`).bind(now(), claim, r.id, ...budget.params);
    }));
    const rows = (
      await database
        .prepare(
          `SELECT ${RUN_JOB_COLUMNS} FROM runs WHERE status='submitting' AND error=?`,
        )
        .bind(claim)
        .all<RunRow>()
    ).results;
    if (!rows.length) continue;
    try {
      const payloads = rows.map((r) =>
        providerPayload(r, {
          model: setting(
            engine === 'claude'
              ? 'DATAFORSEO_CLAUDE_MODEL'
              : 'DATAFORSEO_PERPLEXITY_MODEL',
          ),
          callback:
            setting('ENABLE_PROVIDER_CALLBACKS') === 'true'
              ? `${appOrigin()}/api/provider/callback?run=${r.id}&token=${r.callback_token}&id=$id`
              : undefined,
        }),
      );
      if (engine === 'perplexity') {
        // This endpoint accepts exactly one Live task. Durable claims prevent
        // retries after ambiguous transport failures from charging twice.
        await Promise.all(
          rows.map(async (r, i) => {
            try {
              const task = (await provider(engine, 'live', [payloads[i]]))[0];
              if (!task || task.status_code !== 20000 || !task.result?.[0])
                throw new ProviderError(
                  `DataForSEO: ${task?.status_code ?? 'resposta ausente'}`,
                  task?.status_code ?? 0,
                  !task,
                );
              await saveResult(
                r,
                task.result[0],
                task.cost,
                'submitting',
                task,
              );
            } catch (error) {
              await database
                .prepare(
                  "UPDATE runs SET status=?,error=?,completed_at=? WHERE id=? AND status='submitting'",
                )
                .bind(
                  error instanceof ProviderError && !error.ambiguous
                    ? 'failed'
                    : 'unknown',
                  error instanceof Error ? error.message : 'Falha na coleta',
                  now(),
                  r.id,
                )
                .run();
            }
          }),
        );
        continue;
      }
      const tasks = await provider(engine, 'task_post', payloads);
      await database.batch(
        rows.map((r, i) => {
          const t = tasks.find((t) => t.data?.tag === r.id) ?? tasks[i];
          const accepted = t?.status_code === 20100 && t.id;
          return database
            .prepare(
              'UPDATE runs SET status=?,provider_task_id=?,cost=?,error=?,completed_at=?,next_poll_at=? WHERE id=? AND status=?',
            )
            .bind(
              accepted ? 'pending' : 'failed',
              accepted ? t.id : null,
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
      const ambiguous = error instanceof ProviderError ? error.ambiguous : true;
      await database.batch(
        rows.map((r) =>
          database
            .prepare(
              'UPDATE runs SET status=?,error=?,completed_at=? WHERE id=? AND status=?',
            )
            .bind(
              ambiguous ? 'unknown' : 'failed',
              error instanceof Error ? error.message : 'Falha no provedor',
              now(),
              r.id,
              'submitting',
            ),
        ),
      );
    }
  }
  return (
    eligible.filter((r) => r.engine !== 'perplexity').length +
    Math.min(3, eligible.filter((r) => r.engine === 'perplexity').length)
  );
}
async function saveResult(
  row: RunRow,
  result: Record<string, unknown>,
  cost: number,
  previous: string,
  task: ProviderTask,
) {
  const parsed = extractResponse(result, row.engine);
  const targets = JSON.parse(row.targets_json) as BrandTarget[];
  const mentions = Object.fromEntries(
    targets.map((t) => [t.name, matchesBrand(parsed.answer, t)]),
  );
  const archive = await archiveRawResponse(
    rawResponsesBucket(),
    {
      ownerId: row.owner_id,
      projectId: row.project_id,
      runId: row.id,
      engine: row.engine,
      taskId: row.provider_task_id || task.id,
    },
    rawProviderResponse(task),
  );
  await registerProjectStore(row.project_id, row.owner_id);
  const completedAt = now();
  const payload = {
    id: row.id,
    owner_id: row.owner_id,
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
  };
  // Stage the full normalized payload before the terminal job update, in the
  // same D1 transaction. The metadata trigger merges into this payload and
  // advances its revision; storage ACK later deletes this temporary JSON.
  await db().batch([
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
    Date.now() - Date.parse(row.created_at) >
    (row.engine === 'claude' ? 74 : 24) * 3600000
  ) {
    await database
      .prepare(
        "UPDATE runs SET status='failed',error='The provider did not finish collection within its processing window.',completed_at=? WHERE id=? AND status='pending'",
      )
      .bind(now(), row.id)
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
      await database
        .prepare(
          "UPDATE runs SET status='failed',error=?,completed_at=? WHERE id=? AND status='pending'",
        )
        .bind(
          `DataForSEO: ${task.status_code} — ${task.status_message}`,
          now(),
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
      Date.now() - Date.parse(row.created_at) >
      (row.engine === 'claude' ? 74 : 24) * 3600000
    )
      await database
        .prepare(
          "UPDATE runs SET status='failed',error='The provider did not finish collection within its processing window.',completed_at=? WHERE id=? AND status='pending'",
        )
        .bind(now(), row.id)
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
  for (let i = 0; i < rows.length; i += 5)
    await Promise.all(rows.slice(i, i + 5).map((row) => collectRun(row)));
  return rows.length;
}
// Prompts become due at 04:00 Brasília. The scheduler reserves a single daily
// run per prompt, and drains the durable batch independently of browser sessions.
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
  const result = await withLease('monitor', 270000, runTick);
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
  await syncAccess();
  const database = db();
  try {
    await processProjectOperations();
  } catch {
    console.error('Project operation could not be processed.');
  }
  const monitoringConfigured = !!setting('DATAFORSEO_LOGIN') && !!setting('DATAFORSEO_PASSWORD');
  if (!monitoringConfigured && setting('BRAND_RESEARCH_ENABLED') !== 'true')
    throw new ApiError(503, 'Monitoring provider is unavailable.');
  const projects = monitoringConfigured ? (
    await database
      .prepare(
        `SELECT projects.id,projects.owner_id FROM
     (SELECT DISTINCT project_id FROM prompts WHERE active=1 AND archived=0 AND next_run_at<=?) due
     JOIN projects ON projects.id=due.project_id
     LEFT JOIN system_state ON system_state.key='schedule_attempt:' || projects.id
     WHERE projects.archived=0 AND daily_enabled=1
     ORDER BY COALESCE(system_state.value,'') LIMIT 5`,
      )
      .bind(now())
      .all<{ id: string; owner_id: string }>()
  ).results : [];
  for (const p of projects) {
    await database
      .prepare(
        'INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .bind(`schedule_attempt:${p.id}`, now())
      .run();
    await startMonitoring(p.owner_id, p.id);
  }
  const submitted = monitoringConfigured ? await submitQueued() : 0,
    collected = monitoringConfigured ? await collectPending() : 0;
  let semanticJobs: number | { retry: true };
  try {
    semanticJobs = monitoringConfigured ? await processSemanticJobs() : 0;
  } catch {
    semanticJobs = { retry: true };
    console.error('Semantic evaluation will retry on the next tick.');
  }
  let brandResearchJobs: number | { retry: true };
  try { brandResearchJobs = await processBrandResearchJobs(); }
  catch { brandResearchJobs = { retry: true }; console.error('Brand evaluation will retry on the next tick.'); }
  let sourceTypeJobs: number | { retry: true };
  try { sourceTypeJobs = await processSourceTypeJobs(); }
  catch { sourceTypeJobs = { retry: true }; console.error('Source classification will retry on the next tick.'); }
  // Analytics publication is retryable and cannot undo a collected provider
  // response or cause another paid submission when a project store is down.
  let projectStorage: unknown;
  try {
    projectStorage = await flushProjectStores({ projects: 2, rows: 50 });
  } catch {
    projectStorage = { retry: true };
    console.error('Project storage publication will retry on the next tick.');
  }
  const stamp = now();
  await database
    .prepare(
      "INSERT INTO system_state(key,value) VALUES('scheduler_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .bind(stamp)
    .run();
  return { ok: true, submitted, collected, semanticJobs, brandResearchJobs, sourceTypeJobs, projectStorage, heartbeat: stamp };
}
