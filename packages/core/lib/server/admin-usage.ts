import { isAdmin } from '@edition/lib/admin-access';
import { PLATFORM_LIMITS_KEY, SPEND_MODULES, periodStart, projectBudgetSql, projectSpendSql, spendRowsStatements, UNLIMITED_USD, type SpendModule } from '@/lib/platform-spend';
import { db, now, setting } from './env';
import { ApiError } from './http';
import { planAllowances, projectBudgetDefaultSql, projectBudgetMaxSql, providerSettings, type PlanAllowances } from './capabilities';
import { platformState, recentBlocks } from './spend-guards';
import { burn, setProjectBudget } from './project-budgets';
import { dailyRunDefault } from '@/lib/reservations';

const MONTHS = 6;
const DAYS = 31;
type Row = { module: SpendModule; project_id: string; engine: string; day: string; real_usd: number; spend_usd: number; items: number };
type ProjectRow = { id: string; workspace_id: string; name: string; domain: string; archived: number; email: string; budget: number; spent: number; custom: number; enabled: number | null; automatic: number | null; revision: number | null };
/** One line of a view: what the provider reported (`realUsd`), what counts (`spendUsd`, real plus held) and the items it paid for. */
export type SpendCell = { realUsd: number; spendUsd: number; items: number };
const cell = (): SpendCell => ({ realUsd: 0, spendUsd: 0, items: 0 });
const add = (target: SpendCell, row: Row) => {
  target.realUsd += Number(row.real_usd);
  target.spendUsd += Number(row.spend_usd);
  target.items += Number(row.items);
};
const monthOf = (offset: number) => {
  const at = new Date();
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - offset, 1)).toISOString().slice(0, 7);
};

/**
 * Admin > Usage and costs: where the money goes. Every view reads the same ledgers the reservation
 * guards read (packages/core/lib/platform-spend.ts), by the moment each row was sent, on D1's clock (UTC): by module, project, AI or
 * model, workspace and day, real next to held; today and this month next to the platform's brake; each project's budget, burn,
 * alarm and what blocks it; each workspace's plan quantities and agent credits (Cloud). Nothing here spends.
 */
export async function adminUsage() {
  const database = db();
  const months = Array.from({ length: MONTHS }, (_, index) => monthOf(index));
  const since = `${months[MONTHS - 1]}-01T00:00:00.000Z`;
  const [rows, projects, platform, blocks, runsToday] = await Promise.all([
    database.batch<Row>(spendRowsStatements().map((sql) => database.prepare(sql).bind(since))).then((reads) => ({ results: reads.flatMap((read) => read.results) })),
    database
      .prepare(
        `SELECT p.id,p.workspace_id,p.name,p.domain,p.archived,a.email,${projectBudgetSql('p.id', projectBudgetDefaultSql('p.id'), projectBudgetMaxSql('p.id'))} budget,
         CASE WHEN p.archived=0 THEN ${projectSpendSql('p.id', 'k.ms')} ELSE 0 END spent,(SELECT COUNT(*) FROM project_budgets b WHERE b.project_id=p.id) custom,c.enabled,c.automatic,c.revision
         FROM (SELECT ? AS ms) k,projects p JOIN workspaces w ON w.id=p.workspace_id JOIN accounts a ON a.id=w.owner_id LEFT JOIN brand_research_configurations c ON c.project_id=p.id AND c.workspace_id=p.workspace_id
         ORDER BY p.archived,p.name`,
      )
      .bind(periodStart('month', now()))
      .all<ProjectRow>(),
    platformState(),
    recentBlocks(),
    database.prepare('SELECT COUNT(*) n FROM runs WHERE created_at>=?').bind(`${now().slice(0, 10)}T00:00:00.000Z`).first<{ n: number }>(),
  ]);
  // Model calls per provider and month (lib/server/model-routes.ts tallies each call): who served them, their cost and the
  // failures that moved a call to the next provider. A database without the tally yet shows none.
  type ProviderMonth = { month: string; provider: string; calls: number; failovers: number; cost_usd: number; unpriced: number };
  const providerMonths = await database
    .prepare('SELECT substr(day,1,7) month,provider,SUM(calls) calls,SUM(failovers) failovers,SUM(cost_usd) cost_usd,SUM(unpriced) unpriced FROM llm_provider_usage WHERE day>=? GROUP BY month,provider')
    .bind(since.slice(0, 10))
    .all<ProviderMonth>()
    .then((read) => read.results, () => [] as ProviderMonth[]);
  const byMonth = new Map<string, Record<string, SpendCell>>();
  type Agent = { project: Map<string, SpendCell>; model: Map<string, SpendCell>; day: Map<string, SpendCell> };
  const views = new Map<string, { module: Map<string, SpendCell>; project: Map<string, SpendCell>; engine: Map<string, SpendCell>; owner: Map<string, SpendCell>; projectModules: Map<string, Record<string, SpendCell>>; agent: Agent }>();
  const owners = new Map(projects.results.map((project) => [project.id, project.workspace_id]));
  const recent = new Date(Date.now() - (DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const days = new Map<string, Record<string, SpendCell>>();
  for (const row of rows.results) {
    const month = row.day.slice(0, 7);
    const totals = byMonth.get(month) ?? {};
    add((totals[row.module] ??= cell()), row);
    byMonth.set(month, totals);
    let view = views.get(month);
    if (!view) views.set(month, (view = { module: new Map(), project: new Map(), engine: new Map(), owner: new Map(), projectModules: new Map(), agent: { project: new Map(), model: new Map(), day: new Map() } }));
    const put = (map: Map<string, SpendCell>, key: string) => {
      const value = map.get(key) ?? cell();
      add(value, row);
      map.set(key, value);
    };
    put(view.module, row.module);
    put(view.project, row.project_id);
    // `<engine|model>:<module>:<name>`: the same AI or model once per module it worked for (Claude's collection apart from its panel,
    // the agent's chat model apart from the classifiers on the same model), so each line says what it was for.
    put(view.engine, `${row.module === 'collection' || row.module === 'semantic' || row.module === 'products' || row.module === 'comparison' ? 'engine' : 'model'}:${row.module}:${row.engine ?? ''}`);
    put(view.owner, owners.get(row.project_id) ?? '');
    // The agent's own view: its turns (one per answer) by project, chat model and day.
    if (row.module === 'agent') {
      put(view.agent.project, row.project_id);
      put(view.agent.model, row.engine ?? '');
      put(view.agent.day, row.day);
    }
    const modules = view.projectModules.get(row.project_id) ?? {};
    add((modules[row.module] ??= cell()), row);
    view.projectModules.set(row.project_id, modules);
    if (row.day >= recent) {
      const day = days.get(row.day) ?? {};
      add((day[row.module] ??= cell()), row);
      days.set(row.day, day);
    }
  }
  const list = (map: Map<string, SpendCell> | undefined) => [...(map ?? new Map<string, SpendCell>())].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.spendUsd - a.spendUsd);
  const workspaces = [...new Map(projects.results.map((project) => [project.workspace_id, project.email]))];
  const allowances = new Map<string, PlanAllowances | null>(
    await Promise.all(workspaces.map(async ([owner]) => [owner, await planAllowances(owner).catch(() => null)] as const)),
  );
  const blocked = new Map(blocks.map((block) => [block.project_id, block]));
  return {
    months,
    modules: SPEND_MODULES,
    platform: { ...platform, runsToday: Number(runsToday?.n ?? 0), dailyRunsDefault: dailyRunDefault(setting('GLOBAL_DAILY_RUN_LIMIT')) },
    totals: Object.fromEntries(months.map((month) => [month, byMonth.get(month) ?? {}])),
    views: Object.fromEntries(
      months.map((month) => {
        const view = views.get(month);
        return [month, {
          module: list(view?.module),
          project: list(view?.project),
          engine: list(view?.engine),
          workspace: list(view?.owner),
          projectModules: Object.fromEntries(view?.projectModules ?? []),
          agent: { project: list(view?.agent.project), model: list(view?.agent.model), day: list(view?.agent.day).sort((a, b) => b.key.localeCompare(a.key)) },
        }];
      }),
    ),
    days: [...days].sort(([a], [b]) => b.localeCompare(a)).map(([day, modules]) => ({ day, modules })),
    modelProviders: Object.fromEntries(
      months.map((month) => [
        month,
        providerMonths
          .filter((row) => row.month === month)
          .map((row) => ({ provider: row.provider, calls: Number(row.calls), failovers: Number(row.failovers), costUsd: Number(row.cost_usd), unpriced: Number(row.unpriced) }))
          .sort((a, b) => b.costUsd - a.costUsd),
      ]),
    ),
    projects: projects.results.map((row) => {
      const budgetUsd = Number(row.budget) >= UNLIMITED_USD ? null : Number(row.budget);
      const spentUsd = Number(row.spent || 0);
      return {
        id: row.id,
        name: row.name,
        domain: row.domain,
        archived: !!row.archived,
        owner: row.email,
        workspace: row.workspace_id,
        budgetUsd,
        spentUsd,
        custom: !!row.custom,
        ...burn(spentUsd, budgetUsd),
        blocked: blocked.get(row.id) ?? null,
        // Cloud: automatic evaluations (sentiment and source types) of the project, switched here.
        evaluations: providerSettings || row.enabled == null ? null : { enabled: !!row.enabled, automatic: !!row.enabled && !!row.automatic, revision: Number(row.revision) },
      };
    }),
    workspaces: workspaces.map(([owner, email]) => ({ id: owner, email, plan: allowances.get(owner) ?? null })),
    blocks: blocks.length,
  };
}

const limitValue = (value: unknown, max: number) => {
  if (value === null || value === undefined || value === '' || value === 'default') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) throw new ApiError(400, 'Enter a limit of 0 or more, or leave it empty for the default.');
  return number;
};

/**
 * PATCH actions (audited by key, never a value's secret):
 * - `{ action: 'budget', projectId, monthlyUsd: number | null | 'default' }`: a project's monthly budget, not held to its plan.
 * - `{ action: 'platform', monthUsd, dayUsd, dailyRuns }`: the platform's brake; an empty value is the edition's default.
 * - `{ action: 'automatic', projectId, automatic, expectedRevision }` (Cloud): the project's automatic evaluations switch.
 */
export async function saveAdminUsage(body: Record<string, unknown>, actor: string) {
  const database = db();
  const audit = (key: string) => database.prepare('INSERT INTO admin_audit_log(at,actor,action,key) VALUES(?,?,?,?)').bind(now(), actor, 'set', key).run();
  if (body.action === 'budget') {
    if (typeof body.projectId !== 'string' || !body.projectId) throw new ApiError(400, 'Choose a project.');
    if (!isAdmin({ email: actor })) throw new ApiError(403, 'Only a Lastfind admin changes this.');
    await setProjectBudget({ id: actor, email: actor, workspaceId: '', role: 'owner' }, body.projectId, body.monthlyUsd === undefined ? 'default' : body.monthlyUsd, true);
    return null;
  }
  if (body.action === 'platform') {
    const limits = { monthUsd: limitValue(body.monthUsd, 1e7), dayUsd: limitValue(body.dayUsd, 1e6), dailyRuns: limitValue(body.dailyRuns, 1e7) };
    await database
      .prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind(PLATFORM_LIMITS_KEY, JSON.stringify(limits))
      .run();
    await audit(PLATFORM_LIMITS_KEY);
    return null;
  }
  const { action, projectId, automatic, expectedRevision } = body;
  if (action !== 'automatic' || typeof projectId !== 'string' || !projectId) throw new ApiError(400, 'Choose a project.');
  if (providerSettings) throw new ApiError(400, 'This installation has no automatic evaluations.');
  if (typeof automatic !== 'boolean' || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)) throw new ApiError(400, 'Invalid request.');
  const update = await database
    .prepare('UPDATE brand_research_configurations SET automatic=?,revision=revision+1,updated_at=? WHERE project_id=? AND revision=? AND enabled=1')
    .bind(automatic ? 1 : 0, now(), projectId, expectedRevision)
    .run();
  if (!update.meta.changes) throw new ApiError(409, 'This project changed meanwhile, or evaluation is not enabled for it. Reload before saving.');
  await audit(`automatic:${projectId}`);
  return null;
}
