import {
  RESEARCH_SHORTLIST_VERSION,
} from '@/lib/brand-research-candidates';
import { buildTargetSnapshot } from '@/lib/target-snapshot.mjs';
import { brandProse, matchesBrand, sliceUnicode } from '@/lib/metrics';
import {
  BRAND_RESEARCH_RUBRIC,
  SENTIMENT_QUESTIONS_VERSION,
  LEGACY_RESEARCH_RUBRICS,
  sentimentReprocessKey,
  researchInput,
  matchedDiscoveries,
  summarizeSentiment,
  sentimentByUnit,
  SENTIMENTS,
  EVALUATED_BRANDS,
  GUARANTEED_DISCOVERIES,
  type ResearchInput,
  type ResearchObservation,
  type ResearchProvider,
  type ResearchReading,
  type Sentiment,
} from '@/lib/brand-research';
import {
  decisionRequest,
  mergedReadings,
  parseDecisionResponse,
  researchEvidence,
  RESEARCH_MODELS,
  RESEARCH_RESERVE_USD,
  RESEARCH_ADAPTER_VERSION,
  sentimentCascade,
  steadySentiment,
  windowMaterial,
} from '@/lib/brand-research-provider';
import { measuredCommonNames } from '@/lib/brand-mention-check';
import { ROLE_CONTEXT_PREFIX, evaluableDiscovery } from '@/lib/brand-roles';
import { brandKey } from '@/lib/brand-decisions';
import type { BrandTarget } from '@/lib/types';
import { SOURCE_TYPE_RESERVE_USD, SOURCE_TYPE_RUBRIC } from '@/lib/source-types';
import { DOMAIN_ROW_SPEND_SQL } from '@/lib/brand-domain';
import { waitUntil } from 'cloudflare:workers';
import { shareFlight, type Flight } from './analytics-query-cache';
import { platformGuard, spendGuard } from './spend-guards';
import { timed } from './server-timing';
import { db, now, setting } from './env';
import { classifierModels } from './classifier-models';
import { postDecisions } from './decisions-api';
import { researchAllProjects } from './capabilities';
import * as edition from './capabilities';
import { WORKSPACE_JOBS_SQL, type SpendModule } from '@/lib/platform-spend';
// Read through the namespace: a module standing in for the edition without it (a test's) has no plan counts.
const planCountCondition = edition.planCountCondition ?? (() => ({ sql: '1=1', params: [] as (string | number)[] }));
/**
 * Evaluations are automatic by default where the installation researches every project: Cloud always (8/11/2026); the
 * independent edition when the Worker says so (`BRAND_RESEARCH_ENABLED` with `BRAND_RESEARCH_PROJECTS=*`, the installer's default).
 */
export const automaticByDefault = () => researchAllProjects === 'always' || (setting('BRAND_RESEARCH_ENABLED') === 'true' && researchEveryProject());
import { ApiError } from './http';
import { ownedProject } from './workspace';
import { foundProject, ownedProjectStatement, projectStoreStatement } from './project-reads';
import { projectReadDatabase, storedCopy } from './project-store-read';
import { ANSWER_DISCOVERY_KEYS_SQL, EFFECTIVE_MENTIONS_SQL, EFFECTIVE_TARGETS_SQL } from './run-rows';
import { competitorAnalysisStatus } from './competitor-analysis';
import type { StoreRegistry } from './project-store';
import { decisionEventsFrom, decisionEventsStatement, withoutDecided } from './brand-decision-events';
import { rolesFrom, roleDecisionsStatements, withModelRoles } from './brand-roles';
import { parseReportFilter } from './reports';
import { reportTopics } from './report-filter';
import { readTopicWeights } from '@/lib/topic-weights';
import { decisionKeyConfigured } from './model-routes';

const MAX_CHANNELS = 1000;
/** Answer details kept for each discovered brand in a report. */
const DISCOVERED_DETAILS = 20;
const ENQUEUE_LIMIT = 20;
type StoredRun = {
  id: string;
  unit_id: string;
  engine: string;
  answer: string;
  created_at: string;
  prompt_text: string;
  answer_length: number;
  /** The discoveries the active brand analysis found in the answer (`{brand key: offset}`, or a list of keys); null before it read it. */
  brands?: string | null;
  /** The question's topic (topic weights). */
  topic?: string;
  /** The answer's effective mention of each monitored brand (`{name: 0|1}`, structure-v10), as Responses filters it. */
  mentions_json?: string | null;
  /** The name the answer's own brand had when it was read (the key of its flag in `mentions_json`). */
  primary_name?: string | null;
};
/**
 * Whether the answer mentions a monitored brand, by the one definition Responses and the reports use: the answer's effective
 * mention (the brand analysis overlay, else the collection snapshot), so a name that only matches the text ("Conversion Rate
 * Optimization") is no mention. An answer read before the brand was monitored has no flag: the text decides.
 */
function mentionsTarget(run: Pick<StoredRun, 'answer' | 'mentions_json' | 'primary_name'>, target: BrandTarget, own: boolean) {
  let flags: Record<string, unknown> = {};
  try {
    flags = JSON.parse(run.mentions_json || '{}') ?? {};
  } catch {
    // An unreadable snapshot falls back to the text.
  }
  const key = own ? run.primary_name || target.name : target.name;
  return key in flags ? Number(flags[key]) === 1 : matchesBrand(run.answer, target);
}
/** The brand keys the store keeps for an answer's discoveries. */
const discoveryKeys = (brands: string | null | undefined): string[] => {
  if (!brands) return [];
  const parsed = JSON.parse(brands) as Record<string, unknown> | string[];
  return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : Object.keys(parsed);
};
const MAX_SCOPE_CHARACTERS = 4_000_000;
const QUERY_CHARACTERS = 250_000;
// Answers per store message, several pages of QUERY_CHARACTERS: the response stays well under the store's 4 MiB.
const GROUP_CHARACTERS = 750_000;
type Job = {
  id: string;
  workspace_id: string;
  project_id: string;
  input_key: string;
  context_key: string;
  answer_sha256: string;
  status: string;
  input_json: string;
  result_json: string | null;
  provider: ResearchProvider;
  model: string;
  reserved_usd: number;
  cost_usd: number;
  started_at: string | null;
  error: string | null;
};
/**
 * Most one project's automatic evaluations (sentiment and source types together) may spend in a calendar month
 * unless its configuration row says otherwise (`monthly_ceiling_usd`, edited by the Admin section).
 */
export const DEFAULT_MONTHLY_CEILING_USD = 10;
/** Jobs of the scheduler's automatic evaluations (Cloud): sentiment ids, and the source-type ledger (never `source-types:`, the customers'). */
export const SENTIMENT_JOB_PREFIX = 'project-sentiment:';
export const LEGACY_SENTIMENT_PREFIX = 'netflix-sentiment:';
export const AUTO_LEDGER = `source-types-auto:${SOURCE_TYPE_RUBRIC}`;
export const AUTO_CLASSIFICATION_KEY = 'auto_source_classification';
/**
 * Written by `evaluations-enable` (Cloud, ./automatic-evaluations): the total the first cycle (the initial reprocessing) may spend over every
 * project, from `enabledAt`. It holds until the reprocessing finishes (`closeFirstCycle` sets `completedAt`) or `windowEndsAt` passes,
 * whichever comes first; then the project ceilings alone apply.
 */
export const EVALUATIONS_AUTHORIZATION_KEY = 'evaluations_authorization';
/** What an automatic project's untyped sources are doing: being typed, waiting for the next look, paused by a stop, or out of this month's ceiling. */
export type AutomaticActivity = 'running' | 'waiting' | 'paused' | 'ceiling';
/** "Being typed" needs proof: the operation reported progress and this project had a batch sent within this long (the scheduler ticks every 5 minutes). */
const ACTIVITY_FRESH_MS = 20 * 60_000;
export async function automaticActivity(projectId: string, ceilingUsd: number): Promise<AutomaticActivity> {
  const [spent, state, last, authorization] = await Promise.all([
    db()
      .prepare(
        `SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) spent FROM brand_research_jobs WHERE project_id=? AND requested_at>=? AND (id LIKE ? OR id LIKE ? OR context_key=?)`,
      )
      .bind(projectId, `${now().slice(0, 7)}-01T00:00:00.000Z`, `${SENTIMENT_JOB_PREFIX}%`, `${LEGACY_SENTIMENT_PREFIX}%`, AUTO_LEDGER)
      .first<{ spent: number }>(),
    db().prepare('SELECT value FROM system_state WHERE key=?').bind(AUTO_CLASSIFICATION_KEY).first<{ value: string }>(),
    db().prepare('SELECT MAX(requested_at) at FROM brand_research_jobs WHERE project_id=? AND context_key=?').bind(projectId, AUTO_LEDGER).first<{ at: string | null }>(),
    db().prepare('SELECT value FROM system_state WHERE key=?').bind(EVALUATIONS_AUTHORIZATION_KEY).first<{ value: string }>(),
  ]);
  // While the first cycle lasts (until it is completed or its window passes) and its total is used up, nothing runs, so the
  // turn of the month does not resume anything: that is a pause, never "resumes next month". A passed window ends the cycle.
  if (authorization) {
    let cycle: { enabledAt?: string; windowEndsAt?: string; ceilingUsd?: number; completedAt?: string };
    try {
      cycle = JSON.parse(authorization.value || '{}');
    } catch {
      return 'paused';
    }
    if (!cycle.completedAt && !cycle.windowEndsAt) return 'paused';
    if (!cycle.completedAt && (cycle.windowEndsAt ?? '') >= now()) {
      const total = await db()
        .prepare(
          `SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) spent FROM brand_research_jobs WHERE requested_at>=? AND (id LIKE ? OR id LIKE ? OR context_key=?)`,
        )
        .bind(cycle.enabledAt ?? '', `${SENTIMENT_JOB_PREFIX}%`, `${LEGACY_SENTIMENT_PREFIX}%`, AUTO_LEDGER)
        .first<{ spent: number }>();
      if (Number(total?.spent || 0) + SOURCE_TYPE_RESERVE_USD > Number(cycle.ceilingUsd || 0)) return 'paused';
    }
  }
  if (Number(spent?.spent || 0) + SOURCE_TYPE_RESERVE_USD > ceilingUsd) return 'ceiling';
  let operation: { status?: string; retryable?: boolean; note?: string; updatedAt?: string } = {};
  try {
    operation = JSON.parse(state?.value || '{}');
  } catch {
    // An unreadable state is shown as not running anything.
    return 'paused';
  }
  // Failed with a certain, unbilled rejection (including a refused key, credit or rate limit) is tried again within the hour;
  // failed otherwise (an uncertain outcome, the first-cycle ceiling) waits for a person.
  if (operation.status === 'failed') return operation.retryable ? 'waiting' : 'paused';
  if (operation.status === 'applied' || operation.status === 'capped' || operation.note) return operation.status === 'capped' ? 'paused' : 'waiting';
  const fresh = (at?: string | null) => Date.now() - Date.parse(at ?? '') < ACTIVITY_FRESH_MS;
  // No state, an empty or an unknown one, or progress nobody made lately for this project, is only waiting.
  return operation.status === 'running' && fresh(operation.updatedAt) && fresh(last?.at) ? 'running' : 'waiting';
}
/** The model a provider's evaluations run on: the configured one, else the provider's own. */
export const researchModel =(provider: ResearchProvider) =>
  classifierModels(`brand_research_${provider}`, RESEARCH_MODELS[provider]).model;
async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
// `*` authorizes every project in the independent edition: it has one owner, and its
// project ids do not exist yet when the installer configures the Worker. Cloud
// authorizes every project by itself (8/11/2026: evaluations on for all
// projects, within each budget and plan), whatever `BRAND_RESEARCH_PROJECTS` lists.
const ALL_PROJECTS = '*';
export function researchProjects() {
  return setting('BRAND_RESEARCH_PROJECTS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
/** Every project may be researched: Cloud always, the independent edition with `*`. */
export const researchEveryProject = (projects = researchProjects()) =>
  researchAllProjects === 'always' || (researchAllProjects && projects.includes(ALL_PROJECTS));
// SQL bindings for `(? OR project_id IN (SELECT value FROM json_each(?)))`: the
// scheduler's project filter.
export function researchProjectBindings() {
  const projects = researchProjects();
  return [Number(researchEveryProject(projects)), JSON.stringify(projects)];
}
export function researchAllowed(projectId: string) {
  const projects = researchProjects();
  return setting('BRAND_RESEARCH_ENABLED') === 'true' && (researchEveryProject(projects) || projects.includes(projectId));
}
function selectedProvider(value: unknown): ResearchProvider {
  if (value !== 'liquid' && value !== 'jev' && value !== 'decisions')
    throw new ApiError(400, 'Choose a valid evaluator.');
  return value;
}

type ConfigurationRow = {
  provider: 'jev' | 'decisions';
  sentiment_provider: ResearchProvider;
  enabled: number;
  automatic: number;
  monthly_ceiling_usd: number | null;
  revision: number;
  updated_at: string;
};
/** The read of {@link brandResearchConfiguration}, for a caller that sends it in one `db().batch` with other reads (then {@link configurationRead}). */
export const configurationStatement = (projectId: string, workspaceId: string) =>
  db()
    .prepare(
      'SELECT provider,COALESCE(sentiment_provider,provider) sentiment_provider,enabled,automatic,monthly_ceiling_usd,revision,updated_at FROM brand_research_configurations WHERE project_id=? AND workspace_id=?',
    )
    .bind(projectId, workspaceId);

export async function brandResearchConfiguration(
  projectId: string,
  workspaceId: string,
) {
  await ownedProject(projectId, workspaceId);
  return configurationFrom(await configurationStatement(projectId, workspaceId).first<ConfigurationRow>());
}

/** The configuration a batched {@link configurationStatement} read, for a caller that already checked the project's owner. */
export const configurationRead = (read: D1Result) => configurationFrom(read.results[0] as ConfigurationRow | undefined);
function configurationFrom(row: ConfigurationRow | null | undefined) {
  return row
    ? {
        provider: row.provider,
        sentimentProvider: row.sentiment_provider,
        enabled: !!row.enabled,
        automatic: !!row.enabled && !!row.automatic,
        monthlyCeilingUsd: row.monthly_ceiling_usd ?? DEFAULT_MONTHLY_CEILING_USD,
        revision: row.revision,
        updatedAt: row.updated_at,
      }
    : {
        provider: 'jev' as const,
        sentimentProvider: 'liquid' as const,
        // Every project evaluates automatically until its owner switches it off (Cloud since 8/11/2026; the independent edition when it researches every project).
        enabled: automaticByDefault(),
        automatic: automaticByDefault(),
        monthlyCeilingUsd: DEFAULT_MONTHLY_CEILING_USD,
        revision: 0,
        updatedAt: null,
      };
}

export async function saveBrandResearchConfiguration(
  projectId: string,
  workspaceId: string,
  value: Record<string, unknown>,
) {
  // Customers no longer see or send the evaluator: without one, the saved evaluator is kept.
  const saved = value.provider == null ? await brandResearchConfiguration(projectId, workspaceId) : null;
  if (!saved) await ownedProject(projectId, workspaceId);
  const provider = saved ? saved.sentimentProvider : selectedProvider(value.provider),
    revision = value.expectedRevision;
  if (
    typeof value.enabled !== 'boolean' ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    throw new ApiError(400, 'Invalid brand research configuration.');
  const stamp = now();
  const result = await db().batch([
    db()
      .prepare(`INSERT INTO brand_research_configurations(project_id,workspace_id,provider,sentiment_provider,enabled,automatic,revision,updated_at)
      SELECT id,workspace_id,'jev',?,?,${Number(automaticByDefault())},?,? FROM projects WHERE id=? AND workspace_id=? AND archived=0
      AND COALESCE((SELECT revision FROM brand_research_configurations WHERE project_id=projects.id),0)=?
      ON CONFLICT(project_id) DO UPDATE SET sentiment_provider=excluded.sentiment_provider,enabled=excluded.enabled,revision=excluded.revision,updated_at=excluded.updated_at WHERE brand_research_configurations.workspace_id=excluded.workspace_id AND brand_research_configurations.revision=?`)
      .bind(
        provider,
        Number(value.enabled),
        revision + 1,
        stamp,
        projectId,
        workspaceId,
        revision,
        revision,
      ),
    db()
      .prepare(`UPDATE brand_research_jobs SET status='cancelled',reserved_usd=0,completed_at=?,error='Brand research configuration changed.'
      WHERE project_id=? AND workspace_id=? AND status='pending' AND (?=0 OR (context_key NOT LIKE 'source-types:%' AND provider<>?))
      AND EXISTS(SELECT 1 FROM brand_research_configurations WHERE project_id=? AND workspace_id=? AND revision=? AND COALESCE(sentiment_provider,provider)=? AND enabled=?)`)
      .bind(
        stamp,
        projectId,
        workspaceId,
        Number(value.enabled),
        provider,
        projectId,
        workspaceId,
        revision + 1,
        provider,
        Number(value.enabled),
      ),
  ]);
  if (!result[0].meta.changes)
    throw new ApiError(
      409,
      'Brand research settings changed. Reload before saving.',
    );
  return brandResearchConfiguration(projectId, workspaceId);
}

async function activeConfiguration(
  projectId: string,
  workspaceId: string,
  requested: unknown,
) {
  const configuration = await brandResearchConfiguration(projectId, workspaceId);
  if (!configuration.enabled)
    throw new ApiError(
      403,
      'Enable brand research in Settings before evaluating.',
    );
  if (
    requested != null &&
    selectedProvider(requested) !== configuration.sentimentProvider
  )
    throw new ApiError(
      409,
      'Brand research settings changed. Reload before evaluating.',
    );
  return configuration;
}

/**
 * The brand list is not part of the context: a reading of a brand in an answer stays valid whatever other
 * brands were read with it, so monitoring, rejecting or merging a brand keeps every saved sentiment and only the
 * answers that mention a brand with no reading need a new one. Before that the monitored list was part of the context
 * key, and formerly the discovery list too, so a job saved then carries a key nobody can recompute once a list
 * changes. Such a job still reads an answer for the same category, rubric, provider and model. shortcut: trusts the
 * adapter and shortlist versions of that time; drop it when no job from before this date is left in the 90-day window
 * (2027-02-01) or when one of the two versions changes.
 */
const LEGACY_READINGS_BEFORE = '2026-11-01T00:00:00.000Z';
function legacyReading(job: Job, contextKeys: string[], rubrics: readonly string[], category: string, provider: ResearchProvider) {
  if (contextKeys.includes(job.context_key)) return true;
  if (job.provider !== provider || job.model !== researchModel(provider)) return false;
  // A job of another context counts only once it settled: one that failed, was left unknown or was cancelled never stops a
  // new request under the current context (the Jev readings failed by adapter v1 held their answers). Under the
  // current context the same request is still never resent.
  if (job.status !== 'completed' && job.status !== 'unsettled') return false;
  const input = jobInput(job);
  return !!input && rubrics.includes(input.rubric) && input.category === sliceUnicode(category, 0, 300);
}

/** The columns of {@link Job}. */
const JOB_COLUMNS = 'id,workspace_id,project_id,input_key,context_key,answer_sha256,status,input_json,result_json,provider,model,reserved_usd,cost_usd,started_at,error';
/**
 * The same columns as the report reads them: the input without its excerpt (up to 16,000 characters of the answer) and its
 * options without what the report never reads (aliases, detector key, review flag and reasons), and the readings without
 * their evidence quotes, which are most of a job's bytes and which the report shows for a few answers only (fetched
 * afterwards, {@link readingEvidence}). Everything else is the stored JSON. For Netflix (6,815 readings) 65 MB become 15 MB.
 */
const REPORT_JOB_COLUMNS = JOB_COLUMNS.replace(
  'input_json',
  `CASE WHEN json_type(input_json,'$.options')='array' THEN json_set(json_remove(input_json,'$.excerpt'),'$.options',
     json((SELECT json_group_array(json_remove(o.value,'$.aliases','$.key','$.ambiguous','$.reasons')) FROM json_each(input_json,'$.options') o WHERE o.type='object')))
   ELSE json_remove(input_json,'$.excerpt') END input_json`,
).replace(
  'result_json',
  `CASE WHEN json_valid(result_json) AND json_type(result_json)='array'
   THEN json((SELECT json_group_array(json_remove(r.value,'$.evidence')) FROM json_each(result_json) r WHERE r.type='object')) END result_json`,
);
/** Where a reading's evidence goes in the report, filled by {@link readingEvidence}. */
type EvidenceRef = { job: string; reading: string };
/** The evidence of these readings (job id, reading id), in one D1 read: the first reading of that id in its job, as `brandReading` finds it. */
async function readingEvidence(projectId: string, workspaceId: string, refs: EvidenceRef[]) {
  const found = new Map<string, string[]>();
  if (!refs.length) return found;
  const rows = await db()
    .prepare(
      `SELECT w.key position,json_extract(r.value,'$.evidence') evidence FROM json_each(?) w
       JOIN brand_research_jobs j ON j.id=json_extract(w.value,'$[0]') AND j.project_id=? AND j.workspace_id=?
       JOIN json_each(j.result_json) r ON r.type='object' AND json_extract(r.value,'$.id')=json_extract(w.value,'$[1]')
       ORDER BY w.key,r.key`,
    )
    .bind(JSON.stringify(refs.map((ref) => [ref.job, ref.reading])), projectId, workspaceId)
    .all<{ position: number; evidence: string | null }>();
  for (const row of rows.results) {
    const ref = refs[row.position];
    const key = `${ref.job}\0${ref.reading}`;
    if (!found.has(key)) found.set(key, row.evidence ? (JSON.parse(row.evidence) as string[]) : []);
  }
  return found;
}
const JOB_RANK: Record<string, number> = { completed: 0, unsettled: 0, pending: 1, submitting: 1 };
const settledJob = (job: Job) => job.status === 'completed' || job.status === 'unsettled';
// A report asks each job for its input and readings once per brand of each answer: parsed once per job (most of its CPU otherwise).
const parsedInputs = new WeakMap<Job, ResearchInput | null>();
const parsedReadings = new WeakMap<Job, ResearchReading[]>();
const jobInput = (job: Job) => {
  if (!parsedInputs.has(job))
    try {
      parsedInputs.set(job, JSON.parse(job.input_json) as ResearchInput);
    } catch {
      parsedInputs.set(job, null);
    }
  return parsedInputs.get(job)!;
};
/** A job's readings; those of an earlier rule (a 0–10 score, or none) lose their score, so nothing counts or bands them. */
const jobReadings = (job: Job): ResearchReading[] => {
  if (!settledJob(job) || !job.result_json) return [];
  if (!parsedReadings.has(job))
    try {
      const readings = JSON.parse(job.result_json);
      const current = jobInput(job)?.rubric === BRAND_RESEARCH_RUBRIC;
      parsedReadings.set(job, !Array.isArray(readings) ? [] : current ? readings : readings.map((reading) => (reading?.score == null ? reading : { ...reading, score: null })));
    } catch {
      parsedReadings.set(job, []);
    }
  return parsedReadings.get(job)!;
};
// ponytail: per-isolate memo of brand keys, emptied past 10,000 names; a request reads a few hundred.
const brandKeys = new Map<string, string>();
const keyOf = (name: string) => {
  let key = brandKeys.get(name);
  if (key === undefined) {
    if (brandKeys.size > 10_000) brandKeys.clear();
    brandKeys.set(name, (key = brandKey(name)));
  }
  return key;
};
/** One brand across lists: the same name (accents, case and spacing aside), or the same domain after a rename. */
const sameBrand = (option: { name: string; domain: string | null }, brand: { name: string; domain: string | null }) =>
  keyOf(option.name) === keyOf(brand.name) || (!!brand.domain && option.domain === brand.domain);
/**
 * What the saved jobs of one answer hold for a brand, the settled ones first: the reading of the first job that read it,
 * else the job that is reading it (pending, in flight, uncertain or failed, never resent). `undefined`: no job holds it.
 */
function brandReading(jobs: Job[], brand: { name: string; domain: string | null }) {
  let attempt: Job | undefined;
  for (const job of jobs) {
    const option = jobInput(job)?.options.find((item) => sameBrand(item, brand));
    if (!option) continue;
    const reading = jobReadings(job).find((item) => item.id === option.id);
    if (reading) return { job, reading, input: jobInput(job)! };
    attempt ??= job;
  }
  return attempt ? { job: attempt, reading: undefined, input: jobInput(attempt) } : undefined;
}
const byRank = (a: Job, b: Job) => (JOB_RANK[a.status] ?? 2) - (JOB_RANK[b.status] ?? 2) || String(b.started_at ?? '').localeCompare(String(a.started_at ?? ''));

async function scope(
  projectId: string,
  workspaceId: string,
  q: URLSearchParams,
  previewRunId?: string,
  after?: { at: string; id: string },
  // The report reads the options of each saved job, never its excerpt (up to 16,000 characters of the answer): leaving it
  // out of the D1 read keeps megabytes of text out of the Worker. It also asks, in the same trip, for the readings made
  // under another context (`otherContext`).
  forReport = false,
  // The estimate of a reprocess of recent days (`unevaluatedResearch` with `rereadDays`, Admin > Algorithms only): never
  // from a request's query, so no user route can widen what is read again.
  rereadDays?: number,
) {
  const filter = parseReportFilter(q);
  const clauses = [
    'r.project_id=?',
    'r.workspace_id=?',
    "r.status='complete'",
    'r.response_available=1',
    'r.answer IS NOT NULL',
    'r.created_at>=?',
    'r.created_at<?',
    'p.archived=0',
  ];
  const bindings: (string | number)[] = [
    projectId,
    workspaceId,
    filter.cutoff,
    filter.end,
  ];
  const topics = reportTopics(q),
    prompt = q.get('prompt'),
    tags = (q.get('tags') || '').split(',').filter(Boolean);
  if (
    (prompt?.length || 0) > 253 ||
    tags.length > 8 ||
    tags.some((tag) => tag.length > 100)
  )
    throw new ApiError(400, 'Invalid research filter.');
  if (filter.engine !== 'all') {
    clauses.push('r.engine IN (SELECT value FROM json_each(?))');
    bindings.push(JSON.stringify(filter.engine.split(',')));
  }
  if (topics.length) {
    clauses.push('p.tag IN (SELECT value FROM json_each(?))');
    bindings.push(JSON.stringify(topics));
  }
  if (prompt) {
    clauses.push('COALESCE(p.unit_id,p.id)=?');
    bindings.push(prompt);
  }
  if (tags.length) {
    clauses.push(
      'EXISTS(SELECT 1 FROM json_each(p.tags_json) t WHERE t.value IN (SELECT value FROM json_each(?)))',
    );
    bindings.push(JSON.stringify(tags));
  }
  // Every D1 round trip counts (a call costs ~250 ms in production, and they do not overlap well): the project, its
  // settings, its store, the brand decisions and the model roles are read together, in one.
  const [projectRead, configurationRead, registryRead, eventsRead, rolesRead, questionRolesRead, reprocessRead] = await timed('base', () =>
    db().batch([
      ownedProjectStatement(projectId, workspaceId),
      configurationStatement(projectId, workspaceId),
      projectStoreStatement(projectId, workspaceId),
      decisionEventsStatement(projectId),
      ...roleDecisionsStatements(projectId),
      db().prepare('SELECT value FROM system_state WHERE key=?').bind(sentimentReprocessKey(projectId)),
    ]),
  );
  const project = foundProject(projectRead.results[0] as Record<string, unknown> | undefined);
  const configuration = configurationFrom(configurationRead.results[0] as ConfigurationRow | undefined);
  const registry = (registryRead.results[0] as StoreRegistry | undefined) ?? null;
  const events = Promise.resolve(decisionEventsFrom(eventsRead.results as never));
  const roles = Promise.resolve(rolesFrom(rolesRead.results as never, questionRolesRead.results as never));
  // The analysis status and the latest answers are independent store reads: they run side by side.
  const discoveryRead = timed('discovery', async () => {
    // Every name of the Brands list is read where an answer names it: competitors, clients, suppliers, partners and
    // names in review; a cited source or a name that is no brand never is. Settled roles other than those two are always listed.
    const settled = await roles;
    const notBrand = (role?: string) => role === 'mention' || role === 'not_brand';
    const discovery = await competitorAnalysisStatus(
      projectId,
      workspaceId,
      { project, registry },
      [...settled].filter(([, role]) => notBrand(role)).map(([key]) => key),
      settled,
      [...settled].filter(([, role]) => !notBrand(role) && role !== 'ambiguous').map(([key]) => key),
    );
    // The last complete list, as the Brands list shows it: while a pass over new targets runs (`previous`) or a decision
    // waits for its restart (`needsEnsure`), its discoveries keep their saved readings. An empty list here hid every
    // discovered brand's sentiment after a Monitor until the new pass ended.
    const suggested = discovery.previous?.suggestions ?? discovery.suggestions;
    // Project decisions filter what evaluations offer and report, but they are not part of the context:
    // rejecting a brand that was only discovered must not discard paid readings.
    const kept = new Set(await withoutDecided(projectId, suggested, events));
    const decided = new Set(
      suggested.filter((item) => !kept.has(item)).map((item) => item.name),
    );
    // A rejected one keeps its saved readings but is no longer offered.
    const listed = (await withModelRoles(projectId, suggested.filter((item) => kept.has(item)), roles)).filter((item) => !notBrand(item.role));
    const discoveries = listed.map(({ name, domain }) => ({ name, domain }));
    // What a reading of the shorter list covered (before every brand was read): the 20 most mentioned competitors and partners the model settled.
    const legacyDiscoveries = listed
      .filter(evaluableDiscovery)
      .sort((a, b) => b.answerCount - a.answerCount)
      .slice(0, GUARANTEED_DISCOVERIES)
      .map(({ name, domain }) => ({ name, domain }));
    // While the analysis reads the answers again (new ones arrived, new targets), or a decision waits for that, the
    // discoveries are not known yet: nothing new is read (saved readings still show).
    const analysing = discovery.status === 'pending' || discovery.status === 'running' || !!discovery.needsEnsure;
    return { discovery, decided, discoveries, legacyDiscoveries, analysing };
  });
  // The latest answers do not depend on the discovery chain: they are read while it runs.
  // With the period bounds as the store moves them (see projectReadDatabase): the same answers, and reads isolates can share.
  const answersRead = timed('answers', () => projectReadDatabase(projectId, workspaceId, registry, [filter.cutoff, filter.end]).then(async (analytics) => {
    const result = await analytics
      .prepare(`WITH latest AS (SELECT r.id,COALESCE(p.unit_id,p.id) unit_id,COALESCE(p.tag,'') topic,
      ROW_NUMBER() OVER(PARTITION BY COALESCE(p.unit_id,p.id),r.engine ORDER BY r.created_at DESC,r.id DESC) rank
      FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id WHERE ${clauses.join(' AND ')})
      SELECT r.id,l.unit_id,l.topic,r.engine,length(r.answer) answer_length,r.created_at,r.prompt_text,${ANSWER_DISCOVERY_KEYS_SQL} brands,
      ${EFFECTIVE_MENTIONS_SQL} mentions_json,json_extract(${EFFECTIVE_TARGETS_SQL},'$[0].name') primary_name FROM latest l JOIN runs r ON r.id=l.id
      WHERE l.rank=1${after ? ' AND (r.created_at<? OR (r.created_at=? AND r.id<?))' : ''} ORDER BY r.created_at DESC,r.id DESC LIMIT ${MAX_CHANNELS + 1}`)
      .bind(
        projectId,
        workspaceId,
        analytics.periodBound?.(filter.cutoff) ?? filter.cutoff,
        analytics.periodBound?.(filter.end) ?? filter.end,
        ...bindings.slice(4),
        ...(after ? [after.at, after.at, after.id] : []),
      )
      .all<StoredRun>();
    // Metadata is small. Full answers travel in bounded pages because project
    // storage rejects RPC responses above 4 MiB; hashes always use full content.
    const selected: StoredRun[] = [];
    let characters = 0;
    for (const run of result.results.slice(0, MAX_CHANNELS)) {
      if (characters + run.answer_length > MAX_SCOPE_CHARACTERS) break;
      characters += run.answer_length;
      selected.push(run);
    }
    // An answer that alone exceeds the scope can never be read: it is skipped (and reported), so paging always advances.
    const oversized = selected.length || !result.results.length ? 0 : 1;
    // A preview step hydrates only its planned response. Selection/truncation still
    // use the full latest-answer scope, so a changed snapshot fails closed.
    const scopedRuns = previewRunId
      ? selected.filter((run) => run.id === previewRunId)
      : selected;
    // The pages are planned first and read side by side: every page is a project-store round trip.
    const pages: StoredRun[][] = [];
    for (let offset = 0; offset < scopedRuns.length;) {
      const page: StoredRun[] = [];
      let pageCharacters = 0;
      while (
        offset < scopedRuns.length &&
        (pageCharacters + scopedRuns[offset].answer_length <= QUERY_CHARACTERS ||
          !page.length)
      ) {
        const run = scopedRuns[offset++];
        page.push(run);
        pageCharacters += run.answer_length;
        if (pageCharacters >= QUERY_CHARACTERS) break;
      }
      pages.push(page);
    }
    const readLong = async (run: StoredRun) => {
      let answer = '';
      for (let start = 1; start <= run.answer_length; start += 64000) {
        const part = await analytics
          .prepare(
            'SELECT substr(answer,?,64000) answer FROM runs WHERE id=? AND project_id=? AND workspace_id=?',
          )
          .bind(start, run.id, projectId, workspaceId)
          .first<{ answer: string }>();
        if (!part)
          throw new ApiError(
            409,
            'Saved answer changed; refresh and try again.',
          );
        answer += part.answer;
      }
      run.answer = answer;
    };
    const fill = (page: StoredRun[], payloads: { id: string; answer: string }[]) => {
      for (const run of page) {
        const payload = payloads.find((item) => item.id === run.id);
        if (!payload)
          throw new ApiError(
            409,
            'Saved answer changed; refresh and try again.',
          );
        run.answer = payload.answer;
      }
    };
    // Pages that fit one bounded store response travel together: each message waits in the store's queue.
    const groups: StoredRun[][][] = [];
    let group: StoredRun[][] = [], groupCharacters = 0;
    for (const page of pages) {
      if (page.length === 1 && page[0].answer_length > QUERY_CHARACTERS) continue;
      const size = page.reduce((sum, run) => sum + run.answer_length, 0);
      if (group.length && (groupCharacters + size > GROUP_CHARACTERS || group.length >= 10)) {
        groups.push(group);
        group = [];
        groupCharacters = 0;
      }
      group.push(page);
      groupCharacters += size;
    }
    if (group.length) groups.push(group);
    await Promise.all([
      ...pages.filter((page) => page.length === 1 && page[0].answer_length > QUERY_CHARACTERS).map((page) => readLong(page[0])),
      ...groups.map(async (members) => {
        const read = await analytics.batch<{ id: string; answer: string }>(
          members.map((page) =>
            analytics
              .prepare(
                'SELECT id,answer FROM runs WHERE project_id=? AND workspace_id=? AND id IN (SELECT value FROM json_each(?))',
              )
              .bind(projectId, workspaceId, JSON.stringify(page.map((run) => run.id))),
          ),
        );
        members.forEach((page, index) => fill(page, read[index].results));
      }),
    ]);
    return { result, selected, oversized, scopedRuns };
  }));
  const [{ result, selected, oversized, scopedRuns }, { discovery, decided, discoveries, legacyDiscoveries, analysing }] = await Promise.all([
    answersRead,
    discoveryRead,
  ]);
  const provider = selectedProvider(
    q.get('provider') || configuration.sentimentProvider,
  );
  const targets = buildTargetSnapshot(project) as BrandTarget[];
  // Neither the monitored list nor the discoveries are part of the context: a change in either reads only the answers
  // that mention a brand with no reading yet (see `covered`), never the whole period again.
  const contextFor = (rubric: string) =>
    hash(
      JSON.stringify({
        category: project.category,
        rubric,
        adapter: RESEARCH_ADAPTER_VERSION,
        shortlist: RESEARCH_SHORTLIST_VERSION,
        provider,
        model: researchModel(provider),
      }),
    );
  const contextKey = await contextFor(BRAND_RESEARCH_RUBRIC);
  // Readings of an earlier rule still hold their answers (nothing is reprocessed by itself) until an admin asks to reprocess
  // the project with the current rule (`sentimentReprocessKey`); they carry no score, so the index never counts them.
  let reprocess = false;
  // A reprocess asked for every brand also reads every brand of the answers read for the shorter list before it.
  let everyBrand = false;
  // A reprocess of recent days (`days`, Admin > Algorithms): the answers created in the `days` before it was asked are read
  // again under the current rule even when a reading of it holds them, once each (their new key carries the request's time).
  // `rereadDays` (the estimate) counts what such a request would read, before it is made.
  let reread: { from: string; to: string; salt: string } | null = null;
  try {
    const flag = JSON.parse(String((reprocessRead.results[0] as { value?: string } | undefined)?.value ?? '{}')) as { rubric?: string; brands?: string; requestedAt?: string; days?: number };
    reprocess = flag.rubric === BRAND_RESEARCH_RUBRIC;
    everyBrand = reprocess && flag.brands === 'every';
    const asked = Date.parse(flag.requestedAt ?? '');
    if (reprocess && Number.isInteger(flag.days) && flag.days! > 0 && Number.isFinite(asked))
      reread = { from: new Date(asked - flag.days! * 86_400_000).toISOString(), to: flag.requestedAt!, salt: flag.requestedAt! };
  } catch {
    // An unreadable request reprocesses nothing.
  }
  // The estimate counts what a request made now would read: its own period, never an earlier request's (whose window, long
  // read, hid every answer since: Admin estimated 0 for projects reprocessed before).
  if (Number.isInteger(rereadDays) && rereadDays! > 0)
    reread = { from: new Date(Date.now() - rereadDays! * 86_400_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString(), salt: 'estimate' };
  // A reading of earlier criterion questions (SENTIMENT_QUESTIONS_VERSION) keeps holding its answer, and counting, until a
  // reprocess asked after it was made reads the answer again, whatever the request's period (the estimate counts it now).
  let questionsBefore: string | null = null;
  if (Number.isInteger(rereadDays) && rereadDays! > 0) questionsBefore = new Date(Date.now() + 86_400_000).toISOString();
  else if (reprocess) {
    try {
      // Only a request made under the current questions (it names them): an older one never starts paid reads by itself.
      const flag = JSON.parse(String((reprocessRead.results[0] as { value?: string } | undefined)?.value ?? '{}')) as { requestedAt?: string; questions?: string };
      if (flag.questions === SENTIMENT_QUESTIONS_VERSION && flag.requestedAt && Number.isFinite(Date.parse(flag.requestedAt))) questionsBefore = flag.requestedAt;
    } catch {
      // Unreadable: nothing is read again.
    }
  }
  const earlierQuestions = (job: Job) =>
    !!questionsBefore && (jobInput(job)?.questions ?? 'q1') !== SENTIMENT_QUESTIONS_VERSION && String(job.started_at ?? '') < questionsBefore;
  const rereads = (run: { created_at: string }) => !!reread && run.created_at >= reread.from && run.created_at < reread.to;
  const rubrics = reprocess ? [BRAND_RESEARCH_RUBRIC] : [BRAND_RESEARCH_RUBRIC, ...LEGACY_RESEARCH_RUBRICS];
  const contextKeys = await Promise.all(rubrics.map(contextFor));
  const byKey = new Map(discoveries.map((item) => [brandKey(item.name), item]));
  const hashed = await Promise.all(
    scopedRuns.map(async (run) => ({
      ...run,
      answerHash: await hash(run.answer),
      // The discoveries the analysis found in this answer that it names: the evaluator has to have read each of them.
      mentions: matchedDiscoveries(run.answer, discoveryKeys(run.brands).flatMap((key) => byKey.get(key) ?? [])),
      // Monitored brands the text names whose effective mention is off (a common word, a same-named business): the report never counts
      // them, so they are not read (8/11/2026). Their names go in the reading's key: when a flag turns on, the key changes and the brand,
      // now without a reading, is read (the missing-brand rule below).
      quiet: matchedDiscoveries(run.answer, targets).filter((target) => !mentionsTarget(run, target, target === targets[0])).map((target) => target.name),
    })),
  ).then((items) =>
    Promise.all(
      items.map(async (run) => ({
        ...run,
        // The key of a new reading of this answer for the current brands.
        own: await hash(
          `${contextKey}:${rereads(run) ? `${reread!.salt}:` : ''}${run.answerHash}:${JSON.stringify([targets.map((item) => [item.name, item.domain]), run.mentions.map((item) => [item.name, item.domain]).sort(), ...(run.quiet.length ? [[...run.quiet].sort()] : [])])}`,
        ),
      })),
    ),
  );
  // Every job made for these answers under the current context, or before the date under another brand list
  // (`legacyReading`); the exact key of each answer also matches, for a job saved under another context key.
  const hashes = [...new Set(hashed.map((run) => run.answerHash))];
  const columns = forReport ? REPORT_JOB_COLUMNS : '*';
  const exactKeys = new Set(hashed.map((run) => run.own));
  const [jobsRead, otherContextRead] = hashes.length
    ? await db().batch<Job>([
        // Two indexed reads (by answer hash, by exact key) instead of one OR, which read every job of the project. A job both
        // reads find comes back twice and is kept once below; `+workspace_id` keeps the second read on the (project, key) index.
        db()
          .prepare(
            `SELECT ${columns} FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND answer_sha256 IN (SELECT value FROM json_each(?)) AND (context_key IN (SELECT value FROM json_each(?)) OR requested_at<?)
             UNION ALL SELECT ${columns} FROM brand_research_jobs WHERE project_id=? AND input_key IN (SELECT value FROM json_each(?)) AND +workspace_id=?`,
          )
          .bind(projectId, workspaceId, JSON.stringify(hashes), JSON.stringify(contextKeys), LEGACY_READINGS_BEFORE, projectId, JSON.stringify(hashed.map((run) => run.own)), workspaceId),
        // The report counts the answers whose saved reading was made under another context: asked in the same trip.
        ...(forReport
          ? [
              db()
                .prepare(
                  "SELECT DISTINCT answer_sha256 FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND context_key NOT IN (SELECT value FROM json_each(?)) AND status IN ('completed','unsettled') AND answer_sha256 IN (SELECT value FROM json_each(?))",
                )
                .bind(projectId, workspaceId, JSON.stringify(contextKeys), JSON.stringify(hashes)),
            ]
          : []),
      ])
    : [];
  const family = [...new Map((jobsRead?.results ?? []).map((job) => [job.id, job])).values()].filter(
    (job) => legacyReading(job, contextKeys, rubrics, String(project.category || ''), provider) || exactKeys.has(job.input_key),
  );
  const otherContext = new Set((otherContextRead?.results ?? []).map((row) => row.answer_sha256));
  const byAnswer = new Map<string, Job[]>();
  for (const job of family) byAnswer.set(job.answer_sha256, [...(byAnswer.get(job.answer_sha256) || []), job]);
  const runs = hashed.map(({ own, ...run }) => {
    // The answer's jobs, settled ones first, the newest first: each brand takes its reading from the first that holds one.
    const attempts = (byAnswer.get(run.answerHash) || []).sort(byRank);
    // Its reading under this key, unless made with earlier questions a reprocess reads again.
    const mine = attempts.find((job) => job.input_key === own && !earlierQuestions(job));
    // Covered: every brand the evaluator must read here (each monitored brand and discovery it names) is held by some job.
    // Then nothing is asked again; otherwise a new reading is made (`own`), whose input reads every brand. An answer read only
    // for the shorter list of before is held to what that list covered, until a reprocess asked for every brand.
    const every = [...matchedDiscoveries(run.answer, targets).filter((target) => !run.quiet.includes(target.name)), ...run.mentions];
    const needed =
      everyBrand || !attempts.length || attempts.some((job) => jobInput(job)?.everyBrand)
        ? every
        : [...targets.slice(0, EVALUATED_BRANDS).filter((target) => matchesBrand(run.answer, target)), ...matchedDiscoveries(run.answer, legacyDiscoveries)];
    const covers = (jobs: Job[], brands = needed) => jobs.length > 0 && brands.every((brand) => brandReading(jobs, brand));
    // Read again for a reprocess of recent days: held only by its reading under the request's key. Until it lands, the earlier
    // reading still shows (the newest settled reading of each brand comes first).
    const again = rereads(run);
    // The readings that still hold the answer for a reprocess (earlier questions do not, once one is asked); all of them show.
    const holding = attempts.filter((job) => !earlierQuestions(job));
    const covered = !!mine || (!again && covers(reprocess && !rereadDays ? holding : attempts));
    // Not held for every brand under the current rule and questions: what a reprocess would read again (`brandCount` brands).
    const legacy = again
      ? !mine && covers(attempts)
      : !mine && covers(attempts) && !covers(holding.filter((job) => jobInput(job)?.rubric === BRAND_RESEARCH_RUBRIC), every);
    // A new reading of an answer whose key already holds one of earlier questions takes a key of its own (the questions').
    const next = attempts.some((job) => job.input_key === own) ? `${own}:${SENTIMENT_QUESTIONS_VERSION}` : own;
    return { ...run, attempts, legacy, brandCount: every.length, inputKey: mine?.input_key ?? (covered ? attempts[0]!.input_key : next), fresh: again };
  });
  const jobs = family;
  return {
    project,
    configuration,
    provider,
    targets,
    discoveries,
    analysing,
    contextKey,
    decided,
    runs,
    jobs,
    otherContext,
    /** What the roles classifier settled for each discovered name, and in how many questions it is a competitor. */
    roles: await roles,
    selectedChannels: selected.length,
    truncated: selected.length < result.results.length,
    oversized,
    // Where the next page starts; absent on the last one.
    next:
      selected.length < result.results.length
        ? (() => {
            const last = selected.at(-1) ?? result.results[0];
            return { at: last.created_at, id: last.id };
          })()
        : undefined,
    discovery,
  };
}

// Every page of the 90-day scope, newest first, so no answer past the first 1,000 (or 4 million characters) goes unseen.
// `from` resumes at a page cursor (the scheduler reads a bounded number of pages per tick).
type PageCursor = { at: string; id: string };
async function* scopePages(projectId: string, workspaceId: string, provider: ResearchProvider, from?: PageCursor, rereadDays?: number) {
  let after = from;
  do {
    const page = await scope(projectId, workspaceId, new URLSearchParams({ provider, days: '90' }), undefined, after, false, rereadDays);
    yield { ...page, start: after };
    after = page.next;
  } while (after);
}

/** The last reading of the project that settled (sentiment, brand roles, source types): one seek each on idx_brand_research_settled. */
export const settledReadingStatement = (projectId: string) =>
  db()
    .prepare(
      `SELECT MAX(COALESCE((SELECT MAX(completed_at) FROM brand_research_jobs WHERE project_id=? AND status='completed'),''),
         COALESCE((SELECT MAX(completed_at) FROM brand_research_jobs WHERE project_id=? AND status='unsettled'),'')) settled`,
    )
    .bind(projectId, projectId);
/**
 * The reads a kept report is named by, by project id alone (a caller sends them before the session; the owner is compared after).
 * The last settled reading is one of them: an evaluation that lands makes the copy kept before it miss, so the card is never
 * painted from a copy older than its readings (the preview's Overview said "Not evaluated" while Brands had scores).
 */
export const researchCopyReads = (projectId: string) =>
  db()
    .batch([
      db().prepare('SELECT * FROM projects WHERE id=? AND archived=0').bind(projectId),
      db().prepare('SELECT * FROM project_stores WHERE project_id=?').bind(projectId),
      db().prepare('SELECT * FROM brand_research_configurations WHERE project_id=?').bind(projectId),
      decisionEventsStatement(projectId),
      settledReadingStatement(projectId),
    ])
    .then((reads) => reads.map((read) => read.results as Record<string, unknown>[]));
const KEPT_REPORT_TTL_MS = 24 * 3600_000;
/**
 * Reports this isolate is computing, by owner, project and filters: a second request for one (the page's first read, cut
 * short, then the browser's own) waits for that computation instead of starting another beside it (shareFlight: it finishes
 * after the request that started it, and a stuck one is not waited for). Every caller (the route, the warm-up, the demo)
 * computes the same thing, `publicResearchReport(brandResearchReport(...))`.
 */
const computing = new Map<string, Flight<unknown>>();
/**
 * The report painted from the last one computed for the same filters (a day at most), kept in the project's store, stale-while-
 * revalidate: a copy for the current answers, analysis job, settings, brand decisions and last settled reading is
 * returned as it is; an older one (readings landed since, new answers, publication behind: during a reprocess or the daily
 * collection that is most visits) is returned at once marked `cachedAt`, so the screens read it again with `fresh`, while the
 * report is computed again after the response and kept for the next read. Only a read with no copy at all computes before
 * answering. Computing costs seconds of D1 and project store; the copy, one D1 read (beside the session) and one store read.
 */
export async function keptResearchReport<T extends object>(
  projectId: string,
  workspaceId: string,
  q: URLSearchParams,
  { fresh, early }: { fresh: boolean; early: ReturnType<typeof researchCopyReads> },
  compute: () => Promise<T>,
): Promise<T> {
  const [[project], [registry], configurations, events, settled] = await early;
  if (project?.workspace_id !== workspaceId) throw new ApiError(404, 'Projeto não encontrado.');
  const canonical = new URLSearchParams(q);
  canonical.sort();
  const key = JSON.stringify([workspaceId, projectId, String(canonical)]);
  const shared = () => shareFlight(computing, key, compute, waitUntil) as Promise<T>;
  if (!registry || registry.workspace_id !== workspaceId || !registry.generation) return shared();
  // Publication behind: the computation publishes first, so no copy is current; the last one is painted while it runs.
  const behind = registry.source_revision !== registry.applied_revision;
  const settledAt = String((settled?.[0] as { settled?: unknown } | undefined)?.settled ?? '');
  const filter = parseReportFilter(q);
  const copy = storedCopy(
    { ownerId: workspaceId, projectId, generation: String(registry.generation) },
    // `effective-mention`: copies kept before the index read the effective mention are never painted.
    ['brand-research', 'effective-mention', workspaceId, String(canonical), project, configurations.filter((row) => row.workspace_id === workspaceId), events],
    { analysis: true, bounds: [filter.cutoff, filter.end], last: true },
  );
  copy.catch(() => {});
  const kept = (report: T) => JSON.stringify({ ...report, cachedAt: now(), settledAt });
  if (!fresh) {
    const found = await copy.catch(() => null);
    const young = (at: number) => Date.now() - at < KEPT_REPORT_TTL_MS;
    const value = found?.value && young(found.storedAt) ? found.value : found?.last && young(found.last.storedAt) ? found.last.value : null;
    if (found && value) {
      const report = JSON.parse(value) as T & { cachedAt?: string; settledAt?: string };
      // Current: nothing newer to read, so no `cachedAt` (the screens do not read it again).
      if (!behind && value === found.value && report.settledAt === settledAt) {
        const { cachedAt: _cachedAt, settledAt: _settledAt, ...current } = report;
        return current as T;
      }
      found.refresh(async () => kept(await shared()));
      return report;
    }
  }
  const report = await shared();
  (await copy.catch(() => null))?.keep(kept(report));
  return report;
}

// ponytail: per-isolate memo, so the Responses screen's reads of one band (its list and its cards) read the scope once; a
// shared copy in the project store if a band drill down gets slow.
const bandRuns = new Map<string, { at: number; runs: string[] }>();
const bandReads = new Map<string, Flight<string[]>>();
const BAND_RUNS_TTL_MS = 60_000;
/**
 * Drill down: the answers the sentiment index reads (the latest per question and model, under the filters of `q`)
 * whose reading of the brand is in `band`, each answer by its own score. `brand`: a monitored brand's name, a discovered
 * brand's name or key, or none for the project's own.
 */
export function sentimentBandRuns(projectId: string, workspaceId: string, q: URLSearchParams, brand: string | null, band: string) {
  if (!(SENTIMENTS as readonly string[]).includes(band)) throw new ApiError(400, 'Invalid sentiment filter.');
  const scoped = new URLSearchParams();
  for (const key of ['days', 'start', 'end', 'engine', 'topic', 'prompt', 'tags'])
    for (const value of q.getAll(key)) scoped.append(key, value);
  const key = JSON.stringify([projectId, workspaceId, String(scoped), brand ?? '', band]);
  const kept = bandRuns.get(key);
  if (kept && Date.now() - kept.at < BAND_RUNS_TTL_MS) return Promise.resolve(kept.runs);
  for (const [old, value] of bandRuns) if (Date.now() - value.at >= BAND_RUNS_TTL_MS) bandRuns.delete(old);
  return shareFlight(bandReads, key, () => bandRunsOf(projectId, workspaceId, scoped, brand, band).then((runs) => {
    bandRuns.set(key, { at: Date.now(), runs });
    return runs;
  }), waitUntil);
}

function bandRunsOf(projectId: string, workspaceId: string, scoped: URLSearchParams, brand: string | null, band: string) {
  return scope(projectId, workspaceId, scoped, undefined, undefined, true).then((current) => {
    const own = !brand || brand === 'primary' || brand === current.targets[0]?.name;
    const tracked = own ? current.targets[0] : current.targets.find((target) => target.name === brand);
    const discovery = tracked ? null : current.discoveries.find((item) => item.name === brand || brandKey(item.name) === brandKey(brand!));
    const target = tracked ?? discovery;
    if (!target) return [];
    // The same observations the index composes (the brand's mention as Responses counts it, its reading), so each question is in
    // the band the card counts it in: the band of the mean of its models (sentimentByUnit). The drill ignores topic weighting,
    // which changes how much a question weighs in the shares, never its band.
    const observations = current.runs.map((run) => {
      const mentioned = tracked ? mentionsTarget(run, tracked, own) : run.mentions.some((item) => item.name === target.name);
      return observe(run, target.name, mentioned, brandReading(run.attempts, target));
    });
    const units = sentimentByUnit(observations, target.name);
    return observations
      .filter((item) => item.mentioned && item.reading?.state === 'assessed' && typeof item.reading.score === 'number' && units[item.unitId]?.distribution[band as Sentiment])
      .map((item) => item.runId);
  });
}

/** One brand's observation in one answer, as the sentiment index and its drill down read it. */
const observe = (
  run: { id: string; unit_id: string; engine: string; created_at: string },
  brand: string,
  mentioned: boolean,
  found: ReturnType<typeof brandReading>,
): ResearchObservation => ({
  runId: run.id,
  unitId: run.unit_id,
  engine: run.engine,
  createdAt: run.created_at,
  brand,
  mentioned,
  status: found?.job.status || 'unassessed',
  reading: found?.reading,
  fullCoverage: found?.input?.fullCoverage ?? true,
});

export async function brandResearchReport(
  projectId: string,
  workspaceId: string,
  q: URLSearchParams,
) {
  const current = await scope(projectId, workspaceId, q, undefined, undefined, true);
  const jobs = new Map(current.jobs.map((job) => [job.input_key, job]));
  const observations: ResearchObservation[] = [];
  const candidateSupport = new Map<
    string,
    {
      name: string;
      domain: string | null;
      units: Set<string>;
      evidence: { runId: string; excerpt: string; createdAt: string }[];
    }
  >();
  const details: {
    runId: string;
    prompt: string;
    unitId: string;
    engine: string;
    date: string;
    brand: string;
    state: string;
    sentiment: string | null;
    /** 0–100; null when not assessed under the current rule. */
    score: number | null;
    /** The criteria met, each with the index of its quote in `evidence` (the why of `score`); null without a score. */
    criteria: ResearchReading['criteria'] | null;
    evidence: string[];
  }[] = [];
  const discovered = new Set(current.discoveries.map((item) => item.name));
  // What a read asks beyond the aggregate (with every brand read, the report reached 2.9 MB): a discovered brand's
  // answer details and their evidence only when the read names it (`evidenceBrand`, repeated; `*` every one), and the
  // suggestions' evidence only with `suggestions=1`. Both fields stay, empty where not asked.
  const evidenceBrands = new Set(q.getAll('evidenceBrand'));
  const discoveryDetails = (name: string) => evidenceBrands.has('*') || evidenceBrands.has(name);
  const suggestionEvidence = q.get('suggestions') === '1';
  const discoveredDetails = new Map<string, number>();
  const discoveredRows: typeof details = [];
  // The jobs were read without their evidence (REPORT_JOB_COLUMNS): where a detail or a suggestion shows one, the reading it
  // comes from is noted, and only those are read, once the report knows which it keeps.
  const evidenceOf = new Map<object, EvidenceRef>();
  const shows = <T extends { evidence: string[] } | { excerpt: string }>(found: ReturnType<typeof brandReading>, row: T) => {
    if (found?.reading) evidenceOf.set(row, { job: found.job.id, reading: found.reading.id });
    return row;
  };
  // A reading of an earlier rule (no score) is never shown (10/11/2026: "Evaluated on the previous scale" reached customers):
  // the answer is left out of the evidence, as the index leaves it out of the score.
  const oldScale = (found: ReturnType<typeof brandReading>) => found?.reading?.state === 'assessed' && typeof found.reading.score !== 'number';
  const verdict = (found: ReturnType<typeof brandReading>) => {
    const reading = found?.reading;
    return { state: reading?.state || found?.job.status || 'unassessed', sentiment: reading?.sentiment || null, score: reading?.score ?? null, criteria: reading?.criteria ?? null };
  };
  for (const run of current.runs) {
    for (const [index, target] of current.targets.entries()) {
      // Whatever job read this brand in this answer, under whichever brand list it was made.
      const found = brandReading(run.attempts, target);
      const mentioned = mentionsTarget(run, target, index === 0);
      observations.push(observe(run, target.name, mentioned, found));
      // An answer that does not mention the brand has no evidence to show: it is counted in `absent`, never listed, so the 120
      // details go to answers with a reading (9/11/2026: the brand page listed a dozen "No mention" rows and two readings).
      if (!mentioned || oldScale(found)) continue;
      const detail = {
        runId: run.id,
        prompt: run.prompt_text,
        unitId: run.unit_id,
        engine: run.engine,
        date: run.created_at,
        brand: target.name,
        ...verdict(found),
        evidence: [] as string[],
      };
      details.push(shows(found, detail));
    }
    // Discoveries of the Brands screen: only where the answer mentions them, so the list stays as long as their evidence.
    for (const discovery of run.mentions) {
      const found = brandReading(run.attempts, discovery);
      observations.push(observe(run, discovery.name, true, found));
      if (!discoveryDetails(discovery.name) || oldScale(found)) continue;
      const shown = discoveredDetails.get(discovery.name) || 0;
      discoveredDetails.set(discovery.name, shown + 1);
      if (shown < DISCOVERED_DETAILS)
        discoveredRows.push(
          shows(found, {
            runId: run.id,
            prompt: run.prompt_text,
            unitId: run.unit_id,
            engine: run.engine,
            date: run.created_at,
            brand: discovery.name,
            ...verdict(found),
            evidence: [] as string[],
          }),
        );
    }
    // Loose names the evaluator also reads: one verdict per name and answer, from the first settled job that read it.
    const candidateOptions = new Map<string, { name: string; domain: string | null }>();
    for (const job of run.attempts)
      for (const option of jobInput(job)?.options ?? [])
        if (option.kind === 'candidate') candidateOptions.set(JSON.stringify([option.name, option.domain]), { name: option.name, domain: option.domain });
    for (const candidate of candidateOptions.values()) {
      if (
        current.decided.has(candidate.name) ||
        !matchesBrand(run.answer, {
          ...candidate,
          domain: candidate.domain || '',
        })
      )
        continue;
      const key = JSON.stringify([candidate.name, candidate.domain]);
      const support = candidateSupport.get(key) || {
        ...candidate,
        units: new Set<string>(),
        evidence: [],
      };
      support.units.add(run.unit_id);
      // Whether it competes is the roles classifier's, per question (8/11/2026; until then the sentiment reading asked it again):
      // a competitor's evidence is its readings' quotes.
      const read = brandReading(run.attempts, candidate);
      if (suggestionEvidence && read?.reading?.state === 'assessed' && current.roles.get(brandKey(candidate.name)) === 'competitor' && support.evidence.length < 3)
        support.evidence.push(shows(read, { runId: run.id, excerpt: '', createdAt: run.created_at }));
      candidateSupport.set(key, support);
    }
  }
  // Answers in this scope with a brand no saved reading covers, whose earlier evaluation was made under another setup
  // (provider, model, category or rubric): kept, never counted or carried over. Only what the current period and filters still show.
  const missing = [
    ...new Set(
      current.runs
        .filter((run) => !jobs.get(run.inputKey))
        .map((run) => run.answerHash),
    ),
  ];
  const outdated = missing.filter((hash) => current.otherContext.has(hash)).length;
  // The same question-level aggregate, one channel at a time (the Overview card's rows).
  // Topic weights (lib/topic-weights): each question counts its topic's share, as the other rates do.
  const weighting = { topicOf: new Map(current.runs.map((run) => [run.unit_id, run.topic ?? ''])), weights: readTopicWeights(current.project.topic_weights_json) };
  const byEngine = [...new Set(observations.map((item) => item.engine))].map(
    (engine) => [engine, new Map(summarizeSentiment(observations.filter((item) => item.engine === engine), weighting).brands.map((row) => [row.brand, row]))] as const,
  );
  const shownDetails = [...details.slice(0, 120), ...discoveredRows];
  const suggestions = [...candidateSupport.values()]
    .map(({ units, ...candidate }) => {
      // The questions the roles classifier read it in (per question), else its role for the project applied to the questions here.
      const role = current.roles.get(brandKey(candidate.name));
      const support = current.roles.support?.get(brandKey(candidate.name));
      const other = !!role && role !== 'competitor' && role !== 'ambiguous';
      return {
        ...candidate,
        answerCount: units.size,
        verifiedPrompts: support ? support.competitor : role === 'competitor' ? units.size : 0,
        rejectedPrompts: support ? support.questions - support.competitor : other ? units.size : 0,
        ambiguousPrompts: support ? support.ambiguous : role === 'ambiguous' ? units.size : 0,
      };
    })
    .sort(
      (left, right) =>
        right.verifiedPrompts - left.verifiedPrompts ||
        right.answerCount - left.answerCount ||
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) ||
        String(left.domain).localeCompare(String(right.domain)),
    )
    .slice(0, 200);
  // The evidence of what the report shows, and only that.
  const quoted = [...shownDetails, ...suggestions.flatMap((item) => item.evidence)].flatMap((row) => {
    const ref = evidenceOf.get(row);
    return ref ? [{ row, ref }] : [];
  });
  const quotes = await readingEvidence(projectId, workspaceId, quoted.map(({ ref }) => ref));
  for (const { row, ref } of quoted) {
    const evidence = quotes.get(`${ref.job}\0${ref.reading}`) ?? [];
    if ('excerpt' in row) row.excerpt = evidence.join('\n');
    else row.evidence = evidence;
  }
  return {
    configuration: current.configuration,
    provider: current.provider,
    model: researchModel(current.provider),
    configured: !!decisionKeyConfigured(),
    allowed: researchAllowed(projectId),
    manualProcessing: setting('PREVIEW_MODE') === 'true',
    previewImport:
      setting('PREVIEW_MODE') === 'true'
        ? await db()
            .prepare('SELECT value FROM system_state WHERE key=?')
            .bind(`brand-research-preview-provenance:${projectId}`)
            .first<{ value: string }>()
            .then((row) => (row ? JSON.parse(row.value) : null))
        : null,
    outdated,
    brands: summarizeSentiment(observations, weighting).brands.map((item) => ({
      ...item,
      ...(discovered.has(item.brand) && !current.targets.some((target) => target.name === item.brand) ? { discovered: true } : {}),
      channels: byEngine.flatMap(([engine, rows]) => {
        const channel = rows.get(item.brand);
        return channel ? [{ engine, assessed: channel.assessed, distribution: channel.distribution, scoreTotal: channel.scoreTotal }] : [];
      }),
    })),
    // The project brand's verdict per question, for the Prompts column: the same composition as its score in `brands`.
    units: sentimentByUnit(observations, current.targets[0]?.name),
    // The newest evidence of each brand: the tracked ones share 120 details, each discovery has its own.
    details: shownDetails,
    detailsTruncated: details.length > 120 || [...discoveredDetails.values()].some((count) => count > DISCOVERED_DETAILS),
    truncated: current.truncated,
    maxChannels: MAX_CHANNELS,
    selectedChannels: current.runs.length,
    unassessed: current.runs.filter((run) => {
      const job = jobs.get(run.inputKey);
      return !job || reusableCancellation(job);
    }).length,
    jobs: current.jobs.map(({ id, status, error }) => ({ id, status, error })),
    suggestionsTruncated: candidateSupport.size > 200,
    maxSuggestions: 200,
    suggestions,
  };
}

/**
 * Everything a preview may ever spend on the decision model, whoever asks (the reprocessing runner, a screen): a preview has a
 * provider key only while `preview-data.yml` installed one. Counted over the preview's whole life, not a month.
 */
export const PREVIEW_PROVIDER_BUDGET_USD = 100;
const PREVIEW_SPEND_SQL = `(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs)+(SELECT COALESCE(SUM(${DOMAIN_ROW_SPEND_SQL}),0) FROM brand_domain_lookups)+(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM wizard_jobs)`;

/**
 * Every paid model job (sentiment, source types, roles, intents, attributes, the Brain, learning, mention checks, domain decisions):
 * `reserve` more US$ within the platform's brake and the project's budget (./spend-guards: one rule for every ledger), and in a preview within its lifetime total.
 */
export function researchBudgetCondition(reserve: number, projectId: string | null, count?: { owner: string; module: SpendModule }) {
  // `null`: an operator's platform-wide operation, held to the platform's brake only.
  const spend = projectId === null ? platformGuard(reserve) : spendGuard(projectId, reserve);
  // `count`: one more job of the module within the plan's monthly count of the whole workspace, archived projects too (8/11/2026).
  const plan = count ? workspaceJobsCondition(count.owner, count.module) : null;
  const guard = plan ? { sql: `${spend.sql} AND ${plan.sql}`, params: [...spend.params, ...plan.params] } : spend;
  if (setting('PREVIEW_MODE') !== 'true') return guard;
  return { sql: `${guard.sql} AND ${PREVIEW_SPEND_SQL}+?<=${PREVIEW_PROVIDER_BUDGET_USD}`, params: [...guard.params, reserve] };
}
/** One more job of `module` within the workspace's monthly count in its plan (every project of the owner, archived ones too). */
export function workspaceJobsCondition(owner: string, module: SpendModule) {
  return planCountCondition(owner, module, { sql: WORKSPACE_JOBS_SQL, params: [owner, `${now().slice(0, 7)}-01T00:00:00.000Z`, module] });
}

/** What a preview has spent or holds against {@link PREVIEW_PROVIDER_BUDGET_USD}. */
export async function previewProviderSpend() {
  const row = await db().prepare(`SELECT ${PREVIEW_SPEND_SQL} spent`).first<{ spent: number }>();
  return Number(row?.spent || 0);
}

function reusableCancellation(job: Job) {
  return job.status === 'cancelled' && !job.started_at && job.cost_usd === 0;
}

export async function enqueueBrandResearch(
  projectId: string,
  workspaceId: string,
  q: URLSearchParams,
  value: unknown,
) {
  const configuration = await activeConfiguration(projectId, workspaceId, value);
  const provider = configuration.sentimentProvider;
  if (!researchAllowed(projectId))
    throw new ApiError(
      403,
      'This project is not authorized for brand research.',
    );
  if (!decisionKeyConfigured())
    throw new ApiError(
      503,
      'Evaluation is not available on this installation.',
    );
  q.set('provider', provider);
  const current = await scope(projectId, workspaceId, q);
  const existing = new Set(
    current.jobs
      .filter((job) => !reusableCancellation(job))
      .map((job) => job.input_key),
  );
  let enqueued = 0;
  for (const run of current.runs) {
    if (existing.has(run.inputKey)) continue;
    const input = researchRunInput(run, current);
    // Nothing to read: no brand is named (the decision model refuses a request with no question).
    if (!input.excerpt || !input.options.length) continue;
    const stamp = now(),
      budget = researchBudgetCondition(RESEARCH_RESERVE_USD, projectId, { owner: workspaceId, module: 'sentiment' });
    const result = await db()
      .prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at)
      SELECT ?,?,?,?,?,?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived=0)
      AND EXISTS(SELECT 1 FROM brand_research_configurations WHERE project_id=? AND workspace_id=? AND COALESCE(sentiment_provider,provider)=? AND enabled=1 AND revision=?) AND ${budget.sql}
      ON CONFLICT(project_id,input_key) DO UPDATE SET status='pending',reserved_usd=excluded.reserved_usd,input_json=excluded.input_json,requested_at=excluded.requested_at,completed_at=NULL,error=NULL
      WHERE brand_research_jobs.workspace_id=excluded.workspace_id AND brand_research_jobs.status='cancelled' AND brand_research_jobs.started_at IS NULL AND brand_research_jobs.cost_usd=0`)
      .bind(
        crypto.randomUUID(),
        workspaceId,
        projectId,
        run.inputKey,
        current.contextKey,
        run.answerHash,
        provider,
        researchModel(provider),
        RESEARCH_RESERVE_USD,
        JSON.stringify(input),
        stamp,
        projectId,
        workspaceId,
        projectId,
        workspaceId,
        provider,
        configuration.revision,
        ...budget.params,
      )
      .run();
    if (!result.meta.changes) {
      const latest = await activeConfiguration(projectId, workspaceId, provider);
      if (latest.revision !== configuration.revision)
        throw new ApiError(
          409,
          'Brand research settings changed. Reload before evaluating.',
        );
    }
    existing.add(run.inputKey);
    enqueued += Number(result.meta.changes);
    if (enqueued >= ENQUEUE_LIMIT) break;
    if (
      !result.meta.changes &&
      !(await db()
        .prepare(
          'SELECT id FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND input_key=?',
        )
        .bind(projectId, workspaceId, run.inputKey)
        .first())
    )
      throw new ApiError(409, 'Research budget is full.');
  }
  return { enqueued, limit: ENQUEUE_LIMIT, provider };
}

type ProcessingScope = {
  projectId: string;
  workspaceId: string;
  provider: ResearchProvider;
};

export async function processPreviewBrandResearch(
  projectId: string,
  workspaceId: string,
  value: unknown,
) {
  await ownedProject(projectId, workspaceId);
  if (setting('PREVIEW_MODE') !== 'true')
    throw new ApiError(
      403,
      'Manual evaluation processing is available in previews only.',
    );
  if (!researchAllowed(projectId))
    throw new ApiError(
      403,
      'This project is not authorized for brand research.',
    );
  if (!decisionKeyConfigured())
    throw new ApiError(
      503,
      'Evaluation is not available on this installation.',
    );
  const configuration = await activeConfiguration(projectId, workspaceId, value);
  const provider = configuration.sentimentProvider,
    started = now();
  const processed = await processBrandResearchJobs({
    projectId,
    workspaceId,
    provider,
  });
  const state = await db()
    .prepare(
      "SELECT SUM(status='pending') pending,SUM(status IN ('failed','unknown') AND started_at>=?) failed FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND provider=?",
    )
    .bind(started, projectId, workspaceId, provider)
    .first<{ pending: number; failed: number }>();
  return {
    processed,
    pending: Number(state?.pending || 0),
    failed: Number(state?.failed || 0),
  };
}

export async function processBrandResearchJobs(scope?: ProcessingScope) {
  if (setting('BRAND_RESEARCH_ENABLED') !== 'true') return 0;
  if ((!researchProjects().length && !researchEveryProject()) || !decisionKeyConfigured()) return 0;
  const database = db();
  const scopeSql = scope
    ? ' AND project_id=? AND workspace_id=? AND provider=?'
    : '';
  const scopeParams = scope
    ? [scope.projectId, scope.workspaceId, scope.provider]
    : [];
  if (scope && !researchAllowed(scope.projectId)) return 0;
  await database
    .prepare(
      `UPDATE brand_research_jobs SET status='unknown',completed_at=?,error='Submission outcome is unknown; automatic retry is disabled.' WHERE status='submitting' AND started_at<?${scopeSql}`,
    )
    .bind(
      now(),
      new Date(Date.now() - 5 * 60_000).toISOString(),
      ...scopeParams,
    )
    .run();
  await database
    .prepare(
      `UPDATE brand_research_jobs SET status='cancelled',reserved_usd=0,completed_at=?,error='Project is no longer active.' WHERE status='pending' AND (NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=brand_research_jobs.project_id AND p.workspace_id=brand_research_jobs.workspace_id AND p.archived=0) OR NOT EXISTS(SELECT 1 FROM brand_research_configurations c WHERE c.project_id=brand_research_jobs.project_id AND c.workspace_id=brand_research_jobs.workspace_id AND c.enabled=1 AND (CASE WHEN brand_research_jobs.context_key LIKE 'source-types:%' THEN c.provider ELSE COALESCE(c.sentiment_provider,c.provider) END)=brand_research_jobs.provider)) AND context_key NOT LIKE '${ROLE_CONTEXT_PREFIX}%'${scopeSql}`,
    )
    .bind(now(), ...scopeParams)
    .run();
  const jobs = (
    await database
      .prepare(
        `SELECT * FROM brand_research_jobs WHERE status='pending' AND context_key NOT LIKE ? AND context_key NOT LIKE ? AND (? OR project_id IN (SELECT value FROM json_each(?)))${scopeSql} ORDER BY requested_at LIMIT 2`,
      )
      .bind('source-types:%', `${ROLE_CONTEXT_PREFIX}%`, ...researchProjectBindings(), ...scopeParams)
      .all<Job>()
  ).results;
  let processed = 0;
  // Each project's common words, read once per pass (the cascade asks the model about those names).
  const commons: Record<string, Promise<{ names: Set<string>; measured: boolean }>> = {};
  for (const job of jobs) {
    const stamp = now(),
      budget = researchBudgetCondition(0, job.project_id);
    if (!researchAllowed(job.project_id)) continue;
    const claimed = await database
      .prepare(`UPDATE brand_research_jobs SET status='submitting',started_at=? WHERE id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=? AND archived=0)
      AND EXISTS(SELECT 1 FROM brand_research_configurations c WHERE c.project_id=brand_research_jobs.project_id AND c.workspace_id=brand_research_jobs.workspace_id AND c.enabled=1 AND COALESCE(c.sentiment_provider,c.provider)=brand_research_jobs.provider) AND ${budget.sql}`)
      .bind(stamp, job.id, job.project_id, job.workspace_id, ...budget.params)
      .run();
    if (!claimed.meta.changes) continue;
    processed++;
    let sent = false,
      cost: number | null = null,
      carried: number | null = 0, // spent by a failed first model; null when it may have been billed unreported
      model = job.model;
    const call = async (input: ResearchInput, using: string) => {
      sent = false;
      cost = null;
      const payload = decisionRequest(input, job.provider, using);
      sent = true;
      const response = await steadySentiment(postDecisions)(payload);
      if (!response.ok) {
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408
        )
          sent = false;
        throw new Error(`OpenRouter returned HTTP ${response.status}.`);
      }
      const raw = (await response.json()) as { usage?: { cost?: unknown } };
      if (
        typeof raw.usage?.cost === 'number' &&
        Number.isFinite(raw.usage.cost) &&
        raw.usage.cost >= 0
      )
        cost = raw.usage.cost;
      const result = parseDecisionResponse(raw, input, job.provider, using);
      cost = result.cost;
      return result;
    };
    try {
      if (!researchAllowed(job.project_id))
        throw new Error('Project authorization changed.');
      await activeConfiguration(job.project_id, job.workspace_id, job.provider);
      const input = JSON.parse(job.input_json) as ResearchInput;
      // Decision roots first (sentimentRoots): the project's saved window readings, then the rules; the model reads the rest.
      const roots = await sentimentRoots(input, job.project_id, job.workspace_id, model, commons);
      const ask = roots.ask;
      // The provider's own model answers when the configured one fails.
      const previous = RESEARCH_MODELS[job.provider];
      let result: { readings: ResearchReading[]; cost: number | null; calls: number | null } = { readings: [], cost: 0, calls: 0 };
      if (ask)
        try {
          result = await call(ask, model);
        } catch (error) {
          if (model === previous) throw error;
          console.warn(
            `Brand research: ${model} failed (${error instanceof Error ? error.message : 'error'}); retrying on ${previous}.`,
          );
          carried = sent && cost === null ? null : cost ?? 0;
          model = previous;
          result = await call(ask, model);
        }
      result = { ...result, readings: await roots.keep(result.readings, model) };
      cost =
        result.cost === null || carried === null ? null : result.cost + carried;
      await database
        .prepare(
          "UPDATE brand_research_jobs SET status=?,result_json=?,cost_usd=?,reserved_usd=?,completed_at=?,error=?,model=?,calls=? WHERE id=? AND status='submitting'",
        )
        .bind(
          cost === null ? 'unsettled' : 'completed',
          JSON.stringify(result.readings),
          cost ?? 0,
          cost ?? job.reserved_usd,
          now(),
          cost === null
            ? 'Usage cost is unavailable; the conservative reservation is retained.'
            : null,
          model,
          result.calls,
          job.id,
        )
        .run();
    } catch (error) {
      const unknown = (sent && cost === null) || carried === null;
      const spent = (cost ?? 0) + (carried ?? 0);
      await database
        .prepare(
          "UPDATE brand_research_jobs SET status=?,reserved_usd=?,cost_usd=?,completed_at=?,error=? WHERE id=? AND status='submitting'",
        )
        .bind(
          unknown ? 'unknown' : 'failed',
          unknown ? job.reserved_usd : spent,
          spent,
          now(),
          error instanceof Error
            ? error.message.slice(0, 200)
            : 'Brand research failed.',
          job.id,
        )
        .run();
      if (scope) break;
    }
  }
  return processed;
}

/**
 * The decision roots of one sentiment reading (lib/brand-research-provider.ts sentimentCascade), shared by the scheduler's jobs
 * and Cloud's automatic evaluations: the project's saved readings of the same evidence windows (`sentiment_window_readings`,
 * keyed by rubric, adapter, model, brand and windows; an admin's reprocess reads afresh), then the rules. `ask` is what is left
 * for the model (null: nothing, no call); `keep` merges the model's readings with the roots' and saves what the model read,
 * under the model that answered. `commons` holds each project's common words for one pass.
 */
export async function sentimentRoots(
  input: ResearchInput,
  projectId: string,
  workspaceId: string,
  model: string,
  commons: Record<string, Promise<{ names: Set<string>; measured: boolean }>> = {},
) {
  const database = db();
  const evidence = researchEvidence(input);
  const windowKey = (option: ResearchInput['options'][number], using: string) =>
    hash(`${input.rubric}:${RESEARCH_ADAPTER_VERSION}:${using}:${windowMaterial(option, evidence[option.id] ?? [])}`);
  const keys = new Map(await Promise.all(input.options.filter((option) => evidence[option.id]?.length).map(async (option) => [option.id, await windowKey(option, model)] as const)));
  const saved = new Map<string, ResearchReading>();
  if (keys.size && !input.fresh)
    for (const row of (
      await database
        .prepare('SELECT window_key,reading_json FROM sentiment_window_readings WHERE project_id=? AND window_key IN (SELECT value FROM json_each(?))')
        .bind(projectId, JSON.stringify([...keys.values()]))
        .all<{ window_key: string; reading_json: string }>()
    ).results)
      saved.set(row.window_key, JSON.parse(row.reading_json) as ResearchReading);
  const common = await (commons[`${projectId}:${workspaceId}`] ??= projectReadDatabase(projectId, workspaceId).then(measuredCommonNames, () => ({ names: new Set<string>(), measured: false })));
  const { readings: local, ask } = sentimentCascade(input, common, (option) => saved.get(keys.get(option.id) ?? ''));
  return {
    ask,
    async keep(asked: ResearchReading[], using: string) {
      const readings = mergedReadings(input, local, asked);
      // What the model read is kept by its windows, for the same windows on another day (never what the rules settled).
      // Best effort: a reading the cache could not keep is still the answer's reading (it is only asked again another day).
      const kept = asked.filter((reading) => evidence[reading.id]?.length);
      if (kept.length)
        await database.batch(
          await Promise.all(
            kept.map(async (reading) =>
              database
                .prepare(
                  `INSERT INTO sentiment_window_readings(project_id,window_key,reading_json,created_at) VALUES(?,?,?,?) ON CONFLICT(project_id,window_key) DO ${input.fresh ? 'UPDATE SET reading_json=excluded.reading_json,created_at=excluded.created_at' : 'NOTHING'}`,
                )
                .bind(projectId, await windowKey(input.options.find((option) => option.id === reading.id)!, using), JSON.stringify(reading), now()),
            ),
          ),
        ).catch((error: unknown) => console.warn(`Sentiment window cache: ${error instanceof Error ? error.message : 'not kept'}.`));
      return readings;
    },
  };
}

// Every brand the answer names: the monitored ones and its discoveries (the analysis found them; no loose shortlist).
function researchRunInput(
  { answer, prompt_text, mentions, quiet = [], fresh = false }: { answer: string; prompt_text: string; mentions: { name: string; domain: string | null }[]; quiet?: string[]; fresh?: boolean },
  current: Awaited<ReturnType<typeof scope>>,
) {
  const input = researchInput(answer, current.targets, [], String(current.project.category || ''), mentions, prompt_text, (target) => !quiet.includes(target.name));
  // An admin's reprocess reads the answer again: its saved window readings are not reused, and the new reading replaces them.
  return fresh ? { ...input, fresh: true } : input;
}

// Used only by the scheduler's automatic evaluations (Cloud, ./project-evaluations): the latest answer per question and model of the last 90 days that has no
// job yet, in any status, so an uncertain or failed attempt is never offered again. Reads every page of the scope;
// `truncated` only says an answer was too large to be read. `count` is every such answer; `runs` are the first `limit` of them, the only ones whose
// input is built (the candidate shortlist costs ~100 ms an answer, a past CPU incident). Reading this never sends anything.
export async function unevaluatedResearch(
  projectId: string,
  workspaceId: string,
  provider: ResearchProvider,
  limit = Infinity,
  // With `maxPages` the read stops after that many pages, or once `limit` answers are found, and `next` says where
  // the following read resumes (absent when the scope ended). A page with answers left over is read again, never skipped.
  // `rereadDays` (the estimate of a reprocess of recent days): `legacy` also counts the answers of those days it would read again.
  { from, maxPages = Infinity, rereadDays }: { from?: PageCursor; maxPages?: number; rereadDays?: number } = {},
) {
  let contextKey = '';
  let truncated = false;
  let count = 0;
  // Answers not held for every brand under the current rule: what a reprocess adds to `count`. `legacyBrands` and `brands`
  // add up the brands those answers and the `count` ones name (a reading costs more the more brands it reads).
  let legacy = 0;
  let legacyBrands = 0;
  let brands = 0;
  let waiting = false;
  let pages = 0;
  let next: PageCursor | undefined = from;
  const runs = [];
  for await (const current of scopePages(projectId, workspaceId, provider, from, rereadDays)) {
    pages++;
    contextKey = current.contextKey;
    truncated ||= current.oversized > 0;
    const known = new Set(current.jobs.map((job) => job.input_key));
    let leftover = false;
    for (const run of current.runs) {
      if (run.legacy && hasExcerpt(run.answer)) {
        legacy++;
        legacyBrands += run.brandCount;
      }
      // The estimate of a reprocess of recent days: an answer it would read again is counted there, not as still to read.
      if (known.has(run.inputKey) || !hasExcerpt(run.answer) || (rereadDays && run.legacy)) continue;
      // The analysis is reading the answers again: their discoveries come with it, so they wait (read once, for every brand).
      if (current.analysing) {
        waiting = true;
        continue;
      }
      count++;
      brands += run.brandCount;
      // The input (its candidate shortlist: ~100 ms of CPU an answer) is built when a caller reads it, right before sending:
      // a tick that stops early (time, ceiling) spends no CPU on the answers it leaves for the next one.
      let input: ReturnType<typeof researchRunInput> | undefined;
      if (runs.length < limit)
        runs.push({ runId: run.id, inputKey: run.inputKey, answerHash: run.answerHash, get input() { return (input ??= researchRunInput(run, current)); } });
      else leftover = true;
    }
    next = leftover ? current.start : current.next;
    if (maxPages !== Infinity && (leftover || pages >= maxPages || runs.length >= limit)) break;
  }
  return { contextKey, truncated, count, legacy, legacyBrands, brands, waiting, runs, pages, next };
}

// The same test `researchInput` applies to its excerpt, without building the input.
const hasExcerpt = (answer: string) => brandProse(answer).trim().length > 0;

// Used by the scheduler's first-cycle check and the preview's validation summary (Cloud): the evaluable answers (same window and
// filter as unevaluatedResearch, every page of it) that still have no valid sentiment. `missing` has no job yet; `failed` has a job that
// holds no readings (failed, unknown, in flight, cancelled), which is never resent; `unreadable` is an answer too large to
// be read at all. Reading this never sends anything.
export async function answersWithoutSentiment(
  projectId: string,
  workspaceId: string,
  provider: ResearchProvider,
) {
  const valid = (job?: Job) => {
    // An answer that names no brand has nothing to read: a job sent for it earlier failed with no question, and is settled.
    if (job && Array.isArray(jobInput(job)?.options) && !jobInput(job)!.options.length) return true;
    if (!job || !['completed', 'unsettled'].includes(job.status)) return false;
    try {
      return Array.isArray(JSON.parse(job.result_json || 'null'));
    } catch {
      return false;
    }
  };
  let missing = 0;
  let failed = 0;
  let unreadable = 0;
  // Answers there is something to evaluate in (the share with a valid sentiment is 1 - (missing + failed) / evaluable).
  let evaluable = 0;
  for await (const current of scopePages(projectId, workspaceId, provider)) {
    unreadable += current.oversized;
    const jobs = new Map(current.jobs.map((job) => [job.input_key, job]));
    for (const run of current.runs) {
      if (!hasExcerpt(run.answer)) continue;
      evaluable++;
      const job = jobs.get(run.inputKey);
      if (valid(job)) continue;
      if (job) failed++;
      else missing++;
    }
  }
  return { missing, failed, unreadable, evaluable };
}

// Used only by the authenticated Cloud preview operation; never called by a report.
export async function previewBrandResearchScope(
  projectId: string,
  workspaceId: string,
  provider: ResearchProvider,
  runId?: string,
) {
  if (setting('PREVIEW_MODE') !== 'true') throw new ApiError(404, 'Not found.');
  const current = await scope(
    projectId,
    workspaceId,
    new URLSearchParams({ provider, days: '90' }),
    runId,
  );
  if (current.truncated || current.selectedChannels > 600)
    throw new ApiError(
      409,
      'Preview research scope is truncated or exceeds 600 answers.',
    );
  return current.runs.map((run) => ({
    runId: run.id,
    inputKey: run.inputKey,
    contextKey: current.contextKey,
    answerHash: run.answerHash,
    // Candidate extraction is expensive: plan only identifiers and hashes.
    // Build one input per step, with the same context and full-answer identity.
    ...(runId ? { input: researchRunInput(run, current) } : {}),
  }));
}
