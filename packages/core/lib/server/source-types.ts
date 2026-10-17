import {
  parseSourceTypeResponse,
  sourceTypeDecisionRequest,
  SOURCE_TYPE_ADAPTER_VERSION,
  SOURCE_TYPE_BATCH_SIZE,
  SOURCE_TYPE_CONTEXT_PREFIX,
  SOURCE_TYPE_ENQUEUE_LIMIT,
  SOURCE_TYPE_RESERVE_USD,
  SOURCE_TYPE_RUBRIC,
  UNCLASSIFIED,
  isSourceOwner,
  isSourceType,
  type SourceTypeClassifier,
  type SourceTypeItem,
  type SourceTypeKind,
} from '@/lib/source-types';
import { RESEARCH_MODELS } from '@/lib/brand-research-provider';
import type { ResearchProvider } from '@/lib/brand-research';
import type {
  ContentTypeShare,
  ContentTypesReport,
  SourceEntityDetail,
  SourceRow,
  SourceTypeShare,
  SourceTypesReport,
  SourceTypeValue,
  SourcesPage,
} from '@/lib/report-types';
import { db, now, setting } from './env';
import { ApiError } from './http';
import { ownedProject } from './workspace';
import {
  brandResearchConfiguration,
  researchAllowed,
  researchBudgetCondition,
  researchProjectBindings,
} from './brand-research';
import {
  citationTotal,
  reportContext,
  sourceEntityReport,
  sourcesReport,
} from './reports';

/** Aggregation ceilings: domains read for the distribution/filter, and URLs for a URL type filter. */
const DOMAIN_WINDOW = 2000;
const URL_WINDOW = 1000;
const LOOKUP_CHUNK = 80;
const CANDIDATE_WINDOW = 300;
type Job = {
  id: string;
  owner_id: string;
  project_id: string;
  provider: ResearchProvider;
  model: string;
  input_json: string;
  reserved_usd: number;
};
type Classifier = SourceTypeClassifier;

async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The public demo reads one fixed evaluator cache. Its types are written only by
 * the approved retroactive operation (ARCHITECTURE.md, "Public demo source types"),
 * never by a visitor, so its classifier state is `demo` whatever the settings say.
 */
export const PUBLIC_DEMO_CLASSIFIER: Classifier = {
  state: 'demo',
  provider: 'jev',
  model: RESEARCH_MODELS.jev,
  rubric: SOURCE_TYPE_RUBRIC,
};

/**
 * Cached results stay readable in every state; `ready` only decides whether a
 * user may queue new paid work. Reading, saving settings and rendering never
 * call the provider.
 */
export async function sourceTypeClassifier(
  projectId: string,
  ownerId: string,
  demo = false,
): Promise<Classifier> {
  if (demo) return PUBLIC_DEMO_CLASSIFIER;
  const configuration = await brandResearchConfiguration(projectId, ownerId);
  const base = {
    provider: configuration.provider,
    model: RESEARCH_MODELS[configuration.provider],
    rubric: SOURCE_TYPE_RUBRIC,
  };
  if (!configuration.enabled) return { ...base, state: 'disabled' };
  if (!setting('OPENROUTER_API_KEY')) return { ...base, state: 'unconfigured' };
  if (!researchAllowed(projectId)) return { ...base, state: 'unavailable' };
  return { ...base, state: 'ready' };
}

/** Types cached for the active evaluator and rubric. Missing keys are unclassified. */
export async function cachedSourceTypes(
  kind: SourceTypeKind,
  keys: string[],
  classifier: Classifier,
) {
  const found = new Map<string, string>();
  const unique = [...new Set(keys)];
  for (let offset = 0; offset < unique.length; offset += LOOKUP_CHUNK) {
    const rows = (
      await db()
        .prepare(
          'SELECT key,type FROM source_classifications WHERE kind=? AND provider=? AND model=? AND rubric=? AND key IN (SELECT value FROM json_each(?))',
        )
        .bind(
          kind,
          classifier.provider,
          classifier.model,
          classifier.rubric,
          JSON.stringify(unique.slice(offset, offset + LOOKUP_CHUNK)),
        )
        .all<{ key: string; type: string }>()
    ).results;
    for (const row of rows)
      if (isSourceType(kind, row.type)) found.set(row.key, row.type);
  }
  return found;
}

/**
 * Site type of a domain comes only from the cache. Being yours or a competitor's
 * is a separate mark (`ownership`) that never replaces it.
 */
const cachedType = (cache: Map<string, string>, key: string) =>
  (cache.get(key) as SourceTypeValue | undefined) ?? UNCLASSIFIED;

async function typedRows(
  rows: SourceRow[],
  group: SourceTypeKind,
  classifier: Classifier,
) {
  const domains = await cachedSourceTypes(
    'domain',
    rows.map((row) => row.domain),
    classifier,
  );
  const urls =
    group === 'url'
      ? await cachedSourceTypes(
          'url',
          rows.map((row) => row.key),
          classifier,
        )
      : new Map<string, string>();
  return rows.map((row) => ({
    ...row,
    sourceType: cachedType(group === 'domain' ? domains : urls, group === 'domain' ? row.domain : row.key),
    ...(group === 'url' ? { domainType: cachedType(domains, row.domain) } : {}),
  }));
}

/**
 * Sources list with a type per row, an optional `type` filter and an `owner` filter
 * (own | competitor | third-party). A type filter reads a page-size window and filters it.
 */
export async function typedSourcesReport(
  ownerId: string,
  q: URLSearchParams,
  ctx: Parameters<typeof sourcesReport>[0],
  demo = false,
): Promise<SourcesPage> {
  const group = q.get('group') === 'url' ? 'url' : 'domain';
  const classifier = await sourceTypeClassifier(String(ctx.project.id), ownerId, demo);
  let wanted = q.get('type');
  const query = new URLSearchParams(q);
  // Older links used You/Competitor as source types; they now mean the owner filter.
  if (wanted === 'you' || wanted === 'competitor') {
    query.set('owner', wanted === 'you' ? 'own' : 'competitor');
    wanted = null;
  }
  query.delete('type');
  if (query.get('owner') && !isSourceOwner(query.get('owner')))
    throw new ApiError(400, 'Invalid source owner.');
  if (!wanted) {
    const page = await sourcesReport(ctx, query);
    return { ...page, rows: await typedRows(page.rows, group, classifier), classifier };
  }
  if (wanted !== UNCLASSIFIED && !isSourceType(group, wanted))
    throw new ApiError(400, 'Invalid source type.');
  const window = group === 'domain' ? DOMAIN_WINDOW : URL_WINDOW;
  query.set('page', '1');
  const all = await sourcesReport(ctx, query, window);
  const matching = (await typedRows(all.rows, group, classifier)).filter(
    (row) => row.sourceType === wanted,
  );
  const page = Math.max(1, Number(q.get('page') || 1));
  return {
    rows: matching.slice((page - 1) * 50, page * 50),
    hasMore: matching.length > page * 50,
    available: all.available,
    complete: all.complete,
    classifier,
  };
}

const pendingBatches = async (projectId: string, ownerId: string) =>
  Number(
    (
      await db()
        .prepare(
          "SELECT COUNT(*) n FROM brand_research_jobs WHERE project_id=? AND owner_id=? AND context_key LIKE ? AND status IN ('pending','submitting')",
        )
        .bind(projectId, ownerId, `${SOURCE_TYPE_CONTEXT_PREFIX}%`)
        .first<{ n: number }>()
    )?.n || 0,
  );

/** Orders buckets by citations with the unclassified remainder last. */
function shares<T extends string>(
  byType: Map<SourceTypeValue, { citations: number } & Record<T, number>>,
  total: number,
) {
  return [...byType.entries()]
    .map(([type, bucket]) => ({
      type,
      ...bucket,
      share: total ? (bucket.citations / total) * 100 : 0,
    }))
    .sort(
      (left, right) =>
        Number(left.type === UNCLASSIFIED) - Number(right.type === UNCLASSIFIED) ||
        right.citations - left.citations ||
        left.type.localeCompare(right.type),
    );
}

export async function sourceTypesReport(
  ownerId: string,
  q: URLSearchParams,
  ctx: Parameters<typeof sourcesReport>[0],
  demo = false,
): Promise<SourceTypesReport> {
  const domainQuery = new URLSearchParams(q);
  domainQuery.set('kind', 'cited');
  domainQuery.set('group', 'domain');
  domainQuery.set('page', '1');
  domainQuery.delete('type');
  domainQuery.delete('owner');
  const projectId = String(ctx.project.id);
  const [classifier, window, total, pending] = await Promise.all([
    sourceTypeClassifier(projectId, ownerId, demo),
    sourcesReport(ctx, domainQuery, DOMAIN_WINDOW),
    citationTotal(ctx, domainQuery),
    pendingBatches(projectId, ownerId),
  ]);
  const rows = await typedRows(window.rows, 'domain', classifier);
  const byType = new Map<SourceTypeValue, { citations: number; domains: number }>();
  let seen = 0;
  for (const row of rows) {
    const bucket = byType.get(row.sourceType) ?? { citations: 0, domains: 0 };
    bucket.citations += row.responses;
    bucket.domains += 1;
    byType.set(row.sourceType, bucket);
    seen += row.responses;
  }
  // Domains beyond the window cannot be typed, so they remain visibly unclassified.
  const tail = Math.max(0, total - seen);
  if (tail || window.hasMore) {
    const bucket = byType.get(UNCLASSIFIED) ?? { citations: 0, domains: 0 };
    bucket.citations += tail;
    byType.set(UNCLASSIFIED, bucket);
  }
  const types: SourceTypeShare[] = shares(byType, total);
  const unclassified = byType.get(UNCLASSIFIED)?.citations ?? 0;
  return {
    classifier,
    citations: total,
    classified: total - unclassified,
    unclassified,
    types,
    truncated: window.hasMore,
    pendingBatches: pending,
  };
}

/** Citations by content (page) type of the cited URLs, with the unclassified part declared. */
export async function contentTypesReport(
  ownerId: string,
  q: URLSearchParams,
  ctx: Parameters<typeof sourcesReport>[0],
  demo = false,
): Promise<ContentTypesReport> {
  const urlQuery = new URLSearchParams(q);
  urlQuery.set('kind', 'cited');
  urlQuery.set('group', 'url');
  urlQuery.set('page', '1');
  urlQuery.delete('type');
  urlQuery.delete('owner');
  const projectId = String(ctx.project.id);
  const [classifier, window, total, pending] = await Promise.all([
    sourceTypeClassifier(projectId, ownerId, demo),
    sourcesReport(ctx, urlQuery, URL_WINDOW),
    citationTotal(ctx, urlQuery),
    pendingBatches(projectId, ownerId),
  ]);
  const cached = await cachedSourceTypes('url', window.rows.map((row) => row.key), classifier);
  const byType = new Map<SourceTypeValue, { citations: number; urls: number }>();
  let seen = 0;
  for (const row of window.rows) {
    const type = row.key ? cachedType(cached, row.key) : UNCLASSIFIED;
    const bucket = byType.get(type) ?? { citations: 0, urls: 0 };
    bucket.citations += row.responses;
    bucket.urls += 1;
    byType.set(type, bucket);
    seen += row.responses;
  }
  // URLs beyond the window cannot be typed, so they remain visibly unclassified.
  const tail = Math.max(0, total - seen);
  if (tail || window.hasMore) {
    const bucket = byType.get(UNCLASSIFIED) ?? { citations: 0, urls: 0 };
    bucket.citations += tail;
    byType.set(UNCLASSIFIED, bucket);
  }
  const types: ContentTypeShare[] = shares(byType, total);
  const unclassified = byType.get(UNCLASSIFIED)?.citations ?? 0;
  return {
    classifier,
    citations: total,
    classified: total - unclassified,
    unclassified,
    types,
    truncated: window.hasMore,
    pendingBatches: pending,
  };
}

export async function sourceEntityDetail(
  ownerId: string,
  q: URLSearchParams,
  kind: SourceTypeKind,
  demo = false,
): Promise<SourceEntityDetail> {
  const base = await sourceEntityReport(ownerId, q, kind);
  const classifier = await sourceTypeClassifier(
    String(q.get('project')),
    ownerId,
    demo,
  );
  const domains = await cachedSourceTypes('domain', [base.domain], classifier);
  const urls = await cachedSourceTypes(
    'url',
    kind === 'url' ? [base.key] : base.urls.map((item) => item.url),
    classifier,
  );
  const siteType = cachedType(domains, base.domain);
  return {
    ...base,
    classifier,
    sourceType: kind === 'domain' ? siteType : cachedType(urls, base.key),
    ...(kind === 'url' ? { domainType: siteType } : {}),
    urls: base.urls.map((item) => ({
      ...item,
      pageType: cachedType(urls, item.url),
    })),
  };
}

/** Queues limited provider batches for sources without a cached type. Explicit user action only. */
export async function enqueueSourceTypes(
  projectId: string,
  ownerId: string,
  q: URLSearchParams,
  value: unknown,
) {
  await ownedProject(projectId, ownerId);
  const kind: SourceTypeKind = value === 'url' ? 'url' : 'domain';
  if (value != null && value !== 'domain' && value !== 'url')
    throw new ApiError(400, 'Choose domains or URLs.');
  const classifier = await sourceTypeClassifier(projectId, ownerId);
  if (classifier.state === 'disabled')
    throw new ApiError(403, 'Enable the evaluator in Settings before classifying sources.');
  if (classifier.state === 'unconfigured')
    throw new ApiError(503, 'Configure the OpenRouter server key before classifying sources.');
  if (classifier.state === 'unavailable')
    throw new ApiError(403, 'This project is not authorized for source classification.');
  const configuration = await brandResearchConfiguration(projectId, ownerId);
  const query = new URLSearchParams(q);
  query.set('project', projectId);
  query.set('kind', 'cited');
  query.set('group', kind);
  query.set('page', '1');
  query.delete('type');
  query.delete('owner');
  const ctx = await reportContext(ownerId, query);
  const window = await sourcesReport(ctx, query, CANDIDATE_WINDOW);
  // Your own and competitors' domains are typed too: the site type is independent of ownership.
  const candidates = window.rows.filter((row) => row.key !== '');
  const cached = await cachedSourceTypes(kind, candidates.map((row) => row.key), classifier);
  const contextKey = `${SOURCE_TYPE_CONTEXT_PREFIX}${SOURCE_TYPE_RUBRIC}:${classifier.provider}`;
  const active = new Set(
    (
      await db()
        .prepare(
          `SELECT json_extract(item.value,'$.key') key FROM brand_research_jobs job,json_each(job.input_json,'$.items') item
          WHERE job.project_id=? AND job.owner_id=? AND job.context_key=? AND job.model=?
          AND job.status IN ('pending','submitting','unknown','unsettled') AND json_extract(job.input_json,'$.kind')=?`,
        )
        .bind(projectId, ownerId, contextKey, classifier.model, kind)
        .all<{ key: string }>()
    ).results.map((row) => row.key),
  );
  const todo: SourceTypeItem[] = candidates
    .filter((row) => !cached.has(row.key) && !active.has(row.key))
    .slice(0, SOURCE_TYPE_ENQUEUE_LIMIT)
    .map((row) => ({
      kind,
      key: row.key,
      domain: row.domain,
      title: kind === 'url' ? row.title : undefined,
    }));
  let enqueued = 0;
  for (let offset = 0; offset < todo.length; offset += SOURCE_TYPE_BATCH_SIZE) {
    const items = todo.slice(offset, offset + SOURCE_TYPE_BATCH_SIZE);
    const stamp = now();
    const budget = researchBudgetCondition(
      `${stamp.slice(0, 7)}-01T00:00:00.000Z`,
      SOURCE_TYPE_RESERVE_USD,
    );
    const inputKey = await hash(
      `${contextKey}:${classifier.model}:${SOURCE_TYPE_ADAPTER_VERSION}:${kind}:${items.map((item) => item.key).join('\n')}`,
    );
    const result = await db()
      .prepare(`INSERT INTO brand_research_jobs(id,owner_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at)
      SELECT ?,?,?,?,?,?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND archived=0)
      AND EXISTS(SELECT 1 FROM brand_research_configurations WHERE project_id=? AND owner_id=? AND provider=? AND enabled=1 AND revision=?) AND ${budget.sql}
      ON CONFLICT(project_id,input_key) DO UPDATE SET status='pending',reserved_usd=excluded.reserved_usd,input_json=excluded.input_json,requested_at=excluded.requested_at,completed_at=NULL,error=NULL
      WHERE brand_research_jobs.owner_id=excluded.owner_id AND brand_research_jobs.status IN ('cancelled','failed') AND brand_research_jobs.cost_usd=0`)
      .bind(
        crypto.randomUUID(),
        ownerId,
        projectId,
        inputKey,
        contextKey,
        inputKey,
        classifier.provider,
        classifier.model,
        SOURCE_TYPE_RESERVE_USD,
        JSON.stringify({ kind, items }),
        stamp,
        projectId,
        ownerId,
        projectId,
        ownerId,
        classifier.provider,
        configuration.revision,
        ...budget.params,
      )
      .run();
    enqueued += Number(result.meta.changes);
    if (!result.meta.changes) {
      const existing = await db()
        .prepare('SELECT id FROM brand_research_jobs WHERE project_id=? AND owner_id=? AND input_key=?')
        .bind(projectId, ownerId, inputKey)
        .first();
      if (!existing) throw new ApiError(409, 'Research budget is full.');
    }
  }
  const processed = enqueued
    ? await processSourceTypeJobs({ projectId, ownerId, provider: classifier.provider })
    : 0;
  return {
    queued: todo.length,
    batches: enqueued,
    processed,
    skippedCached: candidates.length - todo.length,
    limit: SOURCE_TYPE_ENQUEUE_LIMIT,
    provider: classifier.provider,
  };
}

/** A provider failure. `unknown` means the request left and no usable cost came back, so it is never resent automatically. */
export class SourceTypeProviderError extends Error {
  constructor(
    message: string,
    readonly unknown: boolean,
    readonly cost: number | null,
  ) {
    super(message);
  }
}

/**
 * One typed Decisions request for at most one batch. Shared by the explicit
 * classification jobs and the public demo operation so both enforce the same
 * request shape, response validation and "unknown outcome" rule.
 */
export async function requestSourceTypes(items: SourceTypeItem[], model: string) {
  let sent = false,
    cost: number | null = null;
  try {
    const payload = sourceTypeDecisionRequest(items, model);
    sent = true;
    const response = await fetch('https://openrouter.ai/api/alpha/decisions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${setting('OPENROUTER_API_KEY')}`,
        'Content-Type': 'application/json',
        'X-Title': 'Lastfind',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 408)
        sent = false;
      throw new Error(`OpenRouter returned HTTP ${response.status}.`);
    }
    const raw = (await response.json()) as { usage?: { cost?: unknown } };
    if (typeof raw.usage?.cost === 'number' && Number.isFinite(raw.usage.cost) && raw.usage.cost >= 0)
      cost = raw.usage.cost;
    const result = parseSourceTypeResponse(raw, items, model);
    cost = result.cost;
    return result;
  } catch (error) {
    throw new SourceTypeProviderError(
      error instanceof Error ? error.message.slice(0, 200) : 'Source classification failed.',
      sent && cost === null,
      cost,
    );
  }
}

type Scope = { projectId: string; ownerId: string; provider: ResearchProvider };

/**
 * Sends at most two pending batches per call. An uncertain outcome becomes
 * `unknown` and is never resent automatically, matching brand research.
 */
export async function processSourceTypeJobs(scope?: Scope) {
  if (setting('BRAND_RESEARCH_ENABLED') !== 'true') return 0;
  const projects = setting('BRAND_RESEARCH_PROJECTS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!projects.length || !setting('OPENROUTER_API_KEY')) return 0;
  if (scope && !researchAllowed(scope.projectId)) return 0;
  const database = db();
  const scopeSql = scope ? ' AND project_id=? AND owner_id=? AND provider=?' : '';
  const scopeParams = scope ? [scope.projectId, scope.ownerId, scope.provider] : [];
  const jobs = (
    await database
      .prepare(
        `SELECT * FROM brand_research_jobs WHERE status='pending' AND context_key LIKE ? AND (? OR project_id IN (SELECT value FROM json_each(?)))${scopeSql} ORDER BY requested_at LIMIT 2`,
      )
      .bind(`${SOURCE_TYPE_CONTEXT_PREFIX}%`, ...researchProjectBindings(), ...scopeParams)
      .all<Job>()
  ).results;
  let processed = 0;
  for (const job of jobs) {
    const stamp = now();
    const budget = researchBudgetCondition(`${stamp.slice(0, 7)}-01T00:00:00.000Z`, 0);
    if (!researchAllowed(job.project_id)) continue;
    const claimed = await database
      .prepare(`UPDATE brand_research_jobs SET status='submitting',started_at=? WHERE id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND archived=0)
      AND EXISTS(SELECT 1 FROM brand_research_configurations c WHERE c.project_id=brand_research_jobs.project_id AND c.owner_id=brand_research_jobs.owner_id AND c.enabled=1 AND c.provider=brand_research_jobs.provider) AND ${budget.sql}`)
      .bind(stamp, job.id, job.project_id, job.owner_id, ...budget.params)
      .run();
    if (!claimed.meta.changes) continue;
    processed++;
    let outcome: { unknown: boolean; cost: number | null } = { unknown: false, cost: null };
    try {
      const { items } = JSON.parse(job.input_json) as { items: SourceTypeItem[] };
      const result = await requestSourceTypes(items, job.model);
      const cost = result.cost;
      outcome = { unknown: false, cost };
      const done = now();
      await database.batch([
        database
          .prepare("UPDATE brand_research_jobs SET status=?,result_json=?,cost_usd=?,reserved_usd=?,completed_at=?,error=? WHERE id=? AND status='submitting'")
          .bind(
            cost === null ? 'unsettled' : 'completed',
            JSON.stringify(result.types),
            cost ?? 0,
            cost ?? job.reserved_usd,
            done,
            cost === null ? 'Usage cost is unavailable; the conservative reservation is retained.' : null,
            job.id,
          ),
        ...result.types.map((item) =>
          database
            .prepare(`INSERT INTO source_classifications(kind,key,provider,model,rubric,type,job_id,classified_at)
            SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM brand_research_jobs WHERE id=? AND completed_at=? AND status IN ('completed','unsettled'))
            ON CONFLICT(kind,key,provider,model,rubric) DO NOTHING`)
            .bind(item.kind, item.key, job.provider, job.model, SOURCE_TYPE_RUBRIC, item.type, job.id, done, job.id, done),
        ),
      ]);
    } catch (error) {
      if (error instanceof SourceTypeProviderError) outcome = { unknown: error.unknown, cost: error.cost };
      const { unknown, cost } = outcome;
      await database
        .prepare("UPDATE brand_research_jobs SET status=?,reserved_usd=?,cost_usd=?,completed_at=?,error=? WHERE id=? AND status='submitting'")
        .bind(
          unknown ? 'unknown' : 'failed',
          unknown ? job.reserved_usd : cost || 0,
          cost || 0,
          now(),
          error instanceof Error ? error.message.slice(0, 200) : 'Source classification failed.',
          job.id,
        )
        .run();
      if (scope) break;
    }
  }
  return processed;
}

/** Cache discriminator: reports with types change when a classification or evaluator setting does. */
export async function sourceTypeRevision(projectId: string, ownerId: string, demo = false) {
  const classifier = await sourceTypeClassifier(projectId, ownerId, demo);
  const row = await db()
    .prepare(
      'SELECT COUNT(*) n,MAX(classified_at) latest FROM source_classifications WHERE provider=? AND model=? AND rubric=?',
    )
    .bind(classifier.provider, classifier.model, classifier.rubric)
    .first<{ n: number; latest: string | null }>();
  return `${classifier.state}:${classifier.provider}:${row?.n ?? 0}:${row?.latest ?? ''}`;
}

export const SOURCE_TYPE_VIEWS = ['sources', 'source-types', 'content-types', 'domain-detail', 'url-detail'] as const;
/** Views that carry source types; the report routes dispatch them here. */
export async function sourceTypeView(
  view: string,
  ownerId: string,
  ctx: Parameters<typeof sourcesReport>[0],
  q: URLSearchParams,
  demo = false,
) {
  switch (view) {
    case 'sources':
      return typedSourcesReport(ownerId, q, ctx, demo);
    case 'source-types':
      return sourceTypesReport(ownerId, q, ctx, demo);
    case 'content-types':
      return contentTypesReport(ownerId, q, ctx, demo);
    case 'domain-detail':
      return sourceEntityDetail(ownerId, q, 'domain', demo);
    case 'url-detail':
      return sourceEntityDetail(ownerId, q, 'url', demo);
    default:
      throw new ApiError(400, 'Invalid report.');
  }
}
