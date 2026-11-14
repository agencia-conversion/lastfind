// Settings > Monitoring > Budget and Admin > Usage and costs: each project's monthly budget, what it spent by module, how
// fast, and what stops it. Both editions; Cloud adds the plan's quantities (./capabilities planAllowances).
import { isAdmin } from '@edition/lib/admin-access';
import { SPEND_MODULES, spendRowsStatements, type SpendModule } from '@/lib/platform-spend';
import { db, now } from './env';
import { ApiError } from './http';
import { roleAtLeast, type Actor } from './auth';
import { ownedProject } from './workspace';
import { planAllowances, providerSettings } from './capabilities';
import { budgetState, recentBlocks } from './spend-guards';

/** Past this share of the budget the project shows an alarm (Settings, Admin). */
export const BUDGET_ALARM_SHARE = 0.8;
const monthStart = (at = now()) => `${at.slice(0, 7)}-01T00:00:00.000Z`;

/** The month so far and the run-rate projection to its end (null on the month's first day, too early to say). */
export function burn(spentUsd: number, budgetUsd: number | null, at = now()) {
  const date = new Date(at);
  const days = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = (Date.parse(at) - Date.parse(monthStart(at))) / 86_400_000;
  const projectedUsd = elapsed >= 1 ? (spentUsd / elapsed) * days : null;
  const share = budgetUsd ? spentUsd / budgetUsd : budgetUsd === 0 ? 1 : 0;
  return {
    share,
    projectedUsd,
    exhausted: budgetUsd !== null && spentUsd >= budgetUsd,
    alarm: budgetUsd !== null && (share >= BUDGET_ALARM_SHARE || (projectedUsd !== null && projectedUsd > budgetUsd)),
  };
}

type Row = { module: SpendModule; engine: string; day: string; real_usd: number; spend_usd: number; items: number };
/** One project's month by module (real and counted, US$). */
async function projectModules(projectId: string) {
  const database = db();
  const results = (await database.batch<Row>(spendRowsStatements(true).map((sql) => database.prepare(sql).bind(projectId, monthStart())))).flatMap((read) => read.results);
  const modules = new Map<SpendModule, { realUsd: number; spendUsd: number; items: number }>();
  for (const row of results) {
    const entry = modules.get(row.module) ?? { realUsd: 0, spendUsd: 0, items: 0 };
    entry.realUsd += Number(row.real_usd);
    entry.spendUsd += Number(row.spend_usd);
    entry.items += Number(row.items);
    modules.set(row.module, entry);
  }
  return SPEND_MODULES.filter((module) => modules.get(module)?.items).map((module) => ({ module, ...modules.get(module)! }));
}

const platformAdmin = (actor: Actor): boolean => isAdmin({ email: actor.email });

/** Settings > Monitoring > Budget: the project's budget, its month by module, the burn, a block if any, and (Cloud) the plan's quantities. */
export async function projectBudget(actor: Actor, projectId: unknown) {
  if (!roleAtLeast(actor.role, 'admin')) throw new ApiError(403, 'Costs are visible to workspace admins.');
  const project = await ownedProject(String(projectId ?? ''), actor.workspaceId);
  const id = String(project.id);
  const [state, modules, blocks, plan] = await Promise.all([budgetState(id), projectModules(id), recentBlocks(id), planAllowances(actor.workspaceId)]);
  // Work sent in an earlier month and still in flight counts in this one too (the guard's rule): its own line, so the lines add up.
  const earlier = state.spentUsd - modules.reduce((sum, row) => sum + row.spendUsd, 0);
  return {
    month: monthStart().slice(0, 7),
    ...state,
    ...burn(state.spentUsd, state.budgetUsd),
    modules: earlier > 0.005 ? [...modules, { module: 'earlier', realUsd: 0, spendUsd: earlier, items: 0 }] : modules,
    blocked: blocks[0] ?? null,
    plan,
    canSet: true,
    // Unlimited (no budget) is a Lastfind admin's in Cloud, where Lastfind pays; the independent edition's owner pays.
    canUnlimited: providerSettings || platformAdmin(actor),
  };
}

/**
 * Sets the project's budget: US$ a month (0 stops every paid module of the project), `null` for none (a Lastfind admin's in
 * Cloud), or `"default"`. A workspace admin sets it up to the plan's maximum; `asPlatformAdmin` (Admin > Usage and costs) is not
 * held to it. Audited by project id.
 */
export async function setProjectBudget(actor: Pick<Actor, 'id' | 'email' | 'workspaceId' | 'role'>, projectId: string, value: unknown, asPlatformAdmin = false) {
  const platform = asPlatformAdmin && platformAdmin(actor as Actor);
  if (!platform && !roleAtLeast(actor.role, 'admin')) throw new ApiError(403, 'Your role in this workspace does not allow this action.');
  const project = platform
    ? await db().prepare('SELECT id,workspace_id FROM projects WHERE id=?').bind(projectId).first<{ id: string; workspace_id: string }>()
    : { id: String((await ownedProject(projectId, actor.workspaceId)).id), workspace_id: actor.workspaceId };
  if (!project) throw new ApiError(404, 'Project not found.');
  const id = project.id;
  if (value === 'default') await db().prepare('DELETE FROM project_budgets WHERE project_id=?').bind(id).run();
  else {
    const usd = value === null ? null : Number(value);
    if (usd !== null && !(Number.isFinite(usd) && usd >= 0 && usd <= 1_000_000)) throw new ApiError(400, 'Enter a monthly budget in US$, or 0 to stop paid work.');
    if (usd === null && !(platform || providerSettings)) throw new ApiError(403, 'A project with no budget is set by the Lastfind team.');
    if (usd !== null && !platform) {
      const { maxUsd } = await budgetState(id);
      if (maxUsd !== null && usd > maxUsd) throw new ApiError(400, 'Your plan does not allow a budget this high. Lower it, or ask the Lastfind team.');
    }
    await db()
      .prepare(
        `INSERT INTO project_budgets(project_id,workspace_id,monthly_usd,updated_at,updated_by) VALUES(?,?,?,?,?)
         ON CONFLICT(project_id) DO UPDATE SET monthly_usd=excluded.monthly_usd,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
      )
      .bind(id, project.workspace_id, usd === null ? null : Math.round(usd * 100) / 100, now(), actor.id)
      .run();
  }
  await db().prepare('INSERT INTO admin_audit_log(at,actor,action,key) VALUES(?,?,?,?)').bind(now(), actor.email, 'set', `budget:${id}`).run().catch(() => undefined);
  return id;
}
