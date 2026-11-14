// The agent's curator (both editions): after a conversation ends, or as soon as the person rates an answer 👎 or comments
// on one, a model reads the conversation (the person's words, the assistant's text cut short, tools by name only) with
// the project's Brain, Memory and the skills it used, and keeps what the team taught it: one place per lesson (a Brain
// file, the Memory or the skill), through the same functions and checks as the agent's own tools, every change a version
// that can be restored (a skill change learned from a conversation that read third-party content waits for a person).
// It also names the conversation's class of task; when the same class was done well in three conversations (by two
// people or on two days) with no skill used, the skill curator makes one call to learn a skill from them (curateSkills).
// Each run is a `brand_research_jobs` row reserved before it is sent (the Brain wizard's pattern, brain-wizard.ts), under
// the project's optional monthly limit (Settings > Agent; no limit by default, 0 turns learning off), two runaway fuses
// (50 runs a day per project, the most one run may hold) and, in Cloud, the platform's research budget. Admin turns it
// all off.
import { env } from 'cloudflare:workers';
import { getAgentByName } from 'agents';
import { resolveActor } from '@edition/server/identity';
import { AGENT_MODEL } from '@/lib/agent';
import { openRouterReserve } from '@/lib/semantic-panel-provider';
import {
  CURATION_RESERVE_MAX_USD,
  CURATION_RUNS_PER_DAY,
  CURATOR_CONTEXT,
  SKILL_CLUSTER_DAYS,
  SKILL_CLUSTER_DIGESTS,
  SKILL_CLUSTER_DIGEST_MAX,
  SKILL_CLUSTER_MIN,
  SKILL_CONTEXT,
  SKILL_KIND_RETRY_DAYS,
  SKILL_KINDS_MAX,
  curationDigest,
  curationRequest,
  parseCuration,
  parseSkillOps,
  readThirdParty,
  skillRequest,
  type CurationOp,
} from '@/lib/agent-learning';
import { db, now, setting } from './env';
import { agentBudgetCondition } from './capabilities';
import { LEARNING_JOBS_SQL } from '@/lib/agent-spend';
import { ApiError } from './http';
import { roleAtLeast, type Actor } from './auth';
import { ownedProject } from './workspace';
import { classifierModels } from './classifier-models';
import { postChat } from './decisions-api';
import { claimDecisionJob, completeDecisionJob, DecisionProviderError, failDecisionJob, hash, markStaleUnknown, requestDecisions } from './decision-jobs';
import { brainFiles, forgetInBrain, rememberInBrain, type Learner } from './agent';
import { learnSkill, patchSkill, retireUnused, revertDegraded, skillLibrary, workspaceSkillBodies } from './agent-skills';
import type { Json } from './mcp-tools';
import { modelKeyConfigured } from './model-routes';

/** Conversations one step reads (each one model call), and how long a conversation rests before it is read. */
const CONVERSATIONS_PER_STEP = 5;
const IDLE_MS = 30 * 60_000;
const REREAD_MS = 60 * 60_000;
/** A conversation of one or two answers is read once a day has passed, for its summary. */
const SHORT_IDLE_MS = 86_400_000;
/** A model call that failed (not billed) is tried again after this, at most three times. */
const RETRY_MS = 30 * 60_000;
const ATTEMPTS_MAX = 3;
const CALL_TIMEOUT_MS = 90_000;
/** The curator's chat call: another family's cheap model of its own when the admin's order sends it there. */
const curatorChat = (payload: unknown, timeoutMs: number) => postChat(payload, timeoutMs, 'agent_curator');
const SKILL_PATCHES_MAX = 2;

const monthStart = () => `${now().slice(0, 7)}-01T00:00:00.000Z`;
const DAY_MS = 86_400_000;
export const learningDisabled = () => setting('AGENT_LEARNING_DISABLED').trim() === 'true';
/** The learning runs of a project's ledger (the curator's and the skill curator's): what its monthly limit counts. */
const LEARNING_JOBS = LEARNING_JOBS_SQL;
/**
 * A learning run's cap: the project's month within its optional limit (no row or NULL: no limit), its day's runs within the
 * fuse, and (8/11/2026) the workspace's AI credits, which the agent's learning spends like its answers.
 */
const learningCap = (projectId: string, workspaceId: string, reserve: number) => {
  const credits = agentBudgetCondition(workspaceId, monthStart(), reserve);
  return {
    sql: `(SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) FROM brand_research_jobs WHERE ${LEARNING_JOBS} AND requested_at>=? AND project_id=?)+?<=COALESCE((SELECT monthly_usd FROM agent_curation_settings WHERE project_id=?),1e12)
    AND (SELECT COUNT(*) FROM brand_research_jobs WHERE project_id=? AND ${LEARNING_JOBS} AND requested_at>=?)<? AND (${credits.sql})`,
    params: [monthStart(), projectId, reserve, projectId, projectId, `${now().slice(0, 10)}T00:00:00.000Z`, CURATION_RUNS_PER_DAY, ...credits.params],
  };
};
/** A conversation the curator has something to read in: newer than its last reading, or rated since. */
const PENDING = `c.deleted_at IS NULL AND c.title<>'' AND (c.updated_at>COALESCE(c.curated_at,'') OR EXISTS(SELECT 1 FROM agent_feedback f WHERE f.conversation_id=c.id AND f.created_at>COALESCE(c.curated_at,'')))`;

/** Projects with a conversation to read (none while learning is off): the scheduler hands them to their runners. */
export async function curationProjects(limit = 50) {
  if (learningDisabled()) return [];
  const { results } = await db()
    .prepare(
      `SELECT c.project_id id FROM agent_conversations c JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id AND p.archived=0
       WHERE ${PENDING} AND NOT EXISTS(SELECT 1 FROM agent_curation_settings s WHERE s.project_id=c.project_id AND s.monthly_usd=0)
       GROUP BY c.project_id ORDER BY MIN(c.updated_at) LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

type Candidate = { id: string; workspace_id: string; account_id: string; email: string; name: string; curated_at: string | null; curated_through: string | null; updated_at: string; feedback: number; turns: number };
/** The conversations ready now: rated since, or three answers since and resting, or short and a day old. */
async function candidates(projectId: string) {
  const { results } = await db()
    .prepare(
      `SELECT c.id,c.workspace_id,c.account_id,a.email,a.name,c.curated_at,c.curated_through,c.updated_at,
       EXISTS(SELECT 1 FROM agent_feedback f WHERE f.conversation_id=c.id AND f.created_at>COALESCE(c.curated_at,'')) feedback,
       (SELECT COUNT(*) FROM agent_turns t WHERE t.conversation_id=c.id AND t.status='done' AND t.started_at>COALESCE(c.curated_at,'')) turns
       FROM agent_conversations c JOIN accounts a ON a.id=c.account_id WHERE c.project_id=? AND ${PENDING} ORDER BY c.updated_at LIMIT 30`,
    )
    .bind(projectId)
    .all<Candidate>();
  const at = Date.now();
  return results
    .filter((row) => {
      if (row.feedback) return true;
      const idle = at - Date.parse(row.updated_at);
      const rested = !row.curated_at || at - Date.parse(row.curated_at) > REREAD_MS;
      return (Number(row.turns) >= 3 && idle > IDLE_MS && rested) || idle > SHORT_IDLE_MS;
    })
    .slice(0, CONVERSATIONS_PER_STEP);
}

/**
 * Marks a conversation read up to `through`, with its summary and its class of task (never its `updated_at`: the list's
 * order and the curator's own wake stay).
 */
const curated = (id: string, through: string | null, summary: string | null = null, task: { kind: string; ok: boolean | null } | null = null) =>
  db()
    .prepare('UPDATE agent_conversations SET summary=COALESCE(?,summary),curated_at=?,curated_through=COALESCE(?,curated_through),task_kind=COALESCE(?,task_kind),task_ok=CASE WHEN ? THEN ? ELSE task_ok END WHERE id=?')
    .bind(summary, now(), through, task?.kind ?? null, task ? 1 : 0, task?.ok === null || !task ? null : task.ok ? 1 : 0, id);

/** The workspace's classes of task so far (60 days, and the ones decided), most used first: the curator reuses one when it fits. */
async function knownKinds(workspaceId: string) {
  const { results } = await db()
    .prepare(
      `SELECT kind FROM (SELECT task_kind kind,COUNT(*) n FROM agent_conversations WHERE workspace_id=? AND task_kind IS NOT NULL AND updated_at>=? GROUP BY task_kind
       UNION ALL SELECT kind,0 n FROM agent_skill_kinds WHERE workspace_id=?) GROUP BY kind ORDER BY MAX(n) DESC,kind LIMIT ?`,
    )
    .bind(workspaceId, new Date(Date.now() - SKILL_CLUSTER_DAYS * DAY_MS).toISOString(), workspaceId, SKILL_KINDS_MAX)
    .all<{ kind: string }>();
  return results.map((row) => row.kind);
}

/**
 * One step of the `learn` pipeline for these projects (project-runners.ts): the guard first (no model call), then up to
 * five conversations each. The number of conversations read, so a runner goes on while there are more.
 */
export async function processAgentCuration(projectIds: readonly string[]) {
  if (learningDisabled() || !modelKeyConfigured()) return 0;
  let done = 0;
  const owners = new Map<string, string[]>();
  for (const projectId of projectIds) {
    const owner = await db().prepare('SELECT workspace_id FROM projects WHERE id=? AND archived=0').bind(projectId).first<{ workspace_id: string }>();
    if (!owner) continue;
    // The guard first, once per workspace (no model call).
    if (!owners.has(owner.workspace_id)) {
      owners.set(owner.workspace_id, await knownKinds(owner.workspace_id));
      await revertDegraded(owner.workspace_id);
      await retireUnused(owner.workspace_id);
    }
    const cap = await db().prepare('SELECT monthly_usd FROM agent_curation_settings WHERE project_id=?').bind(projectId).first<{ monthly_usd: number | null }>();
    if (cap && cap.monthly_usd === 0) continue;
    for (const row of await candidates(projectId)) {
      const outcome = await curateConversation(projectId, row, owners.get(owner.workspace_id) ?? []);
      if (outcome === 'stop') break;
      done++;
    }
  }
  // Then repeated work, once per workspace: usually nothing qualifies, and nothing is called.
  for (const owner of owners.keys()) await curateSkills(owner).catch((error) => console.warn('Skill curator failed:', error instanceof Error ? error.message.slice(0, 160) : 'Unknown error'));
  return done;
}

/** One conversation: `stop` when a cap refused the run (the project waits), else what happened to it. */
async function curateConversation(projectId: string, row: Candidate, kinds: readonly string[]): Promise<'stop' | 'read' | 'skipped' | 'failed'> {
  // Only a member's conversation teaches the agent (a viewer cannot change the Brain, and one who left is no one's).
  const actor = await resolveActor({ id: row.account_id, email: row.email, name: row.name }, row.workspace_id).catch(() => null);
  if (!actor || actor.workspaceId !== row.workspace_id || !roleAtLeast(actor.role, 'member')) {
    await curated(row.id, null).run();
    return 'skipped';
  }
  if (!env.LASTFIND_AGENT) return 'stop';
  const [messages, ratings, project] = await Promise.all([
    (await getAgentByName(env.LASTFIND_AGENT, row.id)).transcript() as Promise<{ id: string; role: string; parts: { type: string; text?: string }[] }[]>,
    db().prepare('SELECT message_id,rating,reason,comment,created_at FROM agent_feedback WHERE conversation_id=?').bind(row.id).all<{ message_id: string; rating: number; reason: string | null; comment: string | null; created_at: string }>(),
    ownedProject(projectId, row.workspace_id),
  ]);
  const last = messages.at(-1)?.id ?? null;
  const digest = curationDigest(messages, { through: row.curated_through, since: row.curated_at, ratings: ratings.results });
  const pt = String(project.language_code ?? '').startsWith('pt');
  // Nothing new from the person, and a summary already kept: nothing to pay for.
  const summarized = await db().prepare('SELECT summary FROM agent_conversations WHERE id=?').bind(row.id).first<{ summary: string | null }>();
  if (!digest.evidence.size && summarized?.summary) {
    await curated(row.id, last).run();
    return 'skipped';
  }
  const files = await brainFiles(row.workspace_id, projectId);
  const skills = await workspaceSkillBodies(row.workspace_id, digest.skills);
  const input = {
    project: String(project.name ?? ''),
    pt,
    digest: digest.text,
    brain: files.filter((file) => !file.memory).map((file) => ({ title: file.title, content: file.content.slice(0, 2_000) })),
    memory: files.find((file) => file.memory)?.content ?? '',
    skills,
    kinds,
  };
  const { model, fallback } = classifierModels('agent_curator', AGENT_MODEL);
  const request = (chosen: string) => curationRequest(chosen, input);
  const reserve = openRouterReserve(request(model), false);
  if (reserve > CURATION_RESERVE_MAX_USD) {
    console.warn('Agent curator: the chosen model costs more than one run may hold; an admin changes it in Admin > Classifiers.');
    return 'stop';
  }
  await markStaleUnknown(CURATOR_CONTEXT, reserve);
  const inputKey = await hash(`${CURATOR_CONTEXT}:${row.id}:${last}:${JSON.stringify(ratings.results)}`);
  // A run whose model call failed three times is given up (the conversation is marked read; its next words wake it again).
  const previous = await db().prepare('SELECT input_json FROM brand_research_jobs WHERE project_id=? AND input_key=?').bind(projectId, inputKey).first<{ input_json: string }>();
  const attempt = (() => {
    try {
      return Number(JSON.parse(previous?.input_json ?? '{}').attempt ?? 0) + 1;
    } catch {
      return 1;
    }
  })();
  if (attempt > ATTEMPTS_MAX) {
    await curated(row.id, last).run();
    return 'skipped';
  }
  const jobId = await claimDecisionJob({
    projectId,
    workspaceId: row.workspace_id,
    contextKey: CURATOR_CONTEXT,
    provider: 'agent-curator',
    model,
    inputKey,
    reserveUsd: reserve,
    inputJson: JSON.stringify({ conversation: row.id, attempt }),
    retryAfterMs: RETRY_MS,
    cap: learningCap(projectId, row.workspace_id, reserve),
  });
  if (!jobId) {
    // This state was read already, or its call may have been billed without an answer (never sent again): it is done.
    const job = await db().prepare('SELECT status FROM brand_research_jobs WHERE project_id=? AND input_key=?').bind(projectId, inputKey).first<{ status: string }>();
    if (job && ['completed', 'unsettled', 'unknown'].includes(job.status)) {
      await curated(row.id, last).run();
      return 'skipped';
    }
    // A cap, or a failed call cooling down: the project waits.
    return 'stop';
  }
  try {
    const result = await requestDecisions(model, fallback, { label: 'Agent curator', post: curatorChat, timeoutMs: CALL_TIMEOUT_MS, payload: request, parse: parseCuration });
    const applied = await applyCuration(row, project, pt, result.operations, digest.evidence, digest.skills, messages, readThirdParty(digest.tools));
    await db().batch([
      completeDecisionJob(jobId, result, JSON.stringify({ applied: applied.applied, refused: [...result.refused, ...applied.refused] }), reserve, now()),
      curated(row.id, last, result.summary, result.task),
    ]);
    return 'read';
  } catch (error) {
    await failDecisionJob(jobId, error, reserve, 'Agent curator');
    // An answer that came back but did not parse, or a call that may have been billed, is not asked again; a call refused
    // before any work is, after RETRY_MS.
    const provider = error instanceof DecisionProviderError ? error : null;
    if (provider && (provider.unknown || (provider.status >= 200 && provider.status < 300))) await curated(row.id, last).run();
    console.warn('Agent curator run failed:', error instanceof Error ? error.message.slice(0, 160) : 'Unknown error');
    return 'failed';
  }
}

/**
 * The curator's operations, each on its own through the agent's own functions (as `curator`, quoting the person message
 * or the rating comment the operation cites). `{ applied, refused }`, with codes: refused ones never show as changes.
 */
export async function applyCuration(
  row: { id: string; workspace_id: string },
  project: Record<string, unknown>,
  pt: boolean,
  operations: readonly CurationOp[],
  evidence: ReadonlyMap<string, string>,
  activated: readonly string[],
  messages: readonly { role: string; parts: readonly { type: string; text?: string }[] }[],
  /** The conversation read third-party content: a skill change waits for a person (a proposal), D10. */
  thirdParty = false,
) {
  const prose = messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.parts.map((part) => (part.type === 'text' ? (part.text ?? '') : '')))
    .join('\n');
  const applied: { op: string; version: number }[] = [];
  const refused: { op: string; code: string }[] = [];
  let patches = 0;
  for (const op of operations) {
    const cited = evidence.get(op.evidence.id);
    const learner: Learner = {
      workspaceId: row.workspace_id,
      projectId: String(project.id),
      project,
      author: 'curator',
      conversationId: row.id,
      pt,
      canWrite: true,
      evidence: cited ? [cited] : [],
      foreign: prose,
    };
    const quote = op.evidence.quote;
    let result: Json;
    if (op.op === 'memory.add') result = await rememberInBrain(learner, { where: 'memory', section: op.section, text: op.text, quote });
    else if (op.op === 'memory.update') result = await rememberInBrain(learner, { where: 'memory', section: op.section, text: op.text, replaces: op.old, quote });
    else if (op.op === 'memory.remove') result = await forgetInBrain(learner, { where: 'memory', section: op.section, text: op.old, quote });
    else if (op.op === 'brain.add') result = await rememberInBrain(learner, { where: 'brain', section: op.file, text: op.text, quote });
    else if (op.op === 'brain.replace') result = await rememberInBrain(learner, { where: 'brain', section: op.file, text: op.text, replaces: op.old, quote });
    else if (patches >= SKILL_PATCHES_MAX) result = { error: { code: 'rate_limited' } };
    else {
      patches++;
      result = await patchSkill(learner, { activated: new Set(activated) }, { name: op.name, old: op.old, new: op.new, why: op.why, quote }, { propose: thirdParty });
    }
    if (result.changed) applied.push({ op: op.op, version: result.changed.version });
    else if (result.proposed) applied.push({ op: `${op.op}:proposed`, version: 0 });
    else refused.push({ op: op.op, code: String(result.error?.code ?? (result.noted ? 'noted' : 'unknown')) });
  }
  return { applied, refused };
}

// ---------------------------------------------------------------- repeated work becomes a skill

type Kind = { kind: string; n: number; people: number; days: number; projects: number };
/**
 * The classes of task that qualify for a skill (SQL only): done well (task_ok, no net 👎) in at least SKILL_CLUSTER_MIN
 * conversations of the last SKILL_CLUSTER_DAYS, by two people or on two days, with no skill used, and not decided before
 * (a class judged not worth a skill is asked again after SKILL_KIND_RETRY_DAYS). The two largest.
 */
export async function skillClusters(workspaceId: string) {
  const since = new Date(Date.now() - SKILL_CLUSTER_DAYS * DAY_MS).toISOString();
  const retry = new Date(Date.now() - SKILL_KIND_RETRY_DAYS * DAY_MS).toISOString();
  const { results } = await db()
    .prepare(
      `SELECT c.task_kind kind,COUNT(*) n,COUNT(DISTINCT c.account_id) people,COUNT(DISTINCT substr(c.updated_at,1,10)) days,COUNT(DISTINCT c.project_id) projects
       FROM agent_conversations c
       WHERE c.workspace_id=? AND c.deleted_at IS NULL AND c.task_kind IS NOT NULL AND c.task_ok=1 AND c.updated_at>=?
       AND NOT EXISTS (SELECT 1 FROM agent_skill_uses u WHERE u.conversation_id=c.id)
       AND COALESCE((SELECT SUM(f.rating) FROM agent_feedback f WHERE f.conversation_id=c.id),0)>=0
       AND NOT EXISTS (SELECT 1 FROM agent_skill_kinds k WHERE k.workspace_id=c.workspace_id AND k.kind=c.task_kind AND (k.skill IS NOT NULL OR k.decided_at>=?))
       GROUP BY c.task_kind HAVING n>=? AND (people>=2 OR days>=2) ORDER BY n DESC,kind LIMIT 2`,
    )
    .bind(workspaceId, since, retry, SKILL_CLUSTER_MIN)
    .all<Kind>();
  return results;
}

/**
 * The skill curator, once per workspace per step: for each class that qualifies, one model call over the newest
 * conversations of it (their digests: the person's words, the assistant's text cut short, tool names only), charged to
 * the project with most of them, under that project's limit and fuses. The same set of conversations is never sent twice
 * (its key), and whatever the answer, the class is recorded (learnSkill).
 */
export async function curateSkills(workspaceId: string) {
  if (learningDisabled() || !modelKeyConfigured() || !env.LASTFIND_AGENT) return 0;
  let learned = 0;
  for (const kind of await skillClusters(workspaceId)) {
    const since = new Date(Date.now() - SKILL_CLUSTER_DAYS * DAY_MS).toISOString();
    const { results: members } = await db()
      .prepare(
        `SELECT c.id,c.project_id FROM agent_conversations c JOIN projects p ON p.id=c.project_id AND p.archived=0 WHERE c.workspace_id=? AND c.task_kind=? AND c.task_ok=1 AND c.deleted_at IS NULL AND c.updated_at>=?
         AND NOT EXISTS (SELECT 1 FROM agent_skill_uses u WHERE u.conversation_id=c.id) ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .bind(workspaceId, kind.kind, since, SKILL_CLUSTER_DIGESTS)
      .all<{ id: string; project_id: string }>();
    if (members.length < SKILL_CLUSTER_MIN) continue;
    // The project with most of them pays (a tie: the smallest id), within its own limit.
    const counts = new Map<string, number>();
    for (const item of members) counts.set(item.project_id, (counts.get(item.project_id) ?? 0) + 1);
    const projectId = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    const cap = await db().prepare('SELECT monthly_usd FROM agent_curation_settings WHERE project_id=?').bind(projectId).first<{ monthly_usd: number | null }>();
    if (cap && cap.monthly_usd === 0) continue;
    const ids = members.map((item) => item.id).sort();
    const inputKey = await hash(`${SKILL_CONTEXT}:${workspaceId}:${kind.kind}:${ids.join(',')}`);
    const done = await db().prepare('SELECT status FROM brand_research_jobs WHERE project_id=? AND input_key=?').bind(projectId, inputKey).first<{ status: string }>();
    if (done && done.status !== 'failed') continue;
    const transcripts = await Promise.all(
      members.map(async (item) => ({ id: item.id, messages: ((await (await getAgentByName(env.LASTFIND_AGENT!, item.id)).transcript()) ?? []) as Parameters<typeof curationDigest>[0] })),
    );
    const digests = transcripts.map((item) => ({ id: item.id, ...curationDigest(item.messages, { max: SKILL_CLUSTER_DIGEST_MAX }) }));
    const text = (role: string) =>
      transcripts.flatMap((item) => item.messages.filter((message) => message.role === role).flatMap((message) => message.parts.map((part) => (part.type === 'text' ? (part.text ?? '') : '')))).join('\n');
    const library = await skillLibrary(workspaceId);
    const pt = String((await db().prepare('SELECT language_code FROM projects WHERE id=?').bind(projectId).first<{ language_code: string | null }>())?.language_code ?? '').startsWith('pt');
    const { model, fallback } = classifierModels('agent_curator', AGENT_MODEL);
    const request = (chosen: string) => skillRequest(chosen, { pt, kind: kind.kind, digests: digests.map((item) => ({ id: item.id, text: item.text })), skills: library.skills, full: library.full });
    const reserve = openRouterReserve(request(model), false);
    if (reserve > CURATION_RESERVE_MAX_USD) {
      console.warn('Skill curator: the chosen model costs more than one run may hold; an admin changes it in Admin > Classifiers.');
      return learned;
    }
    await markStaleUnknown(SKILL_CONTEXT, reserve);
    const jobId = await claimDecisionJob({
      projectId,
      workspaceId,
      contextKey: SKILL_CONTEXT,
      provider: 'agent-curator',
      model,
      inputKey,
      reserveUsd: reserve,
      inputJson: JSON.stringify({ kind: kind.kind, conversations: ids }),
      retryAfterMs: RETRY_MS,
      cap: learningCap(projectId, workspaceId, reserve),
    });
    // Another runner has it, it was sent already, or a limit holds it back: nothing now.
    if (!jobId) continue;
    try {
      const result = await requestDecisions(model, fallback, { label: 'Skill curator', post: curatorChat, timeoutMs: CALL_TIMEOUT_MS, payload: request, parse: (raw) => parseSkillOps(raw, { ids, full: library.full }) });
      const cluster = {
        kind: kind.kind,
        ids,
        conversations: Number(kind.n),
        projects: Number(kind.projects),
        people: Number(kind.people),
        thirdParty: digests.some((item) => readThirdParty(item.tools)),
        personWords: text('user'),
        assistantText: text('assistant'),
      };
      const outcome = await learnSkill(workspaceId, projectId, result.op ?? { op: 'none', why: result.refused ?? '' }, cluster);
      await completeDecisionJob(jobId, result, JSON.stringify({ ...outcome, refused: result.refused }), reserve, now()).run();
      if (outcome.applied) learned++;
    } catch (error) {
      await failDecisionJob(jobId, error, reserve, 'Skill curator');
      console.warn('Skill curator run failed:', error instanceof Error ? error.message.slice(0, 160) : 'Unknown error');
    }
  }
  return learned;
}

// ---------------------------------------------------------------- the monthly limit (Settings > Agent)

/** The project's learning limit this month: `cap` (null: no limit), what it spent, whether this person may change it. */
export async function getCurationBudget(actor: Actor, projectId: unknown) {
  const owned = await ownedProject(String(projectId ?? ''), actor.workspaceId);
  const [row, spent] = await Promise.all([
    db().prepare('SELECT monthly_usd FROM agent_curation_settings WHERE project_id=?').bind(owned.id).first<{ monthly_usd: number | null }>(),
    db()
      .prepare(`SELECT COALESCE(SUM(MAX(cost_usd,reserved_usd)),0) usd FROM brand_research_jobs WHERE project_id=? AND ${LEARNING_JOBS} AND requested_at>=?`)
      .bind(owned.id, monthStart())
      .first<{ usd: number }>(),
  ]);
  return { cap: row?.monthly_usd ?? null, spent: Number(spent?.usd ?? 0), canSet: roleAtLeast(actor.role, 'admin'), disabled: learningDisabled() };
}

/** Sets the project's learning limit (workspace admins): US$ a month (0 turns learning off), or `null` for no limit. */
export async function setCurationBudget(actor: Actor, projectId: unknown, value: unknown) {
  if (!roleAtLeast(actor.role, 'admin')) throw new ApiError(403, 'Your role in this workspace does not allow this action.');
  const owned = await ownedProject(String(projectId ?? ''), actor.workspaceId);
  const cap = value === null || value === '' || value === 'default' ? null : Number(value);
  if (cap !== null && !(Number.isFinite(cap) && cap >= 0 && cap <= 100_000)) throw new ApiError(400, 'Enter an amount in US$, or 0 to turn learning off.');
  if (cap === null) await db().prepare('DELETE FROM agent_curation_settings WHERE project_id=?').bind(owned.id).run();
  else
    await db()
      .prepare(
        `INSERT INTO agent_curation_settings(project_id,workspace_id,monthly_usd,updated_at,updated_by) VALUES(?,?,?,?,?)
         ON CONFLICT(project_id) DO UPDATE SET monthly_usd=excluded.monthly_usd,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
      )
      .bind(owned.id, actor.workspaceId, Math.round(cap * 100) / 100, now(), actor.id)
      .run();
  return getCurationBudget(actor, owned.id);
}
