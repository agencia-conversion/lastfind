import { brandKey, type Suggestion } from '@/lib/brand-decisions';
import { brandDetectionKey, DETECTOR_VERSION, extractBrandMentions, trackedBrandKeys, type DiscoverySeed } from '@/lib/competitor-discovery';
import {
  isNameFragment,
  parseRoleResponse,
  QUESTION_ROLE_CONTEXT,
  questionKey,
  roleRequest,
  ROLE_ADAPTER_VERSION,
  ROLE_CONTEXT_PREFIX,
  ROLE_MAX_CANDIDATES,
  ROLE_RESERVE_USD,
  ROLE_RETRY_AFTER_MS,
  verdictModel,
  type RoleCandidate,
  type RoleContext,
} from '@/lib/brand-roles';
import { db, now, setting } from './env';
import { claimDecisionJob, completeDecisionJob, failDecisionJob, hash, markStaleUnknown, requestDecisions } from './decision-jobs';
import { competitorAnalysisStatus, syncCountedBrands, type CompetitorAnalysisStatus } from './competitor-analysis';
import { decidedRoles, roleKey, roleModels, verdictModels } from './brand-roles';
import { ownedProject } from './workspace';
import { projectReadDatabase } from './project-store-read';
import { buildTargetSnapshot } from '@/lib/target-snapshot.mjs';
import { inPool, OUTBOUND_CONNECTIONS } from '@/lib/pool';
// Per-question roles run only once authorized; without it the per-name classifier below runs.
import { questionRolesAuthorization } from './brand-backfill';
import { checkMentions } from './brand-mention-checks';
import { commonNamesOf } from '@/lib/brand-mention-check';
import { decisionKeyConfigured } from './model-routes';

/** A project's analysis is looked at again no sooner than this; the scheduler visits a few projects per tick. */
const CHECK_EVERY_MS = 4 * 60_000;
const PROJECTS_PER_TICK = 5;
/** Requests of ROLE_MAX_CANDIDATES names one tick may send (a project with thousands of names takes several ticks)... */
const REQUESTS_PER_TICK = 120;
/** ...and the time it may spend on them; a request already sent is always finished. */
const TICK_BUDGET_MS = 120_000;
/**
 * Requests in flight at once (Cloudflare's six outbound connections per invocation; Worker setting BRAND_ROLES_CONCURRENCY).
 * Each reservation is one guarded INSERT (budget caps and the authorized total), so side by side they never pass a ceiling.
 */
export const ROLE_CONCURRENCY = OUTBOUND_CONNECTIONS;
const concurrency = () => Number(setting('BRAND_ROLES_CONCURRENCY')) || ROLE_CONCURRENCY;
const checkedKey = (projectId: string) => `brand-roles-checked:${projectId}`;

/**
 * Names cut from a longer one ("Wh", "EarFun&", isNameFragment) are settled as no brand by rule, under the current
 * criteria and without a request (cost 0), so they leave the list and never count. Returns their keys.
 */
async function settleFragments(projectId: string, candidates: Pick<RoleCandidate, 'key' | 'name' | 'domain'>[], digest: string) {
  const fragments = candidates.filter((candidate) => isNameFragment(candidate.name, candidate.domain));
  if (fragments.length) {
    const database = db();
    const model = verdictModel(roleModels().model);
    const decided = now();
    await database.batch(
      fragments.map((candidate) =>
        database
          .prepare(`INSERT INTO brand_role_decisions(project_id,brand_key,model,role,cost_usd,decided_at,category_digest) VALUES(?,?,?,'not_brand',0,?,?)
          ON CONFLICT(project_id,brand_key,model) DO NOTHING`)
          .bind(projectId, candidate.key, model, decided, digest),
      ),
    );
  }
  return new Set(fragments.map((candidate) => candidate.key));
}

/** The digest a per-name verdict is kept under: the project's category, case and spacing folded. */
export const categoryDigest = (category: string) => hash(`role-category:${category.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase()}`);
/**
 * A decision root of roles (9/11/2026): a name another project of the same workspace settled, under the same criteria and model
 * and the same category, takes that verdict without a request, when it does not depend on the project's own brands: a
 * competitor in the category, or no brand at all. A client, supplier, partner or mention is relative to the tracked brands and
 * is asked again. Never across workspaces. Returns the keys settled.
 */
async function reuseWorkspaceVerdicts(projectId: string, workspaceId: string, candidates: Pick<RoleCandidate, 'key'>[], digest: string) {
  if (!candidates.length) return new Set<string>();
  const database = db();
  const models = [...new Set(verdictModels().current)];
  const { results } = await database
    .prepare(
      `SELECT d.brand_key,d.role,d.model FROM brand_role_decisions d JOIN projects p ON p.id=d.project_id
       WHERE d.category_digest=? AND d.model IN (SELECT value FROM json_each(?)) AND d.brand_key IN (SELECT value FROM json_each(?))
       AND d.role IN ('competitor','not_brand') AND p.workspace_id=? AND d.project_id<>?`,
    )
    .bind(digest, JSON.stringify(models), JSON.stringify(candidates.map((candidate) => candidate.key)), workspaceId, projectId)
    .all<{ brand_key: string; role: string; model: string }>();
  // One verdict per name: the configured model's first, and one role only when the workspace's projects agree.
  const byKey = new Map<string, { role: string; model: string } | null>();
  for (const row of results.sort((a, b) => Number(b.model === models[0]) - Number(a.model === models[0]))) {
    const seen = byKey.get(row.brand_key);
    if (seen === undefined) byKey.set(row.brand_key, row);
    else if (seen && seen.role !== row.role) byKey.set(row.brand_key, null);
  }
  const reused = [...byKey].flatMap(([key, row]) => (row ? [[key, row] as const] : []));
  if (reused.length) {
    const decided = now();
    await database.batch(
      reused.map(([key, row]) =>
        database
          .prepare(`INSERT INTO brand_role_decisions(project_id,brand_key,model,role,cost_usd,decided_at,category_digest) VALUES(?,?,?,?,0,?,?)
          ON CONFLICT(project_id,brand_key,model) DO NOTHING`)
          .bind(projectId, key, row.model, row.role, decided, digest),
      ),
    );
  }
  return new Set(reused.map(([key]) => key));
}

/**
 * Asks the decision model once for the names of a finished analysis that have no answer yet.
 * Never runs while a page loads: the scheduler calls it after the analysis completes. The request
 * is a `brand_research_jobs` row (keyed by project, model and the exact names), so a second
 * isolate, a restart or a repeated tick finds the row and asks nothing; the reservation counts in
 * the same daily and monthly caps as every other paid job. A failure without cost is retried after
 * ROLE_RETRY_AFTER_MS; an uncertain one never. Until an answer is kept the names wait in review.
 */
export async function classifyBrandRoles(
  projectId: string,
  workspaceId: string,
  context: RoleContext,
  suggestions: Suggestion[],
  decided?: Map<string, unknown>,
) {
  if (!suggestions.length || !decisionKeyConfigured()) return 'skipped' as const;
  const { model, fallback } = roleModels();
  // Only the current criteria's verdicts settle a name: one decided under older criteria is asked again.
  const known = decided ?? (await decidedRoles(projectId, { current: true }));
  // Names in a request that may have been billed (or is still in flight) are not sent again inside a new batch: they wait in review.
  const inFlight = new Set<string>();
  const open = await db()
    .prepare("SELECT input_json FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND context_key LIKE ? AND status IN ('pending','submitting','unknown')")
    .bind(projectId, workspaceId, `${ROLE_CONTEXT_PREFIX}%`)
    .all<{ input_json: string }>();
  for (const row of open.results) {
    try {
      for (const candidate of JSON.parse(row.input_json).candidates as RoleCandidate[]) inFlight.add(candidate.key);
    } catch {
      /* A row that cannot be read holds no names. */
    }
  }
  const unsettled: RoleCandidate[] = suggestions
    .filter((suggestion) => !known.has(roleKey(suggestion)) && !inFlight.has(roleKey(suggestion)))
    .map((suggestion) => ({
      key: roleKey(suggestion),
      name: suggestion.name,
      domain: suggestion.domain,
      excerpts: suggestion.evidence.map((item) => item.excerpt),
    }));
  const digest = await categoryDigest(context.category);
  const fragments = await settleFragments(projectId, unsettled, digest);
  const reused = await reuseWorkspaceVerdicts(projectId, workspaceId, unsettled.filter((candidate) => !fragments.has(candidate.key)), digest);
  const candidates = unsettled.filter((candidate) => !fragments.has(candidate.key) && !reused.has(candidate.key)).slice(0, ROLE_MAX_CANDIDATES);
  if (!candidates.length) return 'nothing' as const;
  const database = db();
  const contextKey = `${ROLE_CONTEXT_PREFIX}${ROLE_ADAPTER_VERSION}`;
  const inputKey = await hash(`${contextKey}:${model}:${candidates.map((candidate) => candidate.key).sort().join('\n')}`);
  // No row taken: this exact request is already pending, running, answered, uncertain or cooling down, or the budget is full.
  const jobId = await claimDecisionJob({
    projectId,
    workspaceId,
    contextKey,
    provider: 'brand-roles',
    model,
    inputKey,
    reserveUsd: ROLE_RESERVE_USD,
    inputJson: JSON.stringify({ context, candidates }),
    retryAfterMs: ROLE_RETRY_AFTER_MS,
  });
  if (!jobId) return 'held' as const;
  try {
    const result = await requestDecisions(model, fallback, {
      label: 'Brand roles',
      payload: (m) => roleRequest(m, context, candidates),
      parse: (raw, m) => parseRoleResponse(raw, m, candidates),
    });
    const done = now();
    const share = result.cost == null ? null : result.cost / candidates.length;
    await database.batch([
      completeDecisionJob(jobId, result, JSON.stringify([...result.roles]), ROLE_RESERVE_USD, done),
      ...[...result.roles].map(([key, role]) =>
        database
          .prepare(`INSERT INTO brand_role_decisions(project_id,brand_key,model,role,cost_usd,decided_at,category_digest)
          SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM brand_research_jobs WHERE id=? AND completed_at=? AND status IN ('completed','unsettled'))
          ON CONFLICT(project_id,brand_key,model) DO NOTHING`)
          .bind(projectId, key, verdictModel(result.model), role, share, done, digest, jobId, done),
      ),
    ]);
    return 'answered' as const;
  } catch (error) {
    await failDecisionJob(jobId, error, ROLE_RESERVE_USD, 'Brand role');
    console.warn(`Brand roles: ${error instanceof Error ? error.message : 'failed'}; the names stay in review.`);
    return 'failed' as const;
  }
}

/**
 * Answers read per page (one store read) and pages per project and tick. Pages are asked about PAGES_PER_UNIT at a time, so
 * the pool always has questions to send; a unit is read again until every name in it is settled or in flight.
 */
const PAGE_ANSWERS = 25;
const PAGES_PER_PROJECT = 8;
const PAGES_PER_UNIT = 4;
/** ponytail: names are read in the first 40k characters of an answer (25 per page stay far under the 4 MiB RPC); raise with smaller pages if answers grow. */
const ANSWER_CHARACTERS = 40_000;
const EXCERPTS_PER_NAME = 2;
const WINDOW_MS = 90 * 86400000;
type Cursor = { at: string; id: string };
type PassState = { version: string; top: Cursor | null; cursor: Cursor | null; floor: Cursor | null };
const passKey = (projectId: string) => `brand-question-roles:${projectId}`;
type Authorization = NonNullable<Awaited<ReturnType<typeof questionRolesAuthorization>>>;

/** One request for up to ROLE_MAX_CANDIDATES names of one question, kept per question; the same rules as the per-name request. */
async function askQuestion(
  projectId: string,
  workspaceId: string,
  context: RoleContext & { question: string },
  key: string,
  candidates: RoleCandidate[],
  authorization: Authorization,
) {
  const { model, fallback } = roleModels();
  const inputKey = await hash(`${QUESTION_ROLE_CONTEXT}:${ROLE_ADAPTER_VERSION}:${model}:${key}:${candidates.map((candidate) => candidate.key).sort().join('\n')}`);
  const jobId = await claimDecisionJob({
    projectId,
    workspaceId,
    contextKey: QUESTION_ROLE_CONTEXT,
    provider: 'brand-roles',
    model,
    inputKey,
    reserveUsd: ROLE_RESERVE_USD,
    inputJson: JSON.stringify({ questionKey: key, context, candidates }),
    retryAfterMs: ROLE_RETRY_AFTER_MS,
    // The authorized ceiling, per project and month since 8/11/2026 (a global total before), held in the same statement as
    // the reservation (idx_brand_research_project_spend).
    cap: {
      sql: '(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs WHERE project_id=? AND requested_at>=MAX(?,?) AND context_key=?)+?<=?',
      params: [projectId, authorization.enabledAt, `${now().slice(0, 7)}-01T00:00:00.000Z`, QUESTION_ROLE_CONTEXT, ROLE_RESERVE_USD, authorization.ceilingUsd],
    },
  });
  if (!jobId) return 'held' as const;
  try {
    const result = await requestDecisions(model, fallback, {
      label: 'Brand roles',
      payload: (m) => roleRequest(m, context, candidates),
      parse: (raw, m) => parseRoleResponse(raw, m, candidates),
    });
    const done = now();
    const share = result.cost == null ? null : result.cost / candidates.length;
    const database = db();
    await database.batch([
      completeDecisionJob(jobId, result, JSON.stringify([...result.roles]), ROLE_RESERVE_USD, done),
      ...[...result.roles].map(([brand, role]) =>
        database
          .prepare(`INSERT INTO brand_question_roles(project_id,question_key,brand_key,model,role,question,cost_usd,decided_at)
          SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM brand_research_jobs WHERE id=? AND completed_at=? AND status IN ('completed','unsettled'))
          ON CONFLICT(project_id,question_key,brand_key,model) DO NOTHING`)
          .bind(projectId, key, brand, verdictModel(result.model), role, context.question, share, done, jobId, done),
      ),
    ]);
    return 'answered' as const;
  } catch (error) {
    await failDecisionJob(jobId, error, ROLE_RESERVE_USD, 'Brand role');
    console.warn(`Brand roles: ${error instanceof Error ? error.message : 'failed'}; the names stay in review.`);
    return 'failed' as const;
  }
}

/**
 * The names of one page of answers, grouped by question, that no verdict of the current model settles and no open request
 * holds, then asked question by question. Only names an answer presents as an item (or as a company: "X é uma agência")
 * are asked; a name met only in running text keeps the per-name verdict, if any, and a title written in italics
 * ("*Severance*") is not asked at all: the detector drops it. `complete` once nothing on the page is left.
 */
async function classifyPage(
  projectId: string,
  workspaceId: string,
  targets: DiscoverySeed[],
  context: RoleContext,
  rows: { prompt_text: string | null; answer: string | null }[],
  budget: { left: number; deadline: number },
  authorization: Authorization,
  common: ReadonlySet<string>,
) {
  const tracked = trackedBrandKeys(targets, common);
  const known = new Set(targets.map((target) => brandDetectionKey(target.name)));
  const groups = new Map<string, { question: string; names: Map<string, RoleCandidate> }>();
  const fragments = new Map<string, RoleCandidate>();
  for (const row of rows) {
    if (!row.prompt_text?.trim() || !row.answer) continue;
    const key = await questionKey(row.prompt_text);
    const group = groups.get(key) ?? { question: row.prompt_text.trim().slice(0, 1000), names: new Map() };
    groups.set(key, group);
    for (const mention of extractBrandMentions(row.answer, known)) {
      if (tracked(mention.key) || (mention.structure === 'prose' && !mention.company) || mention.italic) continue;
      const name = brandKey(mention.name);
      if (isNameFragment(mention.name)) {
        fragments.set(name, { key: name, name: mention.name, domain: null, excerpts: [] });
        continue;
      }
      const candidate = group.names.get(name) ?? { key: name, name: mention.name, domain: null, excerpts: [] };
      if (candidate.excerpts.length < EXCERPTS_PER_NAME) candidate.excerpts.push(mention.excerpt);
      group.names.set(name, candidate);
    }
  }
  await settleFragments(projectId, [...fragments.values()], await categoryDigest(context.category));
  if (![...groups.values()].some((group) => group.names.size)) return { complete: true, asked: 0 };
  // Only the current criteria's verdicts settle a name in a question: one decided under older criteria is asked again.
  const { current } = verdictModels();
  const [decided, open] = await db().batch([
    db()
      .prepare('SELECT question_key,brand_key FROM brand_question_roles WHERE project_id=? AND model IN (?,?) AND question_key IN (SELECT value FROM json_each(?))')
      .bind(projectId, ...current, JSON.stringify([...groups.keys()])),
    db()
      // A failure that was billed is never retried either: its names count as asked, so the page moves on.
      .prepare("SELECT input_json FROM brand_research_jobs WHERE project_id=? AND workspace_id=? AND context_key=? AND status IN ('pending','submitting','unknown','failed') AND (status<>'failed' OR cost_usd>0)")
      .bind(projectId, workspaceId, QUESTION_ROLE_CONTEXT),
  ]);
  const settled = new Set((decided.results as { question_key: string; brand_key: string }[]).map((row) => `${row.question_key}\n${row.brand_key}`));
  for (const row of open.results as { input_json: string }[]) {
    try {
      const input = JSON.parse(row.input_json) as { questionKey: string; candidates: RoleCandidate[] };
      // A request that may have been billed (or is still in flight) is never sent again inside a new batch.
      for (const candidate of input.candidates) settled.add(`${input.questionKey}\n${candidate.key}`);
    } catch {
      /* A row that cannot be read holds no names. */
    }
  }
  const requests: { key: string; question: string; candidates: RoleCandidate[] }[] = [];
  for (const [key, group] of groups) {
    const left = [...group.names.values()].filter((candidate) => !settled.has(`${key}\n${candidate.key}`));
    for (let start = 0; start < left.length; start += ROLE_MAX_CANDIDATES)
      requests.push({ key, question: group.question, candidates: left.slice(start, start + ROLE_MAX_CANDIDATES) });
  }
  let asked = 0;
  let complete = true;
  await inPool(requests, concurrency(), async ({ key, question, candidates }) => {
    if (budget.left <= 0 || Date.now() > budget.deadline) {
      complete = false;
      return false;
    }
    // Taken before the request leaves, so requests side by side never pass the tick's count.
    budget.left--;
    const outcome = await askQuestion(projectId, workspaceId, { ...context, question }, key, candidates, authorization);
    if (outcome === 'held') budget.left++;
    else asked++;
    // A failure (a 402 without credits, a timeout), the ceiling or a request cooling down stops the project until a later tick
    // (what is already in flight finishes).
    if (outcome !== 'answered') complete = false;
    return outcome === 'answered';
  });
  return { complete, asked };
}

/**
 * Per-question roles of one project: the 90-day answers, newest first, a page at a time. A pass ends at the newest answer
 * of the previous pass (`floor`), so a new answer is read once and an old one never again; a page is left only when every
 * name on it is settled or in flight. A new model or detector starts a new pass, which asks only what that model has not settled.
 */
async function classifyQuestionRoles(
  projectId: string,
  workspaceId: string,
  targets: DiscoverySeed[],
  context: RoleContext,
  budget: { left: number; deadline: number },
  authorization: Authorization,
) {
  const database = db();
  // New criteria (ROLE_ADAPTER_VERSION) start a new pass from the newest answer, so every question is read again.
  const version = `${roleModels().model}|${DETECTOR_VERSION}|${QUESTION_ROLE_CONTEXT}|${ROLE_ADAPTER_VERSION}`;
  const saved = await database.prepare('SELECT value FROM system_state WHERE key=?').bind(passKey(projectId)).first<{ value: string }>();
  let state: PassState = { version, top: null, cursor: null, floor: null };
  try {
    const parsed = JSON.parse(saved?.value ?? 'null') as PassState | null;
    if (parsed?.version === version) state = parsed;
  } catch {
    /* An unreadable state starts a new pass: settled names are not asked again. */
  }
  const save = () =>
    database
      .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind(passKey(projectId), JSON.stringify(state))
      .run();
  const store = await projectReadDatabase(projectId, workspaceId);
  const common = await commonNamesOf(store);
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  let asked = 0;
  for (let page = 0; page < PAGES_PER_PROJECT && budget.left > 0 && Date.now() <= budget.deadline; ) {
    const { floor } = state;
    // One unit: up to PAGES_PER_UNIT pages, read one after the other (one store read at a time), then asked about together.
    const rows: { id: string; prompt_text: string | null; answer: string | null; created_at: string }[] = [];
    let cursor = state.cursor;
    let end = false;
    for (let read = 0; read < PAGES_PER_UNIT && page < PAGES_PER_PROJECT; read++, page++) {
      const { results } = await store
        .prepare(
          `SELECT id,prompt_text,substr(answer,1,${ANSWER_CHARACTERS}) answer,created_at FROM runs
           WHERE project_id=? AND status='complete' AND response_available=1 AND answer IS NOT NULL AND created_at>=?
           ${floor ? 'AND (created_at>? OR (created_at=? AND id>?))' : ''} ${cursor ? 'AND (created_at<? OR (created_at=? AND id<?))' : ''}
           ORDER BY created_at DESC,id DESC LIMIT ${PAGE_ANSWERS}`,
        )
        .bind(projectId, cutoff, ...(floor ? [floor.at, floor.at, floor.id] : []), ...(cursor ? [cursor.at, cursor.at, cursor.id] : []))
        .all<{ id: string; prompt_text: string | null; answer: string | null; created_at: string }>();
      if (!cursor && results.length) state.top = { at: results[0]!.created_at, id: results[0]!.id };
      rows.push(...results);
      if (results.length < PAGE_ANSWERS) {
        end = true;
        break;
      }
      cursor = { at: results.at(-1)!.created_at, id: results.at(-1)!.id };
    }
    const outcome = rows.length ? await classifyPage(projectId, workspaceId, targets, context, rows, budget, authorization, common) : { complete: true, asked: 0 };
    asked += outcome.asked;
    if (!outcome.complete) break;
    state = end ? { version, top: null, cursor: null, floor: state.top ?? state.floor } : { ...state, cursor };
    if (end) break;
  }
  await save();
  return asked;
}

/**
 * Scheduler step: after an analysis finishes, ask for the roles of its names. A few projects per tick (or only `projectIds`),
 * the least recently looked at first; reading the analysis status starts and repairs nothing. Once per-question
 * roles are authorized, the answers' names are asked per question instead (classifyQuestionRoles).
 */
export async function processBrandRoles(projectIds?: readonly string[]) {
  if (!decisionKeyConfigured()) return 0;
  const database = db();
  // An answer that never came back (the Worker stopped mid-call) is uncertain: it is not resent.
  await markStaleUnknown(ROLE_CONTEXT_PREFIX, ROLE_RESERVE_USD);
  const authorization = await questionRolesAuthorization();
  const due = (
    await database
      .prepare(
        `SELECT p.id id,p.workspace_id workspace_id FROM projects p
         JOIN project_stores s ON s.project_id=p.id AND s.workspace_id=p.workspace_id AND s.initialized=1
         LEFT JOIN system_state c ON c.key='brand-roles-checked:'||p.id
         WHERE p.archived=0 AND COALESCE(c.value,'')<?${projectIds ? ' AND p.id IN (SELECT value FROM json_each(?))' : ''} ORDER BY COALESCE(c.value,'') LIMIT ?`,
      )
      .bind(new Date(Date.now() - CHECK_EVERY_MS).toISOString(), ...(projectIds ? [JSON.stringify(projectIds)] : []), PROJECTS_PER_TICK)
      .all<{ id: string; workspace_id: string }>()
  ).results;
  let asked = 0;
  const deadline = Date.now() + TICK_BUDGET_MS;
  for (const item of due) {
    if (asked >= REQUESTS_PER_TICK || Date.now() > deadline) break;
    // Marked first: a project that fails or is slow does not starve the others.
    await database
      .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind(checkedKey(item.id), now())
      .run();
    // The roles settled so far decide which discoveries share of voice and position count.
    await syncCountedBrands(item.id, item.workspace_id).catch(() => {});
    // The mentions of common-word brands the text alone could not settle (brand-mention-checks.ts).
    try {
      asked += await checkMentions(item.id, item.workspace_id, { left: REQUESTS_PER_TICK - asked, deadline });
    } catch (error) {
      console.warn(`Brand mentions: ${error instanceof Error ? error.message : 'failed'}.`);
    }
    if (authorization) {
      try {
        const project = await ownedProject(item.id, item.workspace_id);
        const targets = buildTargetSnapshot(project) as DiscoverySeed[];
        // Every monitored brand: a product of the tenth one (ThinkPad for Lenovo) is judged against it too.
        const context = { brands: targets.map((target) => String(target.name)), category: typeof project.category === 'string' ? project.category : '' };
        const budget = { left: REQUESTS_PER_TICK - asked, deadline };
        asked += await classifyQuestionRoles(item.id, item.workspace_id, targets, context, budget, authorization);
      } catch (error) {
        // A busy store or an unreadable project waits for a later tick; the other projects go on.
        console.warn(`Brand roles per question: ${error instanceof Error ? error.message : 'failed'}.`);
        continue;
      }
      if (asked >= REQUESTS_PER_TICK || Date.now() > deadline) continue;
    }
    let status: CompetitorAnalysisStatus | null = null;
    let known: Map<string, unknown>;
    try {
      known = await decidedRoles(item.id, { current: true });
      // Only names no answer settled yet, most mentioned first.
      status = await competitorAnalysisStatus(item.id, item.workspace_id, undefined, [...known.keys()]);
    } catch {
      continue;
    }
    if (status.status !== 'complete' || status.publicationPending) continue;
    const project = await ownedProject(item.id, item.workspace_id);
    let competitors: { name?: string }[] = [];
    try {
      competitors = JSON.parse(String(project.competitors_json ?? '[]'));
    } catch {
      /* A project row that cannot be read asks with its own name only. */
    }
    const context = {
      brands: [String(project.name), ...competitors.map((target) => String(target.name))],
      category: typeof project.category === 'string' ? project.category : '',
    };
    // One request after another while they are answered: a failure (a 402 without credits, a timeout) or a held
    // request stops this project until a later tick, and the names wait in review meanwhile.
    // Per question, only names an answer presents as an item or a company are asked. A name the analysis lists from
    // running text only (score below 1: never structured) still gets the per-name verdict, or it would wait in review
    // for good ("Synthetic", "Alternatives" opening sentences; also a real "Orbit is another option").
    const suggestions = (status.suggestions as Suggestion[]).filter((suggestion) => !authorization || (suggestion.score ?? 1) < 1);
    // The names without an answer, ROLE_MAX_CANDIDATES per request, ROLE_CONCURRENCY requests at a time (each skips names
    // another request holds); a request that is not answered stops the project, what is in flight finishes.
    const unknown = suggestions.filter((suggestion) => !known.has(roleKey(suggestion)));
    const chunks = Array.from({ length: Math.ceil(unknown.length / ROLE_MAX_CANDIDATES) }, (_, index) => unknown.slice(index * ROLE_MAX_CANDIDATES, (index + 1) * ROLE_MAX_CANDIDATES));
    await inPool(chunks, concurrency(), async (chunk) => {
      if (asked >= REQUESTS_PER_TICK || Date.now() > deadline) return false;
      asked++;
      const outcome = await classifyBrandRoles(item.id, item.workspace_id, context, chunk, known);
      if (outcome !== 'answered' && outcome !== 'failed') asked--;
      return outcome === 'answered' || outcome === 'nothing';
    });
  }
  return asked;
}
