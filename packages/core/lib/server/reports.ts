import { ENGINES, ENGINE_LABELS, isEngine } from '@/lib/engines';
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
  SourcesPage,
  SourceDetail,
  OpportunitiesReport,
} from '@/lib/report-types';
import { projectReadDatabase } from './project-store-read';
import { ApiError } from './http';
import { ownedProject } from './workspace';
import {
  EFFECTIVE_MENTIONS_SQL,
  EFFECTIVE_TARGETS_SQL,
  RUN_SUMMARY_COLUMNS,
  runSummary,
} from './run-rows';
import { firstMentionPosition } from '@/lib/metrics';
import { seriesColorVar } from '@/lib/chart-series';

const complete = `r.status='complete' AND r.response_available=1`;
const primaryName = `json_extract(${EFFECTIVE_TARGETS_SQL},'$[0].name')`;
const primaryMention = `EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_MENTIONS_SQL}) m WHERE m.value=1 AND m.key=${primaryName})`;
const statuses = [
  'all',
  'queued',
  'submitting',
  'pending',
  'complete',
  'failed',
  'unknown',
];
// Answers are persisted at 180k UTF-16 code units. Four rows stays below the
// 4 MiB D1 result ceiling even for four-byte UTF-8 text, with room for row
// metadata; cursor pagination keeps the full cohort intact.
const POSITION_BATCH_SIZE = 4;

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
  const valid = `json_array_length(${targets}) BETWEEN 1 AND 6
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

export function parseReportFilter(q: URLSearchParams) {
  let days = Number(q.get('days') || 30);
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new ApiError(400, 'Choose a period from 1 to 90 days.');
  const engine = q.get('engine') || 'all';
  const engines = engine === 'all' ? [] : [...new Set(engine.split(','))];
  if (engines.some((value) => !isEngine(value)))
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
  const customStart = q.get('start');
  const customEnd = q.get('end');
  const dateBoundary = (value: string, inclusiveEnd = false) => {
    const isDay = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = Date.parse(isDay ? `${value}T00:00:00.000Z` : value);
    if (
      !Number.isFinite(date) ||
      (isDay && new Date(date).toISOString().slice(0, 10) !== value)
    )
      throw new ApiError(400, 'Invalid report date.');
    return new Date(
      date + (isDay && inclusiveEnd ? 86400000 : 0),
    ).toISOString();
  };
  if (!!customStart !== !!customEnd)
    throw new ApiError(400, 'Choose both dates for a custom period.');
  const end = customEnd
    ? dateBoundary(customEnd, true)
    : new Date().toISOString();
  const cutoff = customStart
    ? dateBoundary(customStart)
    : new Date(Date.parse(end) - days * 86400000).toISOString();
  days = Math.round((Date.parse(end) - Date.parse(cutoff)) / 86400000);
  if (days < 1 || days > 90)
    throw new ApiError(400, 'Choose a period from 1 to 90 days.');
  return {
    days,
    engine,
    status,
    mention,
    gap,
    sourceKind,
    sourceGroup,
    end,
    cutoff,
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
    : `(SELECT json_extract(target.value,'$.name') FROM json_each(${EFFECTIVE_TARGETS_SQL}) target WHERE json_extract(target.value,'$.domain')=(SELECT value FROM report_brand) LIMIT 1)`;
  const mentionExpression = isPrimary
    ? primaryMention
    : `EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_MENTIONS_SQL}) m WHERE m.value=1 AND m.key=${selectedName})`;
  const otherMention = `EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_MENTIONS_SQL}) m WHERE m.value=1 AND m.key!=${selectedName})`;
  // Resolve from the effective interpretation, never from mutable display settings.
  // The active overlay wins; collection snapshots remain the fallback. Older snapshots only have
  // `domain`, which remains the bounded backwards-compatible fallback.
  const selectedTarget = isPrimary
    ? `CAST(target.key AS INTEGER)=0`
    : `json_extract(target.value,'$.domain')=(SELECT value FROM report_brand)`;
  const selectedDomain = `EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_TARGETS_SQL}) target,json_each(CASE WHEN json_type(target.value,'$.domains')='array' THEN json_extract(target.value,'$.domains') ELSE json_array(json_extract(target.value,'$.domain')) END) selected_domain WHERE ${selectedTarget} AND json_extract(cs.value,'$.domain')=selected_domain.value)`;
  const withClause = `WITH report_brand(value) AS (SELECT ?)`;
  const extra: string[] = [];
  const extraBindings: (string | number)[] = [];
  const selectedEngines =
    filter.engine === 'all' ? [] : filter.engine.split(',');
  if (selectedEngines.length) {
    extra.push(`r.engine IN (${selectedEngines.map(() => '?').join(',')})`);
    extraBindings.push(...selectedEngines);
  }
  if (filter.status !== 'all') {
    extra.push('r.status=?');
    extraBindings.push(filter.status);
  }
  const citation = q.get('citation') || 'all';
  if (!['all', 'missing-own'].includes(citation))
    throw new ApiError(400, 'Invalid citation filter.');
  if (citation === 'missing-own')
    extra.push(
      `(${complete}) AND ${mentionExpression} AND NOT EXISTS(SELECT 1 FROM json_each(r.sources_json) own WHERE ${selectedDomain.replaceAll('cs.value', 'own.value')})`,
    );
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
        `json_extract(rs.value,'$.${filter.sourceGroup}')=?`,
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
        `EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_TARGETS_SQL}) own_target,json_each(CASE WHEN json_type(own_target.value,'$.domains')='array' THEN json_extract(own_target.value,'$.domains') ELSE json_array(json_extract(own_target.value,'$.domain')) END) own_domain WHERE CAST(own_target.key AS INTEGER)=0 AND own_domain.value=json_extract(rs.value,'$.domain'))`,
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
    brandBinding: isPrimary
      ? String(project.domain)
      : String(competitors.find((target) => target.name === brand)?.domain),
    mentionExpression,
    otherMention,
    selectedEngines,
    selectedDomain,
    selectedName,
    isPrimary,
  };
}
type Context = Awaited<ReturnType<typeof reportContext>>;

function metrics(
  row: Record<string, unknown> | undefined,
  domains: number,
): Metrics {
  const responses = Number(row?.responses || 0),
    mentions = Number(row?.mentions || 0),
    totalMentions = Number(row?.total_mentions || 0);
  return {
    responses,
    mentions,
    totalMentions,
    citedDomains: domains,
    visibility: responses ? (mentions / responses) * 100 : 0,
    shareOfVoice: totalMentions ? (mentions / totalMentions) * 100 : 0,
    citationPresence: responses
      ? (Number(row?.cited_brand || 0) / responses) * 100
      : 0,
    mentionPosition: Number(row?.mention_position || 0),
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
  const [totals, domains, daily, mentions, targetConsistency] =
    await database.batch<Record<string, unknown>>([
      database
        .prepare(`${withClause} SELECT CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,
      SUM(CASE WHEN ${complete} THEN 1 ELSE 0 END) responses,
      SUM(CASE WHEN ${complete} THEN ${mentionExpression} ELSE 0 END) mentions,
      SUM(CASE WHEN ${complete} THEN (SELECT COUNT(*) FROM json_each(${EFFECTIVE_MENTIONS_SQL}) WHERE value=1) ELSE 0 END) total_mentions,
      SUM(CASE WHEN ${complete} AND EXISTS(SELECT 1 FROM json_each(r.sources_json) cs WHERE ${ctx.selectedDomain}) THEN 1 ELSE 0 END) cited_brand,
      COALESCE(SUM(r.cost),0) cost FROM runs r WHERE ${where} GROUP BY period`)
        .bind(brandBinding, filter.cutoff, ...ctx.combinedBindings),
      database
        .prepare(`${withClause} SELECT CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,
      COUNT(DISTINCT json_extract(s.value,'$.domain')) total FROM runs r,json_each(r.sources_json) s WHERE ${where} AND ${complete} GROUP BY period`)
      .bind(brandBinding, filter.cutoff, ...ctx.combinedBindings),
    database
      .prepare(`${withClause} SELECT substr(r.created_at,1,10) day,COUNT(*) responses,SUM(${mentionExpression}) mentions,
      SUM((SELECT COUNT(*) FROM json_each(${EFFECTIVE_MENTIONS_SQL}) WHERE value=1)) total_mentions
      FROM runs r WHERE ${where} AND ${complete} GROUP BY day ORDER BY day`)
        .bind(brandBinding, ...ctx.bindings),
      database
        .prepare(`${withClause} SELECT substr(r.created_at,1,10) day,json_extract(target.value,'$.domain') domain,COUNT(*) mentions,
      SUM(CASE WHEN CAST(target.key AS INTEGER)=0 THEN 1 ELSE 0 END) primary_mentions
      FROM runs r,json_each(${EFFECTIVE_MENTIONS_SQL}) m
      JOIN json_each(${EFFECTIVE_TARGETS_SQL}) target ON json_extract(target.value,'$.name')=m.key
      WHERE ${where} AND ${complete} AND m.value=1 GROUP BY day,domain`)
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
    ]);
  const positionByPeriod = new Map<string, number[]>();
  for (const [period, bindings] of [
    ['current', ctx.bindings],
    ['previous', ctx.previousBindings],
  ] as const) {
    let cursor: { date: string; id: string } | null = null;
    for (;;) {
      const rows: Record<string, unknown>[] = (
        await database
          .prepare(
            `${withClause} SELECT r.id,r.created_at,r.answer,${EFFECTIVE_TARGETS_SQL} AS targets_json FROM runs r WHERE ${where} AND ${complete} AND ${ctx.mentionExpression}${cursor ? ' AND (r.created_at>? OR (r.created_at=? AND r.id>?))' : ''} ORDER BY r.created_at,r.id LIMIT ${POSITION_BATCH_SIZE}`,
          )
          .bind(
            brandBinding,
            ...bindings,
            ...(cursor ? [cursor.date, cursor.date, cursor.id] : []),
          )
          .all<Record<string, unknown>>()
      ).results;
      for (const row of rows) {
        let targets: { name: string; domain: string; aliases?: string[] }[] =
          [];
        try {
          targets = JSON.parse(String(row.targets_json));
        } catch {
          continue;
        }
        const selected = ctx.isPrimary
          ? targets[0]
          : targets.find((target) => target.domain === brandBinding);
        const position = firstMentionPosition(
          row.answer as string | null,
          [selected?.name || brandBinding, ...(selected?.aliases || [])],
          targets,
        );
        if (position != null) {
          const positions = positionByPeriod.get(period) || [];
          positions.push(position);
          positionByPeriod.set(period, positions);
        }
      }
      if (rows.length < POSITION_BATCH_SIZE) break;
      const last: Record<string, unknown> = rows.at(-1)!;
      cursor = { date: String(last.created_at), id: String(last.id) };
    }
  }
  const averagePosition = (period: string) => {
    const values = positionByPeriod.get(period) || [];
    return values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
  };
  const current = metrics(
    {
      ...totals.results.find((r) => r.period === 'current'),
      mention_position: averagePosition('current'),
    },
    Number(domains.results.find((r) => r.period === 'current')?.total || 0),
  );
  const previous = metrics(
    {
      ...totals.results.find((r) => r.period === 'previous'),
      mention_position: averagePosition('previous'),
    },
    Number(domains.results.find((r) => r.period === 'previous')?.total || 0),
  );
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
      current: positionByPeriod.get('current')?.length || null,
      previous: positionByPeriod.get('previous')?.length || null,
    },
  };
  if (!comparable)
    for (const sample of Object.values(availability)) sample.previous = null;
  const names = [
    { name: String(project.name), domain: String(project.domain) },
    ...ctx.competitors,
  ];
  const competitorNames = ctx.competitors.map((competitor) => competitor.name);
  const mentionRows = mentions.results as {
    day: string;
    domain: string;
    mentions: number;
    primary_mentions: number;
  }[];
  const mentionMap = new Map(
    mentionRows.map((r) => [`${r.day}\0${r.domain}`, r.mentions]),
  );
  return {
    metrics: current,
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
      hasPreviousData: comparable && previous.responses > 0,
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
              : row.domain === target.domain
                ? row.mentions
                : 0),
          0,
        );
        return {
          ...target,
          count,
          visibility: current.responses ? (count / current.responses) * 100 : 0,
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
    daily: (
      daily.results as {
        day: string;
        responses: number;
        mentions: number;
        total_mentions: number;
      }[]
    ).map((row) => {
      const totalMentions = row.total_mentions || 0;
      return {
        date: row.day,
        brand: (row.mentions / row.responses) * 100,
        sov: totalMentions ? (row.mentions / totalMentions) * 100 : null,
        ...Object.fromEntries(
          ctx.competitors.map((c, i) => [
            `c${i}`,
            ((mentionMap.get(`${row.day}\0${c.domain}`) || 0) /
              row.responses) *
              100,
          ]),
        ),
        ...Object.fromEntries(
          ctx.competitors.map((c, i) => [
            `sovC${i}`,
            totalMentions
              ? ((mentionMap.get(`${row.day}\0${c.domain}`) || 0) /
                  totalMentions) *
                100
              : null,
          ]),
        ),
      };
    }),
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
      (engine) =>
        !ctx.selectedEngines.length || ctx.selectedEngines.includes(engine),
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
  const [stats, brands, latest] = await ctx.database.batch<
    Record<string, unknown>
  >([
    ctx.database
      .prepare(`${ctx.withClause} SELECT r.prompt_id,CASE WHEN r.created_at>=? THEN 'current' ELSE 'previous' END period,
      SUM(CASE WHEN ${complete} THEN 1 ELSE 0 END) responses,
      SUM(CASE WHEN ${complete} THEN ${ctx.mentionExpression} ELSE 0 END) mentions,
      SUM(CASE WHEN r.status IN ('queued','pending','submitting') THEN 1 ELSE 0 END) pending
      FROM runs r WHERE ${ctx.where} GROUP BY r.prompt_id,period`)
      .bind(ctx.brandBinding, ctx.filter.cutoff, ...ctx.combinedBindings),
    ctx.database
      .prepare(`${ctx.withClause} SELECT r.prompt_id,m.key name FROM runs r,json_each(${EFFECTIVE_MENTIONS_SQL}) m
      WHERE ${ctx.where} AND ${complete} AND m.value=1 GROUP BY r.prompt_id,m.key ORDER BY r.prompt_id,name`)
      .bind(ctx.brandBinding, ...ctx.bindings),
    ctx.database
      .prepare(`${ctx.withClause}, latest AS (SELECT r.id,ROW_NUMBER() OVER(PARTITION BY r.prompt_id ORDER BY r.created_at DESC,r.id DESC) position
      FROM runs r WHERE ${ctx.where}) SELECT ${RUN_SUMMARY_COLUMNS} FROM latest l JOIN runs r ON r.id=l.id WHERE l.position=1`)
      .bind(ctx.brandBinding, ...ctx.bindings),
  ]);
  const result: PromptReport = {};
  for (const row of stats.results as {
    prompt_id: string;
    period: string;
    responses: number;
    mentions: number;
    pending: number;
  }[]) {
    const score = {
      responses: Number(row.responses),
      mentions: Number(row.mentions),
      visibility: Number(row.responses)
        ? (Number(row.mentions) / Number(row.responses)) * 100
        : 0,
    };
    const item = result[row.prompt_id] ?? {
      responses: 0,
      mentions: 0,
      visibility: 0,
      pending: 0,
      previous: { responses: 0, mentions: 0, visibility: 0 },
      delta: { responses: 0, mentions: 0, visibility: 0 },
      brands: [],
    };
    if (row.period === 'current')
      Object.assign(item, score, { pending: Number(row.pending) });
    else item.previous = score;
    result[row.prompt_id] = item;
  }
  for (const row of brands.results as { prompt_id: string; name: string }[]) {
    const item = result[row.prompt_id];
    if (item) item.brands.push(String(row.name));
  }
  for (const item of Object.values(result))
    item.delta = {
      responses: item.responses - item.previous.responses,
      mentions: item.mentions - item.previous.mentions,
      visibility: item.visibility - item.previous.visibility,
    };
  for (const row of latest.results)
    if (result[String(row.prompt_id)])
      result[String(row.prompt_id)].latest = runSummary(row);
  return result;
}
export async function promptDetail(
  ctx: Context,
  q: URLSearchParams,
): Promise<PromptDetail> {
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
        `${ctx.withClause} SELECT r.engine,COUNT(*) responses,SUM(${ctx.mentionExpression}) mentions FROM runs r WHERE ${ctx.where} AND ${complete} GROUP BY r.engine ORDER BY responses DESC`,
      )
      .bind(ctx.brandBinding, ...ctx.bindings),
    ctx.database
      .prepare(
        `${ctx.withClause} SELECT json_extract(s.value,'$.domain') domain,COUNT(DISTINCT r.id) responses FROM runs r,json_each(r.sources_json) s WHERE ${ctx.where} AND ${complete} GROUP BY domain ORDER BY responses DESC,domain LIMIT 21`,
      )
      .bind(ctx.brandBinding, ...ctx.bindings),
  ]);
  const makeScore = (row: Record<string, unknown>) => ({
    responses: Number(row.responses),
    mentions: Number(row.mentions),
    visibility: Number(row.responses)
      ? (Number(row.mentions) / Number(row.responses)) * 100
      : 0,
  });
  return {
    daily: daily.results
      .slice(0, 90)
      .map((row) => ({ date: String(row.date), ...makeScore(row) })),
    platforms: platforms.results.map((row) => ({
      engine: row.engine as Engine,
      ...makeScore(row),
    })),
    sources: sources.results.slice(0, 20).map((row) => ({
      domain: String(row.domain),
      responses: Number(row.responses),
    })),
    history: await historyReport(ctx, q),
  };
}
export async function competitorsReport(
  ctx: Context,
): Promise<CompetitorsReport> {
  const rows = (
    await ctx.database
      .prepare(`${ctx.withClause} SELECT json_extract(target.value,'$.name') name,json_extract(target.value,'$.domain') domain,
        r.engine,p.tag topic,COUNT(DISTINCT r.id) responses,
        COUNT(DISTINCT CASE WHEN m.value=1 THEN r.id END) mentions
        FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id
        JOIN json_each(${EFFECTIVE_TARGETS_SQL}) target LEFT JOIN json_each(${EFFECTIVE_MENTIONS_SQL}) m ON m.key=json_extract(target.value,'$.name')
        WHERE ${ctx.where} AND ${complete} GROUP BY name,domain,r.engine,p.tag`)
      .bind(ctx.brandBinding, ...ctx.bindings)
      .all<Record<string, unknown>>()
  ).results;
  const targets = new Map<string, { name: string; domain: string }>();
  for (const row of rows)
    targets.set(String(row.name), {
      name: String(row.name),
      domain: String(row.domain),
    });
  const matrix = (dimension: 'engine' | 'topic') =>
    [...targets.values()].map((target) => {
      const cells: CompetitorsReport['platforms'][number]['cells'] = {};
      for (const row of rows.filter(
        (value) => String(value.name) === target.name,
      )) {
        const key = String(row[dimension]);
        const previous = cells[key] || {
          responses: 0,
          mentions: 0,
          visibility: 0,
        };
        const responses = previous.responses + Number(row.responses);
        const mentions = previous.mentions + Number(row.mentions);
        cells[key] = {
          responses,
          mentions,
          visibility: responses ? (mentions / responses) * 100 : 0,
        };
      }
      const values = Object.values(cells);
      const responses = values.reduce((sum, value) => sum + value.responses, 0);
      const mentions = values.reduce((sum, value) => sum + value.mentions, 0);
      return {
        ...target,
        responses,
        mentions,
        visibility: responses ? (mentions / responses) * 100 : 0,
        cells,
      };
    });
  const gaps = (
    await ctx.database
      .prepare(`${ctx.withClause} SELECT r.prompt_id prompt,p.text label,r.engine,p.tag topic,COUNT(*) responses
      FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id
      WHERE ${ctx.where} AND ${complete} AND NOT ${ctx.mentionExpression} AND ${ctx.otherMention}
      GROUP BY r.prompt_id,r.engine,p.tag ORDER BY responses DESC,p.text LIMIT 51`)
      .bind(ctx.brandBinding, ...ctx.bindings)
      .all<Record<string, unknown>>()
  ).results;
  return {
    platforms: matrix('engine'),
    topics: matrix('topic'),
    competitorOnly: gaps.slice(0, 50).map((row) => ({
      prompt: String(row.prompt),
      label: String(row.label),
      responses: Number(row.responses),
      engine: row.engine as Engine,
      topic: String(row.topic),
    })),
  };
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
  const ownOnly = q.get('own') === '1';
  if (q.get('own') && !ownOnly)
    throw new ApiError(400, 'Invalid source filter.');
  const ownershipWhere = ownOnly
    ? ` AND EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_TARGETS_SQL}) own_target,json_each(CASE WHEN json_type(own_target.value,'$.domains')='array' THEN json_extract(own_target.value,'$.domains') ELSE json_array(json_extract(own_target.value,'$.domain')) END) own_domain WHERE CAST(own_target.key AS INTEGER)=0 AND own_domain.value=json_extract(s.value,'$.domain'))`
    : '';
  const [rows, availability] = await ctx.database.batch<
    Record<string, unknown>
  >([
    ctx.database
      .prepare(`${ctx.withClause} SELECT json_extract(s.value,'$.${group}') key,json_extract(s.value,'$.domain') domain,
      MIN(json_extract(s.value,'$.title')) title,COUNT(DISTINCT r.id) responses,
      COUNT(DISTINCT CASE WHEN ${ctx.mentionExpression} THEN r.id END) mentions,
      COUNT(DISTINCT json_extract(s.value,'$.url')) pages,group_concat(DISTINCT r.engine) engines,
      MAX(CASE WHEN EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_TARGETS_SQL}) own_target,json_each(CASE WHEN json_type(own_target.value,'$.domains')='array' THEN json_extract(own_target.value,'$.domains') ELSE json_array(json_extract(own_target.value,'$.domain')) END) own_domain WHERE CAST(own_target.key AS INTEGER)=0 AND own_domain.value=json_extract(s.value,'$.domain')) THEN 1 ELSE 0 END) own_snapshot,
      MAX(CASE WHEN EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_TARGETS_SQL}) competitor_target,json_each(CASE WHEN json_type(competitor_target.value,'$.domains')='array' THEN json_extract(competitor_target.value,'$.domains') ELSE json_array(json_extract(competitor_target.value,'$.domain')) END) competitor_domain WHERE CAST(competitor_target.key AS INTEGER)>0 AND competitor_domain.value=json_extract(s.value,'$.domain')) THEN 1 ELSE 0 END) competitor_snapshot
      FROM runs r,json_each(${column}) s WHERE ${ctx.where} AND ${complete}
      AND (?='' OR instr(lower(COALESCE(json_extract(s.value,'$.url'),'') || ' ' || COALESCE(json_extract(s.value,'$.title'),'')),lower(?))>0)
      ${ownershipWhere} GROUP BY json_extract(s.value,'$.${group}') ORDER BY responses DESC,key LIMIT 51 OFFSET ?`)
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
      ownership: Number(r.own_snapshot)
        ? 'own'
        : Number(r.competitor_snapshot)
          ? 'competitor'
          : 'third-party',
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
  const sourceAfter = q.get('sourceCursor') || '';
  if (sourceAfter.length > 4000) throw new ApiError(400, 'Invalid cursor.');
  const search = (q.get('q') || '').trim();
  if (search.length > 200)
    throw new ApiError(400, 'The search query is too long.');
  const ownOnly = q.get('own') === '1';
  if (q.get('own') && !ownOnly)
    throw new ApiError(400, 'Invalid source filter.');
  const ownershipWhere = ownOnly
    ? ` AND EXISTS(SELECT 1 FROM json_each(${EFFECTIVE_TARGETS_SQL}) own_target,json_each(CASE WHEN json_type(own_target.value,'$.domains')='array' THEN json_extract(own_target.value,'$.domains') ELSE json_array(json_extract(own_target.value,'$.domain')) END) own_domain WHERE CAST(own_target.key AS INTEGER)=0 AND own_domain.value=json_extract(s.value,'$.domain'))`
    : '';
  const [sources, runs] = await ctx.database.batch<Record<string, unknown>>([
    ctx.database
      .prepare(`${ctx.withClause} SELECT DISTINCT json_extract(s.value,'$.url') url,json_extract(s.value,'$.domain') domain,json_extract(s.value,'$.title') title
      FROM runs r,json_each(${column}) s WHERE ${ctx.where} AND ${complete} AND json_extract(s.value,'$.${group}')=?
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
      AND EXISTS(SELECT 1 FROM json_each(${column}) s WHERE json_extract(s.value,'$.${group}')=?
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

/**
 * A bounded, evidence-led opportunity list. It never infers what an external
 * page omits: it only links source domains that were actually cited.
 */
export async function opportunitiesReport(
  ctx: Context,
): Promise<OpportunitiesReport> {
  const rows = (
    await ctx.database
      .prepare(`${ctx.withClause} SELECT * FROM (
        SELECT 'competitor-gap' type,r.prompt_id id,r.prompt_text title,COUNT(*) responses,NULL source,r.engine engine
        FROM runs r WHERE ${ctx.where} AND ${complete} AND NOT ${ctx.mentionExpression} AND ${ctx.otherMention}
        GROUP BY r.prompt_id,r.engine
        UNION ALL
        SELECT 'uncited-brand' type,json_extract(s.value,'$.domain') id,json_extract(s.value,'$.domain') title,COUNT(DISTINCT r.id) responses,json_extract(s.value,'$.domain') source,NULL engine
        FROM runs r,json_each(r.sources_json) s WHERE ${ctx.where} AND ${complete} AND ${ctx.mentionExpression}
          AND NOT EXISTS(SELECT 1 FROM json_each(r.sources_json) own WHERE ${ctx.selectedDomain.replaceAll('cs.value', 'own.value')})
        GROUP BY json_extract(s.value,'$.domain')
      ) ORDER BY responses DESC,title LIMIT 51`)
      .bind(ctx.brandBinding, ...ctx.bindings, ...ctx.bindings)
      .all<Record<string, unknown>>()
  ).results;
  return {
    rows: rows.slice(0, 50).map((row) => ({
      id: `${row.type}:${row.id}`,
      type: row.type as 'competitor-gap' | 'uncited-brand',
      title: String(row.title),
      detail:
        row.type === 'competitor-gap'
          ? 'A competitor appears while the tracked brand is absent.'
          : 'The brand is mentioned, but its registered domain is not cited.',
      responses: Number(row.responses),
      source: row.source ? String(row.source) : undefined,
      prompt: row.type === 'competitor-gap' ? String(row.id) : undefined,
      engine: row.engine as Engine | undefined,
    })),
    hasMore: rows.length > 50,
  };
}
