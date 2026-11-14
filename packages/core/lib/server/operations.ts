import { OPERATIONS_LEASE, withLease } from './leases';
export { runOperations, OPERATIONS_DEADLINE_MS } from './run-operations';
import { startRunners, RUNNER_PROJECTS_PER_TICK } from './project-runners';
import { applyProjectSentiment, sentimentRunnerProjects } from './project-evaluations';
import { applyAutoClassification } from './source-classification';
import { processProjectOperations } from './capabilities';
import { db, now } from './env';

/**
 * Project operations (automatic evaluations, estimates, one-off source operations) run in their own scheduled invocation, apart
 * from `tick` (./monitor): a CPU limit hit there ends only that invocation (a catch cannot stop it), so the monitoring tick never waits for, shares a CPU
 * budget with, or dies of an operation. They hold their own lease, so two of them never overlap and none ever holds the monitoring tick's.
 * Each invocation that ran writes `operations_heartbeat` and the names of the operations that failed (`operations_failed_steps`),
 * which /api/health reports (`operations_stale` once the heartbeat is old).
 */
export async function operations() {
  const result = await withLease(OPERATIONS_LEASE.key, OPERATIONS_LEASE.ms, async () => {
    let outcome: { total: number; failed: string[] };
    try {
      outcome = await processProjectOperations();
    } catch (error) {
      console.error('Project operation could not be processed.', error instanceof Error ? error.message : String(error));
      outcome = { total: 0, failed: ['operations'] };
    }
    const upsert = 'INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value';
    try {
      await db().batch([db().prepare(upsert).bind('operations_heartbeat', now()), db().prepare(upsert).bind('operations_failed_steps', JSON.stringify(outcome.failed))]);
    } catch {
      // Best effort: health then says the operations look stale, which is the truth.
    }
    return outcome.total;
  });
  return { ok: true, operations: result ?? { skipped: 'already_running' } };
}

/**
 * The evaluations every edition runs (automatic sentiment and source types of the projects on automatic evaluations, each inside
 * its budget): with the project runners each project's sentiment, and the source types, run in invocations of their own; inline
 * without them (the independent edition, previews).
 */
export const evaluationOperations = (): [string, () => Promise<number>][] => [
  ['project-sentiment', async () => (await startRunners('sentiment', await sentimentRunnerProjects(RUNNER_PROJECTS_PER_TICK))) ?? applyProjectSentiment()],
  ['auto-classification', async () => ((await startRunners('sources', ['all'])) === null ? applyAutoClassification() : 0)],
];
