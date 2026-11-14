// Reads of the Semantic Branding panel (see semantic-panel-worker.ts for how it is collected) and its frequency setting.
// The report is the score of each brand per period of the project's frequency, computed from the readings of the latest round of each
// period (lib/semantic-perception.ts); the evidence is what each AI answered behind a score. Both come from the tables the collection
// writes (semantic_panel_*), in the control database: a round is a few dozen compact rows, not an analytical volume.
// Only the interfaces' notes count (6/11/2026): a pure model's notes, stored until then, count in no score of any period, so the evolution
// compares the same method throughout; its answers stay readable in the justifications of their period, marked as no longer counted.
import { ENGINES, SCRAPED_ENGINES, type Engine } from '@/lib/engines';
import { DEFAULT_PANEL_FREQUENCY, PANEL_FREQUENCIES, PANEL_MIN_ENGINES, SEARCHED_ENGINES, evidenceList, isFact, isQuote, parsePanelReply, periodStart, readableQuestion, unlabeled, type PanelFrequency } from '@/lib/semantic-panel';
import type { Attribute, Brand } from '@/lib/semantic-panel-provider';
import { MIN_UNITS, SMOOTHING, assistantScore, compare, orderEffect, plainAnswer, scoreBrand, smoothedReadings, smoothedScore, trend, type PerceptionReading } from '@/lib/semantic-perception';
import type { SemanticAggregate } from '@/lib/semantic-report';
import { scheduleWindow } from '@/lib/scheduling';
import { db, now, setting } from './env';
import { ApiError } from './http';
import { accountCapabilities } from './capabilities';
import { recentBlocksStatement, type BlockReason, type BlockRow } from './spend-guards';
import { ownedProject } from './workspace';
import { parseReportFilter } from './report-filter';
import { configurationOf, configurationStatement } from './semantic';
import { foundProject, ownedProjectStatement } from './project-reads';
import { RETIRED_DAY, panelReachable, projectEngines } from './semantic-panel-worker';

type Roster = { brands: Brand[]; attributes: Attribute[]; category: string };
type RoundRow = { id: string; day: string; created_at: string; status: string; roster_json: string; readings: number };
type QueryRow = {
  id: string; round_id: string; engine: Engine; method: 'llm' | 'scrape'; model: string; question: string; status: string; cost_usd: number;
  response: string | null; sources_json: string; error: string | null; web: number; run: number; brand_order_json: string;
};
type ReadingRow = { query_id: string; round_id: string; engine: Engine; method: 'llm' | 'scrape'; model: string; web: number; brand: string; attribute: string; score: number; reason: string | null; evidence: string | null };

const ROUNDS_SCANNED = 400;
const DEFAULT_PERIODS = 12;
const MAX_PERIODS = 52;
/** Answers per page of the evidence: every answer of a round, also of the rounds before 6/11/2026 that asked up to 20, so the justification reads them all at once. */
const PAGE = 24;

const frequencyStatement = (projectId: string) => db().prepare('SELECT frequency FROM semantic_panel_settings WHERE project_id=?').bind(projectId);
const frequencyOf = (row: { frequency?: unknown } | null | undefined): PanelFrequency =>
  PANEL_FREQUENCIES.includes(row?.frequency as PanelFrequency) ? (row!.frequency as PanelFrequency) : DEFAULT_PANEL_FREQUENCY;
export async function panelFrequency(projectId: string): Promise<PanelFrequency> {
  return frequencyOf(await frequencyStatement(projectId).first<{ frequency: string }>());
}

/** Whether this installation collects (the worker needs the search data provider's credentials and is not switched off). */
const collecting = () => setting('SEMANTIC_PANEL_ENABLED') !== 'false' && panelReachable();

/** What the settings screen needs: the frequency, whether the plan fixes it (for example monthly only) and whether this installation collects. */
export async function panelSettings(projectId: string, workspaceId: string) {
  const [, frequency, capabilities] = await Promise.all([ownedProject(projectId, workspaceId), panelFrequency(projectId), accountCapabilities(workspaceId)]);
  return { frequency: capabilities.panelFrequency ?? frequency, fixed: !!capabilities.panelFrequency, collecting: collecting() };
}

/** Only the owner of the project changes how often it is collected (and how its periods are drawn), unless the plan fixes it. */
export async function savePanelFrequency(projectId: string, workspaceId: string, value: unknown) {
  await ownedProject(projectId, workspaceId);
  if (!PANEL_FREQUENCIES.includes(value as PanelFrequency)) throw new ApiError(400, 'Invalid frequency.');
  const fixed = (await accountCapabilities(workspaceId)).panelFrequency;
  if (fixed && value !== fixed) throw new ApiError(403, 'Your plan sets how often Semantic Branding is collected.');
  const result = await db().prepare(`INSERT INTO semantic_panel_settings(project_id,workspace_id,frequency,updated_at)
    SELECT p.id,p.workspace_id,?,? FROM projects p WHERE p.id=? AND p.workspace_id=? AND p.archived=0
    ON CONFLICT(project_id) DO UPDATE SET frequency=excluded.frequency,updated_at=excluded.updated_at`).bind(value, now(), projectId, workspaceId).run();
  if (!result.meta.changes) throw new ApiError(404, 'Projeto não encontrado.');
  return { frequency: value as PanelFrequency };
}

/** The days of the page's date range (the same `days` or `start`/`end` the other screens take), or null without them. */
function dayRange(q: URLSearchParams) {
  if (!['days', 'start', 'end'].some((key) => q.has(key))) return null;
  const { cutoff, end } = parseReportFilter(q);
  return { from: cutoff.slice(0, 10), to: new Date(Date.parse(end) - 1).toISOString().slice(0, 10) };
}

/**
 * The round that stands for each period: the most recent one with readings (a round whose AIs all failed gives way to an earlier one of the
 * same period). Days are bucketed by the CURRENT frequency, so changing it redraws the periods of the history without touching it.
 * With a date range, only the rounds collected inside it count: a week cut by the range stands for the latest round inside, never one after it.
 * A round retired by a deleted history (RETIRED_DAY, only the spend it holds) is never read. Only an interface's notes count as readings.
 */
const roundsStatement = (projectId: string) =>
  db().prepare(`SELECT r.id,r.day,r.created_at,r.status,r.roster_json,
      (SELECT COUNT(*) FROM semantic_panel_readings n JOIN semantic_panel_queries q ON q.id=n.query_id WHERE n.round_id=r.id AND q.method='scrape') readings
    FROM semantic_panel_rounds r WHERE r.project_id=? AND r.day>'${RETIRED_DAY}' ORDER BY r.day DESC,r.created_at DESC,r.id DESC LIMIT ${ROUNDS_SCANNED}`).bind(projectId);
function periodRounds(rounds: RoundRow[], frequency: PanelFrequency, range: { from: string; to: string } | null = null) {
  const represent = (list: RoundRow[]) => {
    const byPeriod = new Map<string, RoundRow>();
    for (const round of list) {
      const period = periodStart(round.day, frequency);
      if (round.readings > 0 && !byPeriod.has(period)) byPeriod.set(period, round);
    }
    return byPeriod;
  };
  const whole = represent(rounds);
  const inside = range ? represent(rounds.filter((round) => round.day >= range.from && round.day <= range.to)) : whole;
  return { all: [...whole.keys()].sort(), whole, periods: [...inside.keys()].sort(), byPeriod: inside, latest: rounds[0] ?? null };
}

function count(q: URLSearchParams, key: string, fallback: number, max: number) {
  const raw = q.get(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new ApiError(400, 'Invalid semantic filter.');
  return value;
}
function chosenPeriod(q: URLSearchParams, periods: string[]) {
  const period = q.get('period');
  if (period === null || period === '') return periods.at(-1) ?? null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period) || !periods.includes(period)) throw new ApiError(400, 'Invalid semantic filter.');
  return period;
}

const readingsStatement = (roundIds: string[]) => db().prepare(`SELECT n.query_id,n.round_id,n.engine,q.method,q.model,q.web,n.brand,n.attribute,n.score,n.reason,n.evidence
  FROM semantic_panel_readings n JOIN semantic_panel_queries q ON q.id=n.query_id
  WHERE n.round_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(roundIds));
const queriesStatement = (roundIds: string[]) => db().prepare(`SELECT id,round_id,engine,method,model,question,status,cost_usd,response,sources_json,error,web,run,brand_order_json
  FROM semantic_panel_queries WHERE round_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(roundIds));
/** In the order of the AIs, then the interface first (a pure model's answer of before 6/11/2026 after it), then run 0 before run 1. */
const inEngineOrder = (queries: QueryRow[]) => queries.sort((a, b) => ENGINES.indexOf(a.engine) - ENGINES.indexOf(b.engine) || Number(b.method === 'scrape') - Number(a.method === 'scrape') || b.web - a.web || a.run - b.run);
/** How a query or reading was asked: AI, method, model and web search (one per AI since 6/11/2026; a pure model's before, Admin's diagnostics). */
/** A retry (`#2`, `#3` after the model) is the same cell as its first ask. */
const cellOf = (row: { engine: Engine; method: string; model: string; web: number }) => `${row.engine}:${row.method}:${row.model.replace(/#\d+$/, '')}:${row.web ? 1 : 0}`;
/** Whether a note or answer counts in the score: an interface's (6/11/2026). */
const counts = (row: { method: string }) => row.method === 'scrape';
const queriesOf = async (roundId: string) => inEngineOrder((await queriesStatement([roundId]).all<QueryRow>()).results);
/**
 * The project, its Semantic Branding configuration, frequency and rounds in one D1 round trip (each costs ~150-250 ms in
 * production), then the readings and answers of the round shown in a second. Before: seven calls in five trips (the report), five (the evidence).
 */
async function panelReads(projectId: string, workspaceId: string) {
  const [project, configuration, frequency, rounds, blocks] = await db().batch<Record<string, unknown>>([
    ownedProjectStatement(projectId, workspaceId), configurationStatement(projectId, workspaceId), frequencyStatement(projectId), roundsStatement(projectId),
    recentBlocksStatement(projectId),
  ]);
  return {
    project: foundProject(project.results[0]),
    configuration: configurationOf(configuration.results[0] as Parameters<typeof configurationOf>[0]),
    frequency: frequencyOf(frequency.results[0]),
    rounds: rounds.results as unknown as RoundRow[],
    blocks: blocks.results as unknown as BlockRow[],
  };
}
async function roundReads(roundIds: string[], queryRoundIds: string[]) {
  const [readings, queries] = await db().batch<Record<string, unknown>>([readingsStatement([...new Set(roundIds)]), queriesStatement([...new Set(queryRoundIds)])]);
  return { readings: readings.results as unknown as ReadingRow[], queries: inEngineOrder(queries.results as unknown as QueryRow[]) };
}

const nameKey = (name: string) => name.trim().toLowerCase();
const jsonList = (value: unknown): unknown[] => {
  try { const list = JSON.parse(String(value || '[]')); return Array.isArray(list) ? list : []; } catch { return []; }
};
/**
 * Every brand the project lists today, its own first, then its competitors (all of them on every radar, heatmap and table; one added
 * after the round shows without notes, never a zero), and `current`: the name today of a name a round asked about (the brand's name or one of
 * its variations, so a renamed brand keeps its notes), or undefined for a brand the project no longer lists.
 */
function listedBrands(project: Record<string, unknown>) {
  const targets = [
    { name: String(project.name), domain: String(project.domain ?? ''), aliases: jsonList(project.aliases_json) },
    ...jsonList(project.competitors_json).flatMap((item) => {
      const brand = item as { name?: unknown; domain?: unknown; aliases?: unknown };
      return typeof brand?.name === 'string' && brand.name.trim() ? [{ name: brand.name, domain: String(brand.domain ?? ''), aliases: Array.isArray(brand.aliases) ? brand.aliases : [] }] : [];
    }),
  ];
  const names = new Map<string, string>();
  for (const target of targets) if (!names.has(nameKey(target.name))) names.set(nameKey(target.name), target.name);
  for (const target of targets) for (const alias of target.aliases) if (typeof alias === 'string' && !names.has(nameKey(alias))) names.set(nameKey(alias), target.name);
  return { brands: targets.map(({ name, domain }) => ({ name, domain })), current: (name: string) => names.get(nameKey(name)) };
}

/**
 * The header's AI filter on Semantic Branding (31/10/2026): `engine`, a comma list of AIs (none: all). Topics and tags do not apply here:
 * the AIs are asked about the brand itself. Until 6/11/2026 a `web` mode chose the answers with or without web search; every answer
 * counted now is an interface's, which searches, so it is gone (an old link's `web` is ignored).
 */
function aiFilter(q: URLSearchParams) {
  const engines = (q.get('engine') || '').split(',').filter(Boolean);
  if (engines.some((engine) => !ENGINES.includes(engine as Engine))) throw new ApiError(400, 'Invalid semantic filter.');
  // Only the AIs collected today: one switched off (Claude, Perplexity, 8/11/2026) never shows, though its notes stay stored.
  const collected = (engines as Engine[]).filter((engine) => SCRAPED_ENGINES.includes(engine));
  const chosen = new Set(collected);
  // No AI asked is every collected one; a list of only switched-off AIs keeps nothing.
  return { engines: collected, keeps: (row: { engine: Engine }) => SCRAPED_ENGINES.includes(row.engine) && (!engines.length || chosen.has(row.engine)) };
}
/**
 * The AIs of a round, one entry each (an AI is asked in several modes and orders): its best status, its notes, its model and why it gave none.
 * The provider's own message is operational: only Admin reads it (`panelDiagnostics`, `admin`); the report gives the reason in words.
 */
function byEngine(queries: QueryRow[], noted: Map<string, number>, admin = false) {
  return [...new Set(queries.map((query) => query.engine))].map((engine) => {
    const own = queries.filter((query) => query.engine === engine);
    const readings = own.reduce((sum, query) => sum + (noted.get(query.id) ?? 0), 0);
    const shown = own.find((query) => query.status === 'completed' && noted.get(query.id)) ?? own.find((query) => query.status === 'completed') ?? own.find((query) => query.status !== 'cancelled') ?? own[0]!;
    // An answer in prose (an AI Overview) whose reading found no note for these brands and attributes: it answered, but rated none of them.
    const unread = shown.status === 'failed' && !!shown.response && / has no notes for these attributes\./.test(shown.error ?? '');
    return { engine, method: shown.method, model: shown.model.replace(/#\d+$/, ''), status: shown.status, readings, error: admin ? shown.error : null, ...(unread ? { unread } : {}) };
  });
}

/** The AIs Semantic Branding asks for a project, and those it monitors that are left out, with why (the screen explains them). */
const engineSetup = (project: Record<string, unknown>, allowed: readonly Engine[]) =>
  projectEngines({ engines_json: project.engines_json, language_code: String(project.language_code), location_code: Number(project.location_code) }, allowed);

export type PanelBlock = { reason: BlockReason };
/** How long a round usually takes to give its first notes, from the moment it opens. */
const FIRST_NOTES_MS = 30 * 60_000;

/** Why a project with Semantic Branding on has nothing to show yet, in the order the reader can act on it. */
async function waitingFor(project: Record<string, unknown>, latest: RoundRow | null, allowed: readonly Engine[], blocked: PanelBlock | null) {
  const { engines, left } = engineSetup(project, allowed);
  const base = { engines, left, minEngines: PANEL_MIN_ENGINES, firstQueryDay: scheduleWindow(now()).slice(0, 10) };
  if (!collecting()) return { ...base, reason: 'not-collecting' as const, round: null };
  // The AIs the project monitors with an interface this installation scrapes: none means no round is ever opened.
  if (engines.length < PANEL_MIN_ENGINES) return { ...base, reason: 'few-engines' as const, round: null };
  // A limit refused the first round: it waits for that limit, never for the scheduler.
  if (!latest && blocked) return { ...base, reason: 'blocked' as const, round: null };
  // When the first notes usually arrive: a round opens at the next scheduler tick (a new project's, at once) and its AIs answer within
  // about half an hour. A recommendation for the screen, not a promise; past it, they are due any moment.
  const expected = (from: string) => new Date(Math.max(Date.parse(from) + FIRST_NOTES_MS, Date.now())).toISOString();
  if (!latest) return { ...base, reason: 'scheduled' as const, round: null, expectedBy: expected(now()) };
  const queries = (await queriesOf(latest.id)).filter((query) => SCRAPED_ENGINES.includes(query.engine));
  return {
    ...base,
    ...(latest.status === 'running' ? { expectedBy: expected(latest.created_at) } : {}),
    reason: latest.status === 'running' ? 'running' as const : 'no-notes' as const,
    round: { day: latest.day, status: latest.status, queries: byEngine(queries, new Map()).map(({ engine, status }) => ({ engine, status })) },
  };
}

/**
 * The report of a project: score per brand and period, with margin, confidence and change, the evolution, the AIs behind the period and why
 * some gave no notes, and the sources they cited. The periods are those inside the page's date range (`days`, or `start` and `end`; all of them
 * without it) and the period shown is the latest of them. `period` (the first day of a period) selects another one; `periods` is how many of
 * the latest periods to compute (12 by default, 52 at most).
 */
export async function panelReport(projectId: string, workspaceId: string, q: URLSearchParams) {
  const [{ project, configuration, frequency, rounds, blocks }, { engines: allowed }] = await Promise.all([panelReads(projectId, workspaceId), accountCapabilities(workspaceId)]);
  // The latest round a spending limit refused (spend-guards records it, a round that opens clears it): which limit.
  const block = blocks.find((item) => item.module === 'semantic');
  const blocked: PanelBlock | null = block ? { reason: block.reason } : null;
  const wanted = count(q, 'periods', DEFAULT_PERIODS, MAX_PERIODS);
  // 8/11/2026: only the AIs active in the project and allowed by its plan, in every period (an AI turned off since, or outside the
  // plan, no longer shows, nor counts in a score).
  const setup = engineSetup(project, allowed);
  const headerFilter = aiFilter(q);
  const filter = { ...headerFilter, keeps: (row: { engine: Engine }) => setup.active.includes(row.engine) && headerFilter.keeps(row) };
  const { all, whole, periods, byPeriod, latest } = periodRounds(rounds, frequency, dayRange(q));
  const period = chosenPeriod(q, periods);
  const round = period ? byPeriod.get(period)! : null;
  // One AI is enough for a score; the margin needs two or more, whatever the header's AI filter.
  const minUnits = MIN_UNITS;
  const base = { frequency, minUnits, filter: { engines: filter.engines }, ownBrand: String(project.name), configuration, collecting: collecting(), blocked };
  if (!round || !period) {
    const empty = { periods: [], period: null, round: null, answered: [], queries: 0, scores: [], trend: [], byAssistant: null, association: null, sources: [], waiting: null, added: [], left: [] };
    if (!configuration.enabled) return { ...base, ...empty, status: 'disabled' as const };
    // There is a history, but nothing was collected in the range the page asks for: it says so, and when the latest period was.
    if (all.length) return { ...base, ...empty, status: 'outside' as const, latestPeriod: all.at(-1)! };
    return { ...base, ...empty, status: 'waiting' as const, waiting: await waitingFor(project, latest, allowed, blocked) };
  }
  const roster = JSON.parse(round.roster_json) as Roster;
  const { brands, current } = listedBrands(project);
  const attributeIds = roster.attributes.map((attribute) => attribute.id);
  // One period before the first shown is read as well (even outside the range), to say whether the first score rose or fell, and the
  // periods before that the smoothing window of the first one reaches (SMOOTHING).
  const upto = all.filter((item) => item <= period).slice(-(wanted + SMOOTHING[frequency].window));
  const shown = periods.filter((item) => item <= period).slice(-wanted);
  const before = all[all.indexOf(period) - 1] ?? null;
  // The periods inside the range stand for their rounds inside it; the earlier ones, read only for the change, for their whole history.
  const roundOf = new Map(upto.map((item) => [item, byPeriod.get(item) ?? whole.get(item)!]));
  const periodOf = new Map([...roundOf].map(([item, row]) => [row.id, item]));
  const reads = await roundReads([...periodOf.keys()], [round.id]);
  // Each interface note under the brand's name today (a renamed brand keeps its notes); a brand dropped since the round is not shown.
  const rows = reads.readings.filter((row) => counts(row) && filter.keeps(row)).flatMap((row) => {
    const brand = current(row.brand);
    return brand ? [{ ...row, brand }] : [];
  });
  // The sampling unit is the AI: its runs (both orders) average into one value first.
  const readings: PerceptionReading[] = rows.map((row) => ({ day: periodOf.get(row.round_id)!, unit: row.engine, brand: row.brand, attribute: row.attribute, score: row.score }));
  // The shown scores are smoothed over the round history (smoothedScore); `daily` is the period's own score, as its notes alone give it.
  const history = { periods: [...roundOf.keys()].sort(), frequency };
  const scores = brands.map((brand) => {
    const current = smoothedScore(readings, attributeIds, brand.name, period, history.periods, frequency, minUnits);
    const previous = before ? smoothedScore(readings, attributeIds, brand.name, before, history.periods, frequency, minUnits) : scoreBrand([], attributeIds, brand.name, minUnits);
    const daily = scoreBrand(readings.filter((item) => item.day === period), attributeIds, brand.name, minUnits).score;
    return { ...brand, ...current, daily, change: compare(current, previous), previousScore: previous.score };
  });
  // The round's interface queries (a pure model's, before 6/11/2026, counts in no score).
  const queries = reads.queries.filter((query) => counts(query) && filter.keeps(query));
  // The header's AI filter hides every AI this collection asked (the screen says so, and offers to clear it); without the filter it would show some.
  const filtered = !queries.length && reads.queries.some((query) => counts(query) && setup.active.includes(query.engine) && SCRAPED_ENGINES.includes(query.engine));
  const roundRows = rows.filter((row) => row.round_id === round.id);
  const noted = new Map<string, number>();
  for (const row of roundRows) noted.set(row.query_id, (noted.get(row.query_id) ?? 0) + 1);
  const answered = [...new Set(roundRows.map((row) => row.engine))].sort((a, b) => ENGINES.indexOf(a) - ENGINES.indexOf(b));
  const cited = new Map<string, { domain: string; url: string; title: string; answers: number; engines: Engine[] }>();
  for (const query of queries) {
    if (query.status !== 'completed') continue;
    for (const source of JSON.parse(query.sources_json) as { url: string; domain: string; title: string }[]) {
      const entry = cited.get(source.domain) ?? { domain: source.domain, url: source.url, title: source.title, answers: 0, engines: [] };
      entry.answers++;
      if (!entry.engines.includes(query.engine)) entry.engines.push(query.engine);
      cited.set(source.domain, entry);
    }
  }
  // "Score by AI": one column per AI the round asked, or Semantic Branding asks now (that one says why it has no notes: `cancelled`).
  const expected = setup.engines.filter((engine) => filter.keeps({ engine }));
  const columns = ENGINES.flatMap((engine) => {
    const own = queries.filter((query) => query.engine === engine);
    if (!own.length && !expected.includes(engine)) return [];
    const inEngine = roundRows.filter((row) => row.engine === engine);
    // Smoothed like the overall score: a brand this AI gave no note in the period has none here (a gap), else its window of notes.
    const steadied = smoothedReadings(readings.filter((item) => item.unit === engine), history.periods, period, frequency);
    const [summary] = own.length ? byEngine(own, noted) : [{ status: 'cancelled', error: null }];
    return [{ engine, status: summary!.status, error: summary!.error, ...('unread' in summary! && summary.unread ? { unread: true } : {}), readings: inEngine.length,
      scores: brands.map((brand) => (inEngine.some((row) => row.brand === brand.name) ? assistantScore(steadied, attributeIds, brand.name) : null)) }];
  });
  // P2 (6/11/2026): a brand listed today that the latest round with notes did not ask (added since) enters the next collection; the
  // screen says so instead of "no evidence". A brand renamed since keeps its notes (its variations name it).
  const asked = new Set((JSON.parse(rounds.find((row) => row.readings > 0)?.roster_json ?? '{"brands":[]}') as Roster).brands.map((brand) => current(brand.name)));
  const added = brands.filter((brand) => !asked.has(brand.name)).map((brand) => brand.name);
  // The aggregate the existing Semantic Branding blocks (summary, radar, heatmap...) draw from, over the period shown.
  const association: SemanticAggregate = {
    ownBrand: String(project.name),
    brands,
    cells: scores.flatMap((score) => score.attributes.map((cell) => ({
      brand: score.name, attribute: cell.attribute, score: cell.reliable ? cell.score : null, samples: cell.units,
      observedScore: cell.score, observedSamples: cell.units, observations: cell.samples, insufficient: 0, ambiguous: 0,
    }))),
    prompts: answered.length,
    engines: answered,
    date: round.day,
  };
  return {
    ...base,
    // Turned off after it collected: the old rounds stay in the body, but the project is no longer in Semantic Branding.
    status: configuration.enabled ? 'ready' : 'disabled',
    attributes: roster.attributes,
    periods: shown,
    period,
    round: {
      id: round.id, day: round.day, status: round.status, costUsd: Number(reads.queries.reduce((sum, query) => sum + query.cost_usd, 0).toFixed(6)),
      // Every AI of the round and why it gave no notes: its status and the provider's own message or reason. An AI with no notes is absent, never a zero.
      queries: byEngine(queries, noted),
      filtered,
    },
    answered,
    queries: new Set(queries.filter((query) => query.status === 'completed').map((query) => query.engine)).size,
    scores,
    trend: trend(readings, attributeIds, brands.map((brand) => brand.name), shown, minUnits, history),
    byAssistant: { brands: brands.map((brand) => brand.name), columns },
    association,
    sources: [...cited.values()].sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain)),
    added,
    // The AIs the project monitors that Semantic Branding leaves out, with why.
    left: setup.left,
  };
}

const DIAGNOSED_PROJECTS = 100;
/**
 * Admin: the operational side of each project's latest Semantic Branding round, which the product screen no longer shows. The cells
 * that gave no notes with the provider's own message, and how much a brand's place in the list moved its notes (orderEffect, over the
 * latest two rounds: since 3/11/2026 a round asks each cell once and the next one reverses the order). Every project of the installation,
 * latest round first, in two D1 round trips.
 */
export async function panelDiagnostics() {
  const { results: latest } = await db().prepare(`SELECT r.id,r.project_id,r.day,r.status,p.name project,a.email owner
    FROM semantic_panel_rounds r JOIN projects p ON p.id=r.project_id LEFT JOIN workspaces w ON w.id=r.workspace_id LEFT JOIN accounts a ON a.id=w.owner_id
    WHERE r.day>'${RETIRED_DAY}' AND r.id IN (SELECT x.id FROM semantic_panel_rounds x WHERE x.project_id=r.project_id AND x.day>'${RETIRED_DAY}' ORDER BY x.day DESC,x.created_at DESC,x.id DESC LIMIT 2)
    ORDER BY r.day DESC,r.created_at DESC,r.project_id LIMIT ${DIAGNOSED_PROJECTS * 2}`).all<{ id: string; project_id: string; day: string; status: string; project: string; owner: string | null }>();
  if (!latest.length) return { rounds: [] };
  const rounds = latest.filter((round, at) => latest.findIndex((other) => other.project_id === round.project_id) === at);
  const ids = JSON.stringify(latest.map((round) => round.id));
  const [queryRows, readingRows] = await db().batch<Record<string, unknown>>([
    db().prepare(`SELECT id,round_id,engine,method,model,status,error,web,run,brand_order_json FROM semantic_panel_queries WHERE round_id IN (SELECT value FROM json_each(?))`).bind(ids),
    db().prepare(`SELECT n.query_id,n.round_id,n.engine,q.web,n.brand,n.attribute,n.score FROM semantic_panel_readings n JOIN semantic_panel_queries q ON q.id=n.query_id
      WHERE n.round_id IN (SELECT value FROM json_each(?))`).bind(ids),
  ]);
  const queries = inEngineOrder(queryRows.results as unknown as QueryRow[]);
  const readings = readingRows.results as unknown as ReadingRow[];
  return {
    rounds: rounds.map((round) => {
      const own = queries.filter((query) => query.round_id === round.id);
      const notes = readings.filter((row) => row.round_id === round.id);
      const noted = new Map<string, number>();
      for (const row of notes) noted.set(row.query_id, (noted.get(row.query_id) ?? 0) + 1);
      const cells = [...new Set(own.map(cellOf))];
      const failures = cells.flatMap((cell) => {
        const asked = own.filter((query) => cellOf(query) === cell);
        if (asked.some((query) => noted.get(query.id))) return [];
        const [summary] = byEngine(asked, noted, true);
        return [{ engine: summary!.engine, web: asked[0]!.web ? 1 : 0, method: asked[0]!.method, model: asked[0]!.model, status: summary!.status, error: summary!.error }];
      });
      const paired = latest.filter((item) => item.project_id === round.project_id).map((item) => item.id);
      const effect = orderEffect(readings.filter((row) => paired.includes(row.round_id)).flatMap((row) => {
        const query = queries.find((item) => item.id === row.query_id);
        const position = query ? (JSON.parse(query.brand_order_json || '[]') as string[]).indexOf(row.brand) : -1;
        return query && position >= 0 ? [{ pair: `${cellOf(query)}|${row.brand}|${row.attribute}`, run: query.run, position, score: row.score }] : [];
      }));
      return { projectId: round.project_id, project: round.project, owner: round.owner, day: round.day, status: round.status, failures, orderEffect: effect };
    }),
  };
}

/** A note's reason or evidence as plain text: some models leave <cite> tags and ([site](url)) citations in it. */
const tidy = (value: string | null) => {
  // A reading stored before its reader label was dropped at parse time loses it here too (unlabeled).
  const text = value && unlabeled(plainAnswer(value.replace(/<\/?[a-z][^>]*>/gi, '')).replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim());
  return text || null;
};

/** What the AI answered as readable text: every brand and attribute with its note, reason and evidence, cleaned like the excerpts. */
function answerText(raw: string, brands: Brand[], attributes: Attribute[]) {
  const readings = parsePanelReply(raw, brands, attributes, 1000);
  if (!readings.length) return tidy(raw)?.slice(0, 6000) ?? '';
  const name = (id: string) => attributes.find((attribute) => attribute.id === id)?.name ?? id;
  return brands.map((brand) => {
    const own = readings.filter((item) => item.brand === brand.name);
    return own.length ? [brand.name, ...own.map((item) => {
      const reason = tidy(item.reason);
      const evidence = item.evidence.map(tidy).filter(Boolean).map((fact) => `“${fact}”`).join(' ');
      return `  ${name(item.attribute)}: ${item.score}${reason ? ` — ${reason}` : ''}${evidence ? ` ${evidence}` : ''}`;
    })].join('\n') : '';
  }).filter(Boolean).join('\n\n');
}

/**
 * The answers behind a score: for each AI that gave notes in the round of the period, the question as a person reads it, the method and model,
 * its notes for the brand (all attributes, or the one in `attribute`) with reason and evidence, the sources it cited and its whole answer cleaned.
 * A pure model's answer (before 6/11/2026) stays readable here, interfaces first; the screen marks it as no longer counted in the score.
 */
export async function panelEvidence(projectId: string, workspaceId: string, q: URLSearchParams) {
  const { project, frequency, rounds } = await panelReads(projectId, workspaceId);
  const { current } = listedBrands(project);
  const { periods, byPeriod } = periodRounds(rounds, frequency, dayRange(q));
  const period = chosenPeriod(q, periods);
  const round = period ? byPeriod.get(period)! : null;
  const roster = round ? JSON.parse(round.roster_json) as Roster : null;
  const brand = q.get('brand') || '';
  const attribute = q.get('attribute') || '';
  const filter = aiFilter(q);
  if (!brand || current(brand) !== brand) throw new ApiError(400, 'Choose a brand.');
  if (attribute.length > 80) throw new ApiError(400, 'Invalid semantic filter.');
  const offset = Number(q.get('cursor') || 0);
  if (!Number.isInteger(offset) || offset < 0) throw new ApiError(400, 'Invalid semantic cursor.');
  if (!round || !roster) return { period, evidence: [], nextCursor: null };
  const reads = await roundReads([round.id], [round.id]);
  // Only facts are shown as evidence (isFact), also in a round recorded before the rule: a restated note or generic praise is none. The
  // evidence of a note read from an answer in prose (a searched AI) is the reader's quote of it (isQuote).
  const domain = roster.brands.find((item) => current(item.name) === brand)?.domain ?? '';
  const own = (attribute: string) => [brand, domain, roster.attributes.find((item) => item.id === attribute)?.name ?? ''];
  const rows = reads.readings.filter((row) => current(row.brand) === brand && (!attribute || row.attribute === attribute) && filter.keeps(row));
  const items = reads.queries.filter((query) => query.status === 'completed' && filter.keeps(query)).flatMap((query) => {
    const keeps = (fact: string, attribute: string) => (SEARCHED_ENGINES.includes(query.engine) ? isQuote(fact) : isFact(fact, own(attribute)));
    const notes = rows.filter((row) => row.query_id === query.id).map((row) => ({ attribute: row.attribute, score: row.score, reason: tidy(row.reason), evidence: evidenceList(row.evidence).map(tidy).filter((fact): fact is string => !!fact && keeps(fact, row.attribute)) }));
    return notes.length ? [{
      id: query.id, engine: query.engine, method: query.method, model: query.model.replace(/#\d+$/, ''), question: readableQuestion(query.question), date: round.day,
      readings: notes, answer: answerText(query.response ?? '', roster.brands, roster.attributes), sources: JSON.parse(query.sources_json) as { url: string; domain: string; title: string }[],
    }] : [];
  });
  return { period, evidence: items.slice(offset, offset + PAGE), nextCursor: offset + PAGE < items.length ? String(offset + PAGE) : null };
}
