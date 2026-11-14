// The one place that says what Lastfind spent, for the platform's brake (Admin > Usage and costs)
// and for each project's monthly budget (Settings). Every paid ledger is listed once; each reservation guard, the
// Settings budget and the Admin panel read these same sums, so a screen shows the number the scheduler stops at.
//
// The rule (semantic-panel-spend's, now everywhere): a row counts for the period it was sent in, at the larger of its
// reserve and its real cost; a row still in flight (queued, submitting, pending, running) also counts in every later period
// until it settles. A lost reply (`unknown`) or a cost the provider never reported (`unsettled`) keeps its reserve for its own
// period only: it may have been billed, but it never weighs on later months forever. Each ledger is two disjoint sums ("since
// the period began" and "in flight from before it"), so each reads an index instead of every row.
//
// Pure SQL text: each sum reads the period's start from an SQL expression its caller binds once (`k.ms`, `k.ds`).
import { AGENT_SPENT_SQL } from './agent-spend.ts';
import { DOMAIN_ROW_SPEND_SQL } from './brand-domain.ts';

export type Period = 'month' | 'day';
/** The start of the period on the app's clock (`now()`, the one clock of the scheduler and its tests), as a bound value. */
export const periodStart = (period: Period, at: string) => (period === 'month' ? `${at.slice(0, 7)}-01T00:00:00.000Z` : `${at.slice(0, 10)}T00:00:00.000Z`);

/** The modules a cost belongs to (Admin groups by these; Settings shows the project's). */
export const SPEND_MODULES = ['collection', 'semantic', 'products', 'sentiment', 'sourceTypes', 'roles', 'mentions', 'intents', 'attributes', 'brain', 'learning', 'domains', 'agent', 'setup', 'comparison', 'legacy'] as const;
export type SpendModule = (typeof SPEND_MODULES)[number];

type Ledger = {
  table: string;
  /** When the row was sent (the period it counts for). */
  at: string;
  /** What one row spends or holds, in US$. */
  spend: string;
  /** Still in flight: counts in every period until it settles. */
  inFlight: string;
  /** The project a row's spend belongs to, as `(column)=<project>`; domain lookups split one row between two projects. */
  project: (ref: string) => { where: string; spend?: string };
  /** The module, as SQL over the row (or a constant). */
  module: string;
  /** What the provider reported (the rest of `spend` is held: a reserve still open, or kept for a lost reply). */
  real: string;
  /** The AI or model a row paid for (Admin's "by AI engine"). */
  engine: string;
  /** The project Admin attributes a row to. */
  projectOf: string;
};

// What a brand_research_jobs row is for, by its ledger context (each paid job names one; see each module's *_CONTEXT).
export const RESEARCH_MODULE_SQL = `CASE
  WHEN context_key LIKE 'source-types%' THEN 'sourceTypes'
  WHEN context_key LIKE 'brand-roles:%' THEN 'roles'
  WHEN context_key LIKE 'brand-mentions:%' THEN 'mentions'
  WHEN context_key LIKE 'fanout-intents:%' THEN 'intents'
  WHEN context_key LIKE 'semantic-attributes:%' THEN 'attributes'
  WHEN context_key LIKE 'comparison-setup:%' THEN 'attributes'
  WHEN context_key LIKE 'brain-wizard:%' THEN 'brain'
  WHEN context_key LIKE 'agent-curator:%' THEN 'learning'
  WHEN context_key LIKE 'agent-skills:%' THEN 'learning'
  ELSE 'sentiment' END`;

/** The same mapping in TypeScript, for a job about to be reserved. */
export function moduleOfContext(contextKey: string): SpendModule {
  const prefixes: [string, SpendModule][] = [['source-types', 'sourceTypes'], ['brand-roles:', 'roles'], ['brand-mentions:', 'mentions'], ['fanout-intents:', 'intents'], ['semantic-attributes:', 'attributes'], ['comparison-setup:', 'attributes'], ['brain-wizard:', 'brain'], ['agent-curator:', 'learning'], ['agent-skills:', 'learning']];
  return prefixes.find(([prefix]) => contextKey.startsWith(prefix))?.[1] ?? 'sentiment';
}

/**
 * How many jobs of a module the workspace asked this month (8/11/2026: a plan's monthly count is the workspace's): every project of
 * the owner, archived ones too, a cancelled job aside. Binds: owner, month start, module.
 */
export const WORKSPACE_JOBS_SQL = `SELECT COUNT(*) FROM brand_research_jobs WHERE project_id IN (SELECT id FROM projects WHERE workspace_id=?) AND requested_at>=? AND status<>'cancelled' AND (${RESEARCH_MODULE_SQL})=?`;

const PANEL_IN_FLIGHT = "status IN ('pending','submitting','submitted')";
export const LEDGERS: Ledger[] = [
  { table: 'runs', at: 'created_at', spend: 'MAX(cost,budget_credits*0.0012)', real: 'cost', engine: 'engine', projectOf: 'project_id', inFlight: "status IN ('queued','submitting','pending')", project: (ref) => ({ where: `project_id=${ref}` }), module: "'collection'" },
  { table: 'semantic_panel_queries', at: 'COALESCE(started_at,requested_at)', spend: 'MAX(cost_usd,reserved_usd)', real: 'cost_usd', engine: 'engine', projectOf: 'project_id', inFlight: PANEL_IN_FLIGHT, project: (ref) => ({ where: `project_id=${ref}` }), module: "'semantic'" },
  { table: 'comparison_queries', at: 'COALESCE(started_at,requested_at)', spend: 'MAX(cost_usd,reserved_usd)', real: 'cost_usd', engine: 'engine', projectOf: 'project_id', inFlight: PANEL_IN_FLIGHT, project: (ref) => ({ where: `project_id=${ref}` }), module: "'products'" },
  // Comparison (12/11/2026): each question and its reading (lib/server/comparison-worker.ts).
  { table: 'comparison_runs', at: 'COALESCE(started_at,requested_at)', spend: 'MAX(cost_usd,reserved_usd)', real: 'cost_usd', engine: 'engine', projectOf: 'project_id', inFlight: PANEL_IN_FLIGHT, project: (ref) => ({ where: `project_id=${ref}` }), module: "'comparison'" },
  { table: 'brand_research_jobs', at: 'requested_at', spend: 'MAX(cost_usd,reserved_usd)', real: 'cost_usd', engine: 'model', projectOf: 'project_id', inFlight: "status IN ('pending','submitting')", project: (ref) => ({ where: `project_id=${ref}` }), module: RESEARCH_MODULE_SQL },
  {
    table: 'brand_domain_lookups',
    at: 'spent_at',
    spend: DOMAIN_ROW_SPEND_SQL,
    real: 'search_cost_usd+decision_cost_usd',
    engine: "'google'",
    projectOf: 'COALESCE(paid_project_id,project_id)',
    inFlight: "(search_status='submitting' OR decision_status='submitting')",
    // The search is the project's that paid it; the decision the one that asked it (brand-domain.ts DOMAIN_PROJECT_SPEND_SQL).
    project: (ref) => ({
      where: `(paid_project_id=${ref} OR decision_project_id=${ref})`,
      spend: `CASE WHEN paid_project_id=${ref} THEN search_cost_usd+search_reserved_usd ELSE 0 END+CASE WHEN COALESCE(decision_project_id,paid_project_id)=${ref} THEN decision_cost_usd+decision_reserved_usd ELSE 0 END`,
    }),
    module: "'domains'",
  },
  // The New project wizard's AI suggestions (lib/server/new-project-ai.ts): the workspace's, before any project exists, so no
  // project's budget holds them; the platform's brake, the workspace's monthly cap and (Cloud) its AI credits do. A project's sum
  // matches no row (`id IS NULL` is answered by the primary key, without reading the table).
  { table: 'wizard_jobs', at: 'requested_at', spend: 'MAX(cost_usd,reserved_usd)', real: 'cost_usd', engine: 'model', projectOf: "''", inFlight: "status='submitting'", project: () => ({ where: 'id IS NULL' }), module: "'setup'" },
  { table: 'agent_turns', at: 'started_at', spend: AGENT_SPENT_SQL, real: 'cost_usd', engine: 'model', projectOf: 'project_id', inFlight: "status='running'", project: (ref) => ({ where: `project_id=${ref}` }), module: "'agent'" },
  // The old Semantic evaluator (removed since): its rows stay, and an unsettled one still counts.
  { table: 'semantic_jobs', at: 'requested_at', spend: 'MAX(cost_usd,reserved_usd)', real: 'cost_usd', engine: "'legacy'", projectOf: 'project_id', inFlight: "status IN ('pending','submitting','submitted')", project: (ref) => ({ where: `project_id=${ref}` }), module: "'legacy'" },
];

function ledgerSum(ledger: Ledger, since: string, project?: string) {
  const scoped = project ? ledger.project(project) : null;
  const spend = scoped?.spend ?? ledger.spend;
  const where = scoped ? ` AND ${scoped.where}` : '';
  return `(SELECT COALESCE(SUM(${spend}),0) FROM ${ledger.table} WHERE ${ledger.at}>=${since}${where})
    +(SELECT COALESCE(SUM(${spend}),0) FROM ${ledger.table} WHERE ${ledger.inFlight} AND COALESCE(${ledger.at},'')<${since}${where})`;
}

/** Everything Lastfind spent or holds since `since` (an SQL expression: the period's start), every project and ledger together. */
export const platformSpendSql = (since: string) => `(${LEDGERS.map((ledger) => ledgerSum(ledger, since)).join('\n  +')})`;

/** What one project spent or holds since `since`; `project` and `since` are SQL expressions (columns, or a subquery's aliases). */
export const projectSpendSql = (project: string, since: string) => `(${LEDGERS.map((ledger) => ledgerSum(ledger, since, project)).join('\n  +')})`;

/** Why a project could not reserve, one record per project in system_state: `budget_blocked:<project>`. */
export const BLOCKED_PREFIX = 'budget_blocked:';
/** A block older than this no longer shows (the work it held has had time to go through, or the record was refreshed). */
export const BLOCKED_FRESH_MS = 6 * 3600_000;

/** Admin > Platform limits: the ops brake, a JSON object in system_state. A missing key is the edition's default. */
export const PLATFORM_LIMITS_KEY = 'platform_limits';
export type PlatformLimits = { monthUsd: number | null; dayUsd: number | null };
const literal = (value: number | null) => (value === null ? 'NULL' : String(Number(value)));
const limitSql = (key: keyof PlatformLimits, fallback: number | null) =>
  `COALESCE((SELECT json_extract(value,'$.${key}') FROM system_state WHERE key='${PLATFORM_LIMITS_KEY}'),${literal(fallback)})`;

/**
 * How much the platform's brake still lets through (US$, SQL): the least of this month's and today's room under the Admin setting
 * or the edition's default (none in the independent edition: {@link UNLIMITED_USD}). A guard is `<what it adds> <= <headroom>`: the
 * sums are uncorrelated, so SQLite reads them once per statement however many rows it checks. Binds: the month's start, the day's.
 */
export function platformHeadroomSql(defaults: PlatformLimits) {
  const room = (since: string, limit: string) => `CASE WHEN ${limit} IS NULL THEN ${UNLIMITED_USD} ELSE ${limit}-${platformSpendSql(since)} END`;
  return `(SELECT MIN(${room('k.ms', 'k.m')},${room('k.ds', 'k.d')}) FROM (SELECT ? AS ms,? AS ds,${limitSql('monthUsd', defaults.monthUsd)} AS m,${limitSql('dayUsd', defaults.dayUsd)} AS d) k)`;
}

/** No limit: a platform admin's "unlimited" (a NULL row), or a plan without a maximum. */
export const UNLIMITED_USD = 1e15;
/**
 * A project's monthly budget as SQL over `project` (an SQL expression): its own value (no row: the edition's default; a
 * row of NULL: unlimited), never above what its plan allows. `defaultSql` and `maxSql` are the edition's, over the same project.
 */
export const projectBudgetSql = (project: string, defaultSql: string, maxSql: string) =>
  `MIN(COALESCE((SELECT COALESCE(monthly_usd,${UNLIMITED_USD}) FROM project_budgets WHERE project_id=${project}),${defaultSql},${UNLIMITED_USD}),COALESCE(${maxSql},${UNLIMITED_USD}))`;

/**
 * How much the project's budget still lets through this month (US$, SQL). Binds: the project id, the month's start.
 */
export function projectHeadroomSql(defaultSql: (project: string) => string, maxSql: (project: string) => string) {
  const budget = projectBudgetSql('k.pid', defaultSql('k.pid'), maxSql('k.pid'));
  return `(SELECT CASE WHEN ${budget}>=${UNLIMITED_USD} THEN ${UNLIMITED_USD} ELSE ${budget}-${projectSpendSql('k.pid', 'k.ms')} END FROM (SELECT ? AS pid,? AS ms) k)`;
}

/**
 * Admin > Usage and costs: each ledger's rows sent since a moment, grouped by module, project, AI or model and day, with
 * what the provider reported (`real_usd`) and what counts (`spend_usd`: real plus held). One statement per ledger (D1 refuses a
 * compound SELECT of this many terms): run them in one batch. Binds: the moment. With `project`, only that project's rows
 * (Settings > Monitoring > Budget); binds: the project, then the moment.
 */
export function spendRowsStatements(project = false) {
  return LEDGERS.map((ledger) => {
    const scoped = project ? ledger.project('k.pid') : null;
    return `SELECT ${ledger.module} module,${scoped ? 'k.pid' : ledger.projectOf} project_id,${ledger.engine} engine,substr(${ledger.at},1,10) day,
      COALESCE(SUM(${ledger.real}),0) real_usd,COALESCE(SUM(${scoped?.spend ?? ledger.spend}),0) spend_usd,COUNT(*) items
      FROM ${ledger.table}${scoped ? ',(SELECT ? AS pid) k' : ''} WHERE ${ledger.at}>=?${scoped ? ` AND ${scoped.where}` : ''} GROUP BY 1,2,3,4`;
  });
}
