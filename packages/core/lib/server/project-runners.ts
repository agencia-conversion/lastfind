import { env } from 'cloudflare:workers';
import { db } from './env';
import { withLease } from './leases';
import { processBrandRoles } from './brand-role-jobs';
import { processBrandDomains } from './brand-domain-discovery';
import { processFanoutIntents } from './fanout-intents';
import { projectStep } from './capabilities';
import { syncProjectStore } from './project-store';
import { RUNNER_SEND_BUDGET_MS, SEND_TIMEOUT_MS, semanticPanelStep } from './semantic-panel-worker';
import { COMPARISON_RUNNER_MS, comparisonStep } from './comparison-worker';

/**
 * The decision-model pipelines of each project run in invocations of their own. Cloudflare lets one invocation hold six
 * outbound connections at once (and a service binding shares its caller's), but every Durable Object request or alarm has its
 * own six, its own CPU and up to 15 minutes. So the scheduler only starts one `ProjectRunner` per pipeline and project (named
 * `<pipeline>:<project>`, worker/project-runner.ts); its alarm runs one bounded step (the same steps the preview runner calls), and the next alarm the
 * next step while the last one did work. The steps keep every lease and ceiling: each reservation is still a guarded INSERT.
 * Without the binding (the independent edition, previews) the scheduler runs the steps inline, as before.
 * The Semantic Branding queries of each project (`panel:<project>`) and the Perplexity Live calls of the collection
 * (`perplexity:<shard>`, PERPLEXITY_RUNNERS of them) leave the scheduler's tick the same way.
 * The agent's curator (`learn:<project>`, agent-curator.ts), started by the scheduler and by a 👎 or a comment.
 */
export type Pipeline = 'publish' | 'sentiment' | 'sources' | 'roles' | 'domains' | 'intents' | 'panel' | 'comparison' | 'perplexity' | 'learn';
export type StepResult = { done: number; busy: boolean };
/** Projects one scheduler tick hands to their runners for a pipeline (publication, roles, domains). */
export const RUNNER_PROJECTS_PER_TICK = 50;
/** One step of a project's roles or domains at a time, whoever calls it (a runner, a preview step). */
const STEP_LEASE_MS = 300_000;
/** A Semantic Branding step sends for up to 4 minutes and waits for its last sends (cut at 40 s), inside the 15 of an alarm. */
const PANEL_LEASE_MS = RUNNER_SEND_BUDGET_MS + SEND_TIMEOUT_MS + 60_000;
/** A Comparison step sends the same way (its runs on the provider's queue, then their readings). */
const COMPARISON_LEASE_MS = COMPARISON_RUNNER_MS + SEND_TIMEOUT_MS + 60_000;

/** When each project was last looked at, per pipeline (the step's own `system_state` key). */
const CHECKED = { roles: 'brand-roles-checked:', domains: 'brand-domains-checked:', intents: 'fanout-intents-checked:' };
const checkedKey = (pipeline: keyof typeof CHECKED, projectId: string) => `${CHECKED[pipeline]}${projectId}`;
const steps = { roles: processBrandRoles, domains: processBrandDomains, intents: processFanoutIntents };

/**
 * One bounded step of a pipeline for one project (sources: every automatic project; its state is shared). `forced`: a
 * continuation, so roles and domains do not wait the scheduler's few minutes between looks at the project.
 */
export async function runProjectStep(pipeline: Pipeline, projectId: string, forced = true): Promise<StepResult> {
  // New answers reach the project's store 100 rows a step (one publisher at a time: its lease), until it is caught up.
  if (pipeline === 'publish') {
    const store = await db().prepare('SELECT workspace_id FROM project_stores WHERE project_id=?').bind(projectId).first<{ workspace_id: string }>();
    if (!store) return { done: 0, busy: false };
    try {
      const result = await syncProjectStore(projectId, store.workspace_id, 100);
      return { done: !result.done && result.published > 0 ? result.published : 0, busy: false };
    } catch (error) {
      // Another publisher holds the project (409) or its store is restarting (503): a little later.
      const status = (error as { status?: unknown } | null)?.status;
      if (status === 409 || status === 503) return { done: 0, busy: true };
      throw error;
    }
  }
  // Its claims keep a query from leaving twice; the lease only keeps a project's lanes to six. (Perplexity's step is the
  // scheduler's own submission, called by the runner itself: worker/project-runner.ts.)
  if (pipeline === 'panel') {
    const done = await withLease(`panel:${projectId}`, PANEL_LEASE_MS, () => semanticPanelStep(projectId));
    return { done: done ?? 0, busy: done === null };
  }
  if (pipeline === 'comparison') {
    const done = await withLease(`comparison:${projectId}`, COMPARISON_LEASE_MS, () => comparisonStep(projectId));
    return { done: done ?? 0, busy: done === null };
  }
  // One curator step per project at a time (the scheduler's start and a rating's may meet).
  if (pipeline === 'learn') {
    const step = learning?.step;
    if (!step) return { done: 0, busy: false };
    const done = await withLease(`learn:${projectId}`, STEP_LEASE_MS, () => step([projectId]));
    return { done: done ?? 0, busy: done === null };
  }
  if (pipeline === 'roles' || pipeline === 'domains' || pipeline === 'intents') {
    const done = await withLease(`${pipeline}:${projectId}`, STEP_LEASE_MS, async () => {
      if (forced) await db().prepare('DELETE FROM system_state WHERE key=?').bind(checkedKey(pipeline, projectId)).run();
      return steps[pipeline]([projectId]);
    });
    return { done: done ?? 0, busy: done === null };
  }
  return (await projectStep(pipeline, projectId)) ?? { done: 0, busy: false };
}

/**
 * The agent's curator (agent-curator.ts): the projects with a conversation to read and one step of theirs, set by the Worker
 * (worker/index.ts, as the project store's restore driver is), so the agent's modules stay out of the scheduler's.
 */
type Learning = { projects: () => Promise<string[]>; step: (projectIds: readonly string[]) => Promise<number> };
let learning: Learning | undefined;
export const setLearning = (value: Learning) => {
  learning = value;
};
/** The scheduler's learning step: each project to its runner; inline (no runners) three projects a tick, after everything else. */
export async function startLearning() {
  if (!learning) return 0;
  const ids = await learning.projects();
  return (await startRunners('learn', ids)) ?? learning.step(ids.slice(0, 3));
}

type Runner = { start(pipeline: Pipeline, projectId: string, delayMs?: number): Promise<void> };
const runners = () => (env as unknown as { PROJECT_RUNNERS?: DurableObjectNamespace }).PROJECT_RUNNERS;

/**
 * When, after the tick hands them over, the runners' first steps run. All at once (every pipeline of every project in the
 * same second) they queued on the one D1 until it refused with "overloaded" (6/11/2026): now each pipeline starts at its
 * own offset and its projects RUNNER_SPACING_MS apart, wrapped inside RUNNER_WINDOW_MS (under the operations tick, 2 minutes later).
 * Perplexity's runners send the collection's Live calls and keep no offset.
 */
const RUNNER_OFFSET_MS: Record<Pipeline, number> = { perplexity: 0, publish: 0, sentiment: 0, sources: 0, panel: 5_000, comparison: 7_000, roles: 10_000, domains: 15_000, intents: 20_000, learn: 25_000 };
export const RUNNER_SPACING_MS = 3_000;
export const RUNNER_WINDOW_MS = 110_000;
export const runnerDelay = (pipeline: Pipeline, index: number) => (RUNNER_OFFSET_MS[pipeline] + index * RUNNER_SPACING_MS) % RUNNER_WINDOW_MS;

/** Starts the runners of these projects for one pipeline, spaced (runnerDelay); null without the binding, so the caller runs the step inline. */
export async function startRunners(pipeline: Pipeline, projectIds: readonly string[]) {
  const namespace = runners();
  if (!namespace) return null;
  await Promise.all(
    projectIds.map((projectId, index) =>
      (namespace.get(namespace.idFromName(`${pipeline}:${projectId}`)) as unknown as Runner).start(pipeline, projectId, runnerDelay(pipeline, index)),
    ),
  );
  return projectIds.length;
}

/**
 * The scheduler's publication, roles, domains or intents step, each project to its runner: publication for the stores behind
 * (as flushProjectStores picks them), the others for the projects with a store, the least recently looked at first.
 * Null without the binding.
 */
export async function startProjectRunners(pipeline: 'publish' | 'roles' | 'domains' | 'intents') {
  if (!runners()) return null;
  const { results } = await (pipeline === 'publish'
    ? db()
        .prepare('SELECT project_id id FROM project_stores WHERE initialized=0 OR source_revision!=applied_revision ORDER BY updated_at LIMIT ?')
        .bind(RUNNER_PROJECTS_PER_TICK)
    : db()
        .prepare(
          `SELECT p.id FROM projects p JOIN project_stores s ON s.project_id=p.id AND s.workspace_id=p.workspace_id AND s.initialized=1
           LEFT JOIN system_state c ON c.key=?||p.id WHERE p.archived=0 ORDER BY COALESCE(c.value,'') LIMIT ?`,
        )
        .bind(CHECKED[pipeline], RUNNER_PROJECTS_PER_TICK)
  ).all<{ id: string }>();
  return startRunners(pipeline, results.map((row) => row.id));
}
