// The dollars every paid reservation must fit, in both editions: the platform's brake (Admin >
// Usage and costs; Cloud's default US$ 2,000 a month and US$ 64 a day, none in the independent edition) and the project's monthly
// budget (Settings > Monitoring > Budget). Each caller adds its plan quantities (./capabilities) and its own per-call cap. When a guard
// refuses, `recordBlocked` keeps the reason where health, Admin and the project's Settings read it.
import {
  BLOCKED_FRESH_MS,
  BLOCKED_PREFIX,
  PLATFORM_LIMITS_KEY,
  UNLIMITED_USD,
  periodStart,
  platformHeadroomSql,
  platformSpendSql,
  projectBudgetSql,
  projectHeadroomSql,
  projectSpendSql,
  type SpendModule,
} from '@/lib/platform-spend';
export { BLOCKED_FRESH_MS, BLOCKED_PREFIX } from '@/lib/platform-spend';
import * as edition from './capabilities';
import { db, now } from './env';

// The edition's values (./capabilities). Read through the namespace: a module standing in for the edition without them (a test's)
// gets no brake and no budget.
const platformLimitDefaults = edition.platformLimitDefaults ?? { monthUsd: null, dayUsd: null };
const projectBudgetDefaultSql = edition.projectBudgetDefaultSql ?? (() => 'NULL');
const projectBudgetMaxSql = edition.projectBudgetMaxSql ?? (() => 'NULL');
let platformRoom: string | undefined;
let projectRoom: string | undefined;
const platform = () => (platformRoom ??= platformHeadroomSql(platformLimitDefaults));
const project = () => (projectRoom ??= projectHeadroomSql(projectBudgetDefaultSql, projectBudgetMaxSql));
/** The binds of the two headrooms, on the app's clock. */
const platformBinds = () => [periodStart('month', now()), periodStart('day', now())];
const projectBinds = (projectId: string) => [projectId, periodStart('month', now())];

/**
 * `add` more US$ (a number, bound; or SQL such as a running total) fits the platform's brake and the project's budget.
 * Binds, in order: `add` when it is a number, the platform's period starts, `add` again, the project id and the month's start.
 */
export function spendGuard(projectId: string, add: number | string) {
  const bound = typeof add === 'number';
  const value = bound ? '?' : `(${add})`;
  return {
    sql: `${value}<=${platform()} AND ${value}<=${project()}`,
    params: [...(bound ? [add] : []), ...platformBinds(), ...(bound ? [add] : []), ...projectBinds(projectId)] as (string | number)[],
  };
}

/** A project's monthly budget as SQL over `project` (an SQL expression; UNLIMITED_USD when none), for a read that lists projects. */
export const projectBudgetColumnSql = (project: string) => projectBudgetSql(project, projectBudgetDefaultSql(project), projectBudgetMaxSql(project));

/** An operator's platform-wide operation (no project pays for it): `add` more US$ within the platform's brake only. */
export function platformGuard(add: number) {
  return { sql: `?<=${platform()}`, params: [add, ...platformBinds()] as (string | number)[] };
}

/** The project's budget, this month's spend and what is left, plus the platform's room (Settings, Admin, the diagnostics). */
export async function budgetState(projectId: string) {
  const row = await db()
    .prepare(
      `SELECT ${projectBudgetSql('k.pid', projectBudgetDefaultSql('k.pid'), projectBudgetMaxSql('k.pid'))} budget,${projectSpendSql('k.pid', 'k.ms')} spent,
       ${projectBudgetDefaultSql('k.pid')} default_usd,${projectBudgetMaxSql('k.pid')} max_usd,
       (SELECT monthly_usd FROM project_budgets WHERE project_id=k.pid) own,(SELECT COUNT(*) FROM project_budgets WHERE project_id=k.pid) custom,
       ${platform()} platform_room FROM (SELECT ? AS pid,? AS ms) k`,
    )
    .bind(...platformBinds(), ...projectBinds(projectId))
    .first<{ budget: number; spent: number; default_usd: number | null; max_usd: number | null; own: number | null; custom: number; platform_room: number }>();
  const budget = Number(row?.budget ?? 0);
  const unlimited = budget >= UNLIMITED_USD;
  const spent = Number(row?.spent ?? 0);
  return {
    budgetUsd: unlimited ? null : budget,
    spentUsd: spent,
    leftUsd: unlimited ? null : Math.max(0, budget - spent),
    defaultUsd: row?.default_usd == null ? null : Number(row.default_usd),
    maxUsd: row?.max_usd == null ? null : Number(row.max_usd),
    custom: !!row?.custom,
    platformRoomUsd: Number(row?.platform_room ?? UNLIMITED_USD) >= UNLIMITED_USD ? null : Number(row?.platform_room),
  };
}

export type BlockReason = 'platform' | 'project_budget' | 'credits' | 'agent_credits' | 'panel_rounds' | 'run_limit' | 'operation';
/** How often the same block is written again (a refused job retried on every tick writes once in this window). */
const BLOCKED_REWRITE_MS = 10 * 60_000;

/** Which dollar limit has no room for `add` (the platform's or the project's), or null when both have room. */
export async function dollarBlock(projectId: string, add: number): Promise<'platform' | 'project_budget' | null> {
  const row = await db().prepare(`SELECT ${platform()} p,${project()} b`).bind(...platformBinds(), ...projectBinds(projectId)).first<{ p: number; b: number }>();
  if (Number(row?.p ?? 0) < add) return 'platform';
  if (Number(row?.b ?? 0) < add) return 'project_budget';
  return null;
}

/**
 * Keeps why a module of the project could not reserve, once per BLOCKED_REWRITE_MS: health counts it, Admin lists it, the
 * project's Settings say it. Best effort: a failed write never fails the caller.
 */
export async function recordBlocked(projectId: string, module: SpendModule, reason: BlockReason) {
  const stamp = now();
  await db()
    .prepare(
      `INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value
       WHERE json_extract(system_state.value,'$.reason')<>json_extract(excluded.value,'$.reason') OR json_extract(system_state.value,'$.module')<>json_extract(excluded.value,'$.module')
       OR COALESCE(json_extract(system_state.value,'$.at'),'')<?`,
    )
    .bind(`${BLOCKED_PREFIX}${projectId}`, JSON.stringify({ reason, module, at: stamp }), new Date(Date.parse(stamp) - BLOCKED_REWRITE_MS).toISOString())
    .run()
    .catch(() => undefined);
}

/** Diagnoses a refused reservation of `add` US$ and records it: the dollars first, then the plan quantity the caller names. */
export async function recordRefusal(projectId: string, module: SpendModule, add: number, otherwise: BlockReason = 'operation') {
  const reason = (await dollarBlock(projectId, add).catch(() => null)) ?? otherwise;
  await recordBlocked(projectId, module, reason);
  return reason;
}

/** Clears the project's block once work of the same module went through. */
export async function clearBlocked(projectId: string, module: SpendModule) {
  await db()
    .prepare(`DELETE FROM system_state WHERE key=? AND json_extract(value,'$.module')=?`)
    .bind(`${BLOCKED_PREFIX}${projectId}`, module)
    .run()
    .catch(() => undefined);
}

export type BlockRow = { project_id: string; reason: BlockReason; module: SpendModule; at: string };
/** The recent blocks (of one project, or all), newest first, as a statement a caller can put in its own batch. */
export function recentBlocksStatement(projectId?: string) {
  const since = new Date(Date.parse(now()) - BLOCKED_FRESH_MS).toISOString();
  return db()
    .prepare(`SELECT substr(key,${BLOCKED_PREFIX.length + 1}) project_id,json_extract(value,'$.reason') reason,json_extract(value,'$.module') module,json_extract(value,'$.at') at
      FROM system_state WHERE key ${projectId ? '=?' : "LIKE 'budget_blocked:%'"} AND json_extract(value,'$.at')>=? ORDER BY at DESC LIMIT 500`)
    .bind(...(projectId ? [`${BLOCKED_PREFIX}${projectId}`] : []), since);
}
/** The recent blocks, newest first (health counts them, Admin lists them). */
export async function recentBlocks(projectId?: string) {
  return (await recentBlocksStatement(projectId).all<BlockRow>()).results;
}

/** The platform's spend this month and today, and the limits in force (Admin). */
export async function platformState() {
  const row = await db()
    .prepare(`SELECT ${platformSpendSql('k.ms')} month,${platformSpendSql('k.ds')} day,(SELECT value FROM system_state WHERE key='${PLATFORM_LIMITS_KEY}') limits FROM (SELECT ? AS ms,? AS ds) k`)
    .bind(...platformBinds())
    .first<{ month: number; day: number; limits: string | null }>();
  let saved: Record<string, unknown> = {};
  try {
    saved = row?.limits ? (JSON.parse(row.limits) as Record<string, unknown>) : {};
  } catch {
    saved = {};
  }
  const pick = (key: 'monthUsd' | 'dayUsd') => (typeof saved[key] === 'number' ? (saved[key] as number) : platformLimitDefaults[key]);
  return {
    monthUsd: Number(row?.month ?? 0),
    dayUsd: Number(row?.day ?? 0),
    limits: { monthUsd: pick('monthUsd'), dayUsd: pick('dayUsd'), dailyRuns: typeof saved.dailyRuns === 'number' ? (saved.dailyRuns as number) : null },
    defaults: platformLimitDefaults,
    custom: { monthUsd: typeof saved.monthUsd === 'number', dayUsd: typeof saved.dayUsd === 'number', dailyRuns: typeof saved.dailyRuns === 'number' },
  };
}
