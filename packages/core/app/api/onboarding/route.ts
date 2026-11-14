import { requireActor } from '@/lib/server/auth';
import {
  body,
  sameOrigin,
  json,
  fail,
  ApiError,
  textField,
} from '@/lib/server/http';
import { waitUntil } from 'cloudflare:workers';
import { projectInput, projectNameInput } from '@/lib/server/validation';
import { engineSelection, promptInput } from '@/lib/server/prompts';
import { db, now, setting } from '@/lib/server/env';
import { startMonitoring, submitQueued } from '@/lib/server/monitor';
import { DEFAULT_COLLECTION_DAY, DEFAULT_COLLECTION_HOUR, INTERVALS, lastCollection, scheduleOf, validTimeZone } from '@/lib/scheduling';
import { workspaceZone } from '@/lib/server/project-reads';
import { accountCapabilities, capacityGuards, PROJECT_LIMIT, projectCreationCondition } from '@/lib/server/capabilities';
import { syncTopics } from '@/lib/server/topics';
import { storeProjectSlugs } from '@/lib/server/project-slugs';
import { comparisonIssues, readComparisonConfig } from '@/lib/comparison';
import { kickComparison } from '@/lib/server/comparison-worker';
import { newSemanticConfiguration } from '@/lib/server/semantic';
import { openFirstRound, sendFirstRound } from '@/lib/server/semantic-panel-worker';
import { ensureCompetitorAnalysis } from '@/lib/server/competitor-analysis';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireActor({ role: 'admin' }),
      data = await body(request);
    const id = textField(data.request_id, 'Identificador', 36, 36);
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw new ApiError(400, 'Identificador inválido.');
    const p = projectInput(data),
      interval = Number(data.interval_hours ?? 24);
    // Its own name (null: the brand's), and Semantic Branding with the attributes reviewed in the wizard unless it skipped it
    // (13/11/2026; none sent, it is set up later in Settings).
    const displayName = projectNameInput(data.project_name);
    const semantic = data.semantic !== false && Array.isArray(data.semantic_attributes) && data.semantic_attributes.length
      ? newSemanticConfiguration(data.semantic_attributes, [p.name, ...p.competitors.map((competitor) => competitor.name)])
      : null;
    const capabilities = await accountCapabilities(u.workspaceId);
    const free = !!capabilities.free;
    // The AIs every question runs on (the project default, inherited by its topics and questions); ChatGPT when none is sent.
    const market = { location_code: p.location, language_code: p.language };
    const engines = data.engines === undefined ? null : engineSelection(data.engines, market, capabilities.engines);
    // A workspace without a time zone (a new one) takes the browser's.
    const stored = await workspaceZone(u.workspaceId);
    const zone = stored ?? (validTimeZone(data.time_zone) ? data.time_zone : null);
    if (!INTERVALS.includes(interval as 24))
      throw new ApiError(400, 'Frequência inválida.');
    if (
      !Array.isArray(data.prompts) ||
      !data.prompts.length ||
      data.prompts.length > 100
    )
      throw new ApiError(400, 'Selecione de 1 a 100 prompts.');
    const inputs = data.prompts.map((x) => {
      if (!x || typeof x !== 'object')
        throw new ApiError(400, 'Prompt inválido.');
      // The default AI is checked too: it is the one this question will run on.
      const input = promptInput({ engine: engines?.[0] ?? 'chat_gpt', ...x }, market);
      // Every AI of the project must take the question (its length, its country).
      for (const engine of engines ?? []) promptInput({ ...input, engine }, market);
      return input;
    });
    // The wizard's optional Comparison step (12/11/2026): the products, attributes and personas the person kept, saved as revision 1.
    const comparison = data.comparison === undefined || data.comparison === null ? null : readComparisonConfig(data.comparison);
    if (comparison) {
      const [issue] = comparisonIssues(comparison, { productLimit: capabilities.comparisonProducts ?? null, brand: p.name });
      if (issue) throw new ApiError(400, issue);
    }
    const unique = [
      ...new Map(
        inputs.map((x) => [`${x.engine}:${x.text.toLowerCase()}`, x]),
      ).values(),
    ];
    const existing = await db()
      .prepare(
        'SELECT id FROM projects WHERE id=? AND workspace_id=? AND archived=0',
      )
      .bind(id, u.workspaceId)
      .first();
    if (!existing) {
      // The plan's projects (Cloud), in the same statement as the creation.
      const plan = projectCreationCondition(u.workspaceId);
      await db().batch([
        db()
          .prepare(
            `INSERT OR IGNORE INTO projects(id,workspace_id,name,display_name,domain,aliases_json,additional_domains_json,competitors_json,location_code,language_code,category,audience,engines_json,daily_enabled,interval_hours,collection_hour,collection_day,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,? WHERE ${plan.sql}`,
          )
          .bind(
            id,
            u.workspaceId,
            p.name,
            displayName,
            p.domain,
            JSON.stringify(p.aliases),
            JSON.stringify(p.additionalDomains),
            JSON.stringify(p.competitors),
            p.location,
            p.language,
            p.category,
            p.audience,
            JSON.stringify(engines ?? ['chat_gpt']),
            interval,
            DEFAULT_COLLECTION_HOUR,
            DEFAULT_COLLECTION_DAY,
            now(),
            ...plan.params,
          ),
        ...(zone && !stored ? [db().prepare('UPDATE workspaces SET time_zone=? WHERE id=? AND time_zone IS NULL').bind(zone, u.workspaceId)] : []),
        // One subscription per AI of the question, the first one's id being the question's (unit_id), as addPrompts does.
        ...unique.flatMap((x, i) => (engines ?? [x.engine]).map((engine, j) => [x, i, engine, j] as const)).map(([x, i, engine, j]) =>
          db()
            .prepare(
              'INSERT OR IGNORE INTO prompts(id,unit_id,project_id,text,engine,tag,tags_json,next_run_at,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=?)',
            )
            .bind(
              j ? `${id}:${i}:${engine}` : `${id}:${i}`,
              `${id}:${i}`,
              id,
              x.text,
              engine,
              x.tag,
              JSON.stringify(x.tags),
              // A new project collects right away (8/11/2026): its prompts are due since the schedule's latest slot, so
              // startMonitoring below reserves them now, within the plan's credits and every cap; then they follow the schedule.
              lastCollection(now(), scheduleOf({ interval_hours: interval }, free, zone)),
              now(),
              id,
              u.workspaceId,
            ),
        ),
        syncTopics(id, u.workspaceId),
        ...(semantic ? [db().prepare(`INSERT OR IGNORE INTO semantic_configurations(project_id,workspace_id,revision,configuration_json,created_at)
          SELECT ?,?,1,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=?)`).bind(id, u.workspaceId, JSON.stringify(semantic), now(), id, u.workspaceId)] : []),
        ...(comparison && comparison.products.length ? [db().prepare(`INSERT OR IGNORE INTO comparison_configurations(project_id,workspace_id,revision,configuration_json,created_at)
          SELECT ?,?,1,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND workspace_id=?)`).bind(id, u.workspaceId, JSON.stringify(comparison), now(), id, u.workspaceId)] : []),
        ...capacityGuards(u.workspaceId),
      ]);
      if (
        !(await db()
          .prepare('SELECT id FROM projects WHERE id=? AND workspace_id=?')
          .bind(id, u.workspaceId)
          .first())
      )
        throw new Error(PROJECT_LIMIT);
      await storeProjectSlugs(u.workspaceId, [{ id, name: p.name, display_name: displayName }]);
    }
    const monitoring = await startMonitoring(u.workspaceId, id);
    // The first collection as fast as possible (12/11/2026): the runs just reserved leave now, not at the next tick, under the
    // same claim and budgets. Only the task-based AIs: a live call outlasts what a response may wait for (the tick sends it).
    const queued = (await db().prepare("SELECT id FROM runs WHERE workspace_id=? AND project_id=? AND status='queued' AND engine!='perplexity'").bind(u.workspaceId, id).all<{ id: string }>()).results.map((row) => row.id);
    if (queued.length && setting('DATAFORSEO_LOGIN') && setting('DATAFORSEO_PASSWORD'))
      waitUntil(submitQueued(u.workspaceId, queued).catch((error) => console.error('New project: first submission waits for the next tick.', error instanceof Error ? error.message : String(error))));
    // Its Comparison and Semantic Branding collect right away too, as its prompts do (13/11/2026: Semantic Branding waited for the next
    // tick, and the project read "no notes yet" meanwhile).
    if (comparison?.products.length) waitUntil(kickComparison(id, true));
    // Its round is opened before the answer (only D1 rows, so the project is whole when it returns), its queries sent after it.
    if (semantic) {
      await openFirstRound(id);
      waitUntil(sendFirstRound(id));
    }
    // The brand analysis starts with the project, as a profile change starts it (13/11/2026): the answers' sentiment waits for it, and
    // before, it only started when someone opened Brands, so the first answers read "Not evaluated".
    // Awaited, as the PATCH does: its store is set up before the answer, never behind it.
    await ensureCompetitorAnalysis(id, u.workspaceId).catch((error) => console.error('New project: the brand analysis starts with its first answers.', error instanceof Error ? error.message : String(error)));
    return json({ id, monitoring }, 201);
  } catch (e) {
    return fail(e);
  }
}
