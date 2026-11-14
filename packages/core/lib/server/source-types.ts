import {
  parseSourceTypeResponse,
  sourceTypeDecisionRequest,
  SOURCE_TYPE_ADAPTER_VERSION,
  SOURCE_TYPE_BATCH_SIZE,
  SOURCE_TYPE_CONTEXT_PREFIX,
  SOURCE_TYPE_DOMAIN_PROMPT,
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
import { pageTypeRule, pageTypeRuleSql, siteTypeRule, siteTypeRuleSql, SOURCE_TYPE_RULES_VERSION } from '@/lib/source-type-rules';
import { canonicalSourceDomain, canonicalSourceUrl } from '@/lib/source-url.mjs';
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
import { waitUntil } from 'cloudflare:workers';
import { shareFlight, type Flight } from './analytics-query-cache';
import { db, now, setting } from './env';
import { classifierModels } from './classifier-models';
import { publicClassifierView } from './internal-models';
import { postDecisions } from './decisions-api';
import { mayUseFallback, SYSTEMIC_PROVIDER_STATUSES } from '@/lib/provider-fallback';
import { ApiError } from './http';
import { ownedProject } from './workspace';
import {
  automaticActivity,
  brandResearchConfiguration,
  configurationRead,
  configurationStatement,
  researchAllowed,
  researchBudgetCondition,
  researchProjectBindings,
  researchProjects,
  researchEveryProject,
} from './brand-research';
import {
  citationTotal,
  reportContext,
  sourceEntityReport,
  sourceKeyCounts,
  sourcesReport,
  SOURCE_KEY_COUNT_PAGE,
} from './reports';
import { decisionKeyConfigured } from './model-routes';

/** Keys read for a type summary (pages of SOURCE_KEY_COUNT_PAGE): what is beyond stays visibly unclassified. */
const COUNT_PAGES = 13;
/** Characters of keys per catalog lookup: one D1 round trip for a whole page of URLs (a parameter may hold 2 MB). */
const LOOKUP_CHARACTERS = 500_000;
const CANDIDATE_WINDOW = 300;
type Job = {
  id: string;
  workspace_id: string;
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

/** The model the fixed demo operations run, and the one they fall back to. */
export const demoClassifierEngines = () => classifierModels('source_types', PUBLIC_DEMO_CLASSIFIER.model);
/** The model a project's source-type provider runs (and the fallback), as the manual classification resolves it. */
export const projectClassifierEngines = (provider: ResearchProvider) => classifierModels('source_types', RESEARCH_MODELS[provider]);

/**
 * Cached results stay readable in every state; `ready` only decides whether a
 * user may queue new paid work. Reading, saving settings and rendering never
 * call the provider.
 */
export async function sourceTypeClassifier(
  projectId: string,
  workspaceId: string,
  demo = false,
): Promise<Classifier> {
  if (demo) return PUBLIC_DEMO_CLASSIFIER;
  return classifierFrom(projectId, await brandResearchConfiguration(projectId, workspaceId));
}
async function classifierFrom(projectId: string, configuration: Awaited<ReturnType<typeof brandResearchConfiguration>>): Promise<Classifier> {
  const base = {
    provider: configuration.provider,
    model: classifierModels('source_types', RESEARCH_MODELS[configuration.provider]).model,
    rubric: SOURCE_TYPE_RUBRIC,
  };
  if (!configuration.enabled) return { ...base, state: 'disabled' };
  if (!decisionKeyConfigured()) return { ...base, state: 'unconfigured' };
  // A project on automatic evaluations is authorized by its own configuration row, not by the env allowlist.
  if (configuration.automatic)
    return { ...base, state: 'ready', automatic: true, activity: await automaticActivity(projectId, configuration.monthlyCeilingUsd) };
  if (!researchAllowed(projectId)) return { ...base, state: 'unavailable' };
  return { ...base, state: 'ready' };
}

/**
 * The source catalog key of a domain or URL: the canonical form every stored
 * occurrence uses (source-url.mjs). A key that is not a usable URL stays as it is.
 */
export const catalogKey = (kind: SourceTypeKind, key: string) =>
  (kind === 'url' ? canonicalSourceUrl(key) : null) ?? (kind === 'domain' ? canonicalSourceDomain(key) : key);

/** The databases this isolate already folded (a read costs nothing after the first), and the folds under way (shared by overlapping reads). */
const folded = new WeakSet<object>();
const folding = new Map<object, Flight<void>>();
/**
 * Brings the types cached before the catalog (`source_classifications`, keyed by
 * the URL as cited and by evaluator) into `source_catalog` (one row per canonical
 * URL or domain and rubric) without any provider call, newest classification
 * first so the newest wins. It is incremental: `system_state` keeps the newest
 * `classified_at` already folded, so a row an older Worker still wrote while a
 * release was rolling out is picked up by the next isolate, and it is repeatable
 * because an entry is never overwritten.
 */
export function foldLegacyClassifications() {
  const database = db();
  if (folded.has(database)) return Promise.resolve();
  return shareFlight(folding, database, () => foldInto(database).then(() => void folded.add(database)), waitUntil);
}
async function foldInto(database: D1Database) {
  const [markRead, newestRead] = await database.batch<{ value?: string; latest?: string | null }>([
    database.prepare('SELECT value FROM system_state WHERE key=?').bind(CATALOG_FOLD_KEY),
    database.prepare('SELECT MAX(classified_at) latest FROM source_classifications'),
  ]);
  const from = markRead.results[0]?.value ?? '';
  const newest = newestRead.results[0]?.latest;
  const page = 500;
  for (let offset = 0; ; offset += page) {
    const rows = (
      await database
        .prepare(
          'SELECT kind,key,rubric,type,provider,model,job_id,classified_at FROM source_classifications WHERE classified_at>=? ORDER BY classified_at DESC,provider,model,key LIMIT ? OFFSET ?',
        )
        .bind(from, page, offset)
        .all<CatalogRow & { kind: SourceTypeKind; key: string }>()
    ).results;
    if (!rows.length) break;
    await database.batch(rows.map((row) => catalogInsert(database, row.kind, catalogKey(row.kind, row.key), row)));
    if (rows.length < page) break;
  }
  if (newest && newest > from)
    await database
      .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind(CATALOG_FOLD_KEY, newest)
      .run();
}

type CatalogRow = {
  rubric: string;
  type: string;
  provider: ResearchProvider;
  model: string;
  job_id: string | null;
  classified_at: string;
};
const CATALOG_FOLD_KEY = 'source_catalog_fold_mark';

/** Writes one classification into the catalog unless that URL or domain already has one for the rubric. */
export function catalogInsert(
  database: ReturnType<typeof db>,
  kind: SourceTypeKind,
  key: string,
  row: CatalogRow,
) {
  return database
    .prepare(
      'INSERT OR IGNORE INTO source_catalog(kind,key,rubric,type,provider,model,job_id,classified_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    .bind(kind, key, row.rubric, row.type, row.provider, row.model, row.job_id, row.classified_at);
}

/**
 * The result of a settled job, written to the catalog only while that job is
 * recorded as completed (the same guard both the customer queue and the demo
 * operation use), and never over an existing entry.
 */
export function catalogWrite(
  database: ReturnType<typeof db>,
  item: { kind: SourceTypeKind; key: string; type: string },
  job: { id: string; provider: ResearchProvider; model: string },
  doneAt: string,
) {
  return database
    .prepare(`INSERT INTO source_catalog(kind,key,rubric,type,provider,model,job_id,classified_at)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM brand_research_jobs WHERE id=? AND completed_at=? AND status IN ('completed','unsettled'))
    ON CONFLICT(kind,key,rubric) DO NOTHING`)
    .bind(item.kind, catalogKey(item.kind, item.key), SOURCE_TYPE_RUBRIC, item.type, job.provider, job.model, job.id, doneAt, job.id, doneAt);
}

/**
 * Deterministic site types (`siteTypeRule`) override the catalog for the rubric. The evaluator that wrote a row is only
 * provenance: switching the evaluator never makes the catalog forget a page, and
 * a new rubric (a deliberate change of taxonomy) is the only thing that reclassifies.
 * Keys are looked up in canonical form and answered under the key that was asked.
 * Missing keys are unclassified.
 */
export async function cachedSourceTypes(
  kind: SourceTypeKind,
  keys: string[],
  classifier: Classifier,
) {
  await foldLegacyClassifications();
  const found = new Map<string, string>();
  const asked = new Map<string, string[]>();
  for (const key of keys) {
    const canonical = catalogKey(kind, key);
    const rule = kind === 'domain' ? siteTypeRule(canonical) : pageTypeRule(canonical);
    if (rule) {
      found.set(key, rule);
      continue;
    }
    asked.set(canonical, [...(asked.get(canonical) ?? []), key]);
  }
  const unique = [...asked.keys()];
  // Every chunk is a D1 round trip: they run side by side, not one after the other.
  const batches: string[][] = [[]];
  let characters = 0;
  for (const key of unique) {
    if (characters + key.length > LOOKUP_CHARACTERS && batches.at(-1)!.length) {
      batches.push([]);
      characters = 0;
    }
    batches.at(-1)!.push(key);
    characters += key.length + 3;
  }
  const chunks = unique.length
    ? batches.map((batch) =>
        db()
          .prepare(
            'SELECT key,type FROM source_catalog WHERE kind=? AND rubric=? AND key IN (SELECT value FROM json_each(?))',
          )
          .bind(kind, classifier.rubric, JSON.stringify(batch))
          .all<{ key: string; type: string }>(),
      )
    : [];
  for (const { results } of await Promise.all(chunks))
    for (const row of results)
      if (isSourceType(kind, row.type)) for (const key of asked.get(row.key) ?? []) found.set(key, row.type);
  return found;
}

/**
 * Site type comes from deterministic rules or the cache. Being yours or a competitor's
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
 * (own | competitor | third-party). Type filtering and ranking precede pagination in SQL.
 */
export async function typedSourcesReport(
  workspaceId: string,
  q: URLSearchParams,
  ctx: Parameters<typeof sourcesReport>[0],
  demo = false,
  known?: Classifier,
): Promise<SourcesPage> {
  const group = q.get('group') === 'url' ? 'url' : 'domain';
  const classifier = known ?? (await sourceTypeClassifier(String(ctx.project.id), workspaceId, demo));
  const query = new URLSearchParams(q);
  // Comma-separated types (OR).
  const wanted = [...new Set((q.get('type') || '').split(',').map((item) => item.trim()).filter(Boolean))];
  query.delete('type');
  const owners = (query.get('owner') || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (owners.some((item) => !isSourceOwner(item)))
    throw new ApiError(400, 'Invalid source owner.');
  let selection: Parameters<typeof sourcesReport>[3];
  if (wanted.length) {
    if (wanted.some((item) => item !== UNCLASSIFIED && !isSourceType(group, item)))
      throw new ApiError(400, 'Invalid source type.');
    await foldLegacyClassifications();
    // Catalog is control D1; send its complete matching key set to project SQLite.
    // No source ranking is truncated or paginated before the type condition.
    const types = (await db().prepare(
      'SELECT key,type FROM source_catalog WHERE kind=? AND rubric=?',
    ).bind(group, classifier.rubric).all<{ key: string; type: string }>()).results;
    const selected = new Set(wanted);
    const includeUnclassified = selected.has(UNCLASSIFIED);
    const matching = types
      .filter((row) => isSourceType(group, row.type) && selected.has(row.type))
      .map((row) => row.key);
    const classifiedOther = types
      .filter((row) => isSourceType(group, row.type) && !selected.has(row.type))
      .map((row) => row.key);
    // A domain or URL a rule types is decided by the same rules in SQL, before the catalog keys (siteTypeRuleSql, pageTypeRuleSql).
    selection = {
      keys: includeUnclassified ? classifiedOther : matching,
      exclude: includeUnclassified,
      rules: group === 'domain' ? siteTypeRuleSql('lower(key)', [...selected]) : pageTypeRuleSql('key', [...selected]),
    };
  }
  // Only the list asks for each row's change against the comparison period (`change=1`).
  const page = await sourcesReport(ctx, query, undefined, selection, q.get('change') === '1');
  // One lookup for the page and the leaders together, not three.
  const leaders = page.leaders;
  const typed = await typedRows(
    [...page.rows, ...(leaders ? [...leaders.ranking, leaders.widest] : [])],
    group,
    classifier,
  );
  const rows = typed.slice(0, page.rows.length);
  const typedLeaders = leaders
    ? { ranking: typed.slice(rows.length, -1), widest: typed[typed.length - 1] }
    : undefined;
  return { ...page, rows, ...(typedLeaders ? { leaders: typedLeaders } : {}), classifier };
}

/** The read of the batches waiting for a type, for a caller that sends it in one `db().batch` with other reads (then {@link pendingCount}). */
export const pendingBatchesStatement = (projectId: string, workspaceId: string) =>
  db()
    .prepare(
      "SELECT COUNT(*) n FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND context_key LIKE ? AND status IN ('pending','submitting')",
    )
    .bind(projectId, workspaceId, `${SOURCE_TYPE_CONTEXT_PREFIX}%`);
export const pendingCount = (row: { n: number } | null | undefined) => Number(row?.n || 0);
const pendingBatches = async (projectId: string, workspaceId: string) =>
  pendingCount(await pendingBatchesStatement(projectId, workspaceId).first<{ n: number }>());

/** Citations and distinct keys per type over every cited domain or URL, paged by key (no ranked window). */
async function typedCounts(
  ctx: Parameters<typeof sourcesReport>[0],
  q: URLSearchParams,
  kind: SourceTypeKind,
  classifier: Promise<Classifier>,
) {
  const buckets = new Map<SourceTypeValue, { citations: number; keys: number }>();
  const pages: Awaited<ReturnType<typeof sourceKeyCounts>>['rows'][] = [];
  let truncated = true;
  for (let page = 0; page < COUNT_PAGES; page++) {
    const { rows, hasMore } = await sourceKeyCounts(ctx, q, page * SOURCE_KEY_COUNT_PAGE);
    pages.push(rows);
    if (!hasMore) {
      truncated = false;
      break;
    }
  }
  // One catalog lookup for every page (it splits itself by size), not a round trip per page.
  const rubric = await classifier;
  const cached = await cachedSourceTypes(kind, pages.flatMap((rows) => rows.map((row) => row.key)), rubric);
  let seen = 0;
  for (const rows of pages) {
    for (const row of rows) {
      const type = row.key ? cachedType(cached, row.key) : UNCLASSIFIED;
      const bucket = buckets.get(type) ?? { citations: 0, keys: 0 };
      bucket.citations += row.responses;
      bucket.keys += 1;
      buckets.set(type, bucket);
      seen += row.responses;
    }
  }
  return { buckets, seen, truncated };
}

/** Orders every bucket by its total in the period, including unclassified. */
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
        right.citations - left.citations ||
        left.type.localeCompare(right.type),
    );
}

export async function sourceTypesReport(
  workspaceId: string,
  q: URLSearchParams,
  ctx: Parameters<typeof sourcesReport>[0],
  demo = false,
  // Already read with the report's context (`pendingBatchesStatement`).
  pendingRead?: number,
  known?: Classifier,
): Promise<SourceTypesReport> {
  const domainQuery = new URLSearchParams(q);
  domainQuery.set('kind', 'cited');
  domainQuery.set('group', 'domain');
  domainQuery.set('page', '1');
  domainQuery.set('order', 'responses');
  domainQuery.delete('type');
  domainQuery.delete('owner');
  const projectId = String(ctx.project.id);
  const classifierRead = known ? Promise.resolve(known) : sourceTypeClassifier(projectId, workspaceId, demo);
  const [{ buckets, seen, truncated }, pending, classifier] = await Promise.all([
    typedCounts(ctx, domainQuery, 'domain', classifierRead),
    pendingRead ?? pendingBatches(projectId, workspaceId),
    classifierRead,
  ]);
  // The citations of every key add up to the period's total, so the extra full scan is only for a truncated read.
  const total = truncated ? await citationTotal(ctx, domainQuery) : seen;
  const byType = new Map<SourceTypeValue, { citations: number; domains: number }>(
    [...buckets].map(([type, { citations, keys }]) => [type, { citations, domains: keys }]),
  );
  // Domains beyond the pages read cannot be typed, so they remain visibly unclassified.
  const tail = Math.max(0, total - seen);
  if (tail || truncated) {
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
    truncated,
    pendingBatches: pending,
  };
}

/** Citations by content (page) type of the cited URLs, with the unclassified part declared. */
export async function contentTypesReport(
  workspaceId: string,
  q: URLSearchParams,
  ctx: Parameters<typeof sourcesReport>[0],
  demo = false,
  pendingRead?: number,
  known?: Classifier,
): Promise<ContentTypesReport> {
  const urlQuery = new URLSearchParams(q);
  urlQuery.set('kind', 'cited');
  urlQuery.set('group', 'url');
  urlQuery.set('page', '1');
  urlQuery.set('order', 'responses');
  urlQuery.delete('type');
  urlQuery.delete('owner');
  const projectId = String(ctx.project.id);
  const classifierRead = known ? Promise.resolve(known) : sourceTypeClassifier(projectId, workspaceId, demo);
  const [{ buckets, seen, truncated }, pending, classifier] = await Promise.all([
    typedCounts(ctx, urlQuery, 'url', classifierRead),
    pendingRead ?? pendingBatches(projectId, workspaceId),
    classifierRead,
  ]);
  // The citations of every key add up to the period's total, so the extra full scan is only for a truncated read.
  const total = truncated ? await citationTotal(ctx, urlQuery) : seen;
  const byType = new Map<SourceTypeValue, { citations: number; urls: number }>(
    [...buckets].map(([type, { citations, keys }]) => [type, { citations, urls: keys }]),
  );
  // URLs beyond the pages read cannot be typed, so they remain visibly unclassified.
  const tail = Math.max(0, total - seen);
  if (tail || truncated) {
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
    truncated,
    pendingBatches: pending,
  };
}

export async function sourceEntityDetail(
  workspaceId: string,
  q: URLSearchParams,
  kind: SourceTypeKind,
  demo = false,
  /** The request's report context and classifier, when it already has them: nothing is read twice. */
  ctx?: Parameters<typeof sourcesReport>[0],
  known?: Classifier,
): Promise<SourceEntityDetail> {
  const [base, classifier] = await Promise.all([
    sourceEntityReport(workspaceId, q, kind, ctx),
    known ?? sourceTypeClassifier(String(q.get('project')), workspaceId, demo),
  ]);
  const [domains, urls] = await Promise.all([
    cachedSourceTypes('domain', [base.domain], classifier),
    cachedSourceTypes('url', kind === 'url' ? [base.key] : base.urls.map((item) => item.url), classifier),
  ]);
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

/** Cited pages per domain sent as evidence with a site-type question, and the window of most cited URLs they come from. */
const SAMPLES_PER_DOMAIN = 3;
const SAMPLE_WINDOW = 1000;
/**
 * The most cited pages (URL and title) of each domain in the period, from one read of the URL ranking: the evaluator
 * judges a site it does not know by what AI answers cited from it.
 */
export async function domainSamples(ctx: Parameters<typeof sourcesReport>[0], q: URLSearchParams) {
  const query = new URLSearchParams(q);
  for (const [key, value] of Object.entries({ kind: 'cited', group: 'url', page: '1', order: 'responses' })) query.set(key, value);
  for (const key of ['type', 'owner', 'sort', 'query', 'q']) query.delete(key);
  const samples = new Map<string, { url: string; title: string }[]>();
  for (const row of (await sourcesReport(ctx, query, SAMPLE_WINDOW)).rows) {
    const domain = catalogKey('domain', row.domain);
    const list = samples.get(domain) ?? [];
    if (list.length < SAMPLES_PER_DOMAIN && row.key) list.push({ url: row.key, title: row.title === row.key ? '' : row.title });
    samples.set(domain, list);
  }
  return samples;
}
export const withSamples = (items: SourceTypeItem[], samples: Map<string, { url: string; title: string }[]>) =>
  items.map((item) => ({ ...item, samples: samples.get(item.key) ?? [] }));
/** A batch's stored input: a domain batch records the question it was asked with (what the admin reclassification compares). */
export const sourceTypeJobInput = (kind: SourceTypeKind, items: SourceTypeItem[]) =>
  kind === 'domain' ? { kind, prompt: SOURCE_TYPE_DOMAIN_PROMPT, items } : { kind, items };

/** Queues limited provider batches for sources without a cached type. Explicit user action only. */
export async function enqueueSourceTypes(
  projectId: string,
  workspaceId: string,
  q: URLSearchParams,
  value: unknown,
) {
  await ownedProject(projectId, workspaceId);
  const kind: SourceTypeKind = value === 'url' ? 'url' : 'domain';
  if (value != null && value !== 'domain' && value !== 'url')
    throw new ApiError(400, 'Choose domains or URLs.');
  const classifier = await sourceTypeClassifier(projectId, workspaceId);
  if (classifier.state === 'disabled')
    throw new ApiError(403, 'Enable the evaluator in Settings before classifying sources.');
  if (classifier.state === 'unconfigured')
    throw new ApiError(503, 'Source classification is not available on this installation.');
  if (classifier.state === 'unavailable')
    throw new ApiError(403, 'This project is not authorized for source classification.');
  const configuration = await brandResearchConfiguration(projectId, workspaceId);
  const query = new URLSearchParams(q);
  query.set('project', projectId);
  query.set('view', 'sources');
  query.set('kind', 'cited');
  query.set('group', kind);
  query.set('page', '1');
  query.delete('type');
  query.delete('owner');
  const ctx = await reportContext(workspaceId, query);
  query.set('order', 'responses');
  const window = await sourcesReport(ctx, query, CANDIDATE_WINDOW);
  // Your own and competitors' domains are typed too: the site type is independent of ownership.
  const candidates = window.rows.filter((row) => row.key !== '');
  const cached = await cachedSourceTypes(kind, candidates.map((row) => row.key), classifier);
  const contextKey = `${SOURCE_TYPE_CONTEXT_PREFIX}${SOURCE_TYPE_RUBRIC}:${classifier.provider}`;
  // Anything already waiting for a provider answer, whoever asked and whichever evaluator: the
  // catalog is shared, so a page queued by another project is never queued a second time.
  const active = new Set(
    (
      await db()
        .prepare(
          `SELECT json_extract(item.value,'$.key') key FROM brand_research_jobs job,json_each(job.input_json,'$.items') item
          WHERE job.context_key LIKE ? AND job.status IN ('pending','submitting','unknown','unsettled')
          AND json_extract(job.input_json,'$.kind')=?`,
        )
        .bind(`${SOURCE_TYPE_CONTEXT_PREFIX}${SOURCE_TYPE_RUBRIC}:%`, kind)
        .all<{ key: string }>()
    ).results.map((row) => catalogKey(kind, row.key)),
  );
  const seen = new Set<string>();
  const listed: SourceTypeItem[] = candidates
    .filter((row) => {
      const key = catalogKey(kind, row.key);
      if (cached.has(row.key) || active.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, SOURCE_TYPE_ENQUEUE_LIMIT)
    .map((row) => ({
      kind,
      key: catalogKey(kind, row.key),
      domain: row.domain,
      title: kind === 'url' ? row.title : undefined,
    }));
  const todo = kind === 'domain' && listed.length ? withSamples(listed, await domainSamples(ctx, query)) : listed;
  let enqueued = 0;
  for (let offset = 0; offset < todo.length; offset += SOURCE_TYPE_BATCH_SIZE) {
    const items = todo.slice(offset, offset + SOURCE_TYPE_BATCH_SIZE);
    const stamp = now();
    const budget = researchBudgetCondition(SOURCE_TYPE_RESERVE_USD, projectId, { owner: workspaceId, module: 'sourceTypes' });
    const inputKey = await hash(
      `${contextKey}:${classifier.model}:${SOURCE_TYPE_ADAPTER_VERSION}:${kind}:${items.map((item) => item.key).join('\n')}`,
    );
    const result = await db()
      .prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at)
      SELECT ?,?,?,?,?,?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived=0)
      AND EXISTS(SELECT 1 FROM brand_research_configurations WHERE project_id=? AND workspace_id=? AND provider=? AND enabled=1 AND revision=?) AND ${budget.sql}
      ON CONFLICT(project_id,input_key) DO UPDATE SET status='pending',reserved_usd=excluded.reserved_usd,input_json=excluded.input_json,requested_at=excluded.requested_at,completed_at=NULL,error=NULL
      WHERE brand_research_jobs.workspace_id=excluded.workspace_id AND brand_research_jobs.status IN ('cancelled','failed') AND brand_research_jobs.cost_usd=0`)
      .bind(
        crypto.randomUUID(),
        workspaceId,
        projectId,
        inputKey,
        contextKey,
        inputKey,
        classifier.provider,
        classifier.model,
        SOURCE_TYPE_RESERVE_USD,
        JSON.stringify(sourceTypeJobInput(kind, items)),
        stamp,
        projectId,
        workspaceId,
        projectId,
        workspaceId,
        classifier.provider,
        configuration.revision,
        ...budget.params,
      )
      .run();
    enqueued += Number(result.meta.changes);
    if (!result.meta.changes) {
      const existing = await db()
        .prepare('SELECT id FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND input_key=?')
        .bind(projectId, workspaceId, inputKey)
        .first();
      if (!existing) throw new ApiError(409, 'Research budget is full.');
    }
  }
  const processed = enqueued
    ? await processSourceTypeJobs({ projectId, workspaceId, provider: classifier.provider })
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
    /** The HTTP status when the provider answered. */
    readonly status = 0,
  ) {
    super(message);
  }
}

export { SYSTEMIC_PROVIDER_STATUSES };

/**
 * One typed Decisions request for at most one batch. Shared by the explicit
 * classification jobs and the public demo operation so both enforce the same
 * request shape, response validation and "unknown outcome" rule.
 */
export async function requestSourceTypes(items: SourceTypeItem[], model: string, fallback: string | null = null) {
  try {
    return { ...(await requestSourceTypesOnce(items, model)), model };
  } catch (error) {
    if (!fallback || !(error instanceof SourceTypeProviderError)) throw error;
    // Both calls are paid from the one reservation (SOURCE_TYPE_RESERVE_USD each, as every call is sized): see mayUseFallback.
    if (!mayUseFallback(error)) throw error;
    console.warn(`Source types: ${model} failed (${error.message}); retrying on ${fallback}.`);
    // A first call that may have been billed without a reported cost keeps the whole reservation.
    const spent = error.unknown ? null : error.cost ?? 0;
    try {
      const result = await requestSourceTypesOnce(items, fallback);
      return { ...result, cost: result.cost === null || spent === null ? null : result.cost + spent, model: fallback };
    } catch (second) {
      if (!(second instanceof SourceTypeProviderError)) throw second;
      throw new SourceTypeProviderError(second.message, second.unknown || spent === null, (second.cost ?? 0) + (spent ?? 0), second.status);
    }
  }
}

async function requestSourceTypesOnce(items: SourceTypeItem[], model: string) {
  let sent = false,
    status = 0,
    cost: number | null = null;
  try {
    const payload = sourceTypeDecisionRequest(items, model);
    sent = true;
    const response = await postDecisions(payload);
    status = response.status;
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
      status,
    );
  }
}

type Scope = { projectId: string; workspaceId: string; provider: ResearchProvider };

/**
 * Sends at most two pending batches per call. An uncertain outcome becomes
 * `unknown` and is never resent automatically, matching brand research.
 */
export async function processSourceTypeJobs(scope?: Scope) {
  if (setting('BRAND_RESEARCH_ENABLED') !== 'true') return 0;
  if ((!researchProjects().length && !researchEveryProject()) || !decisionKeyConfigured()) return 0;
  if (scope && !researchAllowed(scope.projectId)) return 0;
  await foldLegacyClassifications();
  const database = db();
  const scopeSql = scope ? ' AND project_id=? AND workspace_id=? AND provider=?' : '';
  const scopeParams = scope ? [scope.projectId, scope.workspaceId, scope.provider] : [];
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
    const budget = researchBudgetCondition(0, job.project_id);
    if (!researchAllowed(job.project_id)) continue;
    const claimed = await database
      .prepare(`UPDATE brand_research_jobs SET status='submitting',started_at=? WHERE id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived=0)
      AND EXISTS(SELECT 1 FROM brand_research_configurations c WHERE c.project_id=brand_research_jobs.project_id AND c.workspace_id=brand_research_jobs.workspace_id AND c.enabled=1 AND c.provider=brand_research_jobs.provider) AND ${budget.sql}`)
      .bind(stamp, job.id, job.project_id, job.workspace_id, ...budget.params)
      .run();
    if (!claimed.meta.changes) continue;
    processed++;
    let outcome: { unknown: boolean; cost: number | null } = { unknown: false, cost: null };
    try {
      const queued = (JSON.parse(job.input_json) as { items: SourceTypeItem[] }).items;
      // The catalog may have gained these pages since they were queued (another project, an
      // earlier batch, the migration): only what is still unclassified is sent, and a batch with
      // nothing left costs nothing and calls no provider.
      const known = await cachedSourceTypes(queued[0]?.kind ?? 'domain', queued.map((item) => item.key), {
        provider: job.provider,
        model: job.model,
        rubric: SOURCE_TYPE_RUBRIC,
        state: 'ready',
      });
      const items = queued.filter((item) => !known.has(item.key));
      // The previous engine of the job's provider answers when the configured model fails.
      const previous = RESEARCH_MODELS[job.provider];
      const result = items.length
        ? await requestSourceTypes(items, job.model, job.model === previous ? null : previous)
        : { types: [], cost: 0, model: job.model };
      const answered = { ...job, model: result.model };
      const cost = result.cost;
      outcome = { unknown: false, cost };
      const done = now();
      await database.batch([
        database
          .prepare("UPDATE brand_research_jobs SET status=?,result_json=?,cost_usd=?,reserved_usd=?,completed_at=?,error=?,model=? WHERE id=? AND status='submitting'")
          .bind(
            cost === null ? 'unsettled' : 'completed',
            JSON.stringify(result.types),
            cost ?? 0,
            cost ?? job.reserved_usd,
            done,
            cost === null ? 'Usage cost is unavailable; the conservative reservation is retained.' : null,
            result.model,
            job.id,
          ),
        ...result.types.map((item) => catalogWrite(database, item, answered, done)),
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
export async function sourceTypeRevision(projectId: string, workspaceId: string, demo = false) {
  // Every classifier reads the one rubric, so the catalog count does not wait for the classifier state.
  const [classifier, row] = await Promise.all([
    sourceTypeClassifier(projectId, workspaceId, demo),
    sourceTypeRevisionStatement().first<CatalogRevision>(),
  ]);
  return sourceTypeRevisionKey(classifier, row);
}
type CatalogRevision = { n: number; latest: string | null };
/** The read of {@link sourceTypeRevision}, for a caller that sends it in one `db().batch` with other reads (then {@link sourceTypeRevisionKey}). */
export const sourceTypeRevisionStatement = () =>
  db().prepare('SELECT COUNT(*) n,MAX(classified_at) latest FROM source_catalog WHERE rubric=?').bind(SOURCE_TYPE_RUBRIC);
export const sourceTypeRevisionKey = (classifier: Classifier, row: CatalogRevision | null | undefined) =>
  `${classifier.state}${classifier.automatic ? '+auto' : ''}:${classifier.provider}:${row?.n ?? 0}:${row?.latest ?? ''}:${SOURCE_TYPE_RULES_VERSION}`;

/**
 * The D1 reads of a typed view (catalog revision, evaluator settings, batches waiting when `counted`), for the report
 * context's `more`, which has already checked the project's owner; then {@link sourceTypeReads}.
 */
export const sourceTypeStatements = (projectId: string, workspaceId: string, counted: boolean) => [
  sourceTypeRevisionStatement(),
  configurationStatement(projectId, workspaceId),
  ...(counted ? [pendingBatchesStatement(projectId, workspaceId)] : []),
];
export async function sourceTypeReads(projectId: string, [revision, configuration, pending]: D1Result[]) {
  const classifier = await classifierFrom(projectId, configurationRead(configuration));
  return {
    classifier,
    revision: sourceTypeRevisionKey(classifier, revision.results[0] as CatalogRevision | undefined),
    pending: pending ? pendingCount(pending.results[0] as { n: number }) : undefined,
  };
}
export const SOURCE_TYPE_VIEWS = ['sources', 'source-types', 'content-types', 'domain-detail', 'url-detail'] as const;
/** Views that carry source types; the report routes dispatch them here. */
export async function sourceTypeView(
  view: string,
  workspaceId: string,
  ctx: Parameters<typeof sourcesReport>[0],
  q: URLSearchParams,
  demo = false,
  pending?: number,
  classifier?: Classifier,
) {
  // Responses never carry the evaluator or its model.
  switch (view) {
    case 'sources':
      return publicClassifierView(await typedSourcesReport(workspaceId, q, ctx, demo, classifier));
    case 'source-types':
      return publicClassifierView(await sourceTypesReport(workspaceId, q, ctx, demo, pending, classifier));
    case 'content-types':
      return publicClassifierView(await contentTypesReport(workspaceId, q, ctx, demo, pending, classifier));
    case 'domain-detail':
      return publicClassifierView(await sourceEntityDetail(workspaceId, q, 'domain', demo, ctx, classifier));
    case 'url-detail':
      return publicClassifierView(await sourceEntityDetail(workspaceId, q, 'url', demo, ctx, classifier));
    default:
      throw new ApiError(400, 'Invalid report.');
  }
}
