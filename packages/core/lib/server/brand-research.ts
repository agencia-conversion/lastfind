import {
  researchCandidateShortlist,
  RESEARCH_SHORTLIST_VERSION,
} from '@/lib/brand-research-candidates';
import { buildTargetSnapshot } from '@/lib/target-snapshot.mjs';
import { matchesBrand } from '@/lib/metrics';
import {
  BRAND_RESEARCH_RUBRIC,
  researchInput,
  summarizeSentiment,
  type ResearchInput,
  type ResearchObservation,
  type ResearchProvider,
  type ResearchReading,
} from '@/lib/brand-research';
import {
  decisionRequest,
  parseDecisionResponse,
  RESEARCH_MODELS,
  RESEARCH_RESERVE_USD,
  RESEARCH_ADAPTER_VERSION,
} from '@/lib/brand-research-provider';
import type { BrandTarget } from '@/lib/types';
import { db, now, setting } from './env';
import { researchAllProjects } from './capabilities';
import { ApiError } from './http';
import { ownedProject } from './workspace';
import { projectReadDatabase } from './project-store-read';
import { competitorAnalysisStatus } from './competitor-analysis';
import { parseReportFilter } from './reports';

const MAX_CHANNELS = 1000;
const ENQUEUE_LIMIT = 20;
type StoredRun = {
  id: string;
  unit_id: string;
  engine: string;
  answer: string;
  created_at: string;
  prompt_text: string;
  answer_length: number;
};
const MAX_SCOPE_CHARACTERS = 4_000_000;
const QUERY_CHARACTERS = 250_000;
type Job = {
  id: string;
  owner_id: string;
  project_id: string;
  input_key: string;
  context_key: string;
  status: string;
  input_json: string;
  result_json: string | null;
  provider: ResearchProvider;
  reserved_usd: number;
  cost_usd: number;
  started_at: string | null;
  error: string | null;
};
async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
// `*` authorizes every project, but only in the independent edition: it has one
// owner, and its project ids do not exist yet when the installer configures the
// Worker. Cloud ignores it, so a stray `*` can never open research to all accounts.
const ALL_PROJECTS = '*';
function researchProjects() {
  return setting('BRAND_RESEARCH_PROJECTS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
// SQL bindings for `(? OR project_id IN (SELECT value FROM json_each(?)))`: the
// scheduler's project filter, with the independent edition's `*` honoured.
export function researchProjectBindings() {
  const projects = researchProjects();
  return [
    Number(researchAllProjects && projects.includes(ALL_PROJECTS)),
    JSON.stringify(projects),
  ];
}
export function researchAllowed(projectId: string) {
  const projects = researchProjects();
  return (
    setting('BRAND_RESEARCH_ENABLED') === 'true' &&
    ((researchAllProjects && projects.includes(ALL_PROJECTS)) ||
      projects.includes(projectId))
  );
}
function selectedProvider(value: unknown): ResearchProvider {
  if (value !== 'jev' && value !== 'decisions')
    throw new ApiError(400, 'Choose Jev or OpenAI Decisions.');
  return value;
}

export async function brandResearchConfiguration(
  projectId: string,
  ownerId: string,
) {
  await ownedProject(projectId, ownerId);
  const row = await db()
    .prepare(
      'SELECT provider,enabled,revision,updated_at FROM brand_research_configurations WHERE project_id=? AND owner_id=?',
    )
    .bind(projectId, ownerId)
    .first<{
      provider: ResearchProvider;
      enabled: number;
      revision: number;
      updated_at: string;
    }>();
  return row
    ? {
        provider: row.provider,
        enabled: !!row.enabled,
        revision: row.revision,
        updatedAt: row.updated_at,
      }
    : {
        provider: 'jev' as const,
        enabled: false,
        revision: 0,
        updatedAt: null,
      };
}

export async function saveBrandResearchConfiguration(
  projectId: string,
  ownerId: string,
  value: Record<string, unknown>,
) {
  await ownedProject(projectId, ownerId);
  const provider = selectedProvider(value.provider),
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
      .prepare(`INSERT INTO brand_research_configurations(project_id,owner_id,provider,enabled,revision,updated_at)
      SELECT id,owner_id,?,?,?,? FROM projects WHERE id=? AND owner_id=? AND archived=0
      AND COALESCE((SELECT revision FROM brand_research_configurations WHERE project_id=projects.id),0)=?
      ON CONFLICT(project_id) DO UPDATE SET provider=excluded.provider,enabled=excluded.enabled,revision=excluded.revision,updated_at=excluded.updated_at WHERE brand_research_configurations.owner_id=excluded.owner_id AND brand_research_configurations.revision=?`)
      .bind(
        provider,
        Number(value.enabled),
        revision + 1,
        stamp,
        projectId,
        ownerId,
        revision,
        revision,
      ),
    db()
      .prepare(`UPDATE brand_research_jobs SET status='cancelled',reserved_usd=0,completed_at=?,error='Brand research configuration changed.'
      WHERE project_id=? AND owner_id=? AND status='pending' AND (?=0 OR provider<>?)
      AND EXISTS(SELECT 1 FROM brand_research_configurations WHERE project_id=? AND owner_id=? AND revision=? AND provider=? AND enabled=?)`)
      .bind(
        stamp,
        projectId,
        ownerId,
        Number(value.enabled),
        provider,
        projectId,
        ownerId,
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
  return brandResearchConfiguration(projectId, ownerId);
}

async function activeConfiguration(
  projectId: string,
  ownerId: string,
  requested: unknown,
) {
  const configuration = await brandResearchConfiguration(projectId, ownerId);
  if (!configuration.enabled)
    throw new ApiError(
      403,
      'Enable brand research in Settings before evaluating.',
    );
  if (
    requested != null &&
    selectedProvider(requested) !== configuration.provider
  )
    throw new ApiError(
      409,
      'Brand research settings changed. Reload before evaluating.',
    );
  return configuration;
}

async function scope(projectId: string, ownerId: string, q: URLSearchParams) {
  const project = await ownedProject(projectId, ownerId);
  const configuration = await brandResearchConfiguration(projectId, ownerId);
  const provider = selectedProvider(
    q.get('provider') || configuration.provider,
  );
  const filter = parseReportFilter(q);
  const targets = buildTargetSnapshot(project) as BrandTarget[];
  const discovery = await competitorAnalysisStatus(projectId, ownerId);
  const candidates =
    discovery.status === 'complete' && !discovery.needsEnsure
      ? discovery.suggestions.map(({ name, domain }) => ({ name, domain }))
      : [];
  const contextKey = await hash(
    JSON.stringify({
      targets,
      candidates,
      category: project.category,
      rubric: BRAND_RESEARCH_RUBRIC,
      adapter: RESEARCH_ADAPTER_VERSION,
      shortlist: RESEARCH_SHORTLIST_VERSION,
      provider,
      model: RESEARCH_MODELS[provider],
    }),
  );
  const clauses = [
    'r.project_id=?',
    'r.owner_id=?',
    "r.status='complete'",
    'r.response_available=1',
    'r.answer IS NOT NULL',
    'r.created_at>=?',
    'r.created_at<?',
    'p.archived=0',
  ];
  const bindings: (string | number)[] = [
    projectId,
    ownerId,
    filter.cutoff,
    filter.end,
  ];
  const topic = q.get('topic'),
    prompt = q.get('prompt'),
    tags = (q.get('tags') || '').split(',').filter(Boolean);
  if (
    (topic?.length || 0) > 100 ||
    (prompt?.length || 0) > 100 ||
    tags.length > 8 ||
    tags.some((tag) => tag.length > 100)
  )
    throw new ApiError(400, 'Invalid research filter.');
  if (filter.engine !== 'all') {
    clauses.push('r.engine IN (SELECT value FROM json_each(?))');
    bindings.push(JSON.stringify(filter.engine.split(',')));
  }
  if (topic) {
    clauses.push('p.tag=?');
    bindings.push(topic);
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
  const analytics = await projectReadDatabase(projectId, ownerId);
  const result = await analytics
    .prepare(`WITH latest AS (SELECT r.id,COALESCE(p.unit_id,p.id) unit_id,
    ROW_NUMBER() OVER(PARTITION BY COALESCE(p.unit_id,p.id),r.engine ORDER BY r.created_at DESC,r.id DESC) rank
    FROM runs r JOIN prompts p ON p.id=r.prompt_id AND p.project_id=r.project_id WHERE ${clauses.join(' AND ')})
    SELECT r.id,l.unit_id,r.engine,length(r.answer) answer_length,r.created_at,r.prompt_text FROM latest l JOIN runs r ON r.id=l.id
    WHERE l.rank=1 ORDER BY r.created_at DESC,r.id DESC LIMIT ${MAX_CHANNELS + 1}`)
    .bind(...bindings)
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
  for (let offset = 0; offset < selected.length;) {
    const page: StoredRun[] = [];
    let pageCharacters = 0;
    while (
      offset < selected.length &&
      (pageCharacters + selected[offset].answer_length <= QUERY_CHARACTERS ||
        !page.length)
    ) {
      const run = selected[offset++];
      page.push(run);
      pageCharacters += run.answer_length;
      if (pageCharacters >= QUERY_CHARACTERS) break;
    }
    if (page.length === 1 && page[0].answer_length > QUERY_CHARACTERS) {
      let answer = '';
      for (let start = 1; start <= page[0].answer_length; start += 64000) {
        const part = await analytics
          .prepare(
            'SELECT substr(answer,?,64000) answer FROM runs WHERE id=? AND project_id=? AND owner_id=?',
          )
          .bind(start, page[0].id, projectId, ownerId)
          .first<{ answer: string }>();
        if (!part)
          throw new ApiError(
            409,
            'Saved answer changed; refresh and try again.',
          );
        answer += part.answer;
      }
      page[0].answer = answer;
    } else {
      const payloads = (
        await analytics
          .prepare(
            'SELECT id,answer FROM runs WHERE project_id=? AND owner_id=? AND id IN (SELECT value FROM json_each(?))',
          )
          .bind(projectId, ownerId, JSON.stringify(page.map((run) => run.id)))
          .all<{ id: string; answer: string }>()
      ).results;
      for (const run of page) {
        const payload = payloads.find((item) => item.id === run.id);
        if (!payload)
          throw new ApiError(
            409,
            'Saved answer changed; refresh and try again.',
          );
        run.answer = payload.answer;
      }
    }
  }
  const runs = await Promise.all(
    selected.map(async (run) => {
      const answerHash = await hash(run.answer);
      return {
        ...run,
        answerHash,
        inputKey: await hash(`${contextKey}:${answerHash}`),
      };
    }),
  );
  const keys = [...new Set(runs.map((run) => run.inputKey))];
  const jobs = keys.length
    ? (
        await db()
          .prepare(
            'SELECT * FROM brand_research_jobs WHERE project_id=? AND owner_id=? AND input_key IN (SELECT value FROM json_each(?))',
          )
          .bind(projectId, ownerId, JSON.stringify(keys))
          .all<Job>()
      ).results
    : [];
  return {
    project,
    configuration,
    provider,
    targets,
    candidates,
    contextKey,
    runs,
    jobs,
    truncated: selected.length < result.results.length,
    discovery,
  };
}

export async function brandResearchReport(
  projectId: string,
  ownerId: string,
  q: URLSearchParams,
) {
  const current = await scope(projectId, ownerId, q);
  const jobs = new Map(current.jobs.map((job) => [job.input_key, job]));
  const observations: ResearchObservation[] = [];
  const candidateSupport = new Map<
    string,
    {
      name: string;
      domain: string | null;
      units: Set<string>;
      accepted: Set<string>;
      rejected: Set<string>;
      ambiguous: Set<string>;
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
    evidence: string[];
  }[] = [];
  for (const run of current.runs) {
    const job = jobs.get(run.inputKey);
    const input = job ? (JSON.parse(job.input_json) as ResearchInput) : null;
    const readings =
      job && ['completed', 'unsettled'].includes(job.status) && job.result_json
        ? (JSON.parse(job.result_json) as ResearchReading[])
        : [];
    for (const target of current.targets) {
      const option = input?.options.find(
        (item) =>
          item.kind === 'tracked' &&
          item.name === target.name &&
          item.domain === target.domain,
      );
      const reading = readings.find((item) => item.id === option?.id);
      const mentioned = matchesBrand(run.answer, target);
      observations.push({
        runId: run.id,
        unitId: run.unit_id,
        engine: run.engine,
        createdAt: run.created_at,
        brand: target.name,
        mentioned,
        status: job?.status || 'unassessed',
        reading,
        fullCoverage: input?.fullCoverage ?? true,
      });
      details.push({
        runId: run.id,
        prompt: run.prompt_text,
        unitId: run.unit_id,
        engine: run.engine,
        date: run.created_at,
        brand: target.name,
        state: mentioned
          ? reading?.state || job?.status || 'unassessed'
          : 'absent',
        sentiment: mentioned ? reading?.sentiment || null : null,
        evidence: mentioned ? reading?.evidence || [] : [],
      });
    }
    const candidateOptions = new Map(
      (input?.options || [])
        .filter((option) => option.kind === 'candidate')
        .map((option) => [
          JSON.stringify([option.name, option.domain]),
          { name: option.name, domain: option.domain },
        ]),
    );
    for (const candidate of candidateOptions.values()) {
      if (
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
        accepted: new Set<string>(),
        rejected: new Set<string>(),
        ambiguous: new Set<string>(),
        evidence: [],
      };
      support.units.add(run.unit_id);
      const option = input?.options.find(
        (item) =>
          item.kind === 'candidate' &&
          item.name === candidate.name &&
          item.domain === candidate.domain,
      );
      const reading = readings.find((item) => item.id === option?.id);
      if (reading?.candidate === 'competitor' && reading.state === 'assessed') {
        support.accepted.add(run.unit_id);
        if (support.evidence.length < 3)
          support.evidence.push({
            runId: run.id,
            excerpt: reading.evidence.join('\n'),
            createdAt: run.created_at,
          });
      }
      if (reading?.candidate === 'other') support.rejected.add(run.unit_id);
      if (reading?.candidate === 'ambiguous' || reading?.state === 'ambiguous')
        support.ambiguous.add(run.unit_id);
      candidateSupport.set(key, support);
    }
  }
  return {
    configuration: current.configuration,
    provider: current.provider,
    model: RESEARCH_MODELS[current.provider],
    configured: !!setting('OPENROUTER_API_KEY'),
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
    brands: summarizeSentiment(observations).brands,
    details: details.slice(0, 120),
    detailsTruncated: details.length > 120,
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
    suggestions: [...candidateSupport.values()]
      .map(({ units, accepted, rejected, ambiguous, ...candidate }) => ({
        ...candidate,
        answerCount: units.size,
        verifiedPrompts: accepted.size,
        rejectedPrompts: rejected.size,
        ambiguousPrompts: ambiguous.size,
      }))
      .sort(
        (left, right) =>
          right.verifiedPrompts - left.verifiedPrompts ||
          right.answerCount - left.answerCount ||
          (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) ||
          String(left.domain).localeCompare(String(right.domain)),
      )
      .slice(0, 200),
  };
}

// Runs, Semantic and research share the same global dollars and unresolved holds.
export function researchBudgetCondition(month: string, reserve: number) {
  const held = "status IN ('pending','submitting','unknown','unsettled')";
  return {
    sql: `(SELECT COALESCE(SUM(MAX(cost,budget_credits*0.0012)),0) FROM runs WHERE created_at>=? OR status IN ('queued','submitting','unknown'))
    +(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM semantic_jobs WHERE requested_at>=? OR status IN ('pending','submitting','submitted','unknown'))
    +(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs WHERE requested_at>=? OR ${held})+?<=2000
    AND (SELECT COALESCE(SUM(MAX(cost,budget_credits*0.0012)),0) FROM runs WHERE COALESCE(claimed_at,created_at)>=strftime('%Y-%m-%dT00:00:00.000Z','now') OR status IN ('queued','submitting','unknown'))
    +(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM semantic_jobs WHERE requested_at>=strftime('%Y-%m-%dT00:00:00.000Z','now') OR status IN ('pending','submitting','submitted','unknown'))
    +(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs WHERE requested_at>=strftime('%Y-%m-%dT00:00:00.000Z','now') OR ${held})+?<=64`,
    params: [month, month, month, reserve, reserve],
  };
}

function reusableCancellation(job: Job) {
  return job.status === 'cancelled' && !job.started_at && job.cost_usd === 0;
}

export async function enqueueBrandResearch(
  projectId: string,
  ownerId: string,
  q: URLSearchParams,
  value: unknown,
) {
  const configuration = await activeConfiguration(projectId, ownerId, value);
  const provider = configuration.provider;
  if (!researchAllowed(projectId))
    throw new ApiError(
      403,
      'This project is not authorized for brand research.',
    );
  if (!setting('OPENROUTER_API_KEY'))
    throw new ApiError(
      503,
      'Configure the OpenRouter server key before evaluating.',
    );
  q.set('provider', provider);
  const current = await scope(projectId, ownerId, q);
  const existing = new Set(
    current.jobs
      .filter((job) => !reusableCancellation(job))
      .map((job) => job.input_key),
  );
  let enqueued = 0;
  for (const run of current.runs) {
    if (existing.has(run.inputKey)) continue;
    const shortlist = researchCandidateShortlist(
      run.answer,
      current.targets,
      current.candidates,
    );
    const input = researchInput(
      run.answer,
      current.targets,
      shortlist.candidates,
      String(current.project.category || ''),
    );
    input.fullCoverage = input.fullCoverage && shortlist.fullCoverage;
    if (!input.excerpt) continue;
    const stamp = now(),
      budget = researchBudgetCondition(
        `${stamp.slice(0, 7)}-01T00:00:00.000Z`,
        RESEARCH_RESERVE_USD,
      );
    const result = await db()
      .prepare(`INSERT INTO brand_research_jobs(id,owner_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at)
      SELECT ?,?,?,?,?,?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND archived=0)
      AND EXISTS(SELECT 1 FROM brand_research_configurations WHERE project_id=? AND owner_id=? AND provider=? AND enabled=1 AND revision=?) AND ${budget.sql}
      ON CONFLICT(project_id,input_key) DO UPDATE SET status='pending',reserved_usd=excluded.reserved_usd,input_json=excluded.input_json,requested_at=excluded.requested_at,completed_at=NULL,error=NULL
      WHERE brand_research_jobs.owner_id=excluded.owner_id AND brand_research_jobs.status='cancelled' AND brand_research_jobs.started_at IS NULL AND brand_research_jobs.cost_usd=0`)
      .bind(
        crypto.randomUUID(),
        ownerId,
        projectId,
        run.inputKey,
        current.contextKey,
        run.answerHash,
        provider,
        RESEARCH_MODELS[provider],
        RESEARCH_RESERVE_USD,
        JSON.stringify(input),
        stamp,
        projectId,
        ownerId,
        projectId,
        ownerId,
        provider,
        configuration.revision,
        ...budget.params,
      )
      .run();
    if (!result.meta.changes) {
      const latest = await activeConfiguration(projectId, ownerId, provider);
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
          'SELECT id FROM brand_research_jobs WHERE project_id=? AND owner_id=? AND input_key=?',
        )
        .bind(projectId, ownerId, run.inputKey)
        .first())
    )
      throw new ApiError(409, 'Research budget is full.');
  }
  return { enqueued, limit: ENQUEUE_LIMIT, provider };
}

type ProcessingScope = {
  projectId: string;
  ownerId: string;
  provider: ResearchProvider;
};

export async function processPreviewBrandResearch(
  projectId: string,
  ownerId: string,
  value: unknown,
) {
  await ownedProject(projectId, ownerId);
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
  if (!setting('OPENROUTER_API_KEY'))
    throw new ApiError(
      503,
      'Configure the OpenRouter server key before evaluating.',
    );
  const configuration = await activeConfiguration(projectId, ownerId, value);
  const provider = configuration.provider,
    started = now();
  const processed = await processBrandResearchJobs({
    projectId,
    ownerId,
    provider,
  });
  const state = await db()
    .prepare(
      "SELECT SUM(status='pending') pending,SUM(status IN ('failed','unknown') AND started_at>=?) failed FROM brand_research_jobs WHERE project_id=? AND owner_id=? AND provider=?",
    )
    .bind(started, projectId, ownerId, provider)
    .first<{ pending: number; failed: number }>();
  return {
    processed,
    pending: Number(state?.pending || 0),
    failed: Number(state?.failed || 0),
  };
}

export async function processBrandResearchJobs(scope?: ProcessingScope) {
  if (setting('BRAND_RESEARCH_ENABLED') !== 'true') return 0;
  const projects = researchProjects();
  if (!projects.length || !setting('OPENROUTER_API_KEY')) return 0;
  const database = db();
  const scopeSql = scope
    ? ' AND project_id=? AND owner_id=? AND provider=?'
    : '';
  const scopeParams = scope
    ? [scope.projectId, scope.ownerId, scope.provider]
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
      `UPDATE brand_research_jobs SET status='cancelled',reserved_usd=0,completed_at=?,error='Project is no longer active.' WHERE status='pending' AND (NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=brand_research_jobs.project_id AND p.owner_id=brand_research_jobs.owner_id AND p.archived=0) OR NOT EXISTS(SELECT 1 FROM brand_research_configurations c WHERE c.project_id=brand_research_jobs.project_id AND c.owner_id=brand_research_jobs.owner_id AND c.enabled=1 AND c.provider=brand_research_jobs.provider))${scopeSql}`,
    )
    .bind(now(), ...scopeParams)
    .run();
  const jobs = (
    await database
      .prepare(
        `SELECT * FROM brand_research_jobs WHERE status='pending' AND context_key NOT LIKE ? AND (? OR project_id IN (SELECT value FROM json_each(?)))${scopeSql} ORDER BY requested_at LIMIT 2`,
      )
      .bind(
        'source-types:%',
        Number(researchAllProjects && projects.includes(ALL_PROJECTS)),
        JSON.stringify(projects),
        ...scopeParams,
      )
      .all<Job>()
  ).results;
  let processed = 0;
  for (const job of jobs) {
    const stamp = now(),
      budget = researchBudgetCondition(
        `${stamp.slice(0, 7)}-01T00:00:00.000Z`,
        0,
      );
    if (!researchAllowed(job.project_id)) continue;
    const claimed = await database
      .prepare(`UPDATE brand_research_jobs SET status='submitting',started_at=? WHERE id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND archived=0)
      AND EXISTS(SELECT 1 FROM brand_research_configurations c WHERE c.project_id=brand_research_jobs.project_id AND c.owner_id=brand_research_jobs.owner_id AND c.enabled=1 AND c.provider=brand_research_jobs.provider) AND ${budget.sql}`)
      .bind(stamp, job.id, job.project_id, job.owner_id, ...budget.params)
      .run();
    if (!claimed.meta.changes) continue;
    processed++;
    let sent = false,
      cost: number | null = null;
    try {
      if (!researchAllowed(job.project_id))
        throw new Error('Project authorization changed.');
      await activeConfiguration(job.project_id, job.owner_id, job.provider);
      const input = JSON.parse(job.input_json) as ResearchInput;
      const payload = decisionRequest(input, job.provider);
      sent = true;
      const response = await fetch(
        'https://openrouter.ai/api/alpha/decisions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${setting('OPENROUTER_API_KEY')}`,
            'Content-Type': 'application/json',
            'X-Title': 'Lastfind',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        },
      );
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
      const result = parseDecisionResponse(raw, input, job.provider);
      cost = result.cost;
      await database
        .prepare(
          "UPDATE brand_research_jobs SET status=?,result_json=?,cost_usd=?,reserved_usd=?,completed_at=?,error=? WHERE id=? AND status='submitting'",
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
          job.id,
        )
        .run();
    } catch (error) {
      const unknown = sent && cost === null;
      await database
        .prepare(
          "UPDATE brand_research_jobs SET status=?,reserved_usd=?,cost_usd=?,completed_at=?,error=? WHERE id=? AND status='submitting'",
        )
        .bind(
          unknown ? 'unknown' : 'failed',
          unknown ? job.reserved_usd : cost || 0,
          cost || 0,
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
