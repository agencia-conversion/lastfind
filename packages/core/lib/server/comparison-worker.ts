// Comparison collects on its own (lib/comparison.ts), on the scheduler's tick and the project's budget, like Semantic Branding. Once per
// period of the project's collection cadence (daily, or weekly on a weekly plan such as Free) each product and persona of the project's
// configuration is asked of each AI that takes instructions (COMPARISON_ENGINES, within the plan and the project's AIs), the way its daily
// collection asks it (the provider's queue). A run moves pending -> submitting -> submitted -> completed (answered) / absent / failed /
// unknown; a completed run is then read by the decision model (reading_json), a paid call of its own inside the run's reserve.
//   - One run per project, period, product, persona and AI (unique): a retried or concurrent tick never asks twice. A product or persona
//     added mid-period is asked in the same period (the configuration's revision makes the project due again).
//   - Spend: each run reserves its worst case (the scraper's fee and one reading) when the period opens, within the project's budget and
//     the platform's brake (spendGuard, the same ledgers as every module: platform-spend.ts). A reply that is lost stays `unknown` at its
//     reserve and is never sent again; a reading whose reply is lost is never read again.
//   - Absence is never a loss: an AI with no answer, an answer that cannot be read and a run not read yet carry no reading.
import { engineUnavailable, type Engine } from '@/lib/engines';
import { COMPARISON_ENGINES, COMPARISON_METHOD, anchorReading, COMPARISON_READ_RESERVE_USD, QUESTION_LIMIT, comparisonQuestion, comparisonReading, comparisonReady, comparisonRosters, readComparison, readComparisonConfig, type ComparisonConfig, type ComparisonLeftReason, type ComparisonReading, type ComparisonRoster } from '@/lib/comparison';
import { dataForSeo, firstResult, taskCost, NO_SEARCH_RESULTS, SendError, type Send } from '@/lib/semantic-panel-provider';
import { extractResponse } from '@/lib/metrics';
import { providerBase, providerPayload, providerResultCost, providerResultPath, providerTaskPending } from '@/lib/provider-contract';
import { periodStart } from '@/lib/semantic-panel';
import { scheduleWindow } from '@/lib/scheduling';
import { inPool, OUTBOUND_CONNECTIONS } from '@/lib/pool';
import { postChat } from './decisions-api';
import { decisionKeyConfigured } from './model-routes';
import { comparisonReaderModel } from './classifier-models';
import { accountCapabilities } from './capabilities';
import { clearBlocked, recordRefusal, spendGuard } from './spend-guards';
import { panelCredentials, panelReachable, projectEngines } from './semantic-panel-worker';
import { withLease } from './leases';
import { db, now, setting } from './env';

/** The scraper's fee is US$ 0.0012 to 0.004 a task; the reserve holds the worst case (the same as Semantic Branding's queue reserve). */
const QUEUE_RESERVE_USD = 0.02;
export const RUN_RESERVE_USD = QUEUE_RESERVE_USD + COMPARISON_READ_RESERVE_USD;
/** The scheduler's tick has other work: no new send starts after this; a runner's step (Cloud) sends longer. */
const SEND_BUDGET_MS = 60_000;
export const COMPARISON_RUNNER_MS = 4 * 60_000;
export const SEND_TIMEOUT_MS = 40_000;
const PENDING_READ = OUTBOUND_CONNECTIONS * 10;
const POLLS_PER_STEP = 12;
const READS_PER_STEP = 12;
const PROJECTS_PER_TICK = 10;
const POLL_MS = 60_000;
const EXPIRES_MS = 3 * 60 * 60_000;
/** A run claimed and never settled (the Worker stopped, the reply was lost): its outcome is unknown. */
const STALE_MS = 10 * 60_000;
/** Readings of one answer: a failed one (an error answer, never billed) is tried again up to this many times. */
const READ_ATTEMPTS = 3;
/** A reading's chat call: the reader writes a score and a fact per option and attribute. */
const READ_TIMEOUT_MS = 90_000;
/**
 * Answers are read within this long of being asked: every read of the unread answers looks only at this window of the index (status,
 * requested_at), never at every answer ever completed. An answer still unread past it stays unread (no reading, never a loss).
 */
export const READ_WINDOW_MS = 2 * 24 * 60 * 60_000;
const readSince = () => new Date(clock() - READ_WINDOW_MS).toISOString();

const clock = () => Date.parse(now());
export type Cadence = 'daily' | 'weekly';
/** The project's collection cadence (Settings > Monitoring): weekly at 168 hours or more, else daily. Comparison follows it. */
export const cadenceOf = (intervalHours: unknown): Cadence => (Number(intervalHours) >= 168 ? 'weekly' : 'daily');
/** Whether this installation collects Comparison: the search data provider's credentials, and not switched off. */
export const comparisonCollecting = () => setting('COMPARISON_ENABLED') !== 'false' && panelReachable();

/** The AIs a project's comparison asks, and the AIs it monitors that it leaves out, with why. */
export function comparisonEngines(project: { engines_json?: unknown; language_code: string; location_code: number }, allowed?: readonly Engine[]) {
  const { active, left } = projectEngines(project, allowed);
  const out: { engine: Engine; reason: ComparisonLeftReason }[] = left.map((item) => ({ engine: item.engine, reason: 'country' }));
  for (const engine of active) if (!COMPARISON_ENGINES.includes(engine)) out.push({ engine, reason: 'instructions' });
  return { engines: active.filter((engine) => COMPARISON_ENGINES.includes(engine) && !engineUnavailable(engine, project.location_code)), left: out };
}

/** The project's configuration (its latest revision). */
export const configurationStatement = (projectId: string) =>
  db().prepare('SELECT revision,configuration_json,created_at FROM comparison_configurations WHERE project_id=? ORDER BY revision DESC LIMIT 1').bind(projectId);
export const configurationOf = (row: { revision: number; configuration_json: string } | null | undefined): { revision: number; config: ComparisonConfig } =>
  row ? { revision: row.revision, config: readComparisonConfig(JSON.parse(row.configuration_json)) } : { revision: 0, config: readComparisonConfig({}) };

type Candidate = { id: string; workspace_id: string; name: string; domain: string; engines_json: string | null; language_code: string; location_code: number; interval_hours: number; revision: number; configuration_json: string };
type Run = { id: string; project_id: string; engine: Engine; question: string; status: string; reserved_usd: number; cost_usd: number; input_json: string; requested_at: string; started_at: string | null; language_code: string; location_code: number };

/** The state of a run's project: monitoring on and not archived. */
const ACTIVE_SQL = 'EXISTS(SELECT 1 FROM projects p WHERE p.id=comparison_runs.project_id AND p.archived=0 AND p.daily_enabled=1)';
const upsertState = (key: string, value: string) => db().prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value);

/**
 * Opens the runs of a project's period that do not exist yet (every product with options and attributes, every persona, every AI it asks),
 * each reserved under the project's budget and the platform's brake. `done` when nothing is missing any more (the project is not looked at
 * again until its next period or configuration), `retry` when a limit had no room, `skip` when it has nothing to ask.
 */
export async function openPeriod(candidate: Candidate, stamp: string, day: string, maxUsd?: number): Promise<'done' | 'retry' | 'skip'> {
  const config = readComparisonConfig(JSON.parse(candidate.configuration_json));
  if (!comparisonReady(config)) return 'skip';
  const capabilities = await accountCapabilities(candidate.workspace_id);
  const { engines } = comparisonEngines(candidate, capabilities.engines);
  if (!engines.length) return 'skip';
  // A plan that bounds the products (Free: 3) asks the first ones, also for a project configured before a downgrade.
  const limited = { ...config, products: config.products.slice(0, capabilities.comparisonProducts ?? undefined) };
  const period = periodStart(day, cadenceOf(candidate.interval_hours));
  const database = db();
  const { results: had } = await database.prepare('SELECT product_id,persona_id,engine,MAX(cost_usd,reserved_usd) usd FROM comparison_runs WHERE project_id=? AND period_start=? AND method=?').bind(candidate.id, period, COMPARISON_METHOD)
    .all<{ product_id: string; persona_id: string; engine: string; usd: number }>();
  const taken = new Set(had.map((row) => `${row.product_id}|${row.persona_id}|${row.engine}`));
  const rosters = comparisonRosters(limited, { name: candidate.name, domain: candidate.domain }, candidate.language_code);
  const wanted = rosters.flatMap((roster) => engines.map((engine) => ({ roster, engine, question: comparisonQuestion(roster, QUESTION_LIMIT[engine]) })))
    .filter((item) => !taken.has(`${item.roster.product.id}|${item.roster.persona.id}|${item.engine}`));
  if (!wanted.length) return 'done';
  // A backfill's cap (comparisonRoundNow): what the period's runs already hold, plus each new run's reserve, stays within `maxUsd`.
  const room = maxUsd === undefined ? Infinity : Math.floor((maxUsd - had.reduce((sum, row) => sum + Number(row.usd || 0), 0) + 1e-9) / RUN_RESERVE_USD);
  const planned = wanted.slice(0, Math.max(0, room));
  if (!planned.length) return 'retry';
  // Each run is guarded alone, in one transaction: the guard of a later run sees the reserves of the ones before it.
  const statements = planned.map(({ roster, engine, question }) => {
    const reserve = question ? RUN_RESERVE_USD : 0;
    const dollars = spendGuard(candidate.id, reserve);
    return database.prepare(`INSERT OR IGNORE INTO comparison_runs(id,workspace_id,project_id,day,period_start,product_id,persona_id,engine,method,question,roster_json,language_code,location_code,status,reserved_usd,error,requested_at,completed_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived=0 AND daily_enabled=1) AND (${dollars.sql})`)
      .bind(crypto.randomUUID(), candidate.workspace_id, candidate.id, day, period, roster.product.id, roster.persona.id, engine, COMPARISON_METHOD, question ?? '', JSON.stringify(roster), candidate.language_code, candidate.location_code,
        question ? 'pending' : 'cancelled', reserve, question ? null : 'The question does not fit this AI.', stamp, question ? null : stamp, candidate.id, candidate.workspace_id, ...dollars.params);
  });
  const results = await database.batch(statements);
  const opened = results.filter((result) => result.meta.changes).length;
  if (opened) await clearBlocked(candidate.id, 'comparison');
  if (opened === wanted.length) return 'done';
  // The budget refused some (a backfill's own cap is not a refusal: the rest waits for a call with room, or the scheduler).
  if (opened < planned.length) await recordRefusal(candidate.id, 'comparison', RUN_RESERVE_USD);
  return 'retry';
}

/** A project with its latest configuration. */
const CANDIDATE_SQL = `SELECT p.id,p.workspace_id,p.name,p.domain,p.engines_json,p.language_code,p.location_code,p.interval_hours,c.revision,c.configuration_json
    FROM projects p JOIN comparison_configurations c ON c.project_id=p.id AND c.revision=(SELECT MAX(revision) FROM comparison_configurations WHERE project_id=p.id)`;

/**
 * Opens the due periods: projects with monitoring on and a comparison configured, not yet opened for this period and revision (or the
 * one project `projectId`, right after its configuration is saved).
 */
async function enqueue(projectId?: string) {
  const database = db();
  const stamp = now();
  const day = scheduleWindow(stamp).slice(0, 10);
  const daily = periodStart(day, 'daily');
  const weekly = periodStart(day, 'weekly');
  const period = `CASE WHEN p.interval_hours>=168 THEN '${weekly}' ELSE '${daily}' END`;
  const candidates = (await database.prepare(`${CANDIDATE_SQL}
    LEFT JOIN system_state a ON a.key='comparison_attempt:'||p.id
    LEFT JOIN system_state k ON k.key='comparison_done:'||p.id
    WHERE p.archived=0 AND p.daily_enabled=1 AND COALESCE(k.value,'')<>${period}||':'||c.revision||':m${COMPARISON_METHOD}'${projectId ? ' AND p.id=?' : ''}
    ORDER BY COALESCE(a.value,''),p.id LIMIT ?`).bind(...(projectId ? [projectId] : []), PROJECTS_PER_TICK).all<Candidate>()).results;
  for (const candidate of candidates) {
    // A project that cannot open now (its budget) goes to the back of the line, so it does not hold the others up.
    await upsertState(`comparison_attempt:${candidate.id}`, stamp).run();
    try {
      const outcome = await openPeriod(candidate, stamp, day);
      if (outcome !== 'retry') await upsertState(`comparison_done:${candidate.id}`, doneKey(day, candidate)).run();
    } catch (error) { console.error('A Comparison period could not be opened; it will retry on the next tick.', error instanceof Error ? error.message : String(error)); }
  }
}

/** What marks a project's period as opened: the period, the configuration's revision and the method asked (a new method opens it again). */
const doneKey = (day: string, candidate: Pick<Candidate, 'interval_hours' | 'revision'>) => `${periodStart(day, cadenceOf(candidate.interval_hours))}:${candidate.revision}:m${COMPARISON_METHOD}`;

/** How long a step that follows a request (a save, a screen read) may send: inside the time a request's background work has. */
const KICK_MS = 20_000;
/**
 * A project's runs moved now, after its configuration is saved (`open`: its period is opened first, so the first answers do not wait for
 * the next tick, as a new project's first collection) or when its screen is read while answers are on their way (a preview has no
 * scheduler). Within the project's lease, so it never runs beside its runner; bounded by KICK_MS. Never throws.
 */
export async function kickComparison(projectId: string, open = false) {
  try {
    if (open && comparisonCollecting()) await enqueue(projectId);
    await withLease(`comparison:${projectId}`, KICK_MS + SEND_TIMEOUT_MS + 60_000, () => moveRuns(projectId, KICK_MS));
  } catch (error) { console.error('Comparison runs could not be moved now; the scheduler moves them.', error instanceof Error ? error.message : String(error)); }
}

/** Records the outcome of a run in flight; a run settled twice keeps its first outcome. */
async function settle(run: Pick<Run, 'id'>, from: string, patch: { status: string; cost: number; reserved: number; error?: string | null; response?: string | null; sources?: unknown[]; input?: Record<string, unknown> }) {
  const settled = !['submitted', 'submitting', 'pending'].includes(patch.status);
  await db().prepare('UPDATE comparison_runs SET status=?,reserved_usd=?,cost_usd=?,response=COALESCE(?,response),sources_json=?,error=?,input_json=?,completed_at=? WHERE id=? AND status=?')
    .bind(patch.status, patch.reserved, patch.cost, patch.response ?? null, JSON.stringify(patch.sources ?? []), patch.error ?? null, JSON.stringify(patch.input ?? {}), settled ? now() : null, run.id, from).run();
}

/** The request of a run: the question as its collection asks that AI, on the provider's queue, tagged with the run's id. */
const callOf = (run: Run) => ({
  path: `${providerBase(run.engine)}/task_post`,
  payload: providerPayload({ id: run.id, engine: run.engine, language_code: run.language_code, location_code: run.location_code, prompt_text: run.question }),
  resultPath: (task: string) => `${providerBase(run.engine)}/${providerResultPath(run.engine, task)}`,
});

async function submit(run: Run, send: Send) {
  const database = db();
  const stamp = now();
  // Monitoring paused or the project archived since the period opened: nothing more is asked or paid.
  await database.prepare(`UPDATE comparison_runs SET status='cancelled',reserved_usd=0,completed_at=?,error='The project is no longer collecting.' WHERE id=? AND status='pending' AND NOT ${ACTIVE_SQL}`).bind(stamp, run.id).run();
  // Its reserve already counts: the claim adds nothing, but stops once a limit was lowered below what is spent.
  const budget = spendGuard(run.project_id, 0);
  const claimed = await database.prepare(`UPDATE comparison_runs SET status='submitting',started_at=? WHERE id=? AND status='pending' AND ${ACTIVE_SQL} AND ${budget.sql}`).bind(stamp, run.id, ...budget.params).run();
  if (!claimed.meta.changes) return;
  const call = callOf(run);
  try {
    const [task] = await send(call.path, [call.payload]);
    const cost = Number.isFinite(task?.cost) ? Number(task?.cost) : 0;
    if (task?.status_code !== 20100 || !task.id) return settle(run, 'submitting', { status: 'failed', cost, reserved: cost, error: `task ${task?.status_code} ${task?.status_message ?? ''}`.trim() });
    // Accepted: billed from here, so a failure to record the task id leaves the run `submitting`, and it ends `unknown`, never sent again.
    return settle(run, 'submitting', { status: 'submitted', cost, reserved: Math.max(cost, run.reserved_usd), input: { taskId: task.id, submittedCost: cost, nextPollAt: clock() + POLL_MS, startedAt: stamp } });
  } catch (error) {
    const ambiguous = error instanceof SendError ? error.ambiguous : true;
    await settle(run, 'submitting', {
      status: ambiguous ? 'unknown' : 'failed', cost: 0, reserved: ambiguous ? run.reserved_usd : 0,
      error: (ambiguous ? 'The provider did not confirm the request; it is not sent again. ' : '') + String((error as Error)?.message ?? error).slice(0, 300),
    });
  }
}

async function poll(run: Run, send: Send) {
  const input = JSON.parse(run.input_json) as { taskId?: string; submittedCost?: number; startedAt?: string };
  const submitted = input.submittedCost ?? run.cost_usd;
  if (!input.taskId) return settle(run, 'submitted', { status: 'unknown', cost: submitted, reserved: Math.max(submitted, run.reserved_usd), error: 'The task id was not recorded.' });
  if (clock() - Date.parse(input.startedAt || run.started_at || run.requested_at) > EXPIRES_MS)
    return settle(run, 'submitted', { status: 'failed', cost: submitted, reserved: submitted, error: 'The provider did not finish the task in time.' });
  const again = () => settle(run, 'submitted', { status: 'submitted', cost: submitted, reserved: Math.max(submitted, run.reserved_usd), input: { ...input, nextPollAt: clock() + POLL_MS } });
  let task;
  try { [task] = await send(callOf(run).resultPath(input.taskId)); } catch (error) { console.error('Comparison result read failed; it retries.', error instanceof Error ? error.message : String(error)); return again(); }
  if (!task || providerTaskPending(Number(task.status_code))) return again();
  if (task.status_code === NO_SEARCH_RESULTS) return settle(run, 'submitted', { status: 'absent', cost: submitted, reserved: submitted, error: 'no_answer' });
  if (task.status_code !== 20000 || !firstResult(task)) return settle(run, 'submitted', { status: 'failed', cost: submitted, reserved: submitted, error: `task ${task.status_code} ${task.status_message ?? ''}`.trim() });
  const cost = providerResultCost(run.engine, submitted, firstResult(task) ?? {}) || taskCost(task) || submitted;
  const { answer, sources } = extractResponse(firstResult(task) ?? {}, run.engine);
  if (!answer?.trim()) return settle(run, 'submitted', { status: 'absent', cost, reserved: cost, error: 'no_answer' });
  // Answered: the reading's reserve stays held until it is read (readRuns).
  return settle(run, 'submitted', { status: 'completed', cost, reserved: cost + COMPARISON_READ_RESERVE_USD, response: answer.slice(0, 30_000), sources: sources.slice(0, 50), input: { readAttempts: 0 } });
}

/**
 * Reads the completed answers that have no reading yet with the decision model (Admin > Classifiers, "Comparison: reading answers"), one
 * typed Decisions call each. A reading is claimed first (one worker pays it); an error answer is not billed and is tried again up to
 * READ_ATTEMPTS times; a lost reply keeps its reserve and is never read again. Without the model key nothing is read (and nothing paid).
 */
async function readRuns(projectId?: string) {
  if (!decisionKeyConfigured()) return 0;
  const database = db();
  const model = comparisonReaderModel();
  const { results } = await database.prepare(`SELECT id,project_id,question,roster_json,response,cost_usd,reserved_usd,input_json FROM comparison_runs
    WHERE status='completed' AND method=${COMPARISON_METHOD} AND requested_at>? AND reading_json IS NULL AND response IS NOT NULL AND json_extract(input_json,'$.readClaimedAt') IS NULL
      AND COALESCE(json_extract(input_json,'$.readAttempts'),0)<?${projectId ? ' AND project_id=?' : ''} ORDER BY requested_at LIMIT ${READS_PER_STEP}`)
    .bind(readSince(), READ_ATTEMPTS, ...(projectId ? [projectId] : [])).all<{ id: string; project_id: string; question: string; roster_json: string; response: string; cost_usd: number; reserved_usd: number; input_json: string }>();
  let read = 0;
  await inPool(results, OUTBOUND_CONNECTIONS, async (run) => {
    const input = JSON.parse(run.input_json || '{}') as { readAttempts?: number };
    const claimed = await database.prepare(`UPDATE comparison_runs SET input_json=json_set(input_json,'$.readClaimedAt',?) WHERE id=? AND reading_json IS NULL AND json_extract(input_json,'$.readClaimedAt') IS NULL`).bind(now(), run.id).run();
    if (!claimed.meta.changes) return;
    const roster = JSON.parse(run.roster_json) as ComparisonRoster;
    const attempts = (input.readAttempts ?? 0) + 1;
    let response: Response;
    try {
      response = await postChat(comparisonReading(run.response, roster, run.question, model), READ_TIMEOUT_MS, 'comparison_reader');
    } catch (error) {
      // No answer at all: it may have been billed. Its reserve is kept and it is never read again.
      await database.prepare(`UPDATE comparison_runs SET cost_usd=cost_usd+?,reserved_usd=cost_usd+?,input_json=json_set(input_json,'$.readAttempts',?),error=? WHERE id=?`)
        .bind(COMPARISON_READ_RESERVE_USD, COMPARISON_READ_RESERVE_USD, READ_ATTEMPTS, `The reading's outcome is unknown; it is not read again. ${String((error as Error)?.message ?? error).slice(0, 200)}`, run.id).run();
      return;
    }
    const raw = response.ok ? await response.json().catch(() => null) : (await response.body?.cancel(), null);
    const reported = (raw as { usage?: { cost?: unknown } } | null)?.usage?.cost;
    const cost = !response.ok ? 0 : typeof reported === 'number' && Number.isFinite(reported) && reported >= 0 ? reported : COMPARISON_READ_RESERVE_USD;
    const reading = raw ? readComparison((raw as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content, roster) : null;
    const last = attempts >= READ_ATTEMPTS;
    await database.prepare(`UPDATE comparison_runs SET reading_json=?,cost_usd=cost_usd+?,reserved_usd=cost_usd+?+?,input_json=json_remove(json_set(input_json,'$.readAttempts',?,'$.model',?),'$.readClaimedAt'),error=? WHERE id=?`)
      .bind(reading ? JSON.stringify(reading) : null, cost, cost, reading || last ? 0 : COMPARISON_READ_RESERVE_USD, attempts, model,
        reading ? null : response.ok ? 'The reader gave no order for this answer.' : `The reader returned HTTP ${response.status}.`, run.id).run();
    if (reading) read++;
  });
  return read;
}

const COLUMNS = 'id,project_id,engine,question,status,reserved_usd,cost_usd,input_json,requested_at,started_at,language_code,location_code';
/** One project's runs (or every project's, inline): the polls first, then the sends, then the readings, six at a time. */
async function moveRuns(projectId?: string, budgetMs = projectId ? COMPARISON_RUNNER_MS : SEND_BUDGET_MS) {
  const credentials = panelCredentials();
  const database = db();
  const scope = projectId ? ' AND project_id=?' : '';
  const params = projectId ? [projectId] : [];
  const reachable = panelReachable(credentials);
  const [pending, submitted] = reachable ? await Promise.all([
    database.prepare(`SELECT ${COLUMNS} FROM comparison_runs WHERE status='pending'${scope} ORDER BY requested_at,rowid LIMIT ${PENDING_READ}`).bind(...params).all<Run>(),
    database.prepare(`SELECT ${COLUMNS} FROM comparison_runs WHERE status='submitted' AND COALESCE(json_extract(input_json,'$.nextPollAt'),0)<=?${scope} ORDER BY requested_at,id LIMIT ${POLLS_PER_STEP}`).bind(clock(), ...params).all<Run>(),
  ]) : [{ results: [] as Run[] }, { results: [] as Run[] }];
  const send = dataForSeo(credentials.login!, credentials.password!, SEND_TIMEOUT_MS);
  const deadline = Date.now() + budgetMs;
  let sent = 0;
  await inPool<Run>([...submitted.results, ...pending.results], OUTBOUND_CONNECTIONS, async (run) => {
    if (run.status === 'submitted') return void (await poll(run, send));
    if (Date.now() >= deadline) return false;
    await submit(run, send);
    sent++;
  });
  return sent + submitted.results.length + (await readRuns(projectId));
}

/**
 * The scheduler's step: opens the due periods, settles stuck sends and moves the runs. Switched off (`COMPARISON_ENABLED=false`) or
 * without credentials it opens nothing and sends nothing; what was waiting is cancelled (its reserve released), and tasks already posted
 * are still read (they were billed). `start` (Cloud) hands the projects with runs to move to their runners; null without them (inline).
 */
export async function processComparisons(start?: (projectIds: string[]) => Promise<number | null>) {
  const collecting = comparisonCollecting();
  const database = db();
  if (collecting) await enqueue();
  const stamp = now();
  await database.prepare(`UPDATE comparison_runs SET status='unknown',completed_at=?,error='The outcome of the request is unknown; it is not sent again.'
    WHERE status='submitting' AND COALESCE(started_at,requested_at)<?`).bind(stamp, new Date(Date.parse(stamp) - STALE_MS).toISOString()).run();
  // A reading claimed and never settled (the Worker stopped after it may have been billed): its reserve stays, it is not read again.
  await database.prepare(`UPDATE comparison_runs SET input_json=json_set(json_remove(input_json,'$.readClaimedAt'),'$.readAttempts',${READ_ATTEMPTS}),error='The reading started and its outcome is unknown; it is not read again.'
    WHERE status='completed' AND requested_at>? AND reading_json IS NULL AND json_extract(input_json,'$.readClaimedAt')<?`).bind(readSince(), new Date(Date.parse(stamp) - STALE_MS).toISOString()).run();
  if (!collecting) await database.prepare(`UPDATE comparison_runs SET status='cancelled',reserved_usd=0,completed_at=?,error='Comparison collection is switched off.' WHERE status='pending'`).bind(stamp).run();
  // A question of an earlier method not sent yet is never sent: its answer would not count (its period is asked again the current way).
  await database.prepare(`UPDATE comparison_runs SET status='cancelled',reserved_usd=0,completed_at=?,error='Asked again the current way.' WHERE status='pending' AND method<${COMPARISON_METHOD}`).bind(stamp).run();
  if (start) {
    const projects = (await database.prepare(`SELECT DISTINCT project_id FROM comparison_runs
      WHERE status='pending' OR (status='submitted' AND COALESCE(json_extract(input_json,'$.nextPollAt'),0)<=?)
        OR (status='completed' AND method=${COMPARISON_METHOD} AND requested_at>? AND reading_json IS NULL AND json_extract(input_json,'$.readClaimedAt') IS NULL AND COALESCE(json_extract(input_json,'$.readAttempts'),0)<${READ_ATTEMPTS})`).bind(clock(), readSince()).all<{ project_id: string }>()).results;
    const started = projects.length ? await start(projects.map((row) => row.project_id)) : 0;
    if (started !== null) return started;
  }
  return moveRuns();
}

/** One project's runs, in its runner (Cloud, lib/server/project-runners.ts). */
export const comparisonStep = (projectId: string) => moveRuns(projectId);

/** A backfill's ceiling per call (COMPARISON_ROUND_CAP_USD overrides it). */
const ROUND_CAP_USD = 5;
/**
 * One Comparison round of a project now (the operations endpoint's `comparison-round`, a backfill): the current period's questions that are
 * not asked yet (method COMPARISON_METHOD), as many as fit in `maxUsd` with what the period's runs already hold (each run reserves its worst
 * case), then its runs moved as far as a request allows. Idempotent: call again until `inFlight` is 0; a run is never asked twice. What stops
 * it (the cap, the project not collecting, nothing to ask) throws with the reason.
 */
export async function comparisonRoundNow(projectId: string, maxUsd: number) {
  const ceiling = Number(setting('COMPARISON_ROUND_CAP_USD')) > 0 ? Number(setting('COMPARISON_ROUND_CAP_USD')) : ROUND_CAP_USD;
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > ceiling) throw new Error(`maxUsd must be above 0 and at most the round cap (US$ ${ceiling}).`);
  if (!comparisonCollecting()) throw new Error('Comparison collection is switched off here.');
  const database = db();
  const candidate = await database.prepare(`${CANDIDATE_SQL} WHERE p.id=? AND p.archived=0 AND p.daily_enabled=1`).bind(projectId).first<Candidate>();
  if (!candidate) throw new Error('The project is not collecting Comparison (archived, monitoring paused or not set up).');
  const stamp = now();
  const day = scheduleWindow(stamp).slice(0, 10);
  const opened = await openPeriod(candidate, stamp, day, maxUsd);
  if (opened === 'skip') throw new Error('The project has nothing to ask: no product with options and attributes, no persona, or no AI that takes instructions.');
  if (opened === 'done') await upsertState(`comparison_done:${candidate.id}`, doneKey(day, candidate)).run();
  await withLease(`comparison:${projectId}`, KICK_MS + SEND_TIMEOUT_MS + 60_000, () => moveRuns(projectId, KICK_MS));
  const period = periodStart(day, cadenceOf(candidate.interval_hours));
  const { results: runs } = await database.prepare(`SELECT status,COUNT(*) n,ROUND(SUM(cost_usd),4) usd,SUM(reading_json IS NOT NULL) read,SUM(json_extract(reading_json,'$.discarded') IS NOT NULL) discarded,
      SUM(status='completed' AND reading_json IS NULL AND COALESCE(json_extract(input_json,'$.readAttempts'),0)<${READ_ATTEMPTS}) unread
    FROM comparison_runs WHERE project_id=? AND period_start=? AND method=? GROUP BY status ORDER BY status`).bind(projectId, period, COMPARISON_METHOD)
    .all<{ status: string; n: number; usd: number; read: number; discarded: number; unread: number }>();
  const inFlight = runs.reduce((sum, row) => sum + (['pending', 'submitting', 'submitted'].includes(row.status) ? row.n : 0) + Number(row.unread || 0), 0);
  // `complete`: every question of the period is open; else call again with a higher maxUsd (or let the scheduler open the rest).
  return { period, complete: opened === 'done', runs, inFlight };
}

/**
 * A project's stored readings anchored again to the current rule (the operations endpoint's `comparison-reread`, 13/11/2026; free: no AI and
 * no reader is asked): each reading is recomputed from its own stored cells (anchorReading: a score of 60 or more without a fact capped at
 * 59, the evidence discard only under FACT_SHARE_MIN of facts), one page of `limit` runs after `after` (their id); `next` is the cursor of
 * the following page, null at the end. A reading already anchored is left as it is, so a second pass changes nothing.
 */
export async function rereadComparisons(projectId: string, after: string, limit: number) {
  const database = db();
  const { results } = await database.prepare(`SELECT id,reading_json FROM comparison_runs WHERE project_id=? AND method=? AND reading_json IS NOT NULL AND id>? ORDER BY id LIMIT ?`)
    .bind(projectId, COMPARISON_METHOD, after, limit).all<{ id: string; reading_json: string }>();
  let before = 0, discarded = 0, capped = 0;
  const changed = results.flatMap((row) => {
    const stored = JSON.parse(row.reading_json) as ComparisonReading;
    const reading = anchorReading(stored);
    if (stored.discarded) before++;
    if (reading.discarded) discarded++;
    for (const cells of Object.values(reading.scores)) for (const cell of Object.values(cells)) if (cell.capped !== undefined) capped++;
    const value = JSON.stringify(reading);
    return value === row.reading_json ? [] : [database.prepare('UPDATE comparison_runs SET reading_json=? WHERE id=? AND reading_json=?').bind(value, row.id, row.reading_json)];
  });
  if (changed.length) await database.batch(changed);
  return { projectId, read: results.length, changed: changed.length, discarded: { before, after: discarded }, capped, next: results.length === limit ? results.at(-1)!.id : null };
}
