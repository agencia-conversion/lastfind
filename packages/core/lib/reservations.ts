export const USAGE_CREDITS_SQL = `MAX(budget_credits, CAST(cost / 0.0012 + 0.99999999 AS INTEGER))`;
/**
 * A definitive failure settles at what the provider charged: a run it refused outright, or one never sent, holds
 * nothing (0 credits), so the platform's totals drop its reserve and the customer gets the credit back. `cost` is the row's
 * own column (an UPDATE reads the old value), so callers that set the cost in the same statement bind it instead.
 */
export const SETTLE_FAILED_SQL = 'budget_credits=CAST(cost/0.0012+0.99999999 AS INTEGER)';
/** The platform's daily run brake (Admin > Usage and costs), else the Worker's `GLOBAL_DAILY_RUN_LIMIT` (bound). */
export const DAILY_RUNS_LIMIT_SQL = "COALESCE((SELECT json_extract(value,'$.dailyRuns') FROM system_state WHERE key='platform_limits'),?)";
/**
 * The Worker's daily run default (`GLOBAL_DAILY_RUN_LIMIT`), or null for none: since 8/11/2026 no edition sets one by
 * default, so it never blocks every customer at once; an admin may still set one in Admin > Usage and costs.
 */
export const dailyRunDefault = (value: string) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
/**
 * One project's reservation in one statement (the claim's pattern): the prompts as a JSON list
 * (`[{id,prompt,text,engine,token,credits}]`, in order), each checked for being due and having nothing in flight, then numbered
 * with their running credit total `j.total`, so the plan's run counts and every budget see the runs before them in the same
 * statement. The account's and the platform's sums are uncorrelated: SQLite reads them once, not once per prompt.
 * `budgetCondition` is SQL over `j.total` (credits). Binds: owner, project, request key, targets, location, language, created_at,
 * the JSON, the due time, then owner, month, monthly runs, day, the daily run default, free (0/1), owner, week, then the budget's.
 */
export function reservationSql(budgetCondition: string) {
  return `INSERT OR IGNORE INTO runs (id,workspace_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,status,callback_token,created_at,budget_credits)
    SELECT j.id,?,?,j.prompt,?,j.text,j.engine,?,?,?,'queued',j.token,?,j.credits FROM (
      SELECT e.*,SUM(e.credits) OVER (ORDER BY e.n) total,ROW_NUMBER() OVER (ORDER BY e.n) k FROM (
        SELECT key n,json_extract(value,'$.id') id,json_extract(value,'$.prompt') prompt,json_extract(value,'$.text') text,json_extract(value,'$.engine') engine,
          json_extract(value,'$.token') token,json_extract(value,'$.credits') credits FROM json_each(?)) e
      WHERE NOT EXISTS(SELECT 1 FROM runs WHERE prompt_id=e.prompt AND status IN ('queued','submitting','pending'))
      AND EXISTS(SELECT 1 FROM prompts JOIN projects ON projects.id=prompts.project_id WHERE prompts.id=e.prompt AND ${DUE_SQL} AND prompts.next_run_at<=?)) j
    WHERE (SELECT COUNT(*) FROM runs WHERE workspace_id=? AND created_at>=?)+j.k<=?
    AND (SELECT COUNT(*) FROM runs WHERE created_at>=?)+j.k<=${DAILY_RUNS_LIMIT_SQL}
    AND (?=0 OR (SELECT COUNT(*) FROM runs WHERE workspace_id=? AND created_at>=?)+j.k<=10)
    AND (${budgetCondition})`;
}
/** A prompt the scheduler can collect (the due query and the reservation read the same predicate), joined to its project. */
export const DUE_SQL = 'prompts.active=1 AND prompts.archived=0 AND prompts.subscribed=1 AND projects.archived=0 AND projects.daily_enabled=1';
/**
 * The claim of queued runs for sending (lib/server/monitor.ts), many runs of one project in one statement (their ids as a JSON
 * list). The budget condition reads only the account's and the platform's totals, which a claim does not move, so SQLite
 * computes it once per statement instead of once per run. Binds: claimed_at, claim token, ids JSON, then the budget's own.
 */
export const claimSql = (budgetCondition: string) =>
  `UPDATE runs SET status='submitting',claimed_at=?,error=? WHERE id IN (SELECT value FROM json_each(?)) AND status='queued' AND (${budgetCondition})`;
/** A finished task's result stays with DataForSEO for three days: an unknown run older than this cannot be recovered. */
export const RECONCILE_WINDOW_MS = 3 * 86_400_000;
