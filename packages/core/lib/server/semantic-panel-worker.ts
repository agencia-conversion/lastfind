// The Semantic Branding panel collects on its own. Once per period of the project's frequency (daily unless it says otherwise) a round
// asks each AI the project monitors ONE question that covers every brand and attribute, the way its daily collection asks it (see
// lib/semantic-panel.ts: since 8/11/2026 every AI through DataForSEO, the interfaces scraped and Claude and Perplexity through the models the
// collection asks; AI Overviews one search per group of brands; the panel's own models through OpenRouter are no longer asked).
// The scheduler's tick
// opens the due rounds and moves their queries along: pending -> submitting -> completed / absent / failed (a scraper goes through submitted
// while its task is polled). It does not read the Prompts or their answers.
//   - One round per project and period: (project, frequency, period_start) is unique and a round is opened only when none exists on or after the
//     start of the current period, so a retried tick, or a frequency changed mid-period, does not ask twice. The one exception is the operator's
//     redo (panelRoundNow), whose round's period key carries REDO_PERIOD and its own id.
//   - Spend: the worst case of every query is reserved when the round opens (the account ceilings through the edition's budget condition, the
//     round and project caps below). A reply that is lost stays `unknown` at its reserve and is never sent again.
//   - Absence is never a zero: an AI that fails, answers outside the format or shows no AI block (Google's "No Search Results") leaves no readings.
//   - A tick is short: up to six queries are in flight (any rounds, the oldest first) until SEND_BUDGET_MS has passed (a send is cut at
//     SEND_TIMEOUT_MS, a Live one, Claude and Perplexity, at LIVE_TIMEOUT_MS), so a round may take several ticks and the tick still reaches its other work.
//     With the project runners (Cloud) each project's queries go in an invocation of its own (semanticPanelStep). A query that costs more than
//     its reserve stops the rest of its round that was not sent yet.
import { ENGINE_META, engineUnavailable, ENGINES, type Engine } from '@/lib/engines';
import { validateSemanticConfiguration } from '@/lib/semantic-evaluation';
import { MIN_ATTRIBUTE_SHARE, unscoredBrands } from '@/lib/semantic-perception';
import { PANEL_MIN_ENGINES, DEFAULT_PANEL_FREQUENCY, REDO_PERIOD, SEARCHED_ENGINES, anchorReadings, evidenceList, nextRun, panelGroups, panelModel, panelRequest, parsePanelReply, periodStart, shuffled, type PanelFrequency, type PanelMethod, type PanelReading } from '@/lib/semantic-panel';
import { dataForSeo, firstResult, OVERVIEW_READING_RESERVE_USD, READING_MODEL, panelCall, readOverview, readOverviewOnce, readPanelTask, readingKey, taskCost, SendError, NO_SEARCH_RESULTS, READING_RESERVE_USD, type Attribute, type Brand, type PanelCall, type Send } from '@/lib/semantic-panel-provider';
import { postDecisions } from './decisions-api';
import { overviewReaderModel } from './classifier-models';
import { PANEL_IN_FLIGHT } from '@/lib/semantic-panel-spend';
import { collectionModel, providerResultCost, providerTaskPending } from '@/lib/provider-contract';
import { scheduleWindow } from '@/lib/scheduling';
import { accountCapabilities, semanticBudgetCondition } from './capabilities';
import { clearBlocked, recordRefusal, spendGuard } from './spend-guards';
import { db, now, setting } from './env';
import { inPool, OUTBOUND_CONNECTIONS } from '@/lib/pool';
import { decisionKeyConfigured } from './model-routes';
import { withLease } from './leases';

/** The scheduler's tick has a lease and other work to do: no new send starts after this much time, and one send is cut at the timeout. */
const SEND_BUDGET_MS = 60_000;
/** A project runner's step (Cloud) is an invocation of its own (up to 15 minutes): its six lanes keep sending this long, then it chains. */
export const RUNNER_SEND_BUDGET_MS = 4 * 60_000;
export const SEND_TIMEOUT_MS = 40_000;
/** Pending queries read per tick: about a full round for each lane (the six AIs, AI Overviews in a few groups of brands). */
const PENDING_READ = OUTBOUND_CONNECTIONS * 10;
const POLLS_PER_TICK = 12;
/** Rounds opened in one tick; the projects that waited longest go first. */
const ROUNDS_PER_TICK = 10;
const POLL_MS = 60_000;
const EXPIRES_MS = 3 * 60 * 60_000;
/** A call that was claimed and never settled (the Worker stopped, the reply was lost): its outcome is unknown. */
const STALE_MS = 10 * 60_000;
/**
 * The most one round may reserve (the product's ceiling, REQUIREMENTS). Since 8/11/2026 an interface's query reserves its scraper's fee and
 * up to three readings of an answer in prose (about US$ 0.17), Claude's and Perplexity's their model's worst case too (about US$ 0.3 each),
 * so a round of the six AIs with AI Overviews in two groups reserves about US$ 1.4, below the cap, which stays as the brake on a broken
 * assumption. What a project may spend in a month is its budget (Settings > Monitoring > Budget).
 */
const ROUND_CAP_USD = 5;

/** The scheduler's clock in ms: `now()` is the one source of time, so a test can move it. */
const clock = () => Date.parse(now());
const limit = (key: string, fallback: number) => { const value = Number(setting(key)); return Number.isFinite(value) && value > 0 ? value : fallback; };
/** How far back a round looks for each AI's latest answer: past the start of the longest period (a month) with room to spare. */
const LOOKBACK = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 62 * 86_400_000).toISOString().slice(0, 10);
const frequencyOf = (value: unknown): PanelFrequency => (value === 'daily' || value === 'weekly' || value === 'monthly' ? value : DEFAULT_PANEL_FREQUENCY);

type Candidate = {
  id: string; workspace_id: string; name: string; domain: string; aliases_json: string | null; competitors_json: string; category: string | null; engines_json: string | null;
  language_code: string; location_code: number; revision: number; configuration_json: string; frequency: string;
};
/** Rounds from 31/10 to 6/11/2026 also kept the models (`models`) or cells (`cells`) they asked; none is read any more. */
type Roster = { brands: Brand[]; attributes: Attribute[]; category: string };
type Query = {
  id: string; round_id: string; project_id: string; engine: Engine; method: PanelMethod; model: string; web: 0 | 1; run: number; brand_order_json: string; status: string; reserved_usd: number; cost_usd: number; input_json: string; requested_at: string; started_at: string | null;
  roster_json: string; language_code: string; location_code: number; day: string;
};

/** The state of the project: monitoring on and Semantic Branding enabled in its latest configuration. */
const ACTIVE_SQL = `EXISTS(SELECT 1 FROM projects p JOIN semantic_configurations c ON c.project_id=p.id AND c.workspace_id=p.workspace_id
  AND c.revision=(SELECT MAX(revision) FROM semantic_configurations WHERE project_id=p.id)
  WHERE p.id=semantic_panel_queries.project_id AND p.workspace_id=semantic_panel_queries.workspace_id AND p.archived=0 AND p.daily_enabled=1
    AND json_extract(c.configuration_json,'$.enabled')=1)`;

/** The search data provider's credentials: the one provider Semantic Branding calls (every AI and the reading of an answer in prose). */
export const panelCredentials = () => ({ login: setting('DATAFORSEO_LOGIN'), password: setting('DATAFORSEO_PASSWORD') });
/** Whether this installation can collect: it has the provider's credentials. */
export const panelReachable = ({ login, password } = panelCredentials()) => !!login && !!password;

/** Why Semantic Branding leaves out an AI a project monitors: it is not served in the project's country. */
export type LeftOut = { engine: Engine; reason: 'country' };
/** The AIs a project monitors (its engines), from the stored list; the default is ChatGPT, as on the project. */
const monitoredEngines = (enginesJson: unknown): Engine[] => {
  try { const list = JSON.parse(String(enginesJson || '["chat_gpt"]')); return Array.isArray(list) ? ENGINES.filter((engine) => list.includes(engine)) : []; } catch { return []; }
};
/**
 * The AIs Semantic Branding asks for a project (8/11/2026, the same AIs as the project): those it monitors (`allowed` by the account's plan,
 * when given) that its collection serves in the project's country (in both languages; Gemini's in Portuguese since 7/11/2026), here reachable.
 * `left` is the rest of what it monitors, with the reason, for the screen. No D1 read: the round and the report pass the plan's AIs (a
 * project downgraded to Free keeps its old list, 8/11/2026).
 */
export function projectEngines(project: { engines_json?: unknown; language_code: string; location_code: number }, allowed?: readonly Engine[]) {
  const monitored = monitoredEngines(project.engines_json).filter((engine) => !allowed || allowed.includes(engine));
  const left: LeftOut[] = [];
  const engines = monitored.filter((engine) => {
    const reason = engineUnavailable(engine, project.location_code);
    if (reason) left.push({ engine, reason });
    return !reason;
  });
  // `active`: the project's AIs whatever this installation reaches (the report shows only their notes, old rounds included).
  return { engines: panelReachable() ? engines : [], left, active: engines };
}

/**
 * The latest query of each AI (4/11/2026; until then the latest round's): its order. Each AI is asked once a round (3/11/2026), in the
 * reverse order of its previous answer when that was a run 0, else in a new shuffle, so two consecutive answers measure the order effect.
 * SQLite gives the bare columns of the row with the MAX.
 */
async function previousOrders(projectId: string, day: string) {
  const { results } = await db().prepare(`SELECT q.engine,q.run,q.brand_order_json,MAX(r.day||'|'||r.created_at) asked_at
    FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id
    WHERE q.project_id=? AND q.requested_at>? AND r.day>? AND q.status<>'cancelled' AND q.method='scrape' GROUP BY q.engine`)
    .bind(projectId, LOOKBACK(day), LOOKBACK(day)).all<Pick<Query, 'engine' | 'run' | 'brand_order_json'>>();
  return new Map(results.map((query) => [query.engine, { run: query.run, order: JSON.parse(query.brand_order_json || '[]') as string[] }] as const));
}
/** The statement that adds a planned query to a round (`ignore`: one already there, same AI, model and run, stays as it is). */
const insertQuery = (round: { id: string; workspace_id: string; project_id: string }, item: Planned, stamp: string, ignore = false) => db().prepare(`INSERT${ignore ? ' OR IGNORE' : ''} INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,input_json,sources_json,error,requested_at,completed_at,web,run,brand_order_json)
  SELECT ?,?,?,?,?,?,?,?,?,?,0,'{}','[]',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM semantic_panel_rounds WHERE id=?)`)
  .bind(crypto.randomUUID(), round.id, round.workspace_id, round.project_id, item.engine, item.method, item.model, item.question, item.status, item.reserve, item.error, stamp, item.status === 'pending' ? null : stamp,
    item.web, item.run, JSON.stringify(item.order.map((brand) => brand.name)), round.id);

/** The model the daily collection asks for an AI with a model API (Claude, Perplexity; null for an interface): the same in a round. */
const askedModel = (engine: Engine) => (ENGINE_META[engine].family === 'responses' ? collectionModel(engine, setting) : null);
type Planned = { engine: Engine; web: 0 | 1; run: number; order: Brand[]; method: 'scrape'; model: string; question: string; status: 'pending' | 'cancelled'; reserve: number; error: string | null };

/**
 * The queries of a round: each AI once, asked the way its collection asks it (AI Overviews once per group of brands), in the reverse order of
 * its previous answer when that was a run 0 (`previous`, by AI), else in a new shuffle; reserved from the cheapest call up within `cap` (the
 * round's), and none when fewer AIs than the minimum fit (no score would come out of it, so nothing is paid).
 */
function planQueries(engines: Engine[], roster: Roster, previous: Map<Engine, { run: number; order: string[] }>, market: { day: string; language: string; location: number }, cap = limit('SEMANTIC_PANEL_ROUND_CAP_USD', ROUND_CAP_USD)) {
  const { brands, attributes, category } = roster;
  const variants = engines.flatMap((engine) => {
    const next = nextRun(previous.get(engine));
    const order = next.order ? next.order.flatMap((name) => brands.filter((brand) => brand.name === name)) : [];
    // A brand added or removed since the previous round (or an AI Overviews group): a new shuffle.
    const asked = next.order && order.length === brands.length ? { run: next.run, order } : { run: 0, order: shuffled(brands) };
    const model = askedModel(engine);
    return panelGroups(engine, asked.order).map((group, at) => ({ engine, run: asked.run, order: group, model, stored: panelModel(engine, at, model) }));
  });
  // With the model key an answer in prose is read in one decision-model call: the query reserves that call, not the provider's readings.
  const reader = readerModel();
  const calls = variants.map(({ engine, order, model }) => panelCall(engine, panelRequest(order, attributes, category, market.language), { ...market, model, ...(reader ? { readings: OVERVIEW_READING_RESERVE_USD } : {}) }));
  const fits = new Set<number>();
  let reserved = 0;
  for (const at of calls.map((_, index) => index).sort((a, b) => (calls[a]?.reserve ?? 0) - (calls[b]?.reserve ?? 0))) {
    const call = calls[at];
    if (call && reserved + call.reserve <= cap) { reserved += call.reserve; fits.add(at); }
  }
  const plan = variants.map(({ engine, run, order, stored }, at): Planned => {
    const call = calls[at];
    // `web` 1: every AI may search by itself (Claude's pure model, 0, until 8/11/2026); `model` is the engine id, or the collection's model.
    const base = { engine, web: 1 as const, run, order, method: 'scrape' as const, model: stored, question: call?.question ?? '' };
    if (!call) return { ...base, status: 'cancelled', reserve: 0, error: 'The question does not fit this AI.' };
    if (!fits.has(at)) return { ...base, status: 'cancelled', reserve: 0, error: 'The spend cap of the round was reached.' };
    return { ...base, status: 'pending', reserve: call.reserve, error: null };
  });
  if (new Set(plan.filter((item) => item.status === 'pending').map((item) => item.engine)).size < PANEL_MIN_ENGINES) {
    for (const item of plan) if (item.status === 'pending') Object.assign(item, { status: 'cancelled', reserve: 0, error: 'Fewer AIs than the minimum could be asked.' });
    reserved = 0;
  }
  return { plan, reserved };
}

/** What stops a round from opening: any round in the period, or (a redo) a round of the period with queries still in flight. Binds project, period start. */
const blockingSql = (redo: boolean) => (redo
  ? "SELECT 1 FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id WHERE r.project_id=? AND r.day>=? AND q.status IN ('pending','submitting','submitted')"
  : 'SELECT 1 FROM semantic_panel_rounds WHERE project_id=? AND day>=?');

/**
 * Opens the round of a project for the current period with one query per AI. `skip` = the project is not eligible; `retry` = nothing was opened
 * (the budget, or a round already exists). `redo` (the operator, see panelRoundNow): a fresh round even though the period has one, unless a round
 * of the period still has queries in flight; outside the plan's monthly round count (neither held by it nor counted in it), within every dollar guard.
 */
async function openRound(candidate: Candidate, stamp: string, day: string, cap?: number, redo = false): Promise<'opened' | 'skip' | 'retry'> {
  let attributes: Attribute[];
  try {
    const configuration = validateSemanticConfiguration(JSON.parse(candidate.configuration_json));
    if (!configuration.enabled) return 'skip';
    attributes = configuration.attributes;
  } catch (error) { console.error('Semantic Branding configuration is invalid; the project is skipped.', error instanceof Error ? error.message : String(error)); return 'skip'; }
  const language = candidate.language_code;
  const competitors = (JSON.parse(candidate.competitors_json || '[]') as Partial<Brand>[]).filter((item): item is Brand => typeof item?.name === 'string' && typeof item?.domain === 'string');
  // The project's own aliases too (13/11/2026): an answer that names the brand by one of them still gives its notes (brandMatcher).
  const own = (JSON.parse(candidate.aliases_json || '[]') as unknown[]).filter((alias): alias is string => typeof alias === 'string' && !!alias.trim());
  const brands = [{ name: candidate.name, domain: candidate.domain, ...(own.length ? { aliases: own } : {}) }, ...competitors];
  const capabilities = await accountCapabilities(candidate.workspace_id);
  const { engines } = projectEngines(candidate, capabilities.engines);
  if (engines.length < PANEL_MIN_ENGINES) return 'skip';
  // A plan that fixes the frequency (for example monthly only) stores it on the project once, so the due check and the report read it from
  // then on; a round already in that period means nothing is due.
  const fixed = capabilities.panelFrequency;
  if (fixed && fixed !== frequencyOf(candidate.frequency)) {
    await db().prepare(`INSERT INTO semantic_panel_settings(project_id,workspace_id,frequency,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET frequency=excluded.frequency,updated_at=excluded.updated_at`).bind(candidate.id, candidate.workspace_id, fixed, stamp).run();
    candidate.frequency = fixed;
    if (!redo && await db().prepare(blockingSql(false)).bind(candidate.id, periodStart(day, fixed)).first()) return 'skip';
  }
  const roster: Roster = { brands, attributes, category: candidate.category ?? '' };
  const frequency = frequencyOf(candidate.frequency);
  const previous = await previousOrders(candidate.id, day);
  const { plan, reserved } = planQueries(engines, roster, previous, { day, language, location: candidate.location_code }, cap);
  const open = reserved > 0;
  const month = `${stamp.slice(0, 7)}-01T00:00:00.000Z`;
  const rounds = semanticBudgetCondition(candidate.workspace_id, month, open && !redo);
  const dollars = spendGuard(candidate.id, reserved);
  const database = db();
  const id = crypto.randomUUID();
  const period = periodStart(day, frequency);
  const statements = [
    database.prepare(`INSERT OR IGNORE INTO semantic_panel_rounds(id,workspace_id,project_id,day,frequency,period_start,config_revision,language_code,location_code,roster_json,status,created_at,completed_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived=0 AND daily_enabled=1)
      AND EXISTS(SELECT 1 FROM semantic_configurations c WHERE c.project_id=? AND c.workspace_id=? AND c.revision=?
        AND c.revision=(SELECT MAX(revision) FROM semantic_configurations WHERE project_id=c.project_id) AND json_extract(c.configuration_json,'$.enabled')=1)
      AND NOT EXISTS(${blockingSql(redo)})
      AND (${rounds.sql}) AND (${dollars.sql})`)
      .bind(id, candidate.workspace_id, candidate.id, day, frequency, redo ? `${period}${REDO_PERIOD}${id}` : period, candidate.revision, language, candidate.location_code, JSON.stringify(roster), open ? 'running' : 'done', stamp, open ? null : stamp,
        candidate.id, candidate.workspace_id, candidate.id, candidate.workspace_id, candidate.revision,
        candidate.id, period,
        ...rounds.params, ...dollars.params),
    ...plan.map((item) => insertQuery({ id, workspace_id: candidate.workspace_id, project_id: candidate.id }, item, stamp)),
  ];
  const [round] = await database.batch(statements);
  if (round.meta.changes) {
    if (open) await clearBlocked(candidate.id, 'semantic');
    return 'opened';
  }
  // Nothing opened: a round already exists for the period (in flight, for a redo), or a limit has no room (say which, once).
  if (open) {
    const existing = await database.prepare(blockingSql(redo)).bind(candidate.id, period).first();
    if (!existing) await recordRefusal(candidate.id, 'semantic', reserved, 'panel_rounds');
  }
  return 'retry';
}

/** The `day` of a round kept only as the spend ledger of a deleted history: before any real day, so it never blocks or stands for a period. */
export const RETIRED_DAY = '0000-01-01';

/**
 * Admin only (31/10/2026: the history may be deleted, the method and its base change): deletes a project's Semantic Branding history (readings, answers,
 * rounds) so the next tick asks again in the current period, today. Kept: the configuration (attribute revisions), the frequency and what was
 * spent this month, which every ceiling reads from `semantic_panel_queries`: those queries stay with their cost, reserve and dates, emptied of
 * the question, answer and sources, on their round retired to RETIRED_DAY (out of the period key and of every report). What was waiting is
 * cancelled (not paid); what was in flight becomes `unknown` at its reserve (it may have been billed) and is never sent or read again.
 */
export async function resetPanelHistory(projectId: string) {
  const database = db();
  await database.batch([
    ...retireStatements(projectId, null, now()),
    database.prepare('DELETE FROM system_state WHERE key IN (?,?)').bind(`semantic_panel_attempt:${projectId}`, `semantic_panel_skip:${projectId}`),
  ]);
}

/** A round's query has spent this month (what every ceiling sums): it stays as the ledger. Binds project, month start. */
const SPENT_ROUNDS = `SELECT round_id FROM semantic_panel_queries WHERE project_id=? AND COALESCE(started_at,requested_at)>=? AND MAX(cost_usd,reserved_usd)>0`;
/**
 * The deletion of resetPanelHistory, on every round of the project (`rounds` null) or on the rounds listed: their readings go, their queries
 * go unless their round spent this month (then they stay emptied, with cost, reserve and dates, on the round retired to RETIRED_DAY), what was
 * waiting is cancelled and what was in flight becomes `unknown` at its reserve.
 */
function retireStatements(projectId: string, rounds: string[] | null, stamp: string) {
  const database = db();
  const month = `${stamp.slice(0, 7)}-01T00:00:00.000Z`;
  const empty = JSON.stringify({ brands: [], attributes: [], category: '' });
  const of = (column: string) => (rounds ? ` AND ${column} IN (SELECT value FROM json_each(?))` : '');
  const list = rounds ? [JSON.stringify(rounds)] : [];
  return [
    database.prepare(`UPDATE semantic_panel_queries SET status='cancelled',reserved_usd=0,completed_at=?,error='Semantic Branding history was deleted.' WHERE project_id=? AND status='pending'${of('round_id')}`).bind(stamp, projectId, ...list),
    database.prepare(`UPDATE semantic_panel_queries SET status='unknown',completed_at=?,error='Semantic Branding history was deleted while this query was in flight; it is not sent or read again.'
      WHERE project_id=? AND status IN ('submitting','submitted')${of('round_id')}`).bind(stamp, projectId, ...list),
    database.prepare(`DELETE FROM semantic_panel_readings WHERE project_id=?${of('round_id')}`).bind(projectId, ...list),
    database.prepare(`DELETE FROM semantic_panel_queries WHERE project_id=?${of('round_id')} AND round_id NOT IN (${SPENT_ROUNDS})`).bind(projectId, ...list, projectId, month),
    database.prepare(`UPDATE semantic_panel_queries SET question='',response=NULL,sources_json='[]',input_json='{}',brand_order_json='[]' WHERE project_id=?${of('round_id')}`).bind(projectId, ...list),
    database.prepare(`DELETE FROM semantic_panel_rounds WHERE project_id=?${of('id')} AND id NOT IN (SELECT round_id FROM semantic_panel_queries WHERE project_id=?)`).bind(projectId, ...list, projectId),
    database.prepare(`UPDATE semantic_panel_rounds SET day=?,period_start=period_start||'~deleted~'||id,roster_json=?,status='done',completed_at=COALESCE(completed_at,?) WHERE project_id=? AND day<>?${of('id')}`)
      .bind(RETIRED_DAY, empty, stamp, projectId, RETIRED_DAY, ...list),
  ];
}

/**
 * The scale a settled query was recorded with (input_json `scale`): 2 is the anchored scale (9/11/2026, anchorReadings), 3 the scale led by
 * evidence (10/11/2026: every way of asking asks a fact, and a note without one is never above 59), 4 the comparative scale (13/11/2026: the
 * brands ranked per attribute before they are scored, consecutive ranks RANK_GAP apart, the owner's bands, the reader's quotes as evidence). With
 * it the AI's own score of every capped note (`raw`: [brand, attribute, score]) and the key of a reading of its prose (`readingKey`). No
 * migration: the column held the polling state, which a settled query no longer needs. A new scale is the method's id: `semantic-prune`
 * takes every round of an older one out (OLD_SCALE_ROUND), so a score never averages two methods.
 */
const SCALE = 4;
/** A query's scale (input_json `scale`, settledInput): 0 for one recorded before the anchored scale. */
const QUERY_SCALE = `COALESCE(CASE WHEN json_valid(q.input_json) THEN json_extract(q.input_json,'$.scale') END,0)`;
/**
 * The rounds recorded before the current scale (SCALE), by the data of each round `r` (never retired):
 *   - a round with any note whose query has another `scale` (old, or mixed: one score of a period never averages two scales, so the whole round goes);
 *   - a round with no note at all, none of whose queries settled with the current scale nor is in flight (its AIs all failed, or were cancelled, before).
 * A round whose notes are all on the current scale, or with no note but a query settled on it or still in flight, stays.
 */
const OLD_SCALE_ROUND = `r.day<>'${RETIRED_DAY}' AND (
  EXISTS(SELECT 1 FROM semantic_panel_readings n JOIN semantic_panel_queries q ON q.id=n.query_id WHERE n.round_id=r.id AND ${QUERY_SCALE}<>${SCALE})
  OR (NOT EXISTS(SELECT 1 FROM semantic_panel_readings n WHERE n.round_id=r.id)
    AND NOT EXISTS(SELECT 1 FROM semantic_panel_queries q WHERE q.round_id=r.id AND (${QUERY_SCALE}=${SCALE} OR q.status IN ${PANEL_IN_FLIGHT}))))`;

/**
 * Operations (9/11/2026: the anchored scale starts the history again): every Semantic Branding round of before the current scale
 * (OLD_SCALE_ROUND), or with `all` every round (10/11/2026: Semantic Branding zeroed when the algorithm changes), in every project or in
 * `projectId`, taken out the way resetPanelHistory takes a history out: its readings and queries deleted, a round that spent this month kept as
 * the spend ledger, emptied and retired (RETIRED_DAY: in no report, period or trend); a query in flight is not read again. Everything else
 * stays. `dryRun` (the default) only counts, per project and table. Idempotent: a second call finds nothing. A project left without a round of
 * its current period gets one at the scheduler's next tick, like any due project.
 */
export async function prunePanelRounds({ projectId = null, dryRun = true, all = false }: { projectId?: string | null; dryRun?: boolean; all?: boolean } = {}) {
  const database = db();
  const stamp = now();
  const month = `${stamp.slice(0, 7)}-01T00:00:00.000Z`;
  const { results } = await database.prepare(`SELECT r.project_id,json_group_array(r.id) ids FROM semantic_panel_rounds r
    WHERE (? IS NULL OR r.project_id=?) AND ${all ? `r.day<>'${RETIRED_DAY}'` : OLD_SCALE_ROUND} GROUP BY r.project_id ORDER BY r.project_id`)
    .bind(projectId, projectId).all<{ project_id: string; ids: string }>();
  const projects = [];
  for (const row of results) {
    const rounds = JSON.parse(row.ids) as string[];
    const list = JSON.stringify(rounds);
    // A query still waiting is cancelled (its reserve released) before the ledger is read, so it holds no round back.
    const ledger = `SELECT round_id FROM semantic_panel_queries WHERE project_id=? AND COALESCE(started_at,requested_at)>=? AND MAX(cost_usd,CASE WHEN status='pending' THEN 0 ELSE reserved_usd END)>0`;
    const counts = await database.prepare(`SELECT
        (SELECT COUNT(*) FROM semantic_panel_rounds WHERE id IN (SELECT value FROM json_each(?)) AND id IN (${ledger})) ledgerRounds,
        (SELECT COUNT(*) FROM semantic_panel_queries WHERE round_id IN (SELECT value FROM json_each(?))) queries,
        (SELECT COUNT(*) FROM semantic_panel_queries WHERE round_id IN (SELECT value FROM json_each(?)) AND round_id IN (${ledger})) ledgerQueries,
        (SELECT COUNT(*) FROM semantic_panel_readings WHERE round_id IN (SELECT value FROM json_each(?))) readings`)
      .bind(list, row.project_id, month, list, list, row.project_id, month, list)
      .first<{ ledgerRounds: number; queries: number; ledgerQueries: number; readings: number }>();
    const { ledgerRounds = 0, queries = 0, ledgerQueries = 0, readings = 0 } = counts ?? {};
    const result = {
      projectId: row.project_id,
      rounds: { deleted: rounds.length - ledgerRounds, retired: ledgerRounds },
      queries: { deleted: queries - ledgerQueries, emptied: ledgerQueries },
      readings: { deleted: readings },
    };
    if (!dryRun) await database.batch(retireStatements(row.project_id, rounds, stamp));
    console.info(JSON.stringify({ audit: 'semantic-prune', dryRun, all, ...result }));
    projects.push(result);
  }
  return { dryRun, all, projects };
}

/** A project with its latest Semantic Branding configuration and frequency, as a round reads it. */
const CANDIDATE_SQL = `SELECT p.id,p.workspace_id,p.name,p.domain,p.aliases_json,p.competitors_json,p.category,p.engines_json,p.language_code,p.location_code,c.revision,c.configuration_json,COALESCE(s.frequency,'${DEFAULT_PANEL_FREQUENCY}') frequency
    FROM projects p
    JOIN semantic_configurations c ON c.project_id=p.id AND c.workspace_id=p.workspace_id AND c.revision=(SELECT MAX(revision) FROM semantic_configurations WHERE project_id=p.id)
    LEFT JOIN semantic_panel_settings s ON s.project_id=p.id`;

/**
 * Operations (a backfill, run by the operator): one Semantic Branding round of a project now, spending at most `maxUsd` (reserved up front, at
 * most the round cap), then its queries sent and read (the same step a project runner takes). Without a round in the current period it opens
 * one as the scheduler would. With one, it adds to it the AIs the project asks now that do not give every brand a score there and were not
 * already tried by an earlier call (a query added after the round opened): an AI enabled since the round opened, Claude and Perplexity since
 * 8/11/2026, AI Overviews in its groups (its one search of before left most brands without a score). Idempotent: a second call adds nothing and only moves what is in flight (call it until `inFlight` is 0; the
 * scheduler also moves them). Within the project's budget and the account's ceilings, like any round.
 * `redo` (8/11/2026, the score rubric changed): a fresh round for the period even though it has one, every AI asked again. The old round
 * stays stored and the report shows the new one once it has readings. Refused while a round of the period has queries in flight, so a
 * repeated redo opens no third round; calls without `redo` then move the new round. It is not counted in, nor held by, the plan's rounds a month.
 */
export async function panelRoundNow(projectId: string, maxUsd: number, redo = false) {
  const cap = limit('SEMANTIC_PANEL_ROUND_CAP_USD', ROUND_CAP_USD);
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > cap) throw new Error(`maxUsd must be above 0 and at most the round cap (US$ ${cap}).`);
  if (setting('SEMANTIC_PANEL_ENABLED') === 'false' || !panelReachable()) throw new Error('Semantic Branding collection is switched off here.');
  const database = db();
  const stamp = now();
  const day = scheduleWindow(stamp).slice(0, 10);
  const candidate = await database.prepare(`${CANDIDATE_SQL} WHERE p.id=? AND p.archived=0 AND p.daily_enabled=1 AND json_extract(c.configuration_json,'$.enabled')=1`).bind(projectId).first<Candidate>();
  if (!candidate) throw new Error('The project is not collecting Semantic Branding (archived, monitoring paused or Semantic Branding off).');
  const frequency = frequencyOf(candidate.frequency);
  const current = () => database.prepare('SELECT id,workspace_id,project_id,day,created_at,roster_json,language_code,location_code FROM semantic_panel_rounds WHERE project_id=? AND day>=? ORDER BY day DESC,created_at DESC LIMIT 1')
    .bind(projectId, periodStart(day, frequency)).first<{ id: string; workspace_id: string; project_id: string; day: string; created_at: string; roster_json: string; language_code: string; location_code: number }>();
  let round = await current();
  let added: string[] = [];
  // What this call reserved for new queries; a failed AI's retry takes what is left of `maxUsd`.
  let addedReserve = 0;
  // A redo of a period without a round is a plain first round.
  const redoing = redo && !!round;
  if (redoing && await database.prepare(blockingSql(true)).bind(projectId, periodStart(day, frequency)).first())
    throw new Error('A round of this period still has queries in flight: call without redo until inFlight is 0, then redo.');
  if (!round || redoing) {
    const opened = await openRound(candidate, stamp, day, maxUsd, redoing);
    if (redoing && opened !== 'opened') throw new Error(opened === 'skip' ? 'The project has fewer AIs than the minimum to ask.' : 'The project budget or the account ceilings have no room for this round.');
    round = await current();
    addedReserve = maxUsd;
    if (opened === 'opened' && round) added = (await database.prepare("SELECT engine FROM semantic_panel_queries WHERE round_id=? AND status='pending'").bind(round.id).all<{ engine: Engine }>()).results.map((row) => row.engine);
  } else {
    const { engines } = projectEngines(candidate, (await accountCapabilities(candidate.workspace_id)).engines);
    const roster = JSON.parse(round.roster_json) as Roster;
    const [{ results: had }, { results: noted }] = await database.batch<Record<string, unknown>>([
      database.prepare('SELECT engine,method,model,web,run,status,requested_at FROM semantic_panel_queries WHERE round_id=?').bind(round.id),
      database.prepare(`SELECT n.engine,n.brand,COUNT(DISTINCT n.attribute) attributes FROM semantic_panel_readings n JOIN semantic_panel_queries q ON q.id=n.query_id
        WHERE n.round_id=? AND q.method='scrape' GROUP BY n.engine,n.brand`).bind(round.id),
    ]) as unknown as [{ results: { engine: Engine; method: string; model: string; web: number; run: number; status: string; requested_at: string }[] }, { results: { engine: Engine; brand: string; attributes: number }[] }];
    // An AI is done in the round when every brand of it has a score there (notes on enough of the attributes, as Score by AI reads them),
    // when it is in flight, or when an earlier call already tried it (a query added after the round opened): the rest is asked.
    const enough = Math.max(1, Math.ceil(roster.attributes.length * MIN_ATTRIBUTE_SHARE));
    const scored = (engine: Engine) => roster.brands.every((brand) => noted.some((row) => row.engine === engine && row.brand === brand.name && row.attributes >= enough));
    const settled = new Set([...had.filter((query) => ['pending', 'submitting', 'submitted'].includes(query.status) || (query.status !== 'cancelled' && query.requested_at > round!.created_at)).map((query) => query.engine), ...ENGINES.filter(scored)]);
    const missing = engines.filter((engine) => !settled.has(engine));
    const { plan, reserved } = planQueries(missing, roster, await previousOrders(projectId, day), { day: round.day, language: round.language_code, location: round.location_code }, maxUsd);
    // A query of the round with the same AI, model and run (the round's own AI Overviews query, say) keeps its row: the new one takes the
    // other run (only a label of the order), or is not asked.
    const key = (item: { engine: string; method: string; model: string; web: number; run: number }) => `${item.engine}|${item.method}|${item.model}|${item.web}|${item.run}`;
    const taken = new Set(had.map(key));
    const asked = plan.filter((item) => {
      if (item.status !== 'pending') return false;
      if (taken.has(key(item))) item.run = 1 - item.run;
      if (taken.has(key(item))) return false;
      taken.add(key(item));
      return true;
    });
    const dollars = spendGuard(projectId, asked.reduce((sum, item) => sum + item.reserve, 0));
    if (asked.length && await database.prepare(`SELECT 1 ok WHERE ${dollars.sql}`).bind(...dollars.params).first()) {
      await database.batch([
        ...asked.map((item) => insertQuery(round!, item, stamp, true)),
        database.prepare("UPDATE semantic_panel_rounds SET status='running',completed_at=NULL WHERE id=?").bind(round.id),
      ]);
      await clearBlocked(projectId, 'semantic');
      added = asked.map((item) => item.engine);
      addedReserve = asked.reduce((sum, item) => sum + item.reserve, 0);
    } else if (asked.length) await recordRefusal(projectId, 'semantic', reserved, 'panel_rounds');
    if (asked.length && !added.length) throw new Error('The project budget or the account ceilings have no room for this round.');
  }
  // A failed AI of the round is asked again here too, within what this call may still reserve.
  await retryFailed(projectId, maxUsd - addedReserve);
  const moved = await moveQueries(projectId);
  const queries = round ? (await database.prepare('SELECT engine,status,COUNT(*) n,ROUND(SUM(cost_usd),4) usd FROM semantic_panel_queries WHERE round_id=? GROUP BY engine,status ORDER BY engine,status').bind(round.id).all<{ engine: Engine; status: string; n: number; usd: number }>()).results : [];
  return { round: round?.day ?? null, added, moved, queries, inFlight: queries.filter((row) => ['pending', 'submitting', 'submitted'].includes(row.status)).reduce((sum, row) => sum + row.n, 0) };
}

/**
 * Opens the rounds that are due: projects with monitoring on and Semantic Branding enabled, without a round in the current period (or the
 * one project `projectId`, right after it is created: openFirstRound).
 */
async function enqueue(projectId?: string) {
  const database = db();
  const stamp = now();
  const day = scheduleWindow(stamp).slice(0, 10);
  const candidates = (await database.prepare(`${CANDIDATE_SQL}
    LEFT JOIN system_state a ON a.key='semantic_panel_attempt:'||p.id
    LEFT JOIN system_state k ON k.key='semantic_panel_skip:'||p.id
    WHERE p.archived=0 AND p.daily_enabled=1 AND json_extract(c.configuration_json,'$.enabled')=1
      AND NOT EXISTS(SELECT 1 FROM semantic_panel_rounds r WHERE r.project_id=p.id
        AND r.day>=CASE COALESCE(s.frequency,'${DEFAULT_PANEL_FREQUENCY}') WHEN 'daily' THEN ? WHEN 'monthly' THEN ? ELSE ? END)
      AND COALESCE(k.value,'')<>COALESCE(s.frequency,'${DEFAULT_PANEL_FREQUENCY}')||':'||c.revision||':'||CASE COALESCE(s.frequency,'${DEFAULT_PANEL_FREQUENCY}') WHEN 'daily' THEN ? WHEN 'monthly' THEN ? ELSE ? END${projectId ? ' AND p.id=?' : ''}
    ORDER BY COALESCE(a.value,''),p.id LIMIT ?`)
    .bind(periodStart(day, 'daily'), periodStart(day, 'monthly'), periodStart(day, 'weekly'),
      periodStart(day, 'daily'), periodStart(day, 'monthly'), periodStart(day, 'weekly'), ...(projectId ? [projectId] : []), ROUNDS_PER_TICK).all<Candidate>()).results;
  for (const candidate of candidates) {
    // A project that cannot open a round now (budget, cap) goes to the back of the line, so it does not hold the others up.
    await database.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(`semantic_panel_attempt:${candidate.id}`, stamp).run();
    try {
      if (await openRound(candidate, stamp, day) !== 'skip') continue;
      // Not eligible (Semantic Branding off, or fewer usable AIs than the minimum): not looked at again until the next period, or until the
      // configuration changes. ponytail: a plan change inside the period is seen at the next one.
      await database.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .bind(`semantic_panel_skip:${candidate.id}`, `${frequencyOf(candidate.frequency)}:${candidate.revision}:${periodStart(day, frequencyOf(candidate.frequency))}`).run();
    } catch { console.error('A Semantic Branding round could not be opened; it will retry on the next tick.'); }
  }
}

type Settlement = {
  status: 'completed' | 'absent' | 'failed' | 'unknown' | 'cancelled' | 'submitted';
  /** What the call cost, as far as it is known. */
  cost: number;
  /** What stays reserved: the reserve of a call whose outcome is unknown, otherwise what it cost. */
  reserved: number;
  error?: string | null;
  response?: string | null;
  sources?: unknown[];
  model?: string | null;
  readings?: PanelReading[];
  input?: Record<string, unknown>;
};
/**
 * The stored answers read again with the current reader (free: no provider call), so a note an older reader missed is kept. A note already
 * kept is never changed or removed (`INSERT OR IGNORE`); a failed answer that now has notes becomes completed. Idempotent: a second pass adds
 * nothing. Only the interfaces' answers (a pure model's no longer counts, 6/11/2026); the AI Overview is skipped (its notes come from a
 * paid reading of its text). One page of `limit` queries by id after `after`;
 * `next` is the cursor of the following page, null at the end. Run by the operator (/api/operations/project-storage, `semantic-reread`).
 */
export async function rereadPanelAnswers({ after = '', limit = 50, projectId = null }: { after?: string; limit?: number; projectId?: string | null } = {}) {
  const database = db();
  // The first page also takes out the zeros a reader of an answer in prose stored before 13/11/2026 (its "not covered", readerNotes): a query
  // read that way keeps its `readingKey`, and a 0 is never one of its notes. Free and idempotent.
  const cleared = after ? 0 : (await database.prepare(`DELETE FROM semantic_panel_readings WHERE score=0 AND (? IS NULL OR project_id=?)
    AND query_id IN (SELECT id FROM semantic_panel_queries WHERE (? IS NULL OR project_id=?) AND json_valid(input_json) AND json_extract(input_json,'$.readingKey') IS NOT NULL)`)
    .bind(projectId, projectId, projectId, projectId).run()).meta.changes ?? 0;
  const { results } = await database
    .prepare(`SELECT q.id,q.status,q.response,q.question,q.input_json,r.roster_json FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id
      WHERE q.id>? AND (? IS NULL OR q.project_id=?) AND q.status IN ('completed','failed') AND q.method='scrape' AND q.engine<>'google_ai_overviews' AND q.response IS NOT NULL ORDER BY q.id LIMIT ?`)
    .bind(after, projectId, projectId, limit)
    .all<{ id: string; status: string; response: string; question: string; input_json: string; roster_json: string }>();
  let notes = 0;
  let recovered = 0;
  for (const query of results) {
    const roster = JSON.parse(query.roster_json) as Roster;
    // An answer recorded with an anchored scale (`scale` 2 or more in its input) gets the current anchors; an older one keeps the reader's notes as they were.
    const parsed = parsePanelReply(query.response, roster.brands, roster.attributes);
    const readings = JSON.parse(query.input_json || '{}').scale >= 2 ? anchorReadings(parsed) : parsed;
    if (!readings.length) continue;
    const [inserted, completed] = await database.batch([
      database.prepare(`INSERT OR IGNORE INTO semantic_panel_readings(query_id,round_id,project_id,engine,brand,attribute,score,reason,evidence)
        SELECT q.id,q.round_id,q.project_id,q.engine,json_extract(x.value,'$.brand'),json_extract(x.value,'$.attribute'),json_extract(x.value,'$.score'),json_extract(x.value,'$.reason'),
          CASE WHEN json_array_length(x.value,'$.evidence')>0 THEN json_extract(x.value,'$.evidence') END
        FROM semantic_panel_queries q,json_each(?) x WHERE q.id=?`).bind(JSON.stringify(readings), query.id),
      database.prepare(`UPDATE semantic_panel_queries SET status='completed',error=NULL WHERE id=? AND status='failed'`).bind(query.id),
    ]);
    notes += inserted.meta.changes ?? 0;
    recovered += completed.meta.changes ?? 0;
  }
  return { scanned: results.length, notes, recovered, cleared, next: results.length === limit ? results.at(-1)!.id : null };
}

function settledInput(result: Settlement) {
  if (result.status === 'submitted') return result.input ?? {};
  const raw = (result.readings ?? []).filter((reading) => reading.raw !== undefined).map((reading) => [reading.brand, reading.attribute, reading.raw]);
  return { ...result.input, scale: SCALE, ...(raw.length ? { raw } : {}) };
}

/** Records the outcome of a query that is in flight, in one transaction with its readings. A query settled twice keeps its first outcome. */
async function settle(query: Pick<Query, 'id' | 'reserved_usd'>, from: 'submitting' | 'submitted', result: Settlement) {
  const database = db();
  const settled = result.status !== 'submitted';
  await database.batch([
    ...(result.readings?.length ? [database.prepare(`INSERT OR IGNORE INTO semantic_panel_readings(query_id,round_id,project_id,engine,brand,attribute,score,reason,evidence)
      SELECT q.id,q.round_id,q.project_id,q.engine,json_extract(x.value,'$.brand'),json_extract(x.value,'$.attribute'),json_extract(x.value,'$.score'),json_extract(x.value,'$.reason'),
        CASE WHEN json_array_length(x.value,'$.evidence')>0 THEN json_extract(x.value,'$.evidence') END
      FROM semantic_panel_queries q,json_each(?) x WHERE q.id=? AND q.status=?`).bind(JSON.stringify(result.readings), query.id, from)] : []),
    database.prepare(`UPDATE semantic_panel_queries SET status=?,reserved_usd=?,cost_usd=?,response=?,sources_json=?,error=?,input_json=?,completed_at=? WHERE id=? AND status=?`)
      .bind(result.status, result.reserved, result.cost, result.response ?? null, JSON.stringify(result.sources ?? []), result.error ?? null, JSON.stringify(settledInput(result)), settled ? now() : null, query.id, from),
  ]);
  // A real cost above the reserve is counted in full (above). The rest of its round goes on while what the round spent plus what it still
  // holds stays within the round cap; past it, nothing else of the round is sent.
  if (result.cost > query.reserved_usd) {
    console.error('A Semantic Branding query cost more than its reserve.', result.model ?? '', result.cost, query.reserved_usd);
    const round = '(SELECT round_id FROM semantic_panel_queries WHERE id=?)';
    await database.prepare(`UPDATE semantic_panel_queries SET status='cancelled',reserved_usd=0,completed_at=?,error='The round would pass its spend cap; the rest of it was not sent.'
      WHERE status='pending' AND round_id=${round}
      AND (SELECT SUM(CASE WHEN status IN ${PANEL_IN_FLIGHT} THEN MAX(cost_usd,reserved_usd) ELSE cost_usd END) FROM semantic_panel_queries WHERE round_id=${round})>?`)
      .bind(now(), query.id, query.id, limit('SEMANTIC_PANEL_ROUND_CAP_USD', ROUND_CAP_USD)).run();
  }
}

/**
 * The call of a query, rebuilt from its round: the brands in the order it asks them (a query from before 31/10/2026 has none: the roster's).
 * A pure model's query (until 6/11/2026) is not sent any more.
 */
function callOf(query: Query) {
  const roster = JSON.parse(query.roster_json) as Roster;
  const names = JSON.parse(query.brand_order_json || '[]') as string[];
  const order = names.length ? names.flatMap((name) => roster.brands.filter((brand) => brand.name === name)) : roster.brands;
  const request = panelRequest(order, roster.attributes, roster.category, query.language_code);
  // Claude and Perplexity are asked with the model stored on the query (the collection's when the round opened).
  const model = ENGINE_META[query.engine].family === 'responses' ? baseModel(query.model) : null;
  const call = query.method === 'scrape' ? panelCall(query.engine, request, { day: query.day, language: query.language_code, location: query.location_code, model }) : null;
  return { call, roster, request, order };
}

/** The decision model Admin chose to read an answer in prose, or null: the provider's readings (the default, and without the model key). */
const readerModel = () => {
  const model = overviewReaderModel();
  return decisionKeyConfigured() && model !== READING_MODEL ? model : null;
};
/**
 * One reading on the Decisions endpoint: the reply (its `usage.cost` is the cost). An error answer carries no decision and is not billed; a call
 * with no answer at all (a timeout, a reset connection) may have been: `unknown`.
 */
async function askReader(payload: unknown) {
  let response: Response;
  try { response = await postDecisions(payload); } catch (error) { throw Object.assign(new Error(String((error as Error)?.message ?? error).slice(0, 200)), { unknown: true }); }
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`The reader returned HTTP ${response.status}.`), { unknown: false, cost: 0 }); }
  return response.json().catch(() => null);
}

/** A finished task: its readings, or why there are none, settled with its cost. */
async function finish(query: Query, from: 'submitting' | 'submitted', { call, roster, request, order }: { call: PanelCall; roster: Roster; request: ReturnType<typeof panelRequest>; order: Brand[] }, task: Parameters<typeof readPanelTask>[0], submittedCost: number, send: Send) {
  let outcome = readPanelTask(task, call, roster.brands, roster.attributes);
  let cost = submittedCost;
  let key: string | null = null;
  // An AI may answer in prose (an AI Overview always does); LLM calls read its notes (their cost joins the query's, inside the reserve: as many
  // readings as it holds). They are paid, so they are claimed first (one worker wins) and only go out while the panel is on and the query
  // reserved for them; a claim without a settle is never repeated.
  if (outcome.status === 'unread') {
    const found = { answer: outcome.answer, sources: outcome.sources, model: outcome.model };
    const skip = (error: string) => settle(query, from, { status: 'failed', cost, reserved: cost, error, response: found.answer, sources: found.sources, model: found.model });
    // With the model key, ONE decision-model call on the model of Admin > Classifiers (no fallback: a failure leaves the answer unread, never
    // read twice); without the key, the provider's readings (at most what the query reserved).
    const reader = readerModel();
    const budget = Math.floor((query.reserved_usd - submittedCost + 1e-9) / READING_RESERVE_USD);
    const reserved = reader ? query.reserved_usd - submittedCost + 1e-9 >= OVERVIEW_READING_RESERVE_USD : budget >= 1;
    if (setting('SEMANTIC_PANEL_ENABLED') === 'false') return skip('Semantic Branding collection is switched off; the answer was not read.');
    const database = db();
    const active = await database.prepare(`SELECT ${ACTIVE_SQL} AS active FROM semantic_panel_queries WHERE id=?`).bind(query.id).first<{ active: number }>();
    if (!active?.active) return skip('Semantic Branding is no longer active; the answer was not read.');
    // The same text already read for this project, by the same reader and rules for the same brands: its notes again, free (readingKey). The
    // provider's reader is given the brands of the query (an AI Overviews group), the decision model the whole roster.
    key = await readingKey(outcome.answer, reader ? roster.brands : order, roster.attributes, request, reader);
    // A reader's 0 is its "not covered" (readerNotes): never copied, also from a reading stored before that rule.
    const { results: cached } = await database.prepare(`SELECT brand,attribute,score,reason,evidence FROM semantic_panel_readings WHERE score>0 AND query_id=(SELECT id FROM semantic_panel_queries
      WHERE project_id=? AND status='completed' AND json_extract(input_json,'$.readingKey')=? ORDER BY completed_at DESC LIMIT 1)`).bind(query.project_id, key)
      .all<{ brand: string; attribute: string; score: number; reason: string | null; evidence: string | null }>();
    if (cached.length) {
      const readings = cached.map((row) => ({ brand: row.brand, attribute: row.attribute, score: row.score, reason: row.reason, evidence: evidenceList(row.evidence) }));
      return settle(query, from, { cost, reserved: cost, status: 'completed', response: found.answer, sources: found.sources, model: found.model, readings, input: { readingKey: key, cached: true } });
    }
    if (!reserved) return skip('The query did not reserve the cost of reading the answer; it was not read.');
    const claimed = await database.prepare(`UPDATE semantic_panel_queries SET input_json=json_set(input_json,'$.readingClaimedAt',?,'$.nextPollAt',?)
      WHERE id=? AND status=? AND json_extract(input_json,'$.readingClaimedAt') IS NULL`).bind(now(), clock() + STALE_MS, query.id, from).run();
    if (!claimed.meta.changes) return;
    const read = reader
      ? await readOverviewOnce(outcome, roster.brands, roster.attributes, askReader, reader)
      : await readOverview(outcome, request, roster.brands, roster.attributes, send, budget);
    outcome = read.outcome;
    cost += read.cost;
  }
  const base = { cost, reserved: cost };
  // An AI asked to score (not a search read afterwards) that left a brand of its question without a score came back cut: its notes are kept
  // and it is asked again (retryFailed). A search's text may well not cover a brand; that is an answer, not a cut one.
  const incomplete = outcome.status === 'completed' && !SEARCHED_ENGINES.includes(query.engine)
    && unscoredBrands(outcome.readings, order.map((brand) => brand.name), roster.attributes.map((attribute) => attribute.id)).length > 0;
  if (outcome.status === 'completed') return settle(query, from, { ...base, status: 'completed', response: outcome.answer, sources: outcome.sources, model: outcome.model, readings: outcome.readings, ...(key || incomplete ? { input: { ...(key ? { readingKey: key } : {}), ...(incomplete ? { incomplete: true } : {}) } } : {}) });
  if (outcome.status === 'absent') return settle(query, from, { ...base, status: 'absent', error: outcome.reason });
  return settle(query, from, { ...base, status: 'failed', error: outcome.error, response: outcome.answer, sources: outcome.sources, model: outcome.model });
}

async function submit(query: Query, send: Send) {
  const database = db();
  const stamp = now();
  // Monitoring paused, Semantic Branding turned off or the project archived since the round opened: nothing more is asked or paid.
  await database.prepare(`UPDATE semantic_panel_queries SET status='cancelled',reserved_usd=0,completed_at=?,error='Semantic Branding is no longer active.'
    WHERE id=? AND status='pending' AND NOT ${ACTIVE_SQL}`).bind(stamp, query.id).run();
  // Its reserve already counts: the claim adds nothing, but stops once a limit was lowered below what is spent.
  const budget = spendGuard(query.project_id, 0);
  const claimed = await database.prepare(`UPDATE semantic_panel_queries SET status='submitting',started_at=? WHERE id=? AND status='pending' AND ${ACTIVE_SQL} AND ${budget.sql}`)
    .bind(stamp, query.id, ...budget.params).run();
  if (!claimed.meta.changes) return;
  const asked = callOf(query);
  const { call } = asked;
  if (!call) return settle(query, 'submitting', { status: 'cancelled', cost: 0, reserved: 0, error: query.method === 'scrape' ? 'The question does not fit this AI.' : 'Semantic Branding no longer asks the pure models.' });
  try {
    const [task] = await send(call.path, [call.payload]);
    // Claude and Perplexity answer on the Live endpoint (the collection's request, the whole answer in the reply): read it now. Its cost
    // includes what the model spent.
    if (call.live) {
      const cost = taskCost(task);
      if (task?.status_code !== 20000 || !firstResult(task)) return settle(query, 'submitting', { status: 'failed', cost, reserved: cost, error: `task ${task?.status_code} ${task?.status_message ?? ''}`.trim() });
      return await finish(query, 'submitting', { ...asked, call }, task, cost, send);
    }
    const cost = Number.isFinite(task?.cost) ? Number(task?.cost) : 0;
    if (task?.status_code !== 20100 || !task.id) return settle(query, 'submitting', { status: 'failed', cost, reserved: cost, error: `task ${task?.status_code} ${task?.status_message ?? ''}`.trim() });
    // Accepted: it is billed from here, so a failure to record the task id leaves the query `submitting`, and it ends `unknown`, never sent again.
    return settle(query, 'submitting', { status: 'submitted', cost, reserved: Math.max(cost, query.reserved_usd), input: { taskId: task.id, submittedCost: cost, nextPollAt: clock() + POLL_MS, startedAt: stamp } });
  } catch (error) {
    const ambiguous = error instanceof SendError ? error.ambiguous : true;
    await settle(query, 'submitting', {
      status: ambiguous ? 'unknown' : 'failed', cost: 0, reserved: ambiguous ? query.reserved_usd : 0,
      error: (ambiguous ? 'The provider did not confirm the request; it is not sent again. ' : '') + String((error as Error)?.message ?? error).slice(0, 300),
    });
  }
}

async function poll(query: Query, send: Send) {
  const input = JSON.parse(query.input_json) as { taskId?: string; submittedCost?: number; nextPollAt?: number; startedAt?: string; readingClaimedAt?: string };
  const submitted = input.submittedCost ?? query.cost_usd;
  if (!input.taskId) return settle(query, 'submitted', { status: 'unknown', cost: submitted, reserved: Math.max(submitted, query.reserved_usd), error: 'The task id was not recorded.' });
  // The paid readings of the answer were claimed and never settled (the Worker stopped after the provider may have billed them): never read
  // again, and their whole reserve stays counted.
  if (input.readingClaimedAt) {
    const cost = Math.max(submitted + READING_RESERVE_USD, query.reserved_usd);
    return settle(query, 'submitted', { status: 'unknown', cost, reserved: cost, error: 'The reading of the answer started and its outcome is unknown; it is not sent again.' });
  }
  const asked = callOf(query);
  const { call } = asked;
  if (!call) return settle(query, 'submitted', { status: 'failed', cost: submitted, reserved: submitted, error: 'The question does not fit this AI.' });
  const again = (patch: Partial<Settlement> = {}) => settle(query, 'submitted', { status: 'submitted', cost: submitted, reserved: Math.max(submitted, query.reserved_usd), input: { ...input, nextPollAt: clock() + POLL_MS }, ...patch });
  if (clock() - Date.parse(input.startedAt || query.started_at || query.requested_at) > EXPIRES_MS)
    return settle(query, 'submitted', { status: 'failed', cost: submitted, reserved: submitted, error: 'The provider did not finish the task in time.' });
  let task;
  try { [task] = await send(call.resultPath(input.taskId)); } catch (error) { console.error('Semantic Branding result read failed; it retries.', error instanceof Error ? error.message : String(error)); return again(); }
  if (!task) return again();
  if (providerTaskPending(Number(task.status_code))) return again();
  if (task.status_code !== 20000 && task.status_code !== NO_SEARCH_RESULTS) return settle(query, 'submitted', { status: 'failed', cost: submitted, reserved: submitted, error: `task ${task.status_code} ${task.status_message ?? ''}`.trim() });
  // Claude's Standard task: its US$ 0.01 advance is replaced by what the model spent (the collection's rule).
  return finish(query, 'submitted', { ...asked, call }, task, providerResultCost(query.engine, submitted, firstResult(task) ?? {}), send);
}

/**
 * Moves the queries along and opens the due rounds. Returns the number of queries it worked on (with `start`, the projects handed to it).
 * Switched off (`SEMANTIC_PANEL_ENABLED=false`) or without credentials it opens no round and sends nothing: what was waiting is cancelled and its
 * reserve released, stuck sends are settled, and (with credentials) tasks already posted are still read, because they were billed. A pure
 * model's query still waiting from before 6/11/2026 is cancelled when it comes up (callOf).
 * `start` (the scheduler in Cloud) hands the projects with queries to send or read to their runners and answers null without them, so the
 * queries move inline.
 */
export async function processSemanticPanels(start?: (projectIds: string[]) => Promise<number | null>) {
  const reachable = panelReachable();
  const collecting = setting('SEMANTIC_PANEL_ENABLED') !== 'false' && reachable;
  const database = db();
  if (collecting) {
    await enqueue();
    await retryFailed();
  }
  const stamp = now();
  await database.prepare(`UPDATE semantic_panel_queries SET status='unknown',completed_at=?,error='The outcome of the request is unknown; it is not sent again.'
    WHERE status='submitting' AND COALESCE(started_at,requested_at)<?`).bind(stamp, new Date(Date.parse(stamp) - STALE_MS).toISOString()).run();
  if (!collecting) await database.prepare(`UPDATE semantic_panel_queries SET status='cancelled',reserved_usd=0,completed_at=?,error='Semantic Branding collection is switched off.'
    WHERE status='pending'`).bind(stamp).run();
  if (start && reachable) {
    const projects = (await database.prepare(`SELECT DISTINCT project_id FROM semantic_panel_queries
      WHERE status='pending' OR (status='submitted' AND COALESCE(json_extract(input_json,'$.nextPollAt'),0)<=?)`).bind(clock()).all<{ project_id: string }>()).results;
    const started = projects.length ? await start(projects.map((row) => row.project_id)) : 0;
    if (started !== null) {
      await closeRounds();
      return started;
    }
  }
  return moveQueries();
}

/** One project's queries, in its runner (Cloud, lib/server/project-runners.ts): sent and read with its invocation's six lanes. */
export const semanticPanelStep = (projectId: string) => moveQueries(projectId);

/** How long the kick of a new project may send: inside the time a request's background work has. */
const KICK_MS = 20_000;
/**
 * A new project's first round, opened now (13/11/2026: it waited for the next tick, and the project read "no notes yet" meanwhile), under the
 * plan's rounds and the project's budget as any round; `sendFirstRound` then sends its first queries. Never throws.
 */
export async function openFirstRound(projectId: string) {
  try {
    if (setting('SEMANTIC_PANEL_ENABLED') !== 'false' && panelReachable()) await enqueue(projectId);
  } catch (error) { console.error('The first Semantic Branding round could not open now; the scheduler opens it.', error instanceof Error ? error.message : String(error)); }
}
/** The first queries of a round just opened, sent within the project's lease (never beside its runner), bounded by KICK_MS; the scheduler moves the rest. Never throws. */
export async function sendFirstRound(projectId: string) {
  try {
    if (setting('SEMANTIC_PANEL_ENABLED') === 'false' || !panelReachable()) return;
    await withLease(`panel:${projectId}`, KICK_MS + SEND_TIMEOUT_MS + 60_000, () => moveQueries(projectId, KICK_MS));
  } catch (error) { console.error('The first Semantic Branding queries could not leave now; the scheduler sends them.', error instanceof Error ? error.message : String(error)); }
}

/** How many times a round asks one AI (or AI Overviews group) whose answer failed: the first ask and up to two retries (8/11/2026). */
export const PANEL_ATTEMPTS = 3;
/** Failures a retry cannot change: the collection switched off, Semantic Branding off, a question that does not fit, a cap. */
const NOT_RETRIED = /switched off|no longer active|did not reserve|does not fit|spend cap|minimum/i;
/**
 * An ask that is asked again: a failure, and since 13/11/2026 an AI asked to score that left brands of its question out (`incomplete`,
 * finish). Its notes are kept: the next ask adds the ones it lacked, and both count as that AI's.
 */
const retryable = (query: Pick<Query, 'status' | 'input_json'>) => query.status === 'failed'
  || (query.status === 'completed' && (() => { try { return JSON.parse(query.input_json || '{}').incomplete === true; } catch { return false; } })());
/** A retry stores `#2`, `#3` after the model (one row per ask, unique per round); the model asked is the part before it. */
export const baseModel = (model: string) => model.replace(/#\d+$/, '');

/**
 * A failed ask is asked again (8/11/2026: Claude once answered a round with no score at all, and the AI stayed empty until the next day).
 * For every AI (and AI Overviews group) of a round asked in the last day whose every ask failed or left brands out (retryable), one more ask
 * while it has had fewer than PANEL_ATTEMPTS (cancelled ones count, so a project that stopped collecting is not asked again and again), never
 * for a failure a retry cannot change, within the project's budget, the round cap and `budget` (the operator's round now passes what its call
 * may still reserve). A lost reply (`unknown`) is never resent; an AI with no answer (`absent`) is not a failure. The retry goes out like
 * any pending query.
 */
async function retryFailed(projectId?: string, budget = Infinity) {
  const database = db();
  const stamp = now();
  const since = new Date(clock() - 24 * 60 * 60_000).toISOString();
  const scope = projectId ? ' AND project_id=?' : '';
  const { results: recent } = await database.prepare(`SELECT DISTINCT round_id FROM semantic_panel_queries WHERE method='scrape' AND requested_at>?${scope}
    AND (status='failed' OR (status='completed' AND json_valid(input_json) AND json_extract(input_json,'$.incomplete')=1)) LIMIT 50`)
    .bind(since, ...(projectId ? [projectId] : [])).all<{ round_id: string }>();
  if (!recent.length) return 0;
  const { results } = await database.prepare(`SELECT q.id,q.round_id,q.workspace_id,q.project_id,q.engine,q.method,q.model,q.web,q.run,q.brand_order_json,q.status,q.error,q.reserved_usd,q.cost_usd,q.input_json,q.requested_at,q.started_at,
      r.roster_json,r.language_code,r.location_code,r.day FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id
    WHERE q.round_id IN (SELECT value FROM json_each(?)) AND q.method='scrape' AND r.day>? ORDER BY q.requested_at,q.rowid`)
    .bind(JSON.stringify(recent.map((row) => row.round_id)), RETIRED_DAY).all<Query & { workspace_id: string; error: string | null }>();
  const groups = new Map<string, (Query & { workspace_id: string; error: string | null })[]>();
  for (const query of results) {
    const key = `${query.round_id}|${query.engine}|${baseModel(query.model)}`;
    groups.set(key, [...(groups.get(key) ?? []), query]);
  }
  const cap = limit('SEMANTIC_PANEL_ROUND_CAP_USD', ROUND_CAP_USD);
  let asked = 0;
  let held = 0;
  for (const asks of groups.values()) {
    const last = asks.at(-1)!;
    if (asks.length >= PANEL_ATTEMPTS || !retryable(last) || !asks.every((query) => query.status === 'cancelled' || retryable(query)) || NOT_RETRIED.test(last.error ?? '')) continue;
    const { call } = callOf(last);
    if (!call || held + call.reserve > budget) continue;
    const dollars = spendGuard(last.project_id, call.reserve);
    const model = `${baseModel(last.model)}#${asks.length + 1}`;
    const [inserted] = await database.batch([
      database.prepare(`INSERT OR IGNORE INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,input_json,sources_json,error,requested_at,completed_at,web,run,brand_order_json)
        SELECT ?,?,?,?,?,'scrape',?,?,'pending',?,0,'{}','[]',NULL,?,NULL,?,?,?
        WHERE (SELECT COALESCE(SUM(CASE WHEN status IN ${PANEL_IN_FLIGHT} THEN MAX(cost_usd,reserved_usd) ELSE cost_usd END),0) FROM semantic_panel_queries WHERE round_id=?)+?<=? AND (${dollars.sql})`)
        .bind(crypto.randomUUID(), last.round_id, last.workspace_id, last.project_id, last.engine, model, call.question, call.reserve, stamp, last.web, last.run, last.brand_order_json,
          last.round_id, call.reserve, cap, ...dollars.params),
      database.prepare(`UPDATE semantic_panel_rounds SET status='running',completed_at=NULL WHERE id=? AND EXISTS(SELECT 1 FROM semantic_panel_queries WHERE round_id=? AND status='pending')`).bind(last.round_id, last.round_id),
    ]);
    asked += inserted.meta.changes ?? 0;
    if (inserted.meta.changes) held += call.reserve;
  }
  return asked;
}

/** A round is done once none of its queries is in flight. */
const closeRounds = (projectId?: string) => db().prepare(`UPDATE semantic_panel_rounds SET status='done',completed_at=? WHERE status='running'${projectId ? ' AND project_id=?' : ''}
    AND NOT EXISTS(SELECT 1 FROM semantic_panel_queries WHERE round_id=semantic_panel_rounds.id AND status IN ${PANEL_IN_FLIGHT})`).bind(now(), ...(projectId ? [projectId] : [])).run();

async function moveQueries(projectId?: string, budgetMs = projectId ? RUNNER_SEND_BUDGET_MS : SEND_BUDGET_MS) {
  const credentials = panelCredentials();
  const database = db();
  const scope = projectId ? ' AND q.project_id=?' : '';
  const params = projectId ? [projectId] : [];
  const columns = `q.id,q.round_id,q.project_id,q.engine,q.method,q.model,q.web,q.run,q.brand_order_json,q.status,q.reserved_usd,q.cost_usd,q.input_json,q.requested_at,q.started_at,r.roster_json,r.language_code,r.location_code,r.day`;
  const [pending, submitted] = panelReachable(credentials) ? await Promise.all([
    database.prepare(`SELECT ${columns} FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id WHERE q.status='pending'${scope} ORDER BY q.requested_at,q.rowid LIMIT ${PENDING_READ}`).bind(...params).all<Query>(),
    database.prepare(`SELECT ${columns} FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id WHERE q.status='submitted' AND COALESCE(json_extract(q.input_json,'$.nextPollAt'),0)<=?${scope} ORDER BY q.requested_at,q.id LIMIT ${POLLS_PER_TICK}`).bind(clock(), ...params).all<Query>(),
  ]) : [{ results: [] as Query[] }, { results: [] as Query[] }];
  const send = dataForSeo(credentials.login!, credentials.password!, SEND_TIMEOUT_MS);
  // Every query takes a lane of its own: never more than the invocation's six connections in flight, so no paid send waits
  // in Cloudflare's queue while its timeout runs. First the polls (free reads) and one query of each round, alone, then the rest of
  // the rounds, the oldest first: a query that costs more than its reserve still cancels what of its round was not sent.
  const deadline = Date.now() + budgetMs;
  let sent = 0;
  const work = async (query: Query) => {
    if (query.status === 'submitted') return void (await poll(query, send));
    if (Date.now() >= deadline) return false;
    await submit(query, send);
    sent++;
  };
  const leads = new Map<string, Query>();
  for (const query of pending.results) if (!leads.has(query.round_id)) leads.set(query.round_id, query);
  await inPool<Query>([...submitted.results, ...leads.values()], OUTBOUND_CONNECTIONS, work);
  await inPool<Query>(pending.results.filter((query) => leads.get(query.round_id) !== query), OUTBOUND_CONNECTIONS, work);
  await closeRounds(projectId);
  return sent + submitted.results.length;
}
