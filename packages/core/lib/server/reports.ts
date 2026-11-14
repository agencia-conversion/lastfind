import { COMPETITOR_ONLY_PAGE } from '@/lib/report-types';
import { MAX_COMPETITORS } from '@/lib/brand-decisions';
import { sourceKey } from './source-sql';
import { semanticSourcePeriods, semanticSourceRowsFrom, semanticSourceStatement, type SemanticRow, type SemanticSourceRow } from './semantic-source-rows';
import { COLLECTED_ENGINES_SQL, ENGINES, ENGINE_LABELS, isEngine } from '@/lib/engines';
import { isSourceOwner } from '@/lib/source-types';
import type { Engine, Citation } from '@/lib/types';
import type {
  Metrics,
  SummaryReport,
  AnalysisReport,
  AnalysisRow,
  HistoryPage,
  PromptReport,
  PromptDetail,
  CompetitorsReport,
  SourceRow,
  SourcesPage,
  SourceDetail,
  SourceEntityDetail,
  FanoutReport,
  FanoutDetail,
  OpportunitiesReport,
  ProductsReport,
  ProductDetailReport,
} from '@/lib/report-types';
import { buildFanout, normalizeQuery } from '@/lib/fanout';
import { buildOpportunities } from '@/lib/fanout-intents';
import { PRODUCT_ENGINES, buildProductDetail, buildProducts, httpsUrl, type ProductCardRow } from '@/lib/products';
import type { ProjectIntents } from './fanout-intents';
import { projectReadDatabase } from './project-store-read';
import { ApiError } from './http';
import { parseReportFilter, reportTopics } from './report-filter';
export { parseReportFilter };
import { foundProject, ownedProjectStatement, projectStoreStatement } from './project-reads';
import type { StoreRegistry } from './project-store';
import { db } from './env';
import {
  ANSWER_ANALYSED_SQL,
  ANSWER_DISCOVERIES_SQL,
  VOICE_BRANDS_SQL,
  voiceSql,
  DISCOVERY_COUNTED_SQL,
  DISCOVERY_GROUP_SQL,
  countedDiscoveriesSql,
  EFFECTIVE_MENTIONS_SQL,
  EFFECTIVE_POSITIONS_BASIS_SQL,
  EFFECTIVE_TARGETS_SQL,
  RUN_SUMMARY_COLUMNS,
  runSummary,
} from './run-rows';
import { seriesColorVar } from '@/lib/chart-series';
import { brandKey } from '@/lib/brand-decisions';
import { readTopicWeights, topicFactors, type TopicWeights } from '@/lib/topic-weights';
import { coveredPeriods } from '@/lib/period-coverage';

const complete = `r.status='complete' AND r.response_available=1`;
const primaryName = `json_extract(${EFFECTIVE_TARGETS_SQL},'$[0].name')`;
const primaryMention = `EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_MENTIONS_SQL}) m WHERE m.value=1 AND m.key=${primaryName})`;

function canonicalTargetSql(target: string) {
  const aliases = `(SELECT COALESCE(json_group_array(value),'[]') FROM (
    SELECT DISTINCT value FROM json_each(
      CASE WHEN json_type(${target},'$.aliases')='array'
      THEN json_extract(${target},'$.aliases') ELSE '[]' END
    ) WHERE type='text' AND value!=json_extract(${target},'$.name') ORDER BY value
  ))`;
  const domains = `(SELECT COALESCE(json_group_array(value),'[]') FROM (
    SELECT value FROM json_each(
      CASE WHEN json_type(${target},'$.domains')='array'
      THEN json_extract(${target},'$.domains')
      ELSE json_array(json_extract(${target},'$.domain')) END
    ) WHERE type='text'
    GROUP BY value
    ORDER BY value
  ))`;
  return `json_array(
    json_extract(${target},'$.name'),
    json_extract(${target},'$.domain'),
    ${aliases},
    ${domains}
  )`;
}

function canonicalTargetsSql(targets: string) {
  // A run stores the brand and every monitored competitor.
  const valid = `json_array_length(${targets}) BETWEEN 1 AND ${MAX_COMPETITORS + 1}
    AND NOT EXISTS(
      SELECT 1 FROM json_each(${targets}) checked_target
      WHERE json_type(checked_target.value) IS NOT 'object'
      OR json_type(checked_target.value,'$.name') IS NOT 'text'
      OR json_extract(checked_target.value,'$.name')=''
      OR json_type(checked_target.value,'$.domain') IS NOT 'text'
      OR json_extract(checked_target.value,'$.domain')=''
      OR (json_type(checked_target.value,'$.aliases') IS NOT NULL
        AND json_type(checked_target.value,'$.aliases')!='array')
      OR EXISTS(
        SELECT 1 FROM json_each(
          CASE WHEN json_type(checked_target.value,'$.aliases')='array'
          THEN json_extract(checked_target.value,'$.aliases') ELSE '[]' END
        ) WHERE type IS NOT 'text' OR value=''
      )
      OR (json_type(checked_target.value,'$.domains') IS NOT NULL
        AND json_type(checked_target.value,'$.domains')!='array')
      OR EXISTS(
        SELECT 1 FROM json_each(
          CASE WHEN json_type(checked_target.value,'$.domains')='array'
          THEN json_extract(checked_target.value,'$.domains') ELSE '[]' END
        ) WHERE type IS NOT 'text' OR value=''
      )
    )`;
  const primary = `(SELECT ${canonicalTargetSql('primary_target.value')}
    FROM json_each(${targets}) primary_target
    WHERE CAST(primary_target.key AS INTEGER)=0 LIMIT 1)`;
  const competitors = `(SELECT COALESCE(json_group_array(signature),'[]') FROM (
    SELECT ${canonicalTargetSql('competitor_target.value')} signature
    FROM json_each(${targets}) competitor_target
    WHERE CAST(competitor_target.key AS INTEGER)>0
    ORDER BY signature
  ))`;
  return `CASE WHEN json_valid(${targets}) THEN
    CASE WHEN ${valid} THEN json_array(${primary},${competitors}) END
    END`;
}


/**
 * The project and its store by id alone, so a request can send them before its session is resolved (one D1 round trip
 * instead of two in a row). reportContext compares each row's `workspace_id` with the signed-in account before using either.
 */
export const projectReadsById = (id: string) =>
  db()
    .batch([
      db().prepare('SELECT * FROM projects WHERE id=? AND archived=0').bind(id),
      db().prepare('SELECT * FROM project_stores WHERE project_id=?').bind(id),
    ])
    .then(([project, registry]) => [
      (project.results[0] as Record<string, unknown> | undefined) ?? null,
      (registry.results[0] as Record<string, unknown> | undefined) ?? null,
    ]);

/** The parameters a first screen sends with no filter applied (page 1 of every list, all origins). */
const FIRST_SCREEN_PARAMS = new Set(['project', 'days', 'view', 'compact', 'kind', 'evidence', 'change', 'group', 'order', 'page', 'origin']);
/** A read the project store keeps recomputed for its latest data: a first screen with no filter. */
function defaultFirstScreen(q: URLSearchParams) {
  return [...q.keys()].every((key) => FIRST_SCREEN_PARAMS.has(key)) && (q.get('page') ?? '1') === '1' && (q.get('origin') ?? 'all') === 'all';
}

// The alias and SQL expressions below are internal constants; all caller values
// remain bound parameters. Reuse this cohort for reports, evidence and exports.
//
// `more`: further D1 reads of the caller (their results are `context.more`), sent beside the project's own reads.
// `early`: the project's reads by id alone (projectReadsById), sent by a caller before it knew the owner.
// `known`: a context of the same owner, project and period whose reads this one reuses: only its conditions are built
// from `q` (its moved period boundaries are kept exactly, so the two read the same answers).
// `copy`: the request this context answers (the response route's name and canonical query): the store's status then also
// brings the response it kept for it, the owner, the project and the store's current data (see AnalyticsDatabase.keptResponse).
// `only`: the answers the read keeps, by id (a drill down by sentiment band, whose readings live in D1, not in the store).
export async function reportContext(
  owner: string,
  q: URLSearchParams,
  more: D1PreparedStatement[] = [],
  early?: ReturnType<typeof projectReadsById>,
  known?: KnownContext,
  copy?: unknown,
  only?: string[],
) {
  const id = q.get('project');
  if (!id) throw new ApiError(400, 'Select a project.');
  if (known && String(known.project.id) !== id) throw new ApiError(400, 'Select a project.');
  const parsed = parseReportFilter(q);
  const filter = known
    ? { ...parsed, days: known.filter.days, end: known.filter.end, cutoff: known.filter.cutoff, previousCutoff: known.filter.previousCutoff, previousEnd: known.filter.previousEnd }
    : parsed;
  // The D1 reads (the project, its store, the semantic sources) leave together; the semantic ones are only needed after
  // the store, so they are not waited for before it. A project the caller does not own fails in `foundProject` and in the
  // store's own owner check, so nothing is returned.
  const semantic = !known && ['sources', 'source-types', 'content-types', 'domain-detail', 'url-detail'].includes(q.get('view') || '')
    ? semanticSourceStatement(id, owner, filter, q) : null;
  const extraRead = semantic || more.length ? db().batch([...(semantic ? [semantic] : []), ...more]) : null;
  extraRead?.catch(() => {});
  const owned = (row: Record<string, unknown> | null | undefined) => (row && row.workspace_id === owner ? row : null);
  const [projectRow, registryRow] = known
    ? [known.project, null]
    : early
    ? (await early).map(owned)
    : (await db().batch([ownedProjectStatement(id, owner), projectStoreStatement(id, owner)])).map(
        (read) => (read.results[0] as Record<string, unknown> | undefined) ?? null,
      );
  const project = foundProject(projectRow);
  // A comparison chosen apart from the period can leave days between the two: their answers belong to neither.
  const gap = filter.previousEnd < filter.cutoff;
  const [database, rest] = known ? [known.database, [...known.more]] : await Promise.all([
    projectReadDatabase(id, owner, (registryRow as StoreRegistry | null) ?? null, [filter.previousCutoff, ...(gap ? [filter.previousEnd] : []), filter.cutoff, filter.end], {
      warm: defaultFirstScreen(q),
      copy: copy === undefined ? undefined : [owner, copy, project],
    }),
    extraRead ?? Promise.resolve([] as D1Result[]),
  ]);
  // SQL binds the boundaries as the store moved them (same answers, stable text); the report shows `filter` as asked.
  const at = (value: string) => database.periodBound?.(value) ?? value;
  // The semantic answers of the period, and of the comparison for the Sources list's change.
  const { current: semanticSources, previous: previousSemanticSources } = known
    ? { current: known.semanticSources, previous: known.previousSemanticSources }
    : semantic ? semanticSourcePeriods(semanticSourceRowsFrom((rest.shift() as { results: SemanticRow[] }).results), filter)
    : { current: [] as SemanticSourceRow[], previous: [] as SemanticSourceRow[] };
  const competitors = JSON.parse(String(project.competitors_json)) as {
    name: string;
    domain: string;
  }[];
  const brand = q.get('brand') || 'primary';
  const isPrimary = brand === 'primary' || brand === String(project.name);
  // A brand that is not monitored may be a discovery of the Brands screen: its answers are the ones the brand analysis found it
  // in (the stored discoveries, by its key and group), the same the Brands list counts.
  const discovered = !isPrimary && !competitors.some((target) => target.name === brand);
  if (discovered && brand.length > 200) throw new ApiError(400, 'Choose a tracked brand.');
  // A parameterized one-row CTE avoids repeating brand bindings in aggregates.
  const selectedName = isPrimary || discovered
    ? discovered ? '(SELECT value FROM report_brand)' : primaryName
    : `(SELECT json_extract(target.value,'$.name') FROM json_each(${EFFECTIVE_TARGETS_SQL}) target WHERE json_extract(target.value,'$.domain')=(SELECT value FROM report_brand) LIMIT 1)`;
  const mentionExpression = discovered
    ? `EXISTS(SELECT 1 FROM ${ANSWER_DISCOVERIES_SQL} found WHERE ${DISCOVERY_GROUP_SQL}=(SELECT value FROM report_brand))`
    : isPrimary
    ? primaryMention
    : `EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_MENTIONS_SQL}) m WHERE m.value=1 AND m.key=${selectedName})`;
  const otherMention = `EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_MENTIONS_SQL}) m WHERE m.value=1 AND m.key!=${selectedName})`;
  // Resolve from the effective interpretation, never from mutable display settings.
  // The active overlay wins; collection snapshots remain the fallback. Older snapshots only have
  // `domain`, which remains the bounded backwards-compatible fallback.
  const selectedTarget = isPrimary
    ? `CAST(target.key AS INTEGER)=0`
    : `json_extract(target.value,'$.domain')=(SELECT value FROM report_brand)`;
  // Whether the answer cites a domain of the selected brand. The brand's domains come first (CROSS JOIN keeps that order),
  // so the answer's targets are read once, not once per cited source.
  const citesSelected = (alias: string) =>
    `EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_TARGETS_SQL}) target CROSS JOIN json_each(CASE WHEN json_type(target.value,'$.domains')='array' THEN json_extract(target.value,'$.domains') ELSE json_array(json_extract(target.value,'$.domain')) END) selected_domain CROSS JOIN json_each(r.sources_json) ${alias} WHERE ${selectedTarget} AND json_extract(${alias}.value,'$.domain')=selected_domain.value)`;
  const withClause = `WITH report_brand(value) AS (SELECT ?)`;
  const extra: string[] = [];
  const extraBindings: (string | number)[] = [];
  // The AIs asked, among those collected today (parseReportFilter); none left reads nothing.
  const selectedEngines = (filter.engine ? filter.engine.split(',') : []) as Engine[];
  extra.push(selectedEngines.length ? `r.engine IN (${selectedEngines.map(() => '?').join(',')})` : '0');
  extraBindings.push(...selectedEngines);
  if (filter.status !== 'all') {
    extra.push('r.status=?');
    extraBindings.push(filter.status);
  }
  const citation = q.get('citation') || 'all';
  if (!['all', 'missing-own'].includes(citation))
    throw new ApiError(400, 'Invalid citation filter.');
  if (citation === 'missing-own')
    extra.push(
      `(${complete}) AND ${mentionExpression} AND NOT ${citesSelected('own')}`,
    );
  for (const [param, clause, max] of [
    [
      'prompt',
      // The prompt's answers by their own index (runs_prompt_date): an IN list of its unit's prompts, not a test on every answer
      // of the period (an EXISTS per answer read the whole period's rows; a cold store, seconds). A store holds one project.
      'r.prompt_id IN (SELECT member.id FROM prompts selected JOIN prompts member ON COALESCE(member.unit_id,member.id)=COALESCE(selected.unit_id,selected.id) AND member.project_id=selected.project_id WHERE selected.id=? OR selected.unit_id=?)',
      100,
    ],
  ] as const) {
    const value = q.get(param);
    if (value) {
      if (value.length > max)
        throw new ApiError(400, `Invalid ${param} filter.`);
      extra.push(clause);
      extraBindings.push(value);
      if (param === 'prompt') extraBindings.push(value);
    }
  }
  const topics = reportTopics(q);
  if (topics.length) {
    extra.push(`EXISTS(SELECT 1 FROM prompts rp WHERE rp.id=r.prompt_id AND rp.project_id=r.project_id AND rp.tag IN (${topics.map(() => '?').join(',')}))`);
    extraBindings.push(...topics);
  }
  const tags = [
    ...new Set(
      (q.get('tags') || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  if (tags.length > 8 || tags.some((tag) => tag.length > 100))
    throw new ApiError(400, 'Invalid tag filter.');
  if (tags.length) {
    extra.push(
      `EXISTS(SELECT 1 FROM prompts rp,json_each(rp.tags_json) rt WHERE rp.id=r.prompt_id AND rp.project_id=r.project_id AND rt.value IN (${tags.map(() => '?').join(',')}))`,
    );
    extraBindings.push(...tags);
  }
  if (only) {
    extra.push('r.id IN (SELECT value FROM json_each(?))');
    extraBindings.push(JSON.stringify(only));
  }
  const source = q.get('source');
  if (source) {
    if (source.length > 4000) throw new ApiError(400, 'Invalid source filter.');
  }
  const sourceQuery = (q.get('sourceQuery') || '').trim();
  if (sourceQuery.length > 200)
    throw new ApiError(400, 'The source search query is too long.');
  const ownOnly = q.get('own') !== null;
  if (ownOnly && (q.get('own') !== '1' || filter.sourceKind !== 'cited'))
    throw new ApiError(400, 'Invalid source filter.');
  if (source || sourceQuery || ownOnly) {
    const column =
      filter.sourceKind === 'cited'
        ? 'r.sources_json'
        : 'r.consulted_sources_json';
    const sourceConditions: string[] = [];
    if (source) {
      sourceConditions.push(
        `${sourceKey('rs', filter.sourceGroup)}=?`,
      );
      extraBindings.push(source);
    }
    if (sourceQuery) {
      sourceConditions.push(
        `instr(lower(COALESCE(json_extract(rs.value,'$.url'),'') || ' ' || COALESCE(json_extract(rs.value,'$.title'),'')),lower(?))>0`,
      );
      extraBindings.push(sourceQuery);
    }
    if (ownOnly) {
      sourceConditions.push(
        `EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_TARGETS_SQL}) own_target,json_each(CASE WHEN json_type(own_target.value,'$.domains')='array' THEN json_extract(own_target.value,'$.domains') ELSE json_array(json_extract(own_target.value,'$.domain')) END) own_domain WHERE CAST(own_target.key AS INTEGER)=0 AND own_domain.value=${sourceKey('rs', 'domain')})`,
      );
    }
    extra.push(
      `(${complete}) AND EXISTS(SELECT 1 FROM json_each(${column}) rs WHERE ${sourceConditions.join(' AND ')})`,
    );
  }
  if (filter.mention !== 'all')
    extra.push(
      `(${complete}) AND ${filter.mention === 'missing' ? 'NOT ' : ''}${mentionExpression}`,
    );
  if (filter.gap === 'competitor-only')
    extra.push(
      `(${complete}) AND NOT ${mentionExpression} AND ${otherMention}`,
    );
  // Sources list uses `query` for domain/URL substring search (see sourcesReport).
  // Elsewhere `query` filters prompt text; history also accepts legacy `q`.
  const query = (
    q.get('query') ||
    (q.get('view') === 'history' ? q.get('q') : '') ||
    ''
  ).trim();
  if (query.length > 200)
    throw new ApiError(400, 'The search query is too long.');
  if (query && q.get('view') !== 'sources') {
    extra.push('instr(lower(r.prompt_text),lower(?))>0');
    extraBindings.push(query);
  }
  // Filtered by a prompt, the project test is kept off the indexes (`+`), so SQLite reads the prompt's answers by their own
  // index (runs_prompt_status_date) instead of the whole period's: without statistics it would take the project's.
  const common = `${q.get('prompt') ? '+' : ''}r.project_id=? AND r.workspace_id=? AND r.created_at>=? AND r.created_at<?${gap ? ' AND (r.created_at<? OR r.created_at>=?)' : ''}${extra.length ? ` AND ${extra.join(' AND ')}` : ''}`;
  const gapBindings = gap ? [at(filter.previousEnd), at(filter.cutoff)] : [];
  const bindings = [id, owner, at(filter.cutoff), at(filter.end), ...gapBindings, ...extraBindings];
  const previousBindings = [
    id,
    owner,
    at(filter.previousCutoff),
    at(filter.previousEnd),
    ...gapBindings,
    ...extraBindings,
  ];
  const combinedBindings = [
    id,
    owner,
    at(filter.previousCutoff),
    at(filter.end),
    ...gapBindings,
    ...extraBindings,
  ];
  return {
    semanticSources,
    previousSemanticSources,
    more: rest,
    database,
    project,
    filter,
    competitors,
    where: common,
    bindings,
    previousBindings,
    combinedBindings,
    /** `filter.cutoff` as bound in SQL (`CASE WHEN r.created_at>=? THEN 'current'`). */
    periodStart: at(filter.cutoff),
    withClause,
    brandBinding: isPrimary
      ? String(project.domain)
      : discovered
        ? brandKey(brand)
        : String(competitors.find((target) => target.name === brand)?.domain),
    mentionExpression,
    otherMention,
    selectedEngines,
    citesSelected,
    selectedName,
    isPrimary,
    /** A discovery of the Brands screen, not a monitored brand: known only in the answers the brand analysis read. */
    discovered,
    /** The project's topic weights (lib/topic-weights); null counts every answer the same. */
    topicWeights: readTopicWeights(project.topic_weights_json),
  };
}
type Context = Awaited<ReturnType<typeof reportContext>>;
type KnownContext = {
  filter: ReturnType<typeof parseReportFilter>;
  project: Record<string, unknown>;
  database: Awaited<ReturnType<typeof projectReadDatabase>>;
  semanticSources: SemanticSourceRow[];
  previousSemanticSources: SemanticSourceRow[];
  more: D1Result[];
};
/** An answer's topic, through its question (an answer whose question is gone is in the '' topic). */
const TOPIC_JOIN = 'LEFT JOIN prompts tp ON tp.id=r.prompt_id AND tp.project_id=r.project_id';
const TOPIC_SQL = "COALESCE(tp.tag,'')";
type PeriodFactors = { current: Map<string, number>; previous: Map<string, number> };
/**
 * Topic weights: the factor each answer of a topic counts with in each period (lib/topic-weights topicFactors),
 * from the cohort's complete answers per topic (`rows`: period, topic, responses). Every rate a report shows is a sum of
 * answers times these factors over the same sum of the denominator, so the card, the chart, the models, the prompts and
 * the brands agree; counts stay real.
 */
function periodFactors(rows: Record<string, unknown>[], weights: TopicWeights | null): PeriodFactors {
  const answers = { current: new Map<string, number>(), previous: new Map<string, number>() };
  for (const row of rows) {
    const counts = answers[row.period === 'previous' ? 'previous' : 'current'], topic = String(row.topic ?? '');
    counts.set(topic, (counts.get(topic) ?? 0) + Number(row.responses || 0));
  }
  return { current: topicFactors(answers.current, weights), previous: topicFactors(answers.previous, weights) };
}
const factorOf = (factors: Map<string, number>, topic: unknown) => factors.get(String(topic ?? '')) ?? 0;
function groupRows<T extends Record<string, unknown>>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}
/** One period's rows (one per topic) as real counts and topic-weighted rates. */
function weightedMetrics(rows: Record<string, unknown>[], factors: Map<string, number>, mentionPosition: number, domains: number, discovered = false): Metrics & { weightedResponses: number } {
  let responses = 0, mentions = 0, totalMentions = 0, cost = 0, wResponses = 0, wMentions = 0, wTotal = 0, wCited = 0, wVoice = 0, wAnalysed = 0;
  for (const row of rows) {
    const factor = factorOf(factors, row.topic);
    responses += Number(row.responses || 0); mentions += Number(row.mentions || 0); totalMentions += Number(row.total_mentions || 0);
    cost += Number(row.cost || 0);
    wResponses += factor * Number(row.responses || 0); wMentions += factor * Number(row.mentions || 0);
    wTotal += factor * Number(row.total_mentions || 0); wCited += factor * Number(row.cited_brand || 0);
    // Share of voice over the answers the brand analysis read (run-rows voiceSql): its numerator, and those answers.
    wVoice += factor * Number(row.voice_mentions ?? row.mentions ?? 0); wAnalysed += factor * Number(row.analysed ?? row.responses ?? 0);
  }
  return {
    responses,
    mentions,
    totalMentions,
    citedDomains: domains,
    // A discovered brand is known only in the answers the analysis read: its visibility is over those.
    visibility: discovered ? (wAnalysed ? (wMentions / wAnalysed) * 100 : 0) : wResponses ? (wMentions / wResponses) * 100 : 0,
    shareOfVoice: wTotal ? (wVoice / wTotal) * 100 : 0,
    citationPresence: wResponses ? (wCited / wResponses) * 100 : 0,
    mentionPosition,
    cost,
    weightedResponses: wResponses,
  };
}
type PositionCell = { period: 'current' | 'previous'; key: string | null; domain: string; own: number; topic: string; total: number; samples: number };
/**
 * Grouped by position: a bare `key` would be json_each's own column (the entry's index), not the group.
 * Sum and count of the mention ranks of the answers in the cohort, per period, group (`by`, a SQL expression of `r`) and
 * brand. A rank is among every identified brand: the saved rank among the monitored ones (run_positions, see
 * runPositionEntries) plus the counted discoveries named before the brand, so only over the answers the brand analysis read
 * (run-rows voiceSql). `selectedOnly` keeps just the brand the report is about.
 */
function positionCells(ctx: Context, bindings: (string | number)[], by: string, selectedOnly = false) {
  return ctx.database
    .prepare(`${ctx.withClause} SELECT CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,${by} key,
      json_extract(e.value,'$[0]') domain,json_extract(e.value,'$[1]') own,${TOPIC_SQL} topic,
      SUM(json_extract(e.value,'$[2]')+${countedDiscoveriesSql("found.value<json_extract(e.value,'$[3]')")}) total,COUNT(*) samples
      FROM runs r JOIN run_positions rp ON rp.run_id=r.id AND rp.basis=${EFFECTIVE_POSITIONS_BASIS_SQL} ${TOPIC_JOIN},json_each(rp.entries_json) e
      WHERE ${ctx.where} AND ${ANSWER_ANALYSED_SQL}${selectedOnly ? ` AND ${ctx.isPrimary ? "json_extract(e.value,'$[1]')=1" : "json_extract(e.value,'$[0]')=?"}` : ''}
      GROUP BY 1,2,3,4,5`)
    .bind(ctx.brandBinding, ctx.periodStart, ...bindings, ...(selectedOnly && !ctx.isPrimary ? [ctx.brandBinding] : []));
}
const isSelectedCell = (ctx: Context, cell: PositionCell) => (ctx.isPrimary ? cell.own === 1 : cell.domain === ctx.brandBinding);
export async function summaryReport(ctx: Context): Promise<SummaryReport> {
  const {
    where,
    project,
    filter,
    mentionExpression,
    withClause,
    brandBinding,
  } = ctx;
  const database = ctx.database;
  const positionByPeriod = new Map<string, { sum: number; samples: number }>();
  const dailyPositions = new Map<string, { sum: number; samples: number }>();
  await database.ensurePositions();
  const [totals, domains, daily, mentions, targetConsistency, samples, positions, channelTotals, channelPositions] =
    await database.batch<Record<string, unknown>>([
      database
        .prepare(`${withClause} SELECT CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,${TOPIC_SQL} topic,
      SUM(CASE WHEN ${complete} THEN 1 ELSE 0 END) responses,
      SUM(CASE WHEN ${complete} THEN ${mentionExpression} ELSE 0 END) mentions,
      SUM(CASE WHEN ${complete} THEN ${VOICE_BRANDS_SQL} ELSE 0 END) total_mentions,
      SUM(CASE WHEN ${complete} THEN ${voiceSql(mentionExpression)} ELSE 0 END) voice_mentions,
      SUM(CASE WHEN ${complete} THEN ${voiceSql('1')} ELSE 0 END) analysed,
      SUM(CASE WHEN ${complete} AND ${ctx.citesSelected('cs')} THEN 1 ELSE 0 END) cited_brand,
      COALESCE(SUM(r.cost),0) cost FROM runs r ${TOPIC_JOIN} WHERE ${where} GROUP BY period,topic`)
        .bind(brandBinding, ctx.periodStart, ...ctx.combinedBindings),
      database
        .prepare(`${withClause} SELECT CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,
      COUNT(DISTINCT ${sourceKey('s', 'domain')}) total FROM runs r,json_each(r.sources_json) s WHERE ${where} AND ${complete} GROUP BY period`)
      .bind(brandBinding, ctx.periodStart, ...ctx.combinedBindings),
    database
      .prepare(`${withClause} SELECT substr(r.created_at,1,10) day,${TOPIC_SQL} topic,COUNT(*) responses,SUM(${mentionExpression}) mentions,
      SUM(${VOICE_BRANDS_SQL}) total_mentions,SUM(${voiceSql(mentionExpression)}) voice_mentions,SUM(${voiceSql('1')}) analysed
      FROM runs r ${TOPIC_JOIN} WHERE ${where} AND ${complete} GROUP BY day,topic ORDER BY day`)
        .bind(brandBinding, ...ctx.bindings),
      database
        .prepare(`${withClause} SELECT substr(r.created_at,1,10) day,json_extract(target.value,'$.domain') domain,${TOPIC_SQL} topic,COUNT(*) mentions,
      SUM(CASE WHEN CAST(target.key AS INTEGER)=0 THEN 1 ELSE 0 END) primary_mentions,SUM(${voiceSql('1')}) voice_mentions,
      SUM(CASE WHEN CAST(target.key AS INTEGER)=0 THEN ${voiceSql('1')} ELSE 0 END) primary_voice
      FROM runs r ${TOPIC_JOIN},json_each(${EFFECTIVE_MENTIONS_SQL}) m
      JOIN json_each(${EFFECTIVE_TARGETS_SQL}) target ON json_extract(target.value,'$.name')=m.key
      WHERE ${where} AND ${complete} AND m.value=1 GROUP BY day,domain,topic`)
        .bind(brandBinding, ...ctx.bindings),
      database
        .prepare(
          `${withClause}, comparison_cohort AS (
          SELECT DISTINCT ${EFFECTIVE_TARGETS_SQL} targets_json
          FROM runs r WHERE ${where} AND ${complete}
        ), comparison_reference AS (
          SELECT targets_json FROM comparison_cohort ORDER BY targets_json LIMIT 1
        )
         SELECT COALESCE(SUM(CASE
           WHEN ${canonicalTargetsSql('comparison_cohort.targets_json')}=
             ${canonicalTargetsSql('comparison_reference.targets_json')}
           THEN 0 ELSE 1 END),0) mismatched
         FROM comparison_cohort CROSS JOIN comparison_reference`,
        )
        .bind(brandBinding, ...ctx.combinedBindings),
      database.prepare(`${withClause} SELECT CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,
        COUNT(DISTINCT json_array(COALESCE(p.unit_id,p.id),r.engine)) combinations
        FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id
        WHERE ${where} AND ${complete} GROUP BY period`)
        .bind(brandBinding, ctx.periodStart, ...ctx.combinedBindings),
      positionCells(ctx, ctx.combinedBindings, 'substr(r.created_at,1,10)'),
      // The current period per model, for the cards' channel rows.
      database
        .prepare(`${withClause} SELECT r.engine engine,${TOPIC_SQL} topic,COUNT(*) responses,SUM(${mentionExpression}) mentions,
      SUM(${VOICE_BRANDS_SQL}) total_mentions,SUM(${voiceSql(mentionExpression)}) voice_mentions,SUM(${voiceSql('1')}) analysed,
      SUM(CASE WHEN ${ctx.citesSelected('cs')} THEN 1 ELSE 0 END) cited_brand
      FROM runs r ${TOPIC_JOIN} WHERE ${where} AND ${complete} GROUP BY r.engine,topic`)
        .bind(brandBinding, ...ctx.bindings),
      positionCells(ctx, ctx.bindings, 'r.engine', true),
    ]);
  const factors = periodFactors(totals.results, ctx.topicWeights);
  // Measured answers as counted (the samples shown), apart from the topic-weighted sums the averages come from.
  const positionSamples = new Map<string, number>();
  for (const cell of positions.results as PositionCell[]) {
    const selected = isSelectedCell(ctx, cell);
    const factor = factorOf(factors[cell.period], cell.topic);
    if (selected) {
      const value = positionByPeriod.get(cell.period) ?? { sum: 0, samples: 0 };
      value.sum += factor * cell.total; value.samples += factor * cell.samples; positionByPeriod.set(cell.period, value);
      positionSamples.set(cell.period, (positionSamples.get(cell.period) ?? 0) + cell.samples);
    }
    if (cell.period === 'current')
      for (const name of [cell.domain, ...(selected ? ['selected'] : [])]) {
        const id = `${cell.key}\0${name}`, value = dailyPositions.get(id) ?? { sum: 0, samples: 0 };
        value.sum += factor * cell.total; value.samples += factor * cell.samples; dailyPositions.set(id, value);
      }
  }
  const averagePosition = (period: string) => {
    const value = positionByPeriod.get(period);
    return value?.samples ? value.sum / value.samples : 0;
  };
  const periodMetrics = (period: 'current' | 'previous') => {
    const { weightedResponses: _weighted, ...values } = weightedMetrics(
      totals.results.filter((row) => row.period === period),
      factors[period],
      averagePosition(period),
      Number(domains.results.find((r) => r.period === period)?.total || 0),
      ctx.discovered,
    );
    return values;
  };
  const current = periodMetrics('current');
  const previous = periodMetrics('previous');
  const targetsShareInterpretation =
    Number(targetConsistency.results[0]?.mismatched || 0) === 0;
  const comparable = targetsShareInterpretation;
  const availability = {
    visibility: {
      current: current.responses || null,
      previous: previous.responses || null,
    },
    shareOfVoice: {
      current: current.totalMentions || null,
      previous: previous.totalMentions || null,
    },
    citationPresence: {
      current: current.responses || null,
      previous: previous.responses || null,
    },
    mentionPosition: {
      current: positionSamples.get('current') || null,
      previous: positionSamples.get('previous') || null,
    },
  };
  if (!comparable)
    for (const sample of Object.values(availability)) sample.previous = null;
  const channelPosition = new Map<string, { sum: number; samples: number }>();
  for (const cell of channelPositions.results as PositionCell[]) {
    if (cell.period !== 'current' || !cell.key || !isSelectedCell(ctx, cell)) continue;
    const value = channelPosition.get(cell.key) ?? { sum: 0, samples: 0 }, factor = factorOf(factors.current, cell.topic);
    value.sum += factor * cell.total; value.samples += factor * cell.samples; channelPosition.set(cell.key, value);
  }
  const channels = [...groupRows(channelTotals.results, (row) => String(row.engine))]
    .filter(([engine]) => isEngine(engine))
    .map(([engine, rows]) => {
      const values = weightedMetrics(rows, factors.current, 0, 0, ctx.discovered), position = channelPosition.get(engine);
      return {
        engine: engine as Engine,
        visibility: values.responses ? values.visibility : null,
        shareOfVoice: values.totalMentions ? values.shareOfVoice : null,
        citationPresence: values.responses ? values.citationPresence : null,
        mentionPosition: position?.samples ? position.sum / position.samples : null,
      };
    })
    .sort((a, b) => ENGINES.indexOf(a.engine) - ENGINES.indexOf(b.engine));
  const names = [
    { name: String(project.name), domain: String(project.domain) },
    ...ctx.competitors,
  ];
  const competitorNames = ctx.competitors.map((competitor) => competitor.name);
  const mentionRows = mentions.results as {
    day: string;
    domain: string;
    topic: string;
    mentions: number;
    primary_mentions: number;
    voice_mentions: number;
    primary_voice: number;
  }[];
  // Per day and brand, topic-weighted (the chart's rates); the ranking's counts below stay real. `voiceMap`: the same over the
  // answers the brand analysis read, share of voice's numerator (run-rows voiceSql).
  const mentionMap = new Map<string, number>(), voiceMap = new Map<string, number>();
  for (const r of mentionRows) {
    const id = `${r.day}\0${r.domain}`;
    mentionMap.set(id, (mentionMap.get(id) ?? 0) + factorOf(factors.current, r.topic) * r.mentions);
    voiceMap.set(id, (voiceMap.get(id) ?? 0) + factorOf(factors.current, r.topic) * Number(r.voice_mentions ?? 0));
  }
  const topicMentions = groupRows(mentionRows, (row) => String(row.topic ?? ''));
  const weightedResponses = weightedMetrics(totals.results.filter((row) => row.period === 'current'), factors.current, 0, 0).weightedResponses;
  return {
    metrics: current,
    channels,
    // Topic coverage: the brand in each topic of the period, from the cards' own rows. One topic's answers share one
    // factor, so its rates are the real ones; null is not measured there (no complete answer, or no brand named), never a zero.
    // The brand's position among the monitored brands in each topic (by the answers that name each one, the order of
    // both rates, which share the topic's denominators), and its top rival there: the leader, or the runner-up when it leads.
    topics: totals.results.filter((row) => row.period === 'current').map((row) => {
      const responses = Number(row.responses || 0), mentions = Number(row.mentions || 0), named = Number(row.total_mentions || 0);
      // Visibility over every answer of the topic, share of voice over the ones the brand analysis read (run-rows voiceSql).
      const rate = (count: number, voice: number) => ({ visibility: responses ? (count / responses) * 100 : null, shareOfVoice: named ? (voice / named) * 100 : null });
      const inTopic = topicMentions.get(String(row.topic ?? '')) ?? [];
      const rivals = names
        .map((target, i) => ({ ...target, own: i === 0 ? ctx.isPrimary : target.domain === brandBinding,
          count: inTopic.reduce((sum, item) => sum + (i === 0 ? item.primary_mentions : item.domain === target.domain ? item.mentions : 0), 0),
          voice: inTopic.reduce((sum, item) => sum + Number(i === 0 ? item.primary_voice : item.domain === target.domain ? item.voice_mentions : 0), 0) }))
        .filter((target) => !target.own && target.count > 0)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      const rival = rivals[0];
      return {
        topic: String(row.topic ?? ''), responses, ...rate(mentions, Number(row.voice_mentions ?? mentions)),
        // Not named in the topic: no position, never a last place.
        position: mentions ? 1 + rivals.filter((target) => target.count > mentions).length : null,
        rival: rival ? { name: rival.name, domain: rival.domain, ...rate(rival.count, rival.voice) } : null,
      };
    }),
    samples: {
      current: Number(samples.results.find((r) => r.period === 'current')?.combinations || 0),
      previous: Number(samples.results.find((r) => r.period === 'previous')?.combinations || 0),
    },
    availability,
    comparison: {
      previous,
      delta: Object.fromEntries(
        (Object.keys(current) as (keyof Metrics)[]).map((key) => [
          key,
          current[key] - previous[key],
        ]),
      ) as Metrics,
      comparable,
      // An earlier period that measured too few answers is no comparison (lib/period-coverage).
      hasPreviousData: comparable && coveredPeriods(previous.responses, current.responses),
      currentStart: filter.cutoff,
      previousStart: filter.previousCutoff,
      previousEnd: filter.previousEnd,
      end: filter.end,
    },
    leaderboard: names
      .map((target, i) => {
        let count = 0, weighted = 0;
        for (const row of mentionRows) {
          const value = i === 0 ? row.primary_mentions : row.domain === target.domain ? row.mentions : 0;
          count += value;
          weighted += factorOf(factors.current, row.topic) * value;
        }
        return {
          ...target,
          count,
          visibility: weightedResponses ? (weighted / weightedResponses) * 100 : 0,
          color: seriesColorVar(
            target.name,
            String(project.name),
            competitorNames,
          ),
        };
      })
      .sort((a, b) => b.count - a.count),
    // Share of voice per day uses the exact same meaning as the period KPI
    // (`metrics().shareOfVoice = mentions / totalMentions * 100`): the
    // primary numerator is `row.mentions` (the same `mentionExpression` sum
    // the visibility series already uses) and the denominator is
    // `total_mentions` computed at day granularity with the identical
    // `COUNT(*) FROM json_each(EFFECTIVE_MENTIONS_SQL) WHERE value=1` subquery
    // used for the period aggregate — every true entry in the active overlay
    // (or original snapshot fallback), not just today's display roster. This intentionally does
    // NOT use `mentionMap` (keyed by each run's effective target domain, a stable
    // target identity: renaming a competitor under the same domain still
    // matches, changing its domain is a new target with no inferred
    // merger) for the primary; the primary numerator uses each run's own
    // effective primary target instead. Competitor numerators still come from
    // `mentionMap`. A day with zero total_mentions has an undefined share
    // (`null`, a gap), distinct from a tracked brand genuinely having a 0%
    // share that day.
    // A day's counts are topic-weighted (lib/topic-weights; equal to the real ones without weights): the chart sums them
    // into weeks and months and divides, and its totals are the cards'.
    daily: [...groupRows(daily.results, (row) => String(row.day))].map(([day, rows]) => {
      const sum = (field: string) => rows.reduce((total, row) => total + factorOf(factors.current, row.topic) * Number(row[field] || 0), 0);
      return { day, responses: sum('responses'), mentions: sum('mentions'), total_mentions: sum('total_mentions'), voice_mentions: sum('voice_mentions'), analysed: sum('analysed') };
    }).map((row) => {
      // Share of voice's numerators and denominator count only the answers the brand analysis read (run-rows voiceSql).
      const totalMentions = row.total_mentions || 0;
      const positions = dailyPositions.get(`${row.day}\0selected`);
      return {
        responses: row.responses, mentions: row.mentions, totalMentions, voiceMentions: row.voice_mentions, analysed: row.analysed,
        positionSum: positions?.sum ?? 0, positionSamples: positions?.samples ?? 0,
        position: positions?.samples ? positions.sum / positions.samples : null,
        date: row.day,
        brand: (row.mentions / row.responses) * 100,
        sov: totalMentions ? (row.voice_mentions / totalMentions) * 100 : null,
        ...Object.fromEntries(
          ctx.competitors.map((c, i) => [
            `c${i}`,
            ((mentionMap.get(`${row.day}\0${c.domain}`) || 0) /
              row.responses) *
              100,
          ]),
        ),
        ...Object.fromEntries(ctx.competitors.flatMap((competitor, index) => {
          const position = dailyPositions.get(`${row.day}\0${competitor.domain}`);
          return [[`mentionsC${index}`, mentionMap.get(`${row.day}\0${competitor.domain}`) || 0],
            [`voiceMentionsC${index}`, voiceMap.get(`${row.day}\0${competitor.domain}`) || 0],
            [`positionSumC${index}`, position?.sum ?? 0], [`positionSamplesC${index}`, position?.samples ?? 0],
            [`positionC${index}`, position?.samples ? position.sum / position.samples : null]];
        })),
        ...Object.fromEntries(
          ctx.competitors.map((c, i) => [
            `sovC${i}`,
            totalMentions
              ? ((voiceMap.get(`${row.day}\0${c.domain}`) || 0) /
                  totalMentions) *
                100
              : null,
          ]),
        ),
      };
    }),
  };
}

/** One model's rows (one per topic) as one row: real counts, topic-weighted rates (lib/topic-weights). */
function weightedAnalysisRow(rows: Record<string, unknown>[], factors: Map<string, number>): AnalysisRow {
  const sum = (field: string, weighted = false) =>
    rows.reduce((total, row) => total + (weighted ? factorOf(factors, row.topic) : 1) * Number(row[field] || 0), 0);
  const counts = Object.fromEntries(['attempts', 'responses', 'mentions', 'opportunities', 'cited', 'consulted', 'pending', 'failed', 'no_answer'].map((field) => [field, sum(field)]));
  const responses = sum('responses', true);
  return {
    ...analysisRow({ ...rows[0], ...counts }),
    visibility: responses ? (sum('mentions', true) / responses) * 100 : 0,
    citationCoverage: responses ? (sum('cited', true) / responses) * 100 : 0,
    consultedCoverage: responses ? (sum('consulted', true) / responses) * 100 : 0,
  };
}
function analysisRow(row: Record<string, unknown>): AnalysisRow {
  const responses = Number(row.responses || 0),
    mentions = Number(row.mentions || 0);
  return {
    key: String(row.key),
    label: String(row.label),
    attempts: Number(row.attempts || 0),
    responses,
    mentions,
    visibility: responses ? (mentions / responses) * 100 : 0,
    opportunities: Number(row.opportunities || 0),
    citationCoverage: responses
      ? (Number(row.cited || 0) / responses) * 100
      : 0,
    consultedCoverage: responses
      ? (Number(row.consulted || 0) / responses) * 100
      : 0,
    pending: Number(row.pending || 0),
    failed: Number(row.failed || 0),
    noAnswer: Number(row.no_answer || 0),
  };
}
function reportPage(q: URLSearchParams, key = 'page') {
  const page = Number(q.get(key) || 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000)
    throw new ApiError(400, 'Invalid page.');
  return page;
}
export async function analysisReport(ctx: Context,
  q = new URLSearchParams(),
): Promise<AnalysisReport> {
  const database = ctx.database;
  const topicPage = reportPage(q, 'topicPage'),
    promptPage = reportPage(q, 'promptPage');
  const aggregate = `COUNT(*) attempts,SUM(CASE WHEN ${complete} THEN 1 ELSE 0 END) responses,
    SUM(CASE WHEN ${complete} THEN ${ctx.mentionExpression} ELSE 0 END) mentions,
    SUM(CASE WHEN ${complete} AND NOT ${ctx.mentionExpression} AND ${ctx.otherMention} THEN 1 ELSE 0 END) opportunities,
    SUM(CASE WHEN ${complete} AND json_array_length(r.sources_json)>0 THEN 1 ELSE 0 END) cited,
    SUM(CASE WHEN ${complete} AND r.consulted_sources_json IS NOT NULL THEN 1 ELSE 0 END) consulted,
    SUM(CASE WHEN r.status IN ('queued','pending','submitting') THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN r.status IN ('failed','unknown') THEN 1 ELSE 0 END) failed,
    SUM(CASE WHEN r.status='complete' AND r.response_available=0 THEN 1 ELSE 0 END) no_answer`;
  const [channels, topics, prompts] = await database.batch<
    Record<string, unknown>
  >([
    database
      .prepare(
        `${ctx.withClause} SELECT r.engine key,r.engine label,${TOPIC_SQL} topic,${aggregate} FROM runs r ${TOPIC_JOIN} WHERE ${ctx.where} GROUP BY r.engine,topic`,
      )
      .bind(ctx.brandBinding, ...ctx.bindings),
    database
      .prepare(`${ctx.withClause} SELECT p.tag key,p.tag label,${aggregate} FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id
      WHERE ${ctx.where} GROUP BY p.tag ORDER BY opportunities DESC,responses DESC,key LIMIT 51 OFFSET ?`)
      .bind(ctx.brandBinding, ...ctx.bindings, (topicPage - 1) * 50),
    database
      .prepare(`${ctx.withClause} SELECT COALESCE(p.unit_id,p.id) key,p.text label,r.engine engine,p.tag topic,${aggregate} FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id
      WHERE ${ctx.where} GROUP BY COALESCE(p.unit_id,p.id) ORDER BY opportunities DESC,responses DESC,key LIMIT 51 OFFSET ?`)
      .bind(ctx.brandBinding, ...ctx.bindings, (promptPage - 1) * 50),
  ]);
  const factors = periodFactors(channels.results.map((row) => ({ ...row, period: 'current' })), ctx.topicWeights).current;
  const channelRows = groupRows(channels.results, (row) => String(row.key));
  return {
    // The AIs collected today and asked for; one switched off (8/11/2026) never shows.
    channels: ctx.selectedEngines.map((engine) => ({
      ...(channelRows.has(engine) ? weightedAnalysisRow(channelRows.get(engine)!, factors) : analysisRow({ key: engine })),
      key: engine,
      label: ENGINE_LABELS[engine],
    })),
    topics: topics.results.slice(0, 50).map(analysisRow),
    prompts: prompts.results.slice(0, 50).map((row) => ({
      ...analysisRow(row),
      engine: row.engine as Engine,
      topic: String(row.topic),
    })),
    hasMoreTopics: topics.results.length > 50,
    hasMorePrompts: prompts.results.length > 50,
  };
}

function cursorWhere(cursor: string | null) {
  if (!cursor) return { where: '', bindings: [] as string[] };
  try {
    if (cursor.length > 1000) throw 0;
    const [date, id] = JSON.parse(atob(cursor));
    if (
      typeof date !== 'string' ||
      !Number.isFinite(Date.parse(date)) ||
      typeof id !== 'string' ||
      !id ||
      id.length > 100
    )
      throw 0;
    return {
      where: ' AND (r.created_at<? OR (r.created_at=? AND r.id<?))',
      bindings: [date, date, id],
    };
  } catch {
    throw new ApiError(400, 'Invalid page cursor.');
  }
}
function historyPage(rows: Record<string, unknown>[]): HistoryPage {
  const page = rows.slice(0, 25),
    last = page.at(-1);
  return {
    runs: page.map(runSummary),
    nextCursor:
      rows.length > 25 && last
        ? btoa(JSON.stringify([last.created_at, last.id]))
        : null,
  };
}
export async function historyReport(
  ctx: Context,
  q: URLSearchParams,
): Promise<HistoryPage> {
  return historyPage((await historyStatement(ctx, q).all<Record<string, unknown>>()).results);
}
/**
 * The read of {@link historyReport} (then {@link historyPage}), for a caller that batches it with others. Only complete answers:
 * the same set the Summary counts (`responses`), so the list, its pager and its total agree; a failed or pending
 * collection is an operation, not a response (Admin shows those).
 */
function historyStatement(ctx: Context, q: URLSearchParams) {
  const after = cursorWhere(q.get('cursor'));
  const offset = q.has('cursor') ? 0 : (reportPage(q) - 1) * 25;
  return ctx.database
    .prepare(
      `${ctx.withClause} SELECT ${RUN_SUMMARY_COLUMNS} FROM runs r WHERE ${ctx.where} AND ${complete}${after.where} ORDER BY r.created_at DESC,r.id DESC LIMIT 26 OFFSET ?`,
    )
    .bind(ctx.brandBinding, ...ctx.bindings, ...after.bindings, offset);
}
export async function promptReport(
  ctx: Context,
  compact = false,
): Promise<PromptReport> {
  // The subscriptions and the saved mention positions ride in the same project-store call as the aggregates.
  await ctx.database.ensurePositions();
  const [subscriptionRows, stats, brands, positionRows, latest] = await ctx.database.batch<
    Record<string, unknown>
  >([
    ctx.database.prepare('SELECT id,engine,COALESCE(unit_id,id) unit_id,tag FROM prompts WHERE project_id=?').bind(String(ctx.project.id)),
    ctx.database
      .prepare(`${ctx.withClause} SELECT r.prompt_id,CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,
      SUM(CASE WHEN ${complete} THEN 1 ELSE 0 END) responses,
      SUM(CASE WHEN ${complete} THEN ${ctx.mentionExpression} ELSE 0 END) mentions,
      SUM(CASE WHEN ${complete} THEN ${VOICE_BRANDS_SQL} ELSE 0 END) total_mentions,
      SUM(CASE WHEN ${complete} THEN ${voiceSql(ctx.mentionExpression)} ELSE 0 END) voice_mentions,
      SUM(CASE WHEN ${complete} AND ${ctx.citesSelected('cs')} THEN 1 ELSE 0 END) cited,
      SUM(CASE WHEN r.status IN ('queued','pending','submitting') THEN 1 ELSE 0 END) pending
      FROM runs r WHERE ${ctx.where} GROUP BY r.prompt_id,period`)
      .bind(ctx.brandBinding, ctx.periodStart, ...ctx.combinedBindings),
    ctx.database
      .prepare(`${ctx.withClause} SELECT r.prompt_id,m.key name FROM runs r,json_each(${EFFECTIVE_MENTIONS_SQL}) m
      WHERE ${ctx.where} AND ${complete} AND m.value=1 GROUP BY r.prompt_id,m.key ORDER BY r.prompt_id,name`)
      .bind(ctx.brandBinding, ...ctx.bindings),
    positionCells(ctx, ctx.combinedBindings, 'r.prompt_id', true),
    ...(compact
      ? []
      : [
          ctx.database
      .prepare(`${ctx.withClause}, latest AS (SELECT r.id,ROW_NUMBER() OVER(PARTITION BY r.prompt_id ORDER BY r.created_at DESC,r.id DESC) position
      FROM runs r WHERE ${ctx.where}) SELECT ${RUN_SUMMARY_COLUMNS} FROM latest l JOIN runs r ON r.id=l.id WHERE l.position=1`)
      .bind(ctx.brandBinding, ...ctx.bindings),
        ]),
  ]);
  const subscriptions = subscriptionRows.results as { id: string; unit_id: string; engine: Engine; tag: string | null }[];
  const units = new Map(subscriptions.map((row) => [row.id, row.unit_id]));
  // The topic factor of each question (lib/topic-weights), from the same cohort as the summary: the table's Summary row
  // weighs each question by it, so it agrees with the Overview.
  const topicOf = new Map(subscriptions.map((row) => [row.id, row.tag ?? '']));
  const factors = periodFactors(
    (stats.results as Record<string, unknown>[]).map((row) => ({ period: row.period, topic: topicOf.get(String(row.prompt_id)) ?? '', responses: row.responses })),
    ctx.topicWeights,
  );
  const unitId = (id: string) => units.get(id) || id;
  const channelBySubscription = new Map(subscriptions.map((row) => [row.id, row.engine]));
  const result: PromptReport = {};
  for (const row of stats.results as {
    prompt_id: string;
    period: string;
    responses: number;
    mentions: number;
    total_mentions: number;
    voice_mentions: number;
    cited: number;
    pending: number;
  }[]) {
    const score = {
      responses: Number(row.responses),
      mentions: Number(row.mentions),
      totalMentions: Number(row.total_mentions),
      voiceMentions: Number(row.voice_mentions),
      visibility: Number(row.responses)
        ? (Number(row.mentions) / Number(row.responses)) * 100
        : 0,
      shareOfVoice: Number(row.total_mentions)
        ? (Number(row.voice_mentions) / Number(row.total_mentions)) * 100
        : null,
    };
    const id = unitId(row.prompt_id);
    const item: PromptReport[string] = result[id] ?? {
      responses: 0,
      mentions: 0,
      visibility: 0,
      totalMentions: 0,
      shareOfVoice: null,
      pending: 0,
      previous: { responses: 0, mentions: 0, visibility: 0, totalMentions: 0, voiceMentions: 0, shareOfVoice: null },
      delta: { responses: 0, mentions: 0, visibility: 0 },
      brands: [],
    };
    const target = row.period === 'current' ? item : item.previous;
    target.responses += score.responses;
    target.mentions += score.mentions;
    target.totalMentions = (target.totalMentions ?? 0) + score.totalMentions;
    target.voiceMentions = (target.voiceMentions ?? 0) + score.voiceMentions;
    target.visibility = target.responses ? target.mentions / target.responses * 100 : 0;
    target.shareOfVoice = target.totalMentions ? (target.voiceMentions / target.totalMentions) * 100 : null;
    if (row.period === 'current') {
      item.weight = factorOf(factors.current, topicOf.get(row.prompt_id) ?? '');
      item.pending += Number(row.pending);
      item.cited = (item.cited ?? 0) + Number(row.cited);
      const engine = channelBySubscription.get(row.prompt_id);
      if (engine) {
        item.channels ??= {};
        const channel = item.channels[engine] ??= { responses: 0, mentions: 0, visibility: 0, position: null };
        channel.responses += score.responses; channel.mentions += score.mentions;
        channel.visibility = channel.responses ? channel.mentions / channel.responses * 100 : 0;
      }
    }
    result[id] = item;
  }
  for (const row of brands.results as { prompt_id: string; name: string }[]) {
    const item = result[unitId(row.prompt_id)];
    if (item && !item.brands.includes(String(row.name))) item.brands.push(String(row.name));
  }
  for (const item of Object.values(result)) {
    item.totalMentions = item.totalMentions || 0;
    item.shareOfVoice = item.totalMentions ? ((item.voiceMentions ?? 0) / item.totalMentions) * 100 : null;
    item.delta = {
      responses: item.responses - item.previous.responses,
      mentions: item.mentions - item.previous.mentions,
      visibility: item.visibility - item.previous.visibility,
    };
  }
  for (const row of latest?.results ?? []) {
    const item = result[unitId(String(row.prompt_id))];
    const run = runSummary(row);
    if (item && (!item.latest || `${run.created_at}${run.id}` > `${item.latest.created_at}${item.latest.id}`)) item.latest = run;
  }
  const positions = new Map<string, { sum: number; count: number }>();
  const previousPositions = new Map<string, { sum: number; count: number }>();
  const channelPositions = new Map<string, { sum: number; count: number }>();
  for (const cell of positionRows.results as PositionCell[]) {
    if (!isSelectedCell(ctx, cell)) continue;
    const subscriptionId = String(cell.key), promptId = unitId(subscriptionId);
    const periodPositions = cell.period === 'current' ? positions : previousPositions;
    const value = periodPositions.get(promptId) || { sum: 0, count: 0 };
    value.sum += cell.total;
    value.count += cell.samples;
    periodPositions.set(promptId, value);
    if (cell.period !== 'current') continue;
    const engine = channelBySubscription.get(subscriptionId);
    if (engine) { const key = `${promptId}|${engine}`, score = channelPositions.get(key) ?? { sum: 0, count: 0 }; score.sum += cell.total; score.count += cell.samples; channelPositions.set(key, score); }
  }
  for (const [id, item] of Object.entries(result)) {
    const value = positions.get(id);
    item.position = value ? value.sum / value.count : null;
    item.positionSamples = value?.count ?? 0;
    const before = previousPositions.get(id);
    item.previous.position = before ? before.sum / before.count : null;
    for (const [engine, channel] of Object.entries(item.channels ?? {})) { const score = channelPositions.get(`${id}|${engine}`); channel.position = score ? score.sum / score.count : null; }
  }
  return result;
}
export async function promptDetail(
  ctx: Context,
  q: URLSearchParams,
): Promise<PromptDetail> {
  const sourcePage = reportPage(q, 'sourcePage');
  const scoresPromise = promptReport(ctx, true);
  const historyPromise = historyReport(ctx, q);
  await ctx.database.ensurePositions();
  const [daily, platforms, sources] = await ctx.database.batch<
    Record<string, unknown>
  >([
    ctx.database
      .prepare(
        `${ctx.withClause} SELECT substr(r.created_at,1,10) date,COUNT(*) responses,SUM(${ctx.mentionExpression}) mentions FROM runs r WHERE ${ctx.where} AND ${complete} GROUP BY date ORDER BY date LIMIT 91`,
      )
      .bind(ctx.brandBinding, ...ctx.bindings),
    ctx.database
      .prepare(
        `${ctx.withClause} SELECT r.engine,COUNT(*) responses,SUM(${ctx.mentionExpression}) mentions,MAX(r.created_at||'|'||r.id) latest FROM runs r WHERE ${ctx.where} AND ${complete} GROUP BY r.engine ORDER BY responses DESC`,
      )
      .bind(ctx.brandBinding, ...ctx.bindings),
    ctx.database
      .prepare(
        `${ctx.withClause} SELECT ${sourceKey('s', 'domain')} domain,COUNT(DISTINCT r.id) responses FROM runs r,json_each(r.sources_json) s WHERE ${ctx.where} AND ${complete} GROUP BY domain ORDER BY responses DESC,domain LIMIT 51 OFFSET ?`,
      )
      .bind(ctx.brandBinding, ...ctx.bindings, (sourcePage - 1) * 50),
  ]);
  const makeScore = (row: Record<string, unknown>) => ({
    responses: Number(row.responses),
    mentions: Number(row.mentions),
    visibility: Number(row.responses)
      ? (Number(row.mentions) / Number(row.responses)) * 100
      : 0,
  });
  const [scores, history] = await Promise.all([scoresPromise, historyPromise]);
  const values = Object.values(scores);
  const score = values.length === 1 ? values[0] : undefined;
  const responses = values.reduce((sum, row) => sum + row.responses, 0),
    mentions = values.reduce((sum, row) => sum + row.mentions, 0);
  const before = {
    responses: values.reduce((sum, row) => sum + row.previous.responses, 0),
    mentions: values.reduce((sum, row) => sum + row.previous.mentions, 0),
  };
  return {
    metrics: {
      responses,
      mentions,
      visibility: responses ? (mentions / responses) * 100 : 0,
      position: score?.position ?? null,
    },
    previous: {
      ...before,
      visibility: before.responses ? (before.mentions / before.responses) * 100 : 0,
      position: score?.previous.position ?? null,
    },
    daily: daily.results
      .slice(0, 90)
      .map((row) => ({ date: String(row.date), ...makeScore(row) })),
    platforms: platforms.results.map((row) => ({
      engine: row.engine as Engine,
      ...makeScore(row),
      position: score?.channels?.[row.engine as Engine]?.position ?? null,
      latestRunId: String(row.latest).slice(String(row.latest).indexOf('|') + 1),
      latestAt: String(row.latest).slice(0, String(row.latest).indexOf('|')),
    })),
    sources: sources.results.slice(0, 50).map((row) => ({
      domain: String(row.domain),
      responses: Number(row.responses),
    })),
    hasMoreSources: sources.results.length > 50,
    history,
  };
}
/** The project's current name for a brand of a collected answer: its own brand, a monitored competitor by domain, else as collected. */
function currentBrandName(ctx: Context) {
  const competitors = new Map(ctx.competitors.map((target) => [target.domain, target.name]));
  return (name: string, domain: string, own = false) =>
    own ? String(ctx.project.name) : (competitors.get(domain) ?? name);
}
export async function competitorsReport(
  ctx: Context,
  q = new URLSearchParams(),
): Promise<CompetitorsReport> {
  const page = reportPage(q);
  // The comparison period rides in the same read: its rows give each brand's `previous`. Share of voice divides by the
  // mentions of every identified brand (ANSWER_BRANDS_SQL), discovered ones included, over the answers the brand analysis read
  // (VOICE_BRANDS_SQL), its numerators too.
  const [{ results: periodRows }, { results: brandTotals }] = await ctx.database.batch<Record<string, unknown>>([
    ctx.database
      .prepare(`${ctx.withClause} SELECT CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,
        json_extract(target.value,'$.name') name,json_extract(target.value,'$.domain') domain,
        CAST(target.key AS INTEGER)=0 own,r.engine,p.tag topic,COUNT(DISTINCT r.id) responses,
        COUNT(DISTINCT CASE WHEN m.value=1 THEN r.id END) mentions,
        COUNT(DISTINCT CASE WHEN m.value=1 AND ${ANSWER_ANALYSED_SQL} THEN r.id END) voice_mentions
        FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id
        JOIN json_each(${EFFECTIVE_TARGETS_SQL}) target LEFT JOIN json_each(${EFFECTIVE_MENTIONS_SQL}) m ON m.key=json_extract(target.value,'$.name')
        WHERE ${ctx.where} AND ${complete} GROUP BY period,name,domain,own,r.engine,p.tag`)
      .bind(ctx.brandBinding, ctx.periodStart, ...ctx.combinedBindings),
    ctx.database
      .prepare(`${ctx.withClause} SELECT CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,${TOPIC_SQL} topic,COUNT(*) responses,SUM(${VOICE_BRANDS_SQL}) total,
        SUM(CASE WHEN ${ANSWER_ANALYSED_SQL} THEN 1 ELSE 0 END) analysed
        FROM runs r ${TOPIC_JOIN} WHERE ${ctx.where} AND ${complete} GROUP BY period,topic`)
      .bind(ctx.brandBinding, ctx.periodStart, ...ctx.combinedBindings),
  ]);
  // Rates are topic-weighted (lib/topic-weights): every sum below has its real count and its weighted one.
  const factors = periodFactors(brandTotals, ctx.topicWeights);
  const factor = (row: Record<string, unknown>) => factorOf(factors[row.period === 'previous' ? 'previous' : 'current'], row.topic);
  const totalOf = (period: string, field: string, weighted = false) =>
    brandTotals.filter((row) => row.period === period).reduce((sum, row) => sum + (weighted ? factor(row) : 1) * Number(row[field] || 0), 0);
  const allMentions = (period: string) => totalOf(period, 'total', true);
  // Every discovery of the answers, by its group (a merged name with the brand it joined), counted or not: the Brands list
  // measures them under any filter, like the monitored brands. One row per brand, its topic weights applied in the query: a
  // row per brand, topic and period went past the store's 10,000 rows on a large window (6,700 discoveries in Netflix's).
  // Past the most mentioned 9,000 a brand shows its window's answers instead (as when a filter does not apply to it).
  const weights = JSON.stringify(
    [...new Set(brandTotals.map((row) => String(row.topic ?? '')))].map((topic) => [topic, factorOf(factors.current, topic), factorOf(factors.previous, topic)]),
  );
  const { results: discoveredRows } = await ctx.database
    .prepare(`${ctx.withClause} SELECT brand,SUM(now) mentions,SUM(1-now) previous,SUM(now*wc) weighted_mentions,SUM((1-now)*wp) weighted_previous,MAX(counted) counted
      FROM (SELECT r.id,CASE WHEN r.created_at>=? THEN 1 ELSE 0 END now,${DISCOVERY_GROUP_SQL} brand,MAX(${DISCOVERY_COUNTED_SQL}) counted,
          COALESCE(f.wc,0) wc,COALESCE(f.wp,0) wp
        FROM runs r ${TOPIC_JOIN},${ANSWER_DISCOVERIES_SQL} found
        LEFT JOIN (SELECT json_extract(value,'$[0]') topic,json_extract(value,'$[1]') wc,json_extract(value,'$[2]') wp FROM json_each(?)) f ON f.topic=${TOPIC_SQL}
        WHERE ${ctx.where} AND ${complete} GROUP BY r.id,brand)
      GROUP BY brand ORDER BY mentions DESC,brand LIMIT 9000`)
    .bind(ctx.brandBinding, ctx.periodStart, weights, ...ctx.combinedBindings)
    .all<Record<string, unknown>>();
  const discovered: NonNullable<CompetitorsReport['discovered']> = {};
  for (const row of discoveredRows)
    discovered[String(row.brand)] = {
      mentions: Number(row.mentions),
      previous: Number(row.previous),
      counted: Number(row.counted) === 1,
      weightedMentions: Number(row.weighted_mentions),
      weightedPrevious: Number(row.weighted_previous),
    };
  // An answer keeps the brand names of its collection (an alias, an old name) until the brand analysis relabels it, which
  // a new project or a just-changed list has not done yet. The report names the brands as the project does now, like the
  // summary: the first target is the project's own brand, a competitor is known by its domain.
  const current = currentBrandName(ctx);
  for (const row of periodRows) {
    if (Number(row.own)) row.domain = String(ctx.project.domain);
    row.name = current(String(row.name), String(row.domain), Number(row.own) === 1);
  }
  const rows = periodRows.filter((row) => row.period === 'current');
  // A row counts one brand's answers of one model and topic: a brand's total sums them, as the current matrix does.
  const before = new Map<string, { responses: number; mentions: number; weightedResponses: number; weightedMentions: number; weightedVoice: number }>();
  for (const row of periodRows)
    if (row.period === 'previous') {
      const value = before.get(String(row.name)) ?? { responses: 0, mentions: 0, weightedResponses: 0, weightedMentions: 0, weightedVoice: 0 };
      value.responses += Number(row.responses);
      value.mentions += Number(row.mentions);
      value.weightedResponses += factor(row) * Number(row.responses);
      value.weightedMentions += factor(row) * Number(row.mentions);
      value.weightedVoice += factor(row) * Number(row.voice_mentions ?? 0);
      before.set(String(row.name), value);
    }
  const previousMentions = allMentions('previous');
  const targets = new Map<string, { name: string; domain: string }>();
  for (const row of rows)
    targets.set(String(row.name), {
      name: String(row.name),
      domain: String(row.domain),
    });
  const totalMentions = allMentions('current');
  const matrix = (dimension: 'engine' | 'topic') =>
    [...targets.values()].map((target) => {
        const cells: CompetitorsReport['platforms'][number]['cells'] = {};
        const weightedCells = new Map<string, { responses: number; mentions: number; voice: number }>();
        for (const row of rows.filter(
        (value) => String(value.name) === target.name,
      )) {
        const key = String(row[dimension]);
        const previous = cells[key] || {
          responses: 0,
          mentions: 0,
          visibility: 0,
        };
        const weighted = weightedCells.get(key) ?? { responses: 0, mentions: 0, voice: 0 };
        weighted.responses += factor(row) * Number(row.responses);
        weighted.mentions += factor(row) * Number(row.mentions);
        weighted.voice += factor(row) * Number(row.voice_mentions ?? 0);
        weightedCells.set(key, weighted);
        const responses = previous.responses + Number(row.responses);
        const mentions = previous.mentions + Number(row.mentions);
        cells[key] = {
          responses,
          mentions,
          visibility: weighted.responses ? (weighted.mentions / weighted.responses) * 100 : 0,
        };
      }
        const values = Object.values(cells);
        const responses = values.reduce((sum, value) => sum + value.responses, 0);
        const mentions = values.reduce((sum, value) => sum + value.mentions, 0);
        const weightedResponses = [...weightedCells.values()].reduce((sum, value) => sum + value.responses, 0);
        const weightedMentions = [...weightedCells.values()].reduce((sum, value) => sum + value.mentions, 0);
        const weightedVoice = [...weightedCells.values()].reduce((sum, value) => sum + value.voice, 0);
        const previous = before.get(target.name);
        return {
          ...target,
          responses,
          mentions,
          visibility: weightedResponses ? (weightedMentions / weightedResponses) * 100 : 0,
          shareOfVoice: totalMentions ? (weightedVoice / totalMentions) * 100 : null,
          cells,
          // Absent: the brand had no complete answer in the comparison period (nothing to compare, never a zero).
          // Absent too when it measured fewer than half the current answers (lib/period-coverage).
          ...(previous?.responses && coveredPeriods(previous.responses, responses) ? { previous: {
            responses: previous.responses,
            mentions: previous.mentions,
            visibility: previous.weightedResponses ? (previous.weightedMentions / previous.weightedResponses) * 100 : 0,
            shareOfVoice: previousMentions ? (previous.weightedVoice / previousMentions) * 100 : null,
          } } : {}),
        };
      })
      .sort(
        (a, b) =>
          (b.shareOfVoice ?? -1) - (a.shareOfVoice ?? -1) ||
          a.name.localeCompare(b.name),
      );
  const gaps = (
    await ctx.database
        .prepare(`${ctx.withClause} SELECT COALESCE(p.unit_id,p.id) prompt,p.text label,p.tag topic,
      json_group_array(DISTINCT r.engine) engines,COUNT(DISTINCT r.id) responses,
      json_group_array(DISTINCT json_object('name',m.key,'domain',json_extract(target.value,'$.domain'))) brands
      FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id
      JOIN json_each(${EFFECTIVE_MENTIONS_SQL}) m ON m.value=1
      JOIN json_each(${EFFECTIVE_TARGETS_SQL}) target ON json_extract(target.value,'$.name')=m.key
      WHERE ${ctx.where} AND ${complete} AND NOT ${ctx.mentionExpression} AND ${ctx.otherMention}
      GROUP BY COALESCE(p.unit_id,p.id),p.text,p.tag ORDER BY responses DESC,p.text,prompt LIMIT ${COMPETITOR_ONLY_PAGE + 1} OFFSET ?`)
      .bind(ctx.brandBinding, ...ctx.bindings, (page - 1) * COMPETITOR_ONLY_PAGE)
      .all<Record<string, unknown>>()
  ).results;
  return {
    hasMoreCompetitorOnly: gaps.length > COMPETITOR_ONLY_PAGE,
    platforms: matrix('engine'),
    topics: matrix('topic'),
    competitorOnly: gaps.slice(0, COMPETITOR_ONLY_PAGE).map((row) => ({
      prompt: String(row.prompt),
      label: String(row.label),
      responses: Number(row.responses),
      engine: (JSON.parse(String(row.engines)) as Engine[])[0],
      engines: JSON.parse(String(row.engines)) as Engine[],
      brands: (JSON.parse(String(row.brands)) as { name: string; domain: string }[]).map((brand) => ({
        ...brand,
        name: current(brand.name, brand.domain),
      })).filter((brand, index, all) => all.findIndex((other) => other.name === brand.name) === index),
      topic: String(row.topic),
    })),
    discovered,
    totals: {
      responses: totalOf('current', 'responses'),
      mentions: totalOf('current', 'total'),
      previousResponses: totalOf('previous', 'responses'),
      previousMentions: totalOf('previous', 'total'),
      weightedResponses: totalOf('current', 'responses', true),
      weightedMentions: allMentions('current'),
      weightedPreviousResponses: totalOf('previous', 'responses', true),
      weightedPreviousMentions: previousMentions,
      // The answers the brand analysis read in each period: a discovered brand is compared only when the earlier one has enough.
      analysed: totalOf('current', 'analysed'),
      previousAnalysed: totalOf('previous', 'analysed'),
      // The same, topic-weighted: a discovered brand's visibility divides by them (run-rows voiceSql).
      weightedAnalysed: totalOf('current', 'analysed', true),
      weightedPreviousAnalysed: totalOf('previous', 'analysed', true),
    },
  };
}
/**
 * `kind`: `cited` and `consulted` read one list; `all` reads every source an answer cited or consulted, and `uncited`
 * the ones of those never cited in the cohort. Those two count a response once whichever list holds the source, over
 * every complete answer (an answer without a consulted list still has its citations).
 * `evidence=1` (the Sources list) also reads the other list of a one-list read, only to say of each row whether it was
 * cited and whether consulted; its presence still counts the chosen list alone.
 */
const SOURCE_KINDS = ['cited', 'consulted', 'all', 'uncited'] as const;
function sourceOptions(q: URLSearchParams) {
  const kind = (q.get('kind') || 'cited') as (typeof SOURCE_KINDS)[number],
    group = q.get('group') || 'domain';
  if (
    !SOURCE_KINDS.includes(kind) ||
    !['domain', 'url'].includes(group)
  )
    throw new ApiError(400, 'Invalid source filter.');
  return {
    column: kind === 'consulted' ? 'r.consulted_sources_json' : 'r.sources_json',
    group,
    kind,
    union: kind === 'all' || kind === 'uncited',
  };
}
/** Both origins feed the existing source aggregation; keys are still deduplicated by sourceKey and GROUP BY. */
/** `lean`: for counts that read neither the targets nor the mention, so they are not computed for every answer. */
/** `previous`: the same cohort over the comparison period, as `previous_cohort` after another cohort's WITH. */
function sourceCohort(ctx: Context, q: URLSearchParams, lean = false, previous = false) {
  const origin = q.get('origin') || 'all';
  if (!['all', 'prompts', 'semantic-branding'].includes(origin)) throw new ApiError(400, 'Invalid source origin.');
  const prompts = origin !== 'semantic-branding';
  const semantic = origin !== 'prompts' ? (previous ? ctx.previousSemanticSources : ctx.semanticSources) ?? [] : [];
  return {
    sql: `${previous ? 'previous_cohort' : `${ctx.withClause}, cohort`} AS MATERIALIZED (
      SELECT r.id,r.created_at,r.engine,r.sources_json,r.consulted_sources_json,${lean ? 'NULL' : EFFECTIVE_TARGETS_SQL} targets_json,
        'prompts:' || COALESCE(p.unit_id,p.id) unit,${lean ? 'NULL' : ctx.mentionExpression} mentioned,NULL score,'prompts' origin,COALESCE(p.tag,'') topic,
        NULL listed_order
      FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id
      WHERE ${ctx.where} AND ${complete} AND ${prompts ? '1=1' : '0=1'}
      UNION ALL
      SELECT 'semantic:' || json_extract(value,'$.id'),json_extract(value,'$.date'),json_extract(value,'$.engine'),json_extract(value,'$.sources'),NULL,
        json_extract(value,'$.targets'),COALESCE(json_extract(value,'$.unit'),'semantic-branding'),NULL,json_extract(value,'$.score'),'semantic-branding','',
        CAST(key AS INTEGER)
      FROM json_each(?)
    )`,
    bindings: [...(previous ? ctx.previousBindings : [ctx.brandBinding,...ctx.bindings]),JSON.stringify(semantic)],
    origin,
  };
}
/** All ranking/filtering happens in SQLite before the UI page is selected. */
export const SOURCE_LIST_PAGE = 50;
/** Table column → SQL column for the sources list's own order (the type column is typed after paging, so it has none). */
const SOURCE_SORT_COLUMNS: Record<string, string> = {
  source: 'key',
  presence: 'presence',
  'average-score': 'average_score',
  questions: 'questions',
  stability: 'steady',
};
type SourceSelection = { keys?: string[]; exclude?: boolean; domain?: string; rules?: { sql: string; params: string[] } };
export async function sourcesReport(
  ctx: Context,
  q: URLSearchParams,
  size = SOURCE_LIST_PAGE,
  selection?: SourceSelection,
  /** The Sources list (`change=1`): each row's presence in the comparison period too (previousSourcePresence). */
  change = false,
): Promise<SourcesPage> {
  const [statement, page] = sourcesRead(ctx, q, size, selection);
  const result = page((await statement.all<Record<string, unknown>>()).results[0]);
  if (!change) return result;
  // Read after the page, for its keys only: in the same statement it was a second copy of the whole list query.
  const previous = await previousSourcePresence(ctx, q, result.rows.map((row) => row.key));
  // No answers then, or fewer than half the current ones (lib/period-coverage): no comparison (null), never a 0.
  const compared = previous.slots > 0 && coveredPeriods(previous.complete, result.complete);
  return { ...result, rows: result.rows.map((row) => ({ ...row, previousPresence: compared ? (previous.presence.get(row.key) ?? 0) : null })) };
}
/**
 * Statement shape (sourcesRead, previousSourcePresence). The Durable Object SQLite refuses a statement whose CTEs and
 * subqueries, each copied wherever it is read, add up to about 100 ("VIEWs and/or subqueries nested too deep", enforced by
 * Cloudflare's runtime since 10/11/2026). The list used to read its answers through eight CTEs that each read the
 * previous ones again (its leaders, page and comparison too): several hundred copies, and every Sources read failed. Now
 * every step reads the one before it once, and what was a separate CTE per figure is a window over the same rows.
 */
/** {@link sourcesReport} as its one statement and the page made from its row, for a caller that batches it with others. */
function sourcesRead(ctx: Context, q: URLSearchParams, size = SOURCE_LIST_PAGE, selection?: SourceSelection) {
  const { column, group, kind, union } = sourceOptions(q);
  // Both lists are read for `all`/`uncited`, and for a one-list read that asked for each row's evidence (cited, consulted).
  const both = union || q.get('evidence') === '1';
  const consultedOnly = kind === 'consulted';
  const cohort = sourceCohort(ctx, q);
  const page = Number(q.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000)
    throw new ApiError(400, 'Invalid page.');
  // Type-share distributions retain response incidence as their calculation base.
  const order = q.get('order') || 'presence';
  if (!['presence', 'responses'].includes(order)) throw new ApiError(400, 'Invalid source filter.');
  // The list's own column order (`sort` + `dir`) applies to the page only; `order` still ranks the leaders.
  const sort = q.get('sort');
  const sortColumn = sort && Object.hasOwn(SOURCE_SORT_COLUMNS, sort) ? SOURCE_SORT_COLUMNS[sort] : undefined;
  if (q.get('sort') && !sortColumn) throw new ApiError(400, 'Invalid source sort.');
  const rowOrder = sortColumn
    ? `${sortColumn} IS NULL,${sortColumn} ${q.get('dir') === 'asc' ? 'ASC' : 'DESC'},key`
    : `${order} DESC,key`;
  // `query` matches domain (group=domain) or URL (group=url) substring; legacy `q` kept.
  // Title is out of scope for the list search.
  const search = (q.get('query') || q.get('q') || '').trim().slice(0, 200);
  const ownOnly = q.get('own') === '1';
  if (q.get('own') && !ownOnly) throw new ApiError(400, 'Invalid source filter.');
  // Comma-separated owners (OR). Legacy single value still works.
  const owners = [...new Set((q.get('owner') || '').split(',').map((item) => item.trim()).filter(Boolean))];
  if (owners.some((item) => !isSourceOwner(item))) throw new ApiError(400, 'Invalid source owner.');
  const ownerClause = (owner: string) =>
    owner === 'own' ? 'own_snapshot=1'
      : owner === 'competitor' ? 'own_snapshot=0 AND competitor_snapshot=1'
      : 'own_snapshot=0 AND competitor_snapshot=0';
  const ownerWhere = owners.length && owners.length < 3
    ? ` AND (${owners.map((owner) => `(${ownerClause(owner)})`).join(' OR ')})`
    : '';
  // A domain or URL the deterministic rules type is decided by them (`WHEN` clauses) before ranking and pagination, whether or
  // not the catalog holds it; any other key by the catalog keys.
  const rules = selection?.rules;
  const keyIn = `key ${selection?.exclude ? 'NOT IN' : 'IN'} (SELECT value FROM json_each(?))`;
  const keyWhere = selection?.keys ? ` AND (${rules ? `CASE ${rules.sql} ELSE ${keyIn} END` : keyIn})` : '';
  const domainWhere = selection?.domain ? ' AND domain=?' : '';
  // The tracked domains of an answer are listed once per answer (eligible), and each citation's domain is worked out once
  // (citations): the ownership test compares the two instead of walking every target of the answer for every citation.
  const trackedDomains = (role: string) =>
    `(SELECT json_group_array(d.value) FROM json_each(r.targets_json) target,json_each(CASE WHEN json_type(target.value,'$.domains')='array' THEN json_extract(target.value,'$.domains') ELSE json_array(json_extract(target.value,'$.domain')) END) d WHERE CAST(target.key AS INTEGER)${role})`;
  const own = `EXISTS(SELECT 1 FROM json_each(o.own_domains) d WHERE d.value=o.domain)`;
  const competitor = `EXISTS(SELECT 1 FROM json_each(o.competitor_domains) d WHERE d.value=o.domain)`;
  // Derived from sourcePresence: hits are distinct responses, the denominator counts combinations (question × model, a
  // "slot") once. Topic weights (lib/topic-weights): each slot counts its topic's share of the weights, spread over that
  // topic's slots; without weights every slot counts 1. The weights are a quoted literal, so no binding moves.
  const weight = sourceTopicWeight(ctx, 'r.slot_topic');
  // A slot counts the answers that read the list asked (consulted: the models that supplied consulted evidence); every
  // listed source of a counted answer belongs to its slot. `missing URLs are misses` (the full cohort stays the base).
  const inSlot = consultedOnly ? '(r.consulted_sources_json IS NOT NULL)' : '1';
  // Which occurrences count (`hits`); the others only say whether a key was also cited or consulted (`evidence`).
  const hit = both && kind === 'cited' ? 'o.cited=1' : both && consultedOnly ? 'o.cited=0' : '1';
  const rowJson = () => `json_object(${[
    'key','domain','title','responses','citations','mentions','pages','engines','own_snapshot','competitor_snapshot',
    'presence','slots','questions','steady','once','single','average_score','mention_responses','cited_responses',
    ...(both ? ['cited_any','consulted_any'] : []),
  ].map((key) => `'${key}',${key}`).join(',')})`;
  // One occurrence per listed source; `cited` tells a citation (1) from a consultation (0). The single list of a
  // one-list read without evidence counts as that kind.
  const occurrence = (list: string, cited: number) => `SELECT r.id,r.unit,r.engine,r.mentioned,r.score,r.own_domains,r.competitor_domains,
        r.n,r.w,r.weight_total,r.answer_order,CAST(s.key AS INTEGER) source_order,${group === 'domain' ? 'NULL' : sourceKey('s', group)} key,
        ${sourceKey('s', 'domain')} domain,json_extract(s.value,'$.url') url,json_extract(s.value,'$.title') title,${cited} cited
      FROM answers r,json_each(${list}) s`;
  // `answer_order`: the answers by date (prompts, then Semantic Branding's in their own order), the order SQLite used to read
  // them: a source's AIs are listed in the order they first named it, whatever index reads the answers (a prompt's own).
  // `keyed` ends with `LIMIT -1` (no limit): SQLite does not push the list's filters down into a query with a limit. Pushed
  // into that aggregate and on through the windows, the site-type rules met the key's own expression and passed SQLite's
  // expression depth of 100.
  const sql = `${cohort.sql},
    eligible AS MATERIALIZED (SELECT r.*,${trackedDomains('=0')} own_domains,${trackedDomains('>0')} competitor_domains,${inSlot} in_slot,
        ROW_NUMBER() OVER (ORDER BY origin<>'prompts',CASE WHEN origin='prompts' THEN created_at END,CASE WHEN origin='prompts' THEN id END,listed_order) answer_order
      FROM cohort r),
    slotted AS (SELECT r.*,SUM(in_slot) OVER slot n,MIN(CASE WHEN in_slot THEN topic END) OVER slot slot_topic,
        in_slot AND ROW_NUMBER() OVER (PARTITION BY unit,engine ORDER BY in_slot DESC,id)=1 slot_first,
        in_slot AND ROW_NUMBER() OVER (PARTITION BY unit ORDER BY in_slot DESC,id)=1 unit_first,
        in_slot AND ROW_NUMBER() OVER (PARTITION BY engine ORDER BY in_slot DESC,id)=1 engine_first,
        COUNT(*) OVER () complete,COUNT(consulted_sources_json) OVER () available
      FROM eligible r WINDOW slot AS (PARTITION BY unit,engine)),
    weighted AS (SELECT r.*,${weight ? `${weight}*1.0/SUM(slot_first) OVER topic` : '1'} w,SUM(slot_first) OVER topic n_t,
        slot_first AND ROW_NUMBER() OVER (PARTITION BY slot_topic ORDER BY slot_first DESC,unit,engine)=1 topic_first,
        SUM(slot_first) OVER () slots,SUM(unit_first) OVER () questions,SUM(engine_first) OVER () models
      FROM slotted r WINDOW topic AS (PARTITION BY slot_topic)),
    answers AS MATERIALIZED (SELECT r.*,
        SUM(CASE WHEN topic_first THEN w*n_t END) OVER (ORDER BY slot_topic ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) weight_total
      FROM weighted r),
    listed AS MATERIALIZED (
      ${both ? `${occurrence('r.sources_json', 1)}
      UNION ALL ${occurrence('r.consulted_sources_json', 0)}` : occurrence(column, 1)}
    ),
    occurrences AS (SELECT o.id,o.unit,o.engine,o.mentioned,o.score,o.n,o.w,o.weight_total,o.answer_order,o.source_order,${group === 'domain' ? 'o.domain' : 'o.key'} key,o.domain,o.url,o.title,o.cited,
        ${own} own_snapshot,${competitor} competitor_snapshot,${hit} hit FROM listed o),
    firsts AS (SELECT o.*,hit AND ROW_NUMBER() OVER (PARTITION BY key,hit,id)=1 id_first,
        hit AND ROW_NUMBER() OVER (PARTITION BY key,hit,unit,engine)=1 key_slot_first,
        hit AND ROW_NUMBER() OVER (PARTITION BY key,hit,engine ORDER BY cited DESC,answer_order,source_order)=1 engine_first
      FROM occurrences o),
    counted AS (SELECT o.*,SUM(id_first) OVER (PARTITION BY key,unit,engine) slot_hits FROM firsts o),
    keyed AS (
      SELECT key,MIN(CASE WHEN hit THEN domain END) domain,MIN(CASE WHEN hit THEN title END) title,
        COUNT(DISTINCT CASE WHEN hit THEN id END) responses,SUM(CASE WHEN hit THEN cited END) citations,
        COUNT(DISTINCT CASE WHEN hit AND cited=1 THEN id END) cited_responses,
        COUNT(DISTINCT CASE WHEN hit AND mentioned THEN id END) mentions,
        COUNT(DISTINCT CASE WHEN hit AND mentioned IS NOT NULL THEN id END) mention_responses,
        COUNT(DISTINCT CASE WHEN hit THEN url END) pages,group_concat(CASE WHEN engine_first THEN engine END,',' ORDER BY cited DESC,answer_order,source_order) engines,
        MAX(CASE WHEN hit THEN own_snapshot END) own_snapshot,MAX(CASE WHEN hit THEN competitor_snapshot END) competitor_snapshot,
        100.0*SUM(CASE WHEN key_slot_first THEN w*slot_hits*1.0/n END ORDER BY unit,engine)/NULLIF(MAX(weight_total),0) presence,
        SUM(key_slot_first) slots,COUNT(DISTINCT CASE WHEN key_slot_first THEN unit END) questions,
        SUM(CASE WHEN key_slot_first AND n>1 AND slot_hits=n THEN 1 ELSE 0 END) steady,
        SUM(CASE WHEN key_slot_first AND n>1 AND slot_hits=1 THEN 1 ELSE 0 END) once,
        SUM(CASE WHEN key_slot_first AND n=1 THEN 1 ELSE 0 END) single,
        AVG(CASE WHEN id_first THEN score END ORDER BY id) average_score${both ? ',MAX(cited) cited_any,MIN(cited)=0 consulted_any' : ''}
      FROM counted GROUP BY key HAVING SUM(hit)>0 LIMIT -1
    ),
    ranked AS (
      SELECT k.*,ROW_NUMBER() OVER (ORDER BY ${rowOrder}) page_rn,ROW_NUMBER() OVER (ORDER BY ${order} DESC,key) order_rn,
        ROW_NUMBER() OVER (ORDER BY questions DESC,presence DESC,key) wide_rn
      FROM keyed k
      WHERE (?='' OR instr(lower(COALESCE(key,'')),lower(?))>0)
      ${ownOnly ? ' AND own_snapshot=1' : ''}${ownerWhere}${keyWhere}${domainWhere}${kind === 'uncited' ? ' AND cited_responses=0' : ''}
    )
    SELECT json_group_array(${rowJson()} ORDER BY page_rn) FILTER (WHERE page_rn>? AND page_rn<=?) rows,
      json_group_array(${rowJson()} ORDER BY order_rn) FILTER (WHERE order_rn<=10) ranking,
      MAX(CASE WHEN wide_rn=1 THEN ${rowJson()} END) wide_row,
      (SELECT json_array(slots,questions,models,complete,available) FROM answers LIMIT 1) totals
    FROM ranked`;
  const bindings = [...cohort.bindings,search,search,
    ...(selection?.keys ? [...(rules?.params ?? []), JSON.stringify(selection.keys)] : []),...(selection?.domain ? [selection.domain] : []),
    (page-1)*size,(page-1)*size+size+1];
  const statement = ctx.database.prepare(sql).bind(...bindings);
  return [statement, (result: Record<string, unknown> | undefined): SourcesPage => {
  const map = (r: Record<string, unknown>): SourceRow => ({
    key: String(r.key),domain: String(r.domain),title: group === 'domain' ? String(r.domain) : String(r.title || r.key),
    averageScore: r.average_score == null ? null : Number(r.average_score),
    responses: Number(r.responses),citations: Number(r.citations),pages: Number(r.pages),
    engines: String(r.engines).split(',') as Engine[],mentions: Number(r.mentions),
    // Semantic answers have no per-response mention measurement.
    visibility: Number(r.mention_responses) ? 100*Number(r.mentions)/Number(r.mention_responses) : null,
    ownership: Number(r.own_snapshot) ? 'own' : Number(r.competitor_snapshot) ? 'competitor' : 'third-party',
    // Whether the answers cited it and whether they consulted it (a one-list read without evidence says only what it read).
    ...(both ? {cited: Number(r.cited_any) > 0,consulted: Number(r.consulted_any) > 0} : consultedOnly ? {} : {cited: Number(r.cited_responses) > 0}),
    presence: {presence: Number(r.presence),slots: Number(r.slots),questions: Number(r.questions),steady: Number(r.steady),once: Number(r.once),single: Number(r.single)},
  });
  const rows = (JSON.parse(String(result?.rows || '[]')) as Record<string,unknown>[]).map(map);
  const ranking = (JSON.parse(String(result?.ranking || '[]')) as Record<string,unknown>[]).map(map);
  const [slots, questions, models, complete, available] = (JSON.parse(String(result?.totals || '[]')) as unknown[]).map((value) => Number(value || 0));
  return {
    presenceVersion: 1,
    origin: cohort.origin as SourcesPage['origin'],
    rows: rows.slice(0,size),hasMore: rows.length>size,
    totals: {slots: slots || 0,questions: questions || 0,models: models || 0},
    ...(result?.wide_row ? {leaders: {ranking,widest: map(JSON.parse(String(result.wide_row)))}} : {}),
    available: available || 0,complete: complete || 0,
  };
  }] as const;
}
/** The topic weight of a slot's topic (`topic` is its SQL), or null when the project weighs every topic the same. */
function sourceTopicWeight(ctx: Context, topic: string) {
  const weights = ctx.topicWeights;
  if (!weights) return null;
  const json = `'${JSON.stringify(Object.fromEntries(weights)).replace(/'/g, "''")}'`;
  return `COALESCE((SELECT value FROM json_each(${json}) WHERE key=${topic}),${Math.min(...weights.values())})`;
}
/**
 * Each of `keys`' presence in the comparison period of `q` (the Sources list's change), and the period's slots (0: the
 * comparison has no answers, so its presence is unknown, never 0). A key's presence depends on the lists read and the
 * combinations, never on the row filters, so those are not repeated.
 */
async function previousSourcePresence(ctx: Context, q: URLSearchParams, keys: string[]) {
  const { column, group, kind, union } = sourceOptions(q);
  const consultedOnly = kind === 'consulted';
  const previous = sourceCohort(ctx, q, true, true);
  const weight = sourceTopicWeight(ctx, 'previous_slots.topic');
  // The period's filters may name the selected brand (report_brand), as the list's own statement does.
  const sql = `${ctx.withClause}, ${previous.sql},
    previous_slots AS (SELECT unit,engine,MIN(topic) topic,COUNT(*) n FROM previous_cohort${consultedOnly ? ' WHERE consulted_sources_json IS NOT NULL' : ''} GROUP BY unit,engine),
    previous_slot_weight AS (SELECT topic,${weight ? `${weight}*1.0/COUNT(*)` : '1'} w,COUNT(*) n FROM previous_slots GROUP BY topic),
    previous_hits AS (
      SELECT key,unit,engine,COUNT(DISTINCT id) hits FROM (${(union ? ['r.sources_json', 'r.consulted_sources_json'] : [column]).map((list) =>
        `SELECT r.id,r.unit,r.engine,${sourceKey('s', group)} key FROM previous_cohort r,json_each(${list}) s`).join(' UNION ALL ')})
      WHERE key IN (SELECT value FROM json_each(?)) GROUP BY key,unit,engine
    ),
    previous_presence AS (
      SELECT k.key,100.0*SUM(w.w*k.hits*1.0/c.n)/NULLIF((SELECT SUM(w*n) FROM previous_slot_weight),0) previous_presence
      FROM previous_hits k JOIN previous_slots c USING(unit,engine) JOIN previous_slot_weight w ON w.topic=c.topic GROUP BY k.key
    )
    SELECT (SELECT json_group_array(json_array(key,previous_presence)) FROM previous_presence) rows,
      (SELECT COUNT(*) FROM previous_slots) slots,(SELECT COUNT(*) FROM previous_cohort) complete`;
  const result = await ctx.database.prepare(sql).bind(ctx.brandBinding, ...previous.bindings, JSON.stringify(keys)).first<{ rows: string; slots: number; complete: number }>();
  return {
    slots: Number(result?.slots || 0),
    complete: Number(result?.complete || 0),
    presence: new Map((JSON.parse(String(result?.rows || '[]')) as [string, number | null][]).map(([key, value]) => [key, Number(value ?? 0)])),
  };
}
/** Keys per page of {@link sourceCounts}: compact `[key,responses,domain,title]` rows, far below the store's result ceiling. */
export const SOURCE_COUNT_PAGE = 2000;
/**
 * Every cited domain or URL of the cohort with the responses citing it, unranked and paged by key. The typed
 * summaries and the source classification read this instead of a ranked window, so no tail stays untyped.
 */
export async function sourceCounts(ctx: Context, q: URLSearchParams, offset = 0, size = SOURCE_COUNT_PAGE) {
  const { group } = sourceOptions(q);
  const cohort = sourceCohort(ctx, q);
  const sql = `${cohort.sql}
    SELECT json_group_array(json_array(key,responses,domain,title)) rows FROM (
      SELECT COALESCE(${sourceKey('s', group)},'') key,COUNT(DISTINCT r.id) responses,
        MIN(${sourceKey('s', 'domain')}) domain,MIN(json_extract(s.value,'$.title')) title
      FROM cohort r,json_each(r.sources_json) s
      GROUP BY 1 ORDER BY 1 LIMIT ? OFFSET ?)`;
  const result = await ctx.database.prepare(sql).bind(...cohort.bindings, size + 1, offset).first<{ rows: string }>();
  const rows = (JSON.parse(String(result?.rows || '[]')) as [string, number, string, string | null][]).map(
    ([key, responses, domain, title]) => ({ key, responses: Number(responses), domain: String(domain ?? ''), title: String(title || key) }),
  );
  return { rows: rows.slice(0, size), hasMore: rows.length > size };
}
/** Keys per page of {@link sourceKeyCounts}: `[key,responses]` only, so a whole typed summary is one or two store scans. */
export const SOURCE_KEY_COUNT_PAGE = 8000;
/** {@link sourceCounts} without the domain and title the typed summaries never read (and without the per-answer targets). */
export async function sourceKeyCounts(ctx: Context, q: URLSearchParams, offset = 0, size = SOURCE_KEY_COUNT_PAGE) {
  const { group } = sourceOptions(q);
  const cohort = sourceCohort(ctx, q, true);
  const sql = `${cohort.sql}
    SELECT json_group_array(json_array(key,responses)) rows FROM (
      SELECT COALESCE(${sourceKey('s', group)},'') key,COUNT(DISTINCT r.id) responses
      FROM cohort r,json_each(r.sources_json) s
      GROUP BY 1 ORDER BY 1 LIMIT ? OFFSET ?)`;
  const result = await ctx.database.prepare(sql).bind(...cohort.bindings, size + 1, offset).first<{ rows: string }>();
  const rows = (JSON.parse(String(result?.rows || '[]')) as [string, number][]).map(([key, responses]) => ({ key, responses: Number(responses) }));
  return { rows: rows.slice(0, size), hasMore: rows.length > size };
}

export async function sourceDetail(
  ctx: Context,
  q: URLSearchParams,
): Promise<SourceDetail> {
  const { column, group } = sourceOptions(q),
    key = q.get('key');
  if (!key || key.length > 4000) throw new ApiError(400, 'Invalid source.');
  const after = cursorWhere(q.get('cursor'));
  const sourceAfter = q.get('sourceCursor') || '';
  if (sourceAfter.length > 4000) throw new ApiError(400, 'Invalid cursor.');
  const search = (q.get('q') || '').trim();
  if (search.length > 200)
    throw new ApiError(400, 'The search query is too long.');
  const ownOnly = q.get('own') === '1';
  if (q.get('own') && !ownOnly)
    throw new ApiError(400, 'Invalid source filter.');
  const ownershipWhere = ownOnly
    ? ` AND EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_TARGETS_SQL}) own_target,json_each(CASE WHEN json_type(own_target.value,'$.domains')='array' THEN json_extract(own_target.value,'$.domains') ELSE json_array(json_extract(own_target.value,'$.domain')) END) own_domain WHERE CAST(own_target.key AS INTEGER)=0 AND own_domain.value=${sourceKey('s', 'domain')})`
    : '';
  const [sources, runs] = await ctx.database.batch<Record<string, unknown>>([
    ctx.database
      .prepare(`${ctx.withClause} SELECT DISTINCT json_extract(s.value,'$.url') url,${sourceKey('s', 'domain')} domain,json_extract(s.value,'$.title') title
      FROM runs r,json_each(${column}) s WHERE ${ctx.where} AND ${complete} AND ${sourceKey('s', group)}=?
      AND (?='' OR instr(lower(COALESCE(json_extract(s.value,'$.url'),'') || ' ' || COALESCE(json_extract(s.value,'$.title'),'')),lower(?))>0)
      ${ownershipWhere}
      AND (?='' OR json_extract(s.value,'$.url')>?) ORDER BY url LIMIT 51`)
      .bind(
        ctx.brandBinding,
        ...ctx.bindings,
        key,
        search,
        search,
        sourceAfter,
        sourceAfter,
      ),
    ctx.database
      .prepare(`${ctx.withClause} SELECT ${RUN_SUMMARY_COLUMNS} FROM runs r WHERE ${ctx.where} AND ${complete}
      AND EXISTS(SELECT 1 FROM json_each(${column}) s WHERE ${sourceKey('s', group)}=?
        AND (?='' OR instr(lower(COALESCE(json_extract(s.value,'$.url'),'') || ' ' || COALESCE(json_extract(s.value,'$.title'),'')),lower(?))>0)
        ${ownershipWhere})${after.where} ORDER BY r.created_at DESC,r.id DESC LIMIT 26`)
      .bind(
        ctx.brandBinding,
        ...ctx.bindings,
        key,
        search,
        search,
        ...after.bindings,
      ),
  ]);
  const page = historyPage(runs.results);
  return {
    sources: sources.results.slice(0, 50) as unknown as Citation[],
    nextSourceCursor:
      sources.results.length > 50
        ? String(sources.results[49]?.url || '')
        : null,
    ...page,
    hasMore: !!page.nextCursor,
  };
}

/** Citations (responses × distinct domain) in the cohort, independent of paging. */
export async function citationTotal(ctx: Context, q: URLSearchParams) {
  const { column, group } = sourceOptions(q);
  const cohort = sourceCohort(ctx, q);
  const row = await ctx.database
    .prepare(`${cohort.sql} SELECT COUNT(*) citations FROM (SELECT DISTINCT r.id,${sourceKey('s', group)} key FROM cohort r,json_each(${column}) s)`)
    .bind(...cohort.bindings)
    .first<{ citations: number }>();
  return Number(row?.citations || 0);
}

const rate = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);

/**
 * Detail of one cited domain or URL. `citing` is the cohort of complete
 * responses whose cited sources contain the key; `total` is the same period and
 * filters without the source condition, so rates state their denominator.
 */
export async function sourceEntityReport(
  owner: string,
  q: URLSearchParams,
  kind: 'domain' | 'url',
  /** The request's own context (same project and period): its reads are reused, so the detail reads nothing again. */
  known?: KnownContext,
): Promise<Omit<SourceEntityDetail, 'sourceType' | 'domainType' | 'classifier'>> {
  const key = (q.get('key') || '').trim();
  if (!key || key.length > 4000) throw new ApiError(400, 'Invalid source.');
  const citingQuery = new URLSearchParams(q);
  citingQuery.delete('key');
  citingQuery.set('source', key);
  const sourceKind = q.get('kind') === 'consulted' ? 'consulted' : 'cited';
  const sourceColumn = sourceKind === 'consulted' ? 'r.consulted_sources_json' : 'r.sources_json';
  citingQuery.set('sourceKind', sourceKind);
  citingQuery.set('sourceGroup', kind);
  const totalQuery = new URLSearchParams(citingQuery);
  totalQuery.delete('source');
  // `citing` differs from `total` only by the source condition: it is built from it, with no read of its own.
  const total = await reportContext(owner, totalQuery, [], undefined, known);
  const citing = await reportContext(owner, citingQuery, [], undefined, total);
  const presenceQuery = new URLSearchParams(totalQuery);
  presenceQuery.set('kind', sourceKind);
  presenceQuery.set('group', kind);
  presenceQuery.set('page', '1');
  presenceQuery.delete('q');
  presenceQuery.delete('owner');
  presenceQuery.delete('own');
  const [presenceStatement, presencePageOf] = sourcesRead(total, presenceQuery, 1, { keys: [key] });
  const cohort = sourceCohort(total, presenceQuery);
  const cohortHit = `EXISTS(SELECT 1 FROM json_each(${sourceColumn}) s WHERE ${sourceKey('s', kind)}=?)`;
  // Daily/model rates use exactly the same logical combination weighting as the list.
  const presenceBuckets = (bucket: 'day' | 'engine') =>
    total.database.prepare(`${cohort.sql}, observations AS (
      SELECT ${bucket === 'day' ? 'substr(r.created_at,1,10)' : 'r.engine'} bucket,
        r.unit,r.engine,
        EXISTS(SELECT 1 FROM json_each(${sourceColumn}) s WHERE ${sourceKey('s', kind)}=?) hit
      FROM cohort r
      WHERE 1=1${sourceKind === 'consulted' ? ' AND r.consulted_sources_json IS NOT NULL' : ''}
    ), combinations AS (
      SELECT bucket,unit,engine,AVG(hit*1.0) weight FROM observations GROUP BY bucket,unit,engine
    ) SELECT bucket,100.0*AVG(weight) presence,COUNT(*) denominator,SUM(weight>0) slots,
      COUNT(DISTINCT CASE WHEN weight>0 THEN unit END) questions
      FROM combinations GROUP BY bucket ORDER BY presence DESC,bucket`)
      .bind(...cohort.bindings,key);
  const presenceOf = (rows: Record<string, unknown>[]) =>
    new Map(rows.map((row) => [String(row.bucket),{
      presence: Number(row.presence),denominator: Number(row.denominator),slots: Number(row.slots),questions: Number(row.questions),
    }]));
  const urlQuery = new URLSearchParams(presenceQuery);
  urlQuery.set('group', 'url');
  // The domain's URLs follow the list's filter (`kind=all` lists the cited and the consulted ones), each saying which it was.
  if (q.get('kind') === 'all') urlQuery.set('kind', 'all');
  urlQuery.set('evidence', '1');
  const urlRead = kind === 'domain' ? sourcesRead(total, urlQuery, 25, { domain: key }) : null;
  const semanticOnly = cohort.origin === 'semantic-branding';
  const bindCiting = [citing.brandBinding, ...citing.bindings];
  const cited = `${sourceKey('s', kind)}=?`;
  // Every read is independent: two store calls side by side (a call takes up to 10 statements).
  const [reads, [identity, daily, totalDaily, platforms, totalPlatforms, prompts, brands]] =
    await Promise.all([
      total.database.batch<Record<string, unknown>>([
        presenceStatement,
        presenceBuckets('day'),
        presenceBuckets('engine'),
        total.database.prepare(`${cohort.sql} SELECT COUNT(*) total FROM cohort r`).bind(...cohort.bindings),
        ...(urlRead ? [urlRead[0]] : []),
        ...(semanticOnly ? [] : [historyStatement(citing, q)]),
      ]),
      citing.database.batch<Record<string, unknown>>([
      citing.database
        .prepare(`${cohort.sql} SELECT ${sourceKey('s', 'domain')} domain,MIN(json_extract(s.value,'$.title')) title,COUNT(DISTINCT json_extract(s.value,'$.url')) pages,COUNT(DISTINCT r.id) citing
        FROM cohort r,json_each(${sourceColumn}) s WHERE ${cited}`)
        .bind(...cohort.bindings, key),
      citing.database
        .prepare(`${cohort.sql} SELECT substr(r.created_at,1,10) date,COUNT(*) citing FROM cohort r WHERE ${cohortHit} GROUP BY date ORDER BY date LIMIT 91`)
        .bind(...cohort.bindings,key),
      citing.database
        .prepare(`${cohort.sql} SELECT substr(r.created_at,1,10) date,COUNT(*) total FROM cohort r GROUP BY date ORDER BY date LIMIT 91`)
        .bind(...cohort.bindings),
      citing.database
        .prepare(`${cohort.sql} SELECT r.engine,COUNT(*) citing FROM cohort r WHERE ${cohortHit} GROUP BY r.engine ORDER BY citing DESC`)
        .bind(...cohort.bindings,key),
      citing.database
        .prepare(`${cohort.sql} SELECT r.engine,COUNT(*) total FROM cohort r GROUP BY r.engine`)
        .bind(...cohort.bindings),
      total.database.prepare(`${total.withClause}, observations AS (
        SELECT COALESCE(p.unit_id,p.id) prompt,r.engine,p.text,p.tag,
          EXISTS(SELECT 1 FROM json_each(${sourceColumn}) s WHERE ${sourceKey('s', kind)}=?) hit
        FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id
        WHERE ${total.where} AND ${complete} AND ${semanticOnly ? '0=1' : '1=1'}${sourceKind === 'consulted' ? ' AND r.consulted_sources_json IS NOT NULL' : ''}
      ), combinations AS (
        SELECT prompt,engine,MIN(text) text,MIN(tag) topic,AVG(hit*1.0) weight,SUM(hit) responses FROM observations GROUP BY prompt,engine
      ) SELECT prompt,MIN(text) text,MIN(topic) topic,SUM(responses) responses,
        100.0*AVG(weight) presence,SUM(weight>0) slots,COUNT(*) denominator
        FROM combinations GROUP BY prompt HAVING SUM(responses)>0 ORDER BY presence DESC,prompt LIMIT 25`)
        .bind(total.brandBinding,key,...total.bindings),
      citing.database
        .prepare(`${citing.withClause} SELECT m.key name,COUNT(DISTINCT r.id) responses FROM runs r,json_each(${EFFECTIVE_MENTIONS_SQL}) m
        WHERE ${citing.where} AND ${complete} AND ${semanticOnly ? '0=1' : '1=1'} AND m.value=1 GROUP BY m.key ORDER BY responses DESC,name LIMIT 20`)
        .bind(...bindCiting),
      ]),
    ]);
  const [presenceRow, dayRows, engineRows, totalRows] = reads;
  const urlRow = urlRead ? reads[4] : null;
  const historyRows = semanticOnly ? null : reads.at(-1)!;
  const presencePage = presencePageOf(presenceRow.results[0]);
  const dailyPresence = presenceOf(dayRows.results);
  const modelPresence = presenceOf(engineRows.results);
  const urlPresence = urlRead ? urlRead[1](urlRow!.results[0]) : null;
  const citingCount = Number(identity.results[0]?.citing || 0);
  const totalResponses = Number(totalRows.results[0]?.total || 0);
  const domain = kind === 'domain' ? key : String(identity.results[0]?.domain || '');
  const own = [String(citing.project.domain), ...(JSON.parse(String(citing.project.additional_domains_json || '[]')) as string[])];
  const targets = [
    { name: String(citing.project.name), domain: String(citing.project.domain) },
    ...citing.competitors,
  ];
  const totalByDay = new Map(totalDaily.results.map((row) => [String(row.date), Number(row.total)]));
  const totalByEngine = new Map(totalPlatforms.results.map((row) => [String(row.engine), Number(row.total)]));
  const history = historyRows ? historyPage(historyRows.results) : { runs: [], nextCursor: null };
  return {
    presenceVersion: 1,
    origin: cohort.origin as SourceEntityDetail['origin'],
    averageScore: presencePage.rows[0]?.averageScore ?? null,
    presence: presencePage.rows[0]?.presence ?? null,
    totals: presencePage.totals!,
    sourceKind,
    kind,
    key,
    domain,
    title: kind === 'url' && identity.results[0]?.title ? String(identity.results[0].title) : null,
    ownership: own.includes(domain)
      ? 'own'
      : citing.competitors.some((target) => target.domain === domain)
        ? 'competitor'
        : 'third-party',
    metrics: {
      citing: citingCount,
      total: totalResponses,
      rate: rate(citingCount, totalResponses),
      pages: Number(identity.results[0]?.pages || 0),
    },
    daily: (citingCount ? totalDaily.results : []).slice(0, 90).filter((row) => dailyPresence.has(String(row.date))).map((row) => {
      const day = String(row.date),
        denominator = totalByDay.get(day) ?? 0;
      const hits = Number(daily.results.find((item) => item.date === row.date)?.citing || 0);
      return { date: day, citing: hits, total: denominator, rate: rate(hits, denominator), ...dailyPresence.get(day)! };
    }),
    platforms: platforms.results.map((row) => {
      const denominator = totalByEngine.get(String(row.engine)) ?? 0;
      return { engine: row.engine as Engine, citing: Number(row.citing), total: denominator, rate: rate(Number(row.citing), denominator), ...modelPresence.get(String(row.engine))! };
    }).sort((a,b) => b.presence-a.presence || a.engine.localeCompare(b.engine)),
    prompts: prompts.results.map((row) => ({
      prompt: String(row.prompt),
      text: String(row.text),
      topic: String(row.topic ?? ''),
      responses: Number(row.responses),
      presence: Number(row.presence), slots: Number(row.slots), denominator: Number(row.denominator),
    })),
    urls: (urlPresence?.rows ?? []).map((row) => ({
      url: row.key,title: row.title,responses: row.responses,pageType: 'unclassified' as const,cited: row.cited,consulted: row.consulted,
      presence: row.presence!.presence,slots: row.presence!.slots,denominator: urlPresence!.totals!.slots,
    })),
    brands: brands.results.map((row) => ({
      name: String(row.name),
      domain: targets.find((target) => target.name === row.name)?.domain ?? '',
      responses: Number(row.responses),
    })),
    history,
  };
}

// Read-only Query Fan Out view over `runs.search_queries_json`. The period and
// engine/topic/tag filters are the shared report cohort; normalization and grouping run here, not in SQL.
const FANOUT_RUN_CAP = 5000;
function fanoutRunsStatement(ctx: Context, bindings = ctx.bindings) {
  const own = ctx.citesSelected('own');
  return ctx.database
    .prepare(
      `${ctx.withClause} SELECT r.id,r.prompt_id,r.prompt_text,COALESCE(p.tag,'') topic,r.engine,r.created_at,r.search_queries_json,(${ctx.mentionExpression}) mentioned,(${own}) cited
      FROM runs r LEFT JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id WHERE ${ctx.where} AND ${complete} AND json_array_length(r.search_queries_json)>0
      ORDER BY r.created_at DESC,r.id DESC LIMIT ${FANOUT_RUN_CAP + 1}`,
    )
    .bind(ctx.brandBinding, ...bindings);
}
function fanoutRunsFrom(rows: Record<string, unknown>[]) {
  return {
    truncated: rows.length > FANOUT_RUN_CAP,
    runs: rows.slice(0, FANOUT_RUN_CAP).map((row) => ({
      id: String(row.id),
      engine: row.engine as Engine,
      prompt_id: String(row.prompt_id),
      prompt_text: String(row.prompt_text),
      topic: String(row.topic),
      created_at: String(row.created_at),
      queries: (JSON.parse(String(row.search_queries_json)) as unknown[]).filter((x): x is string => typeof x === 'string'),
      mentioned: !!row.mentioned,
      cited: !!row.cited,
    })),
  };
}
async function fanoutRuns(ctx: Context, bindings = ctx.bindings) {
  return fanoutRunsFrom((await fanoutRunsStatement(ctx, bindings).all<Record<string, unknown>>()).results);
}
const fanoutQueries = (json: unknown) => (JSON.parse(String(json)) as unknown[]).filter((x): x is string => typeof x === 'string');
export async function fanoutReport(ctx: Context, q = new URLSearchParams(), grouping?: ProjectIntents): Promise<FanoutReport> {
  // The AIs that ever returned searches for this project, whatever the period and engine filter: the data decides, not a fixed list.
  const [projectId, workspaceId] = ctx.bindings;
  const term = normalizeQuery((q.get('term') || '').slice(0, 80));
  const intent = (q.get('intent') || '').slice(0, 100);
  const current = [
    ctx.database
      .prepare(`SELECT DISTINCT r.engine FROM runs r WHERE r.project_id=? AND r.workspace_id=? AND r.engine IN ${COLLECTED_ENGINES_SQL} AND ${complete} AND json_array_length(r.search_queries_json)>0`)
      .bind(projectId, workspaceId),
    ctx.database
      .prepare(`${ctx.withClause} SELECT r.engine,COUNT(*) responses FROM runs r WHERE ${ctx.where} AND ${complete} GROUP BY r.engine`)
      .bind(ctx.brandBinding, ...ctx.bindings),
    // The newest answers with searches, one row each, newest first (`n`), with only what `buildFanout` reads: a query is
    // normalized in JS (Unicode accents and punctuation, which SQLite cannot), so rows stay per answer, just small. The
    // question (prompt, its text at the time, topic) is sent once, on its first row; `k` names it on the others.
    ctx.database
      .prepare(`${ctx.withClause}, picked AS (
        SELECT r.prompt_id,r.prompt_text,COALESCE(p.tag,'') topic,r.engine,r.created_at,r.search_queries_json,
          (${ctx.mentionExpression}) mentioned,(${ctx.citesSelected('own')}) cited,ROW_NUMBER() OVER (ORDER BY r.created_at DESC,r.id DESC) n
        FROM runs r LEFT JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id WHERE ${ctx.where} AND ${complete} AND json_array_length(r.search_queries_json)>0
        ORDER BY r.created_at DESC,r.id DESC LIMIT ${FANOUT_RUN_CAP + 1}
      ) SELECT DENSE_RANK() OVER (ORDER BY prompt_id,prompt_text,topic) k,
        CASE WHEN ROW_NUMBER() OVER (PARTITION BY prompt_id,prompt_text,topic ORDER BY n)=1 THEN json_array(prompt_id,prompt_text,topic) END t,
        engine e,substr(created_at,1,10) d,search_queries_json q,mentioned m,cited c FROM picked ORDER BY n`)
      .bind(ctx.brandBinding, ...ctx.bindings),
  ];
  // The previous period only counts words per answer: identical search lists come once, with how many answers had them.
  // Its own read, so the two periods never add up against the store's per-read size limit.
  const previous = ctx.database
    .prepare(`${ctx.withClause} SELECT q,COUNT(*) n FROM (SELECT r.search_queries_json q FROM runs r
      WHERE ${ctx.where} AND ${complete} AND json_array_length(r.search_queries_json)>0 ORDER BY r.created_at DESC,r.id DESC LIMIT ${FANOUT_RUN_CAP})
      GROUP BY q`)
    .bind(ctx.brandBinding, ...ctx.previousBindings);
  const brands = [{ name: String(ctx.project.name), own: true }, ...ctx.competitors.map((c) => ({ name: c.name, own: false }))];
  const compute = async (): Promise<FanoutReport> => {
    const [[engineRows, coverageRows, currentRows], [previousRows]] = (
      await Promise.all([ctx.database.batch<Record<string, unknown>>(current), ctx.database.batch<Record<string, unknown>>([previous])])
    ).map((results) => results.map((result) => result.results));
    const fanoutEngines = engineRows.map((row) => row.engine as Engine);
    const coverage = (coverageRows as { engine: Engine; responses: number }[])
      .filter((row) => fanoutEngines.includes(row.engine))
      .map((row) => ({ engine: row.engine, responses: Number(row.responses) }));
    const questions = new Map<unknown, string[]>();
    const runs = currentRows.slice(0, FANOUT_RUN_CAP).map((row) => {
      if (row.t != null) questions.set(row.k, JSON.parse(String(row.t)) as string[]);
      const [prompt_id, prompt_text, topic] = questions.get(row.k)!;
      return {
        id: '',
        engine: row.e as Engine,
        prompt_id: String(prompt_id),
        prompt_text: String(prompt_text),
        topic: String(topic),
        created_at: String(row.d),
        queries: fanoutQueries(row.q),
        mentioned: !!row.m,
        cited: !!row.c,
      };
    });
    const previousRuns = previousRows.flatMap((row) => {
      const run = { id: '', engine: 'chat_gpt' as Engine, prompt_id: '', prompt_text: '', topic: '', created_at: '', queries: fanoutQueries(row.q), mentioned: false, cited: false };
      return Array.from({ length: Number(row.n) }, () => run);
    });
    const intents = { intents: grouping?.intents, assignments: grouping && new Map(grouping.assignments), intent };
    return { ...buildFanout(runs, coverage, brands, term, previousRuns, intents), fanoutEngines, truncated: currentRows.length > FANOUT_RUN_CAP };
  };
  // Kept with the reads it comes from: a cached report is not computed again from cached rows.
  return ctx.database.derive?.([...current, previous], [term, brands, intent, grouping?.revision ?? ''], compute) ?? compute();
}

/**
 * Opportunities: the intents of the period's searches where two or more AIs never name the brand while competitors
 * appear (buildOpportunities). Reads every complete answer of the period (newest first, capped) with its searches, whether
 * it names the brand and which tracked competitors it names, then the domains cited by the newest answers without the brand.
 */
const OPPORTUNITY_RUN_CAP = 5000;
const OPPORTUNITY_LIMIT = 50;
export async function opportunitiesReport(ctx: Context, grouping: ProjectIntents): Promise<OpportunitiesReport> {
  const answers = ctx.database
    .prepare(
      `${ctx.withClause} SELECT r.id,COALESCE(p.unit_id,p.id,r.prompt_id) prompt,r.engine e,COALESCE(p.tag,'') topic,r.search_queries_json q,(${ctx.mentionExpression}) m,
        (SELECT json_group_array(om.key) FROM json_each(${EFFECTIVE_MENTIONS_SQL}) om WHERE om.value=1 AND om.key!=${ctx.selectedName}) c
      FROM runs r LEFT JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id WHERE ${ctx.where} AND ${complete}
      ORDER BY r.created_at DESC,r.id DESC LIMIT ${OPPORTUNITY_RUN_CAP + 1}`,
    )
    .bind(ctx.brandBinding, ...ctx.bindings);
  const prompts = ctx.database.prepare('SELECT COALESCE(unit_id,id) id,MIN(text) text FROM prompts WHERE project_id=? GROUP BY COALESCE(unit_id,id)').bind(String(ctx.project.id));
  const compute = async (): Promise<OpportunitiesReport> => {
    const [answerRows, promptRows] = (await ctx.database.batch<Record<string, unknown>>([answers, prompts])).map((result) => result.results);
    const rows = answerRows.slice(0, OPPORTUNITY_RUN_CAP).map((row) => ({
      id: String(row.id),
      prompt: String(row.prompt),
      engine: row.e as Engine,
      topic: String(row.topic),
      queries: fanoutQueries(row.q ?? '[]'),
      mentioned: !!row.m,
      competitors: (JSON.parse(String(row.c ?? '[]')) as unknown[]).filter((name): name is string => typeof name === 'string'),
    }));
    const built = buildOpportunities(
      rows,
      new Map(grouping.intents.map((intent) => [intent.id, intent])),
      new Map(grouping.assignments),
      ctx.topicWeights,
      new Map(promptRows.map((row) => [String(row.id), String(row.text ?? '')])),
    );
    const listed = built.opportunities.slice(0, OPPORTUNITY_LIMIT);
    const ids = [...new Set(listed.flatMap((row) => row.newest))];
    // Only the cited domains of those answers (small rows), never their text.
    const cited = new Map<string, Citation[]>();
    if (ids.length)
      for (const row of (
        await ctx.database
          .prepare(`SELECT r.id i,json_extract(s.value,'$.domain') d,json_extract(s.value,'$.url') u FROM runs r,json_each(r.sources_json) s WHERE r.project_id=? AND r.id IN (SELECT value FROM json_each(?))`)
          .bind(String(ctx.project.id), JSON.stringify(ids))
          .all<Record<string, unknown>>()
      ).results) {
        const list = cited.get(String(row.i)) ?? [];
        cited.set(String(row.i), list);
        list.push({ domain: typeof row.d === 'string' ? row.d : '', url: typeof row.u === 'string' ? row.u : '' } as Citation);
      }
    return {
      responses: built.responses,
      withFanout: built.withFanout,
      queries: built.queries,
      classified: built.classified,
      intents: built.intents,
      opportunities: listed.map(({ newest, ...row }) => ({ ...row, sources: topDomains(newest.map((id) => cited.get(id) ?? [])).slice(0, 5) })),
      truncated: answerRows.length > OPPORTUNITY_RUN_CAP,
    };
  };
  return ctx.database.derive?.([answers, prompts], ['opportunities', grouping.revision], compute) ?? compute();
}
const domainOf = (citation: Citation) =>
  citation.domain || (() => { try { return new URL(citation.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
function topDomains(lists: Citation[][]) {
  const counts = new Map<string, number>();
  for (const list of lists)
    for (const domain of new Set(list.map(domainOf).filter(Boolean))) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  return [...counts].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)).slice(0, 10);
}
export async function fanoutDetail(ctx: Context, q: URLSearchParams): Promise<FanoutDetail> {
  const key = (q.get('key') || '').trim();
  if (!key || key.length > 400) throw new ApiError(400, 'Choose a query.');
  const { runs } = await fanoutRuns(ctx);
  const variants = new Set<string>();
  const written = new Map<string, string>();
  const matched = runs
    .filter((run) => {
      const hits = run.queries.filter((text) => normalizeQuery(text) === key);
      hits.forEach((text) => variants.add(text));
      if (hits.length) written.set(run.id, hits[0]);
      return hits.length > 0;
    })
    .slice(0, 50);
  const sources = matched.length
    ? (
        await ctx.database
          .prepare(`SELECT r.id,r.sources_json,r.consulted_sources_json FROM runs r WHERE r.project_id=? AND r.id IN (${matched.map(() => '?').join(',')})`)
          .bind(String(ctx.project.id), ...matched.map((run) => run.id))
          .all<Record<string, unknown>>()
      ).results
    : [];
  const consulted = sources.filter((row) => typeof row.consulted_sources_json === 'string');
  return {
    key,
    variants: [...variants],
    runs: matched.map(({ id, prompt_text, engine, created_at, mentioned, cited }) => ({ id, prompt_text, query_text: written.get(id) ?? key, engine, created_at, mentioned, cited })),
    cited: topDomains(sources.map((row) => JSON.parse(String(row.sources_json)) as Citation[])),
    consulted: consulted.length ? topDomains(consulted.map((row) => JSON.parse(String(row.consulted_sources_json)) as Citation[])) : null,
  };
}

/**
 * Products (31/10): the product cards in the period's answers of the AIs that show them (lib/products.ts), with those
 * answers per AI, the brands named in the cards and their stores. Reads the newest cards, capped. With `target` (a
 * product's slug or `brands/<brand slug>`, the page's address), that product's or brand's page from the same cards.
 */
const PRODUCT_CARD_CAP = 5000;
const PRODUCT_ENGINES_SQL = `r.engine IN (${PRODUCT_ENGINES.map((engine) => `'${engine}'`).join(',')})`;
export function productsReport(ctx: Context): Promise<ProductsReport>;
export function productsReport(ctx: Context, target: string): Promise<ProductDetailReport>;
export async function productsReport(ctx: Context, target?: string): Promise<ProductsReport | ProductDetailReport> {
  const statements = [
    ctx.database
      .prepare(`${ctx.withClause} SELECT r.engine,COUNT(*) responses,SUM(EXISTS(SELECT 1 FROM run_products p WHERE p.run_id=r.id)) with_products
        FROM runs r WHERE ${ctx.where} AND ${complete} AND ${PRODUCT_ENGINES_SQL} GROUP BY r.engine`)
      .bind(ctx.brandBinding, ...ctx.bindings),
    ctx.database
      .prepare(`${ctx.withClause} SELECT p.run_id,r.engine,r.prompt_id,r.prompt_text,substr(r.created_at,1,10) d,p.position,p.title,p.title_key,p.price_value,
        p.price_text,p.currency,p.rating_value,p.merchants_json,p.tag,p.image_url FROM run_products p JOIN runs r ON r.id=p.run_id
        WHERE ${ctx.where} AND ${complete} ORDER BY r.created_at DESC,r.id DESC,p.position LIMIT ${PRODUCT_CARD_CAP + 1}`)
      .bind(ctx.brandBinding, ...ctx.bindings),
  ];
  const targets = (json: unknown) => {
    try {
      const parsed = JSON.parse(String(json ?? '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const brands = [
    { name: String(ctx.project.name), domain: String(ctx.project.domain), aliases: targets(ctx.project.aliases_json).map(String), own: true },
    ...(targets(ctx.project.competitors_json) as { name: string; domain?: string; aliases?: string[] }[]).map((target) => ({ ...target, own: false })),
  ];
  const compute = async () => {
    const [engineRows, cardRows] = (await ctx.database.batch<Record<string, unknown>>(statements)).map((result) => result.results);
    const engines = ENGINES.flatMap((engine) => {
      const row = engineRows.find((item) => item.engine === engine);
      return row ? [{ engine, responses: Number(row.responses), withProducts: Number(row.with_products) }] : [];
    });
    const cards: ProductCardRow[] = cardRows.slice(0, PRODUCT_CARD_CAP).map((row) => ({
      run: String(row.run_id),
      engine: row.engine as Engine,
      promptId: String(row.prompt_id ?? ''),
      prompt: String(row.prompt_text ?? ''),
      date: String(row.d),
      position: Number(row.position),
      title: String(row.title),
      key: String(row.title_key),
      price: row.price_value == null ? null : Number(row.price_value),
      priceText: row.price_text == null ? null : String(row.price_text),
      currency: row.currency == null ? null : String(row.currency),
      store: (targets(row.merchants_json)[0] as string | undefined) ?? null,
      rating: row.rating_value == null ? null : Number(row.rating_value),
      label: row.tag == null ? null : String(row.tag),
      image: httpsUrl(row.image_url),
    }));
    const truncated = cardRows.length > PRODUCT_CARD_CAP;
    return target === undefined ? buildProducts(cards, engines, brands, truncated) : buildProductDetail(cards, engines, brands, target, truncated);
  };
  return ctx.database.derive?.(statements, ['products', brands, target ?? null], compute) ?? compute();
}
