import type { FailoverReason, ModelProvider } from '@/lib/model-providers';
import { db } from './env';

/**
 * The day's tally (UTC) per model provider and task (`llm_provider_usage`): one row write per call, read only by Admin
 * (Providers, Usage and costs). A failure to write never fails the call (an installation whose migration has not run yet
 * simply has no tally).
 */
export async function recordModelCall(provider: ModelProvider, task: string, model: string, outcome: { cost: number | null } | { failover: FailoverReason; status: number }) {
  const stamp = new Date().toISOString();
  const day = stamp.slice(0, 10);
  try {
    if ('cost' in outcome)
      await db()
        .prepare(
          `INSERT INTO llm_provider_usage(day,provider,task,calls,failovers,cost_usd,unpriced,last_at,last_model) VALUES(?,?,?,1,0,?,?,?,?)
           ON CONFLICT(day,provider,task) DO UPDATE SET calls=calls+1,cost_usd=cost_usd+excluded.cost_usd,unpriced=unpriced+excluded.unpriced,last_at=excluded.last_at,last_model=excluded.last_model`,
        )
        .bind(day, provider, task, outcome.cost ?? 0, outcome.cost === null ? 1 : 0, stamp, model)
        .run();
    else
      await db()
        .prepare(
          `INSERT INTO llm_provider_usage(day,provider,task,calls,failovers,cost_usd,unpriced,last_error,last_error_at) VALUES(?,?,?,0,1,0,0,?,?)
           ON CONFLICT(day,provider,task) DO UPDATE SET failovers=failovers+1,last_error=excluded.last_error,last_error_at=excluded.last_error_at`,
        )
        .bind(day, provider, task, `${outcome.failover} (HTTP ${outcome.status})`, stamp)
        .run();
  } catch (error) {
    console.warn('Lastfind model tally not written:', error instanceof Error ? error.message.slice(0, 120) : 'unknown error');
  }
}
