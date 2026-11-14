import { DurableObject } from 'cloudflare:workers';
import { setting } from '../lib/server/env';
import { loadPlatformSettings } from '../lib/server/platform-settings';
import { runProjectStep, type Pipeline, type StepResult } from '../lib/server/project-runners';
import { submitQueued } from '../lib/server/monitor';
import { d1Overloaded } from '../lib/server/leases';

/**
 * A busy step (a store restarting, a lease held elsewhere, D1 overloaded) is tried again this much later (and up to half again
 * at random, so the runners that met it together come back apart), up to BUSY_RETRIES times in a row.
 */
const BUSY_DELAY_MS = 30_000;
const BUSY_RETRIES = 10;
/** Steps one start may chain; the next scheduler tick starts it again if work is left. */
const MAX_STEPS = 500;

type Job = { pipeline: Pipeline; projectId: string; steps: number; busy: number };

/**
 * One pipeline of one project (`<pipeline>:<project>`, ../lib/server/project-runners.ts): each alarm is an invocation of its own
 * (six outbound connections, its own CPU, up to 15 minutes) that runs one bounded step, and sets the next alarm while the
 * step did work. It keeps nothing but its job; leases and ceilings live in D1, as for every other caller of the steps.
 */
export class ProjectRunner extends DurableObject<Record<string, unknown>> {
  /** Starts this runner's chain unless one is already under way: its first step runs `delayMs` later (the scheduler's spacing), in an alarm of its own. */
  async start(pipeline: Pipeline, projectId: string, delayMs = 0) {
    if ((await this.ctx.storage.getAlarm()) !== null) return;
    await this.ctx.storage.put('job', { pipeline, projectId, steps: 0, busy: 0 } satisfies Job);
    await this.ctx.storage.setAlarm(Date.now() + Math.max(0, delayMs));
  }

  async alarm() {
    const job = await this.ctx.storage.get<Job>('job');
    if (!job || setting('MAINTENANCE_MODE') === 'true') return;
    let result: StepResult = { done: 0, busy: false };
    try {
      await loadPlatformSettings();
      // The first step after a start keeps the scheduler's spacing; the ones it chains go on at once.
      // A Perplexity runner sends its share of the collection's Live calls: the scheduler's own submission, scoped.
      result = job.pipeline === 'perplexity'
        ? { done: await submitQueued(undefined, undefined, undefined, Number(job.projectId)), busy: false }
        : await runProjectStep(job.pipeline, job.projectId, job.steps > 0);
    } catch (error) {
      // D1 refused (its queue full): nothing ran, so the step waits like a busy one instead of ending the chain.
      if (d1Overloaded(error)) {
        console.warn(`Project runner ${job.pipeline} step waits: D1 is overloaded.`);
        result = { done: 0, busy: true };
      } else console.error(`Project runner ${job.pipeline} step failed (${error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : 'unknown'}).`);
    }
    const next: Job = { ...job, steps: job.steps + 1, busy: result.busy ? job.busy + 1 : 0 };
    await this.ctx.storage.put('job', next);
    if (result.done > 0 && next.steps < MAX_STEPS) await this.ctx.storage.setAlarm(Date.now());
    else if (result.busy && next.busy <= BUSY_RETRIES) await this.ctx.storage.setAlarm(Date.now() + BUSY_DELAY_MS * (1 + Math.random() / 2));
  }
}
