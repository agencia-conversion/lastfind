// The agent's spend as the other ledgers read it (lib/platform-spend.ts, and the hosted edition's agent credits).
/** What a turn holds: its reserve while it runs, what it cost once it ends. */
export const AGENT_SPENT_SQL = `CASE WHEN status='running' THEN MAX(cost_usd,reserved_usd) ELSE cost_usd END`;
/** The agent's learning runs in brand_research_jobs (the curator's and the skill curator's): AI credits too since 8/11/2026. */
export const LEARNING_JOBS_SQL = `(context_key LIKE 'agent-curator%' OR context_key LIKE 'agent-skills%')`;
/**
 * Closes running turns (the caller adds which) as failed, each reserve counted as spent: what a cut call cost is unknown.
 * Binds `finished_at` first.
 */
export const CLOSE_RUNNING_TURNS_SQL = `UPDATE agent_turns SET status='failed',cost_usd=MAX(cost_usd,reserved_usd),finished_at=? WHERE status='running' AND`;
/**
 * A turn still running after this was cut by a deploy or an eviction and never resumed (a turn is at most AGENT_MAX_STEPS
 * model calls, minutes): the scheduler closes it, so its reserve stops holding the budgets of every later period.
 */
export const ORPHAN_TURN_MS = 2 * 60 * 60_000;
