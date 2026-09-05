import { ENGINES, ENGINE_LABELS, isEngine } from '@/lib/engines';
import type { Engine, Citation } from '@/lib/types';
import type {
  Metrics,
  SummaryReport,
  AnalysisReport,
  AnalysisRow,
  HistoryPage,
  PromptReport,
  SourcesPage,
  SourceDetail,
} from '@/lib/report-types';
import { projectReadDatabase } from './project-store-read';
import { ApiError } from './http';
import { ownedProject } from './workspace';
import { RUN_SUMMARY_COLUMNS, runSummary } from './run-rows';

const complete = `r.status='complete' AND r.response_available=1`;
const primaryName = `json_extract(r.targets_json,'$[0].name')`;
const primaryMention = `EXISTS(SELECT 1 FROM json_each(r.mentions_json) m WHERE m.value=1 AND m.key=${primaryName})`;
const statuses = [
  'all',
  'queued',
  'submitting',
  'pending',
  'complete',
  'failed',
  'unknown',
];

export function parseReportFilter(q: URLSearchParams) {
  const days = Number(q.get('days') || 30);
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new ApiError(400, 'Choose a period from 1 to 90 days.');
  const engine = q.get('engine') || 'all';
  if (engine !== 'all' && !isEngine(engine))
    throw new ApiError(400, 'Invalid AI channel.');
  const status = q.get('status') || 'all';
  if (!statuses.includes(status))
    throw new ApiError(400, 'Invalid response status.');
  const mention = q.get('mention') || 'all';
  if (!['all', 'mentioned', 'missing'].includes(mention))
    throw new ApiError(400, 'Invalid mention filter.');
  const gap = q.get('gap') || 'all';
  if (!['all', 'competitor-only'].includes(gap))
    throw new ApiError(400, 'Invalid opportunity filter.');
  const sourceKind = q.get('sourceKind') || 'cited';
  const sourceGroup = q.get('sourceGroup') || 'domain';
  if (
    !['cited', 'consulted'].includes(sourceKind) ||
    !['domain', 'url'].includes(sourceGroup)
  )
    throw new ApiError(400, 'Invalid source filter.');
  const end = new Date().toISOString();
  return {
    days,
    engine,
    status,
    mention,
    gap,
    sourceKind,
    sourceGroup,
    end,
    cutoff: new Date(Date.parse(end) - days * 86400000).toISOString(),
    previousCutoff: new Date(
      Date.parse(end) - days * 2 * 86400000,
    ).toISOString(),
  };
}

// The alias and SQL expressions below are internal constants; all caller values
// remain bound parameters. Reuse this cohort for reports, evidence and exports.
export async function reportContext(owner: string, q: URLSearchParams) {
  const id = q.get('project');
  if (!id) throw new ApiError(400, 'Select a project.');
  const project = await ownedProject(id, owner);
  const filter = parseReportFilter(q);
  const competitors = JSON.parse(String(project.competitors_json)) as {
    name: string;
    domain: string;
  }[];
  const brand = q.get('brand') || 'primary';
  const isPrimary = brand === 'primary' || brand === String(project.name);
  if (!isPrimary && !competitors.some((target) => target.name === brand))
    throw new ApiError(400, 'Choose a tracked brand.');
  // A parameterized one-row CTE avoids repeating brand bindings in aggregates.
  const selectedName = isPrimary
    ? primaryName
    : `(SELECT name FROM report_brand)`;
  const mentionExpression = isPrimary
    ? primaryMention
    : `EXISTS(SELECT 1 FROM json_each(r.mentions_json) m WHERE m.value=1 AND m.key=${selectedName})`;
  const otherMention = `EXISTS(SELECT 1 FROM json_each(r.mentions_json) m WHERE m.value=1 AND m.key!=${selectedName})`;
  const withClause = `WITH report_brand(name) AS (SELECT ?)`;
  const extra: string[] = [];
  const extraBindings: (string | number)[] = [];
  if (filter.engine !== 'all') {
    extra.push('r.engine=?');
    extraBindings.push(filter.engine);
  }
  if (filter.status !== 'all') {
    extra.push('r.status=?');
    extraBindings.push(filter.status);
  }
  for (const [param, clause, max] of [
    ['prompt', 'r.prompt_id=?', 100],
    [
      'topic',
      'EXISTS(SELECT 1 FROM prompts rp WHERE rp.id=r.prompt_id AND rp.project_id=r.project_id AND rp.tag=?)',
      100,
    ],
  ] as const) {
    const value = q.get(param);
    if (value) {
      if (value.length > max)
        throw new ApiError(400, `Invalid ${param} filter.`);
      extra.push(clause);
      extraBindings.push(value);
    }
  }
  const source = q.get('source');
  if (source) {
    if (source.length > 4000) throw new ApiError(400, 'Invalid source filter.');
    const column =
      filter.sourceKind === 'cited'
        ? 'r.sources_json'
        : 'r.consulted_sources_json';
    extra.push(
      `(${complete}) AND EXISTS(SELECT 1 FROM json_each(${column}) rs WHERE json_extract(rs.value,'$.${filter.sourceGroup}')=?)`,
    );
    extraBindings.push(source);
  }
  if (filter.mention !== 'all')
    extra.push(
      `(${complete}) AND ${filter.mention === 'missing' ? 'NOT ' : ''}${mentionExpression}`,
    );
  if (filter.gap === 'competitor-only')
    extra.push(
      `(${complete}) AND NOT ${mentionExpression} AND ${otherMention}`,
    );
  // The source view uses q for source search. query always filters prompt text.
  const query = (
    q.get('query') ||
    (q.get('view') === 'history' ? q.get('q') : '') ||
    ''
  ).trim();
  if (query.length > 200)
    throw new ApiError(400, 'The search query is too long.');
  if (query) {
    extra.push('instr(lower(r.prompt_text),lower(?))>0');
    extraBindings.push(query);
  }
  const common = `r.project_id=? AND r.owner_id=? AND r.created_at>=? AND r.created_at<?${extra.length ? ` AND ${extra.join(' AND ')}` : ''}`;
  const bindings = [id, owner, filter.cutoff, filter.end, ...extraBindings];
  const previousBindings = [
    id,
    owner,
    filter.previousCutoff,
    filter.cutoff,
    ...extraBindings,
  ];
  const combinedBindings = [
    id,
    owner,
    filter.previousCutoff,
    filter.end,
    ...extraBindings,
  ];
  return {
    database: await projectReadDatabase(id, owner),
    project,
    filter,
    competitors,
    where: common,
    bindings,
    previousBindings,
    combinedBindings,
    withClause,
    brandBinding: brand,
    mentionExpression,
    otherMention,
  };
}
type Context = Awaited<ReturnType<typeof reportContext>>;

function metrics(
  row: Record<string, unknown> | undefined,
  domains: number,
): Metrics {
  const responses = Number(row?.responses || 0),
    mentions = Number(row?.mentions || 0);
  return {
    responses,
    mentions,
    citedDomains: domains,
    visibility: responses ? (mentions / responses) * 100 : 0,
    shareOfVoice: Number(row?.total_mentions)
      ? (mentions / Number(row?.total_mentions)) * 100
      : 0,
    cost: Number(row?.cost || 0),
  };
}
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
  const [totals, domains, daily, mentions] = await database.batch<
    Record<string, unknown>
  >([
    database
      .prepare(`${withClause} SELECT CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,
      SUM(CASE WHEN ${complete} THEN 1 ELSE 0 END) responses,
      SUM(CASE WHEN ${complete} THEN ${mentionExpression} ELSE 0 END) mentions,
      SUM(CASE WHEN ${complete} THEN (SELECT COUNT(*) FROM json_each(r.mentions_json) WHERE value=1) ELSE 0 END) total_mentions,
      COALESCE(SUM(r.cost),0) cost FROM runs r WHERE ${where} GROUP BY period`)
      .bind(brandBinding, filter.cutoff, ...ctx.combinedBindings),
    database
      .prepare(`${withClause} SELECT CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,
      COUNT(DISTINCT json_extract(s.value,'$.domain')) total FROM runs r,json_each(r.sources_json) s WHERE ${where} AND ${complete} GROUP BY period`)
      .bind(brandBinding, filter.cutoff, ...ctx.combinedBindings),
    database
      .prepare(`${withClause} SELECT substr(r.created_at,1,10) day,COUNT(*) responses,SUM(${mentionExpression}) mentions
      FROM runs r WHERE ${where} AND ${complete} GROUP BY day ORDER BY day`)
      .bind(brandBinding, ...ctx.bindings),
    database
      .prepare(`${withClause} SELECT substr(r.created_at,1,10) day,m.key name,COUNT(*) mentions,
      SUM(CASE WHEN m.key=${primaryName} THEN 1 ELSE 0 END) primary_mentions
      FROM runs r,json_each(r.mentions_json) m WHERE ${where} AND ${complete} AND m.value=1 GROUP BY day,m.key`)
      .bind(brandBinding, ...ctx.bindings),
  ]);
  const current = metrics(
    totals.results.find((r) => r.period === 'current'),
    Number(domains.results.find((r) => r.period === 'current')?.total || 0),
  );
  const previous = metrics(
    totals.results.find((r) => r.period === 'previous'),
    Number(domains.results.find((r) => r.period === 'previous')?.total || 0),
  );
  const names = [
    { name: String(project.name), domain: String(project.domain) },
    ...ctx.competitors,
  ];
  const mentionRows = mentions.results as {
    day: string;
    name: string;
    mentions: number;
    primary_mentions: number;
  }[];
  const mentionMap = new Map(
    mentionRows.map((r) => [`${r.day}\0${r.name}`, r.mentions]),
  );
  return {
    metrics: current,
    comparison: {
      previous,
      delta: Object.fromEntries(
        (Object.keys(current) as (keyof Metrics)[]).map((key) => [
          key,
          current[key] - previous[key],
        ]),
      ) as Metrics,
      hasPreviousData: previous.responses > 0,
      currentStart: filter.cutoff,
      previousStart: filter.previousCutoff,
      end: filter.end,
    },
    leaderboard: names
      .map((target, i) => {
        const count = mentionRows.reduce(
          (sum, row) =>
            sum +
            (i === 0
              ? row.primary_mentions
              : row.name === target.name
                ? row.mentions
                : 0),
          0,
        );
        return {
          ...target,
          count,
          visibility: current.responses ? (count / current.responses) * 100 : 0,
          color: `var(--chart-${(i % 5) + 1})`,
        };
      })
      .sort((a, b) => b.count - a.count),
    daily: (
      daily.results as { day: string; responses: number; mentions: number }[]
    ).map((row) => ({
      date: row.day,
      brand: (row.mentions / row.responses) * 100,
      ...Object.fromEntries(
        ctx.competitors.map((c, i) => [
          `c${i}`,
          ((mentionMap.get(`${row.day}\0${c.name}`) || 0) / row.responses) *
            100,
        ]),
      ),
    })),
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
export async function analysisReport(ctx: Context): Promise<AnalysisReport> {
  const database = ctx.database;
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
        `${ctx.withClause} SELECT r.engine key,r.engine label,${aggregate} FROM runs r WHERE ${ctx.where} GROUP BY r.engine`,
      )
      .bind(ctx.brandBinding, ...ctx.bindings),
    database
      .prepare(`${ctx.withClause} SELECT p.tag key,p.tag label,${aggregate} FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id
      WHERE ${ctx.where} GROUP BY p.tag ORDER BY opportunities DESC,responses DESC,key LIMIT 51`)
      .bind(ctx.brandBinding, ...ctx.bindings),
    database
      .prepare(`${ctx.withClause} SELECT r.prompt_id key,p.text label,p.engine engine,p.tag topic,${aggregate} FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id
      WHERE ${ctx.where} GROUP BY r.prompt_id ORDER BY opportunities DESC,responses DESC,key LIMIT 51`)
      .bind(ctx.brandBinding, ...ctx.bindings),
  ]);
  return {
    channels: ENGINES.filter(
      (engine) => ctx.filter.engine === 'all' || ctx.filter.engine === engine,
    ).map((engine) => ({
      ...analysisRow(
        channels.results.find((r) => r.key === engine) || { key: engine },
      ),
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
  const after = cursorWhere(q.get('cursor'));
  const rows = (
    await ctx.database
      .prepare(
        `${ctx.withClause} SELECT ${RUN_SUMMARY_COLUMNS} FROM runs r WHERE ${ctx.where}${after.where} ORDER BY r.created_at DESC,r.id DESC LIMIT 26`,
      )
      .bind(ctx.brandBinding, ...ctx.bindings, ...after.bindings)
      .all<Record<string, unknown>>()
  ).results;
  return historyPage(rows);
}
export async function promptReport(ctx: Context): Promise<PromptReport> {
  const [stats, latest] = await ctx.database.batch<Record<string, unknown>>([
    ctx.database
      .prepare(`${ctx.withClause} SELECT r.prompt_id,SUM(CASE WHEN ${complete} THEN 1 ELSE 0 END) responses,
      SUM(CASE WHEN ${complete} THEN ${ctx.mentionExpression} ELSE 0 END) mentions,
      SUM(CASE WHEN r.status IN ('queued','pending','submitting') THEN 1 ELSE 0 END) pending
      FROM runs r WHERE ${ctx.where} GROUP BY r.prompt_id`)
      .bind(ctx.brandBinding, ...ctx.bindings),
    ctx.database
      .prepare(`${ctx.withClause}, latest AS (SELECT r.id,ROW_NUMBER() OVER(PARTITION BY r.prompt_id ORDER BY r.created_at DESC,r.id DESC) position
      FROM runs r WHERE ${ctx.where}) SELECT ${RUN_SUMMARY_COLUMNS} FROM latest l JOIN runs r ON r.id=l.id WHERE l.position=1`)
      .bind(ctx.brandBinding, ...ctx.bindings),
  ]);
  const result: PromptReport = {};
  for (const row of stats.results as {
    prompt_id: string;
    responses: number;
    mentions: number;
    pending: number;
  }[])
    result[row.prompt_id] = {
      responses: row.responses,
      visibility: row.responses ? (row.mentions / row.responses) * 100 : 0,
      pending: row.pending,
    };
  for (const row of latest.results)
    if (result[String(row.prompt_id)])
      result[String(row.prompt_id)].latest = runSummary(row);
  return result;
}
function sourceOptions(q: URLSearchParams) {
  const kind = q.get('kind') || 'cited',
    group = q.get('group') || 'domain';
  if (
    !['cited', 'consulted'].includes(kind) ||
    !['domain', 'url'].includes(group)
  )
    throw new ApiError(400, 'Invalid source filter.');
  return {
    column: kind === 'cited' ? 'r.sources_json' : 'r.consulted_sources_json',
    group,
  };
}
export async function sourcesReport(
  ctx: Context,
  q: URLSearchParams,
): Promise<SourcesPage> {
  const { column, group } = sourceOptions(q);
  const page = Number(q.get('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000)
    throw new ApiError(400, 'Invalid page.');
  const search = (q.get('q') || '').trim().slice(0, 200);
  const [rows, availability] = await ctx.database.batch<
    Record<string, unknown>
  >([
    ctx.database
      .prepare(`${ctx.withClause} SELECT json_extract(s.value,'$.${group}') key,json_extract(s.value,'$.domain') domain,
      MIN(json_extract(s.value,'$.title')) title,COUNT(DISTINCT r.id) responses,
      COUNT(DISTINCT CASE WHEN ${ctx.mentionExpression} THEN r.id END) mentions,
      COUNT(DISTINCT json_extract(s.value,'$.url')) pages,group_concat(DISTINCT r.engine) engines
      FROM runs r,json_each(${column}) s WHERE ${ctx.where} AND ${complete}
      AND (?='' OR instr(lower(COALESCE(json_extract(s.value,'$.url'),'') || ' ' || COALESCE(json_extract(s.value,'$.title'),'')),lower(?))>0)
      GROUP BY json_extract(s.value,'$.${group}') ORDER BY responses DESC,key LIMIT 51 OFFSET ?`)
      .bind(ctx.brandBinding, ...ctx.bindings, search, search, (page - 1) * 50),
    ctx.database
      .prepare(`${ctx.withClause} SELECT COUNT(*) complete,SUM(CASE WHEN r.consulted_sources_json IS NOT NULL THEN 1 ELSE 0 END) available
      FROM runs r WHERE ${ctx.where} AND ${complete}`)
      .bind(ctx.brandBinding, ...ctx.bindings),
  ]);
  return {
    rows: rows.results.slice(0, 50).map((r) => ({
      key: String(r.key),
      domain: String(r.domain),
      title: group === 'domain' ? String(r.domain) : String(r.title || r.key),
      responses: Number(r.responses),
      pages: Number(r.pages),
      engines: String(r.engines).split(',') as Engine[],
      mentions: Number(r.mentions),
      visibility: Number(r.responses)
        ? (Number(r.mentions) / Number(r.responses)) * 100
        : 0,
    })),
    hasMore: rows.results.length > 50,
    available: Number(availability.results[0]?.available || 0),
    complete: Number(availability.results[0]?.complete || 0),
  };
}
export async function sourceDetail(
  ctx: Context,
  q: URLSearchParams,
): Promise<SourceDetail> {
  const { column, group } = sourceOptions(q),
    key = q.get('key');
  if (!key || key.length > 4000) throw new ApiError(400, 'Invalid source.');
  const after = cursorWhere(q.get('cursor'));
  const [sources, runs] = await ctx.database.batch<Record<string, unknown>>([
    ctx.database
      .prepare(`${ctx.withClause} SELECT DISTINCT json_extract(s.value,'$.url') url,json_extract(s.value,'$.domain') domain,json_extract(s.value,'$.title') title
      FROM runs r,json_each(${column}) s WHERE ${ctx.where} AND ${complete} AND json_extract(s.value,'$.${group}')=? ORDER BY url LIMIT 51`)
      .bind(ctx.brandBinding, ...ctx.bindings, key),
    ctx.database
      .prepare(`${ctx.withClause} SELECT ${RUN_SUMMARY_COLUMNS} FROM runs r WHERE ${ctx.where} AND ${complete}
      AND EXISTS(SELECT 1 FROM json_each(${column}) s WHERE json_extract(s.value,'$.${group}')=?)${after.where} ORDER BY r.created_at DESC,r.id DESC LIMIT 26`)
      .bind(ctx.brandBinding, ...ctx.bindings, key, ...after.bindings),
  ]);
  const page = historyPage(runs.results);
  return {
    sources: sources.results.slice(0, 50) as unknown as Citation[],
    ...page,
    hasMore: sources.results.length > 50 || !!page.nextCursor,
  };
}
