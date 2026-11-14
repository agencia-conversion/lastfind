// Comparison's reads and writes (lib/comparison.ts; the collection is ./comparison-worker.ts): the configuration (products, attribute
// library, personas) one revision per save, the report (win rate and mean place per brand, attribute, product and persona, in the header's
// period and AIs), and the wizard's suggestions (one paid chat call, a `brand_research_jobs` row like the attribute wizard's).
import { COMPARISON_ENGINES, COMPARISON_METHOD, comparisonIssues, comparisonMetrics, comparisonReady, comparisonSuggestionRequest, parseComparisonSuggestions, readComparisonConfig, type ComparisonReading, type ComparisonRoster, type ComparisonRun } from '@/lib/comparison';
import { homeText, projectBrands } from '@/lib/semantic-attributes';
import { openRouterReserve } from '@/lib/semantic-panel-provider';
import { WIZARD_MODEL } from '@/lib/new-project-ai';
import { countryName } from '@/lib/countries';
import type { Engine } from '@/lib/engines';
import { waitUntil } from 'cloudflare:workers';
import { db, now } from './env';
import { ApiError } from './http';
import { ownedProject } from './workspace';
import { accountCapabilities } from './capabilities';
import { parseReportFilter } from './report-filter';
import { readHome } from './favicon';
import { postChat } from './decisions-api';
import { claimDecisionJob, completeDecisionJob, failDecisionJob, hash, markStaleUnknown, requestDecisions } from './decision-jobs';
import { classifierModels } from './classifier-models';
import { modelKeyConfigured } from './model-routes';
import { READ_WINDOW_MS, cadenceOf, comparisonCollecting, comparisonEngines, configurationOf, configurationStatement, kickComparison } from './comparison-worker';

/** What the screens need besides the data: the configuration, the plan's bound, the AIs asked and left out, and the cadence. */
export async function comparisonSettings(projectId: string, workspaceId: string) {
  const [project, capabilities, row] = await Promise.all([ownedProject(projectId, workspaceId), accountCapabilities(workspaceId), configurationStatement(projectId).first<{ revision: number; configuration_json: string }>()]);
  const { revision, config } = configurationOf(row);
  const { engines, left } = comparisonEngines(project as { engines_json?: unknown; language_code: string; location_code: number }, capabilities.engines);
  return {
    revision,
    config,
    productLimit: capabilities.comparisonProducts ?? null,
    engines,
    left,
    cadence: cadenceOf(project.interval_hours),
    collecting: comparisonCollecting(),
    competitors: projectBrands(project).slice(1),
    brand: { name: String(project.name), domain: String(project.domain ?? '') },
  };
}

/** Saves a revision when it follows the rules (comparisonIssues) and nobody saved in between (`expectedRevision`). */
export async function saveComparison(projectId: string, workspaceId: string, value: unknown, expectedRevision: unknown) {
  const [project, capabilities] = await Promise.all([ownedProject(projectId, workspaceId), accountCapabilities(workspaceId)]);
  if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new ApiError(400, 'Invalid revision.');
  const config = readComparisonConfig(value);
  const [issue] = comparisonIssues(config, { productLimit: capabilities.comparisonProducts ?? null, brand: String(project.name) });
  if (issue) throw new ApiError(400, issue);
  const result = await db().prepare(`INSERT INTO comparison_configurations(project_id,workspace_id,revision,configuration_json,created_at)
    SELECT p.id,p.workspace_id,?,?,? FROM projects p WHERE p.id=? AND p.workspace_id=? AND p.archived=0
      AND (SELECT COALESCE(MAX(revision),0) FROM comparison_configurations WHERE project_id=p.id)=?`)
    .bind(expectedRevision + 1, JSON.stringify(config), now(), projectId, workspaceId, expectedRevision).run();
  if (!result.meta.changes) throw new ApiError(409, 'Comparison settings changed. Reload before saving.');
  // The first answers of a new product or persona do not wait for the next tick.
  waitUntil(kickComparison(projectId, true));
  return comparisonSettings(projectId, workspaceId);
}

/**
 * The rows a report or its answers read: the project's scored answers (COMPARISON_METHOD) in the AIs asked of the header's, and when
 * filtered, one product, one persona, or the answers that asked one attribute (its page).
 */
function scopeOf(projectId: string, q: URLSearchParams, engine: string) {
  const engines = engine.split(',').filter((item): item is Engine => COMPARISON_ENGINES.includes(item as Engine));
  const [product, persona, attribute] = ['product', 'persona', 'attribute'].map((name) => q.get(name) || '');
  if ([product, persona, attribute].some((value) => value.length > 80)) throw new ApiError(400, 'Invalid filter.');
  return {
    attribute,
    scope: `project_id=? AND method=? AND engine IN (SELECT value FROM json_each(?))${product ? ' AND product_id=?' : ''}${persona ? ' AND persona_id=?' : ''}${attribute ? " AND EXISTS (SELECT 1 FROM json_each(roster_json,'$.attributes') a WHERE json_extract(a.value,'$.id')=?)" : ''}`,
    binds: [projectId, COMPARISON_METHOD, JSON.stringify(engines), ...[product, persona, attribute].filter(Boolean)],
  };
}

type RunRow = { product_id: string; persona_id: string; engine: Engine; day: string; roster_json: string; reading_json: string };

/**
 * The report: the read answers of the header's period (the scored ones, COMPARISON_METHOD; a discarded reading is counted, never a figure) (and of the comparison period, for the change) in the AIs asked, by product,
 * persona or attribute when filtered (an attribute: each answer read on it alone). Names are today's (a renamed product keeps its answers); an attribute or product no longer configured keeps the
 * name it was asked with. `status`: `unconfigured` (nothing to ask yet), `waiting` (configured, nothing read in the period: `inFlight`
 * says whether answers are on their way) or `ready`. `capped` (the counted scores capped at 59 for want of a fact) is a Lastfind admin's
 * only (`admin`), null for everyone else.
 */
export async function comparisonReport(projectId: string, workspaceId: string, q: URLSearchParams, admin = false) {
  const settings = await comparisonSettings(projectId, workspaceId);
  const filter = parseReportFilter(q);
  const { scope, binds, attribute } = scopeOf(projectId, q, filter.engine);
  const database = db();
  const read = (from: string, to: string) => database.prepare(`SELECT product_id,persona_id,engine,day,roster_json,reading_json FROM comparison_runs
    WHERE ${scope} AND status='completed' AND reading_json IS NOT NULL AND requested_at>=? AND requested_at<? ORDER BY requested_at LIMIT 20000`).bind(...binds, from, to);
  const [{ results: current }, { results: previous }, flight] = await database.batch<Record<string, unknown>>([
    read(filter.cutoff, filter.end),
    read(filter.previousCutoff, filter.previousEnd),
    database.prepare(`SELECT COUNT(*) n FROM comparison_runs WHERE ${scope} AND requested_at>? AND (status IN ('pending','submitting','submitted') OR (status='completed' AND reading_json IS NULL AND COALESCE(json_extract(input_json,'$.readAttempts'),0)<3))`)
      .bind(...binds, new Date(Date.parse(now()) - READ_WINDOW_MS).toISOString()),
  ]) as unknown as [{ results: RunRow[] }, { results: RunRow[] }, { results: { n: number }[] }];
  const names = { products: new Map<string, string>(), personas: new Map<string, string>(), attributes: new Map<string, string>() };
  const runsOf = (rows: RunRow[]): ComparisonRun[] => rows.map((row) => {
    const roster = JSON.parse(row.roster_json) as ComparisonRoster;
    if (!names.products.has(row.product_id)) names.products.set(row.product_id, roster.product.name);
    if (!names.personas.has(row.persona_id)) names.personas.set(row.persona_id, roster.persona.name);
    for (const attribute of roster.attributes) if (!names.attributes.has(attribute.id)) names.attributes.set(attribute.id, attribute.name);
    const reading = JSON.parse(row.reading_json) as ComparisonReading;
    const run = { product: row.product_id, persona: row.persona_id, engine: row.engine, day: row.day, options: roster.options.map((option) => option.name), attributes: roster.attributes.map((attribute) => attribute.id), reading };
    // An attribute's page: each answer read on that attribute alone, so every figure (the overall, the wins, the evolution) is that attribute's.
    return attribute ? { ...run, attributes: [attribute], reading: { ...reading, scores: reading.scores[attribute] ? { [attribute]: reading.scores[attribute] } : {} } } : run;
  });
  const own = settings.brand.name;
  const metrics = comparisonMetrics(runsOf(current), own);
  const before = comparisonMetrics(runsOf(previous), own);
  // Today's names win over the names asked.
  for (const item of settings.config.products) names.products.set(item.id, item.name);
  for (const item of settings.config.personas) names.personas.set(item.id, item.name);
  for (const item of settings.config.attributes) names.attributes.set(item.id, item.name);
  const ready = comparisonReady(settings.config);
  // Answers on their way are moved along by the read too (a preview has no scheduler); the project's lease keeps it to one at a time.
  if (Number(flight.results[0]?.n ?? 0) > 0) waitUntil(kickComparison(projectId));
  return {
    // An answer read counts even when discarded: the report says so, instead of waiting for answers that already came.
    status: metrics.answers || metrics.discarded.total ? 'ready' : ready ? 'waiting' : 'unconfigured',
    inFlight: Number(flight.results[0]?.n ?? 0),
    engines: settings.engines,
    left: settings.left,
    cadence: settings.cadence,
    collecting: settings.collecting,
    brand: own,
    answers: metrics.answers,
    discarded: metrics.discarded,
    capped: admin ? metrics.capped : null,
    ties: metrics.ties,
    undecided: metrics.undecided,
    own: metrics.own,
    previous: before.answers ? { answers: before.answers, own: before.own } : null,
    days: metrics.days,
    brands: metrics.brands,
    attributes: metrics.attributes.map((row) => ({ ...row, name: names.attributes.get(row.id) ?? row.id })),
    products: metrics.products.map((row) => ({ ...row, name: names.products.get(row.id) ?? row.id })),
    personas: metrics.personas.map((row) => ({ ...row, name: names.personas.get(row.id) ?? row.id })),
    filters: {
      products: settings.config.products.map((item) => ({ id: item.id, name: item.name })),
      personas: settings.config.personas.map((item) => ({ id: item.id, name: item.name })),
    },
  };
}
export type ComparisonReport = Awaited<ReturnType<typeof comparisonReport>>;

/**
 * The answers behind the report (the newest 25 of the period, in its AIs, by product, persona or attribute when filtered): what each AI was asked,
 * what it answered (the first 6,000 characters, third-party text) and how it was read: each option's score and fact per attribute, or why
 * the reading was discarded; null while unread. No cost and no provider's message.
 */
export async function comparisonAnswers(projectId: string, workspaceId: string, q: URLSearchParams) {
  await ownedProject(projectId, workspaceId);
  const filter = parseReportFilter(q);
  const { scope, binds } = scopeOf(projectId, q, filter.engine);
  const { results } = await db().prepare(`SELECT id,engine,day,product_id,persona_id,question,substr(response,1,6000) answer,reading_json,roster_json FROM comparison_runs
    WHERE ${scope} AND status='completed' AND requested_at>=? AND requested_at<? ORDER BY requested_at DESC LIMIT 25`)
    .bind(...binds, filter.cutoff, filter.end)
    .all<{ id: string; engine: Engine; day: string; product_id: string; persona_id: string; question: string; answer: string | null; reading_json: string | null; roster_json: string }>();
  return {
    answers: results.map((row) => {
      const roster = JSON.parse(row.roster_json) as ComparisonRoster;
      return {
        id: row.id, engine: row.engine, day: row.day, product: roster.product.name, persona: roster.persona.name, options: roster.options, attributes: roster.attributes,
        question: row.question, answer: row.answer, reading: row.reading_json ? (JSON.parse(row.reading_json) as ComparisonReading) : null,
      };
    }),
  };
}

export type ComparisonAnswers = Awaited<ReturnType<typeof comparisonAnswers>>;

/** The wizard's ledger key: under the attribute suggestions' plan count and a project's monthly ceiling of its own. */
export const COMPARISON_SETUP_CONTEXT = 'comparison-setup:v1';
const SETUP_MONTHLY_MAX_USD = 3;
const CALL_TIMEOUT_MS = 90_000;

/**
 * The wizard's suggestions for a project (nothing is saved): products with their attributes and personas, from the site's home page
 * (read free on the guarded path). 503 without the model key; 429 when a limit is reached; 502 when the model gives nothing usable.
 */
export async function suggestComparison(projectId: string, workspaceId: string) {
  if (!modelKeyConfigured()) throw new ApiError(503, 'AI suggestions need the model key: an admin adds it in Admin > Providers. You can still add products, attributes and personas by hand.');
  const [project, capabilities] = await Promise.all([ownedProject(projectId, workspaceId), accountCapabilities(workspaceId)]);
  const brands = projectBrands(project);
  const language = String(project.language_code ?? 'en');
  const html = await readHome(String(project.domain ?? '')).catch(() => null);
  const request = (model: string) => comparisonSuggestionRequest(model, {
    brand: String(project.name), domain: String(project.domain ?? ''), home: html ? homeText(html, 3500) : null, language,
    country: countryName(Number(project.location_code), language.startsWith('pt') ? 'pt-BR' : 'en'), competitors: brands.slice(1).map((brand) => brand.name),
    products: Math.min(5, capabilities.comparisonProducts ?? 5),
  });
  const { model, fallback } = classifierModels('project_wizard', WIZARD_MODEL);
  const reserve = openRouterReserve(request(model), false);
  await markStaleUnknown(COMPARISON_SETUP_CONTEXT, reserve);
  const jobId = await claimDecisionJob({
    projectId, workspaceId, contextKey: COMPARISON_SETUP_CONTEXT, provider: 'comparison-setup', model,
    inputKey: await hash(`${COMPARISON_SETUP_CONTEXT}:${model}:${crypto.randomUUID()}`), reserveUsd: reserve, inputJson: '{}', retryAfterMs: 0,
    cap: {
      sql: '(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs WHERE project_id=? AND context_key=? AND requested_at>=?)+?<=?',
      params: [projectId, COMPARISON_SETUP_CONTEXT, `${now().slice(0, 7)}-01T00:00:00.000Z`, reserve, SETUP_MONTHLY_MAX_USD],
    },
  });
  if (!jobId) throw new ApiError(429, 'The limit for AI suggestions was reached this month. You can still add products, attributes and personas by hand.');
  try {
    const result = await requestDecisions(model, fallback, {
      label: 'Comparison setup',
      post: (payload, timeoutMs) => postChat(payload, timeoutMs, 'project_wizard'),
      timeoutMs: CALL_TIMEOUT_MS,
      payload: request,
      parse: (raw) => {
        const response = (raw ?? {}) as { choices?: { message?: { content?: unknown } }[]; usage?: { cost?: unknown } };
        const spent = response.usage?.cost;
        const suggestions = parseComparisonSuggestions(String(response.choices?.[0]?.message?.content ?? ''), brands.map((brand) => brand.name));
        if (!suggestions.products.length && !suggestions.personas.length) throw new Error('The answer has no usable suggestions.');
        return { ...suggestions, cost: typeof spent === 'number' && Number.isFinite(spent) && spent >= 0 ? spent : null };
      },
    });
    await completeDecisionJob(jobId, result, JSON.stringify({ products: result.products.length, personas: result.personas.length }), reserve, now()).run();
    return { products: result.products, attributes: result.attributes, personas: result.personas };
  } catch (error) {
    await failDecisionJob(jobId, error, reserve, 'Comparison setup');
    throw new ApiError(502, "We couldn't generate suggestions right now. Try again, or add them by hand.");
  }
}
