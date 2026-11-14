import { db, setting } from '@/lib/server/env';
import { secureEqual } from '@/lib/server/secure-equal';
import {
  getProjectStore,
  flushProjectStores,
  exportProjectStore,
} from '@/lib/server/project-store';
import {
  projectStorageAction,
  storageActionBody,
} from '@/lib/server/project-store-actions';
import { json, fail, ApiError } from '@/lib/server/http';
import { warmProject } from '@/lib/server/first-screen-warm';
import { ensureCompetitorAnalysis } from '@/lib/server/competitor-analysis';
import { panelRoundNow, prunePanelRounds, rereadPanelAnswers } from '@/lib/server/semantic-panel-worker';
import { applyRetention } from '@/lib/server/retention';
import { comparisonRoundNow, rereadComparisons } from '@/lib/server/comparison-worker';
import { validRetention } from '@/lib/retention';
import { rereadLandings } from '@/lib/server/ai-bots';

/**
 * Export, restore and flush any project: `OPERATIONS_SECRET`, never the scheduler's `CRON_SECRET` once it is set. An
 * installation without one still accepts `CRON_SECRET` here, as before (set `OPERATIONS_SECRET` to close that).
 */
function operationsAuthorized(request: Request) {
  const secret = setting('OPERATIONS_SECRET') || setting('CRON_SECRET');
  return secret.length >= 32 && secureEqual(request.headers.get('authorization') || '', `Bearer ${secret}`);
}
export async function POST(request: Request) {
  try {
    if (!operationsAuthorized(request)) throw new ApiError(401, 'Access denied.');
    const body = await storageActionBody(request);
    // One audit line per authorized call: what was asked and for which project, never the body or the secret.
    console.info(
      JSON.stringify({
        audit: 'operations.project-storage',
        action: String(body.action).slice(0, 64),
        projectId: typeof body.projectId === 'string' ? body.projectId.slice(0, 128) : null,
      }),
    );
    // The stored Semantic Branding answers read again with the current reader (free, idempotent), one page at a time: call again
    // with `after: next` until `next` is null. `projectId` narrows it to one project.
    if (body.action === 'semantic-reread')
      return json(await rereadPanelAnswers({
        after: typeof body.after === 'string' ? body.after : '',
        limit: Math.min(200, Math.max(1, Number(body.limit) || 50)),
        projectId: typeof body.projectId === 'string' && body.projectId ? body.projectId : null,
      }));
    // The Semantic Branding rounds of before the current scale taken out (prunePanelRounds), or every round with `all: true` (Semantic
    // Branding zeroed): counts only unless `dryRun` is false. `projectId` narrows it to one project. Idempotent.
    if (body.action === 'semantic-prune')
      return json(await prunePanelRounds({
        projectId: typeof body.projectId === 'string' && body.projectId ? body.projectId : null,
        dryRun: body.dryRun !== false,
        all: body.all === true,
      }));
    // Data retention (retention.ts): what each project with a retention would lose now, per part (a dry run, the default), or
    // one batch of each now with `dryRun: false` (irreversible; call again while `more`). `projectId` narrows it to one project.
    if (body.action === 'retention-apply')
      return json(await applyRetention({
        projectId: typeof body.projectId === 'string' && body.projectId ? body.projectId : null,
        dryRun: body.dryRun !== false,
        limit: Math.min(500, Math.max(1, Number(body.limit) || 200)),
      }));
    // Landing pages of AI Traffic for the days collected before them (rereadLandings): the last 30 days read again through the
    // daily collection, once per connection (a project already read is skipped). A dry run unless `dryRun` is false.
    if (body.action === 'ai-bots-reread')
      return json(await rereadLandings({
        projectId: typeof body.projectId === 'string' && body.projectId ? body.projectId : null,
        dryRun: body.dryRun !== false,
      }));
    if (body.action === 'flush')
      return json(await flushProjectStores({ projects: 2, rows: 50 }));
    const project = await db()
      .prepare('SELECT id,workspace_id FROM projects WHERE id=?')
      .bind(typeof body.projectId === 'string' ? body.projectId : '')
      .first<{ id: string; workspace_id: string }>();
    if (!project) throw new ApiError(404, 'Project not found.');
    // One Semantic Branding round of the project now (a backfill), spending at most `maxUsd`; idempotent: call again until `inFlight` is 0.
    // `redo: true` opens a fresh round for the period even though it has one (refused while one is in flight); later calls go without it.
    // What stops it (the cap, the project not collecting, a round in flight) answers 409 with the reason, for the operator.
    if (body.action === 'semantic-round')
      return json(await panelRoundNow(project.id, Number(body.maxUsd), body.redo === true).catch((error: unknown) => { throw new ApiError(409, error instanceof Error ? error.message : String(error)); }));
    // One Comparison round of the project now (a backfill): the current period's questions not asked yet, as many as fit in `maxUsd` with what
    // the period already holds; idempotent: call again until `inFlight` is 0 (and `complete`). What stops it answers 409 with the reason.
    if (body.action === 'comparison-round')
      return json(await comparisonRoundNow(project.id, Number(body.maxUsd)).catch((error: unknown) => { throw new ApiError(409, error instanceof Error ? error.message : String(error)); }));
    // The project's stored Comparison readings anchored again to the current rule (rereadComparisons; free, idempotent), one page at a
    // time: call again with `after: next` until `next` is null.
    if (body.action === 'comparison-reread')
      return json(await rereadComparisons(project.id, typeof body.after === 'string' ? body.after : '', Math.min(500, Math.max(1, Number(body.limit) || 200))));
    // The project's brand analysis: `restart: true` reads its whole window again under the current detector (free: the decision
    // model's questions are kept, so only new ones cost); without it, the status, to follow the pass until `status` is complete.
    if (body.action === 'analysis')
      return json(await ensureCompetitorAnalysis(project.id, project.workspace_id, body.restart === true));
    // A project's retention in days (lib/retention.ts RETENTION_DAYS), or null to keep everything, as Settings > Project data sets it.
    if (body.action === 'retention-set') {
      if (!validRetention(body.days)) throw new ApiError(400, 'Invalid retention.');
      await db().prepare('UPDATE projects SET raw_retention_days=? WHERE id=?').bind(body.days, project.id).run();
      return json({ projectId: project.id, days: body.days });
    }
    if (body.action === 'export')
      // The operator's copy: every account's agent conversations, so a restore of the platform loses none.
      return await exportProjectStore(project.id, project.workspace_id, null);
    if (body.action === 'status')
      return json({
        registry: await getProjectStore(project.id, project.workspace_id),
      });
    // The project's first screens computed and kept now, as the scheduler does after a change (a preview has no scheduler).
    if (body.action === 'warm') return json(await warmProject(project.id, project.workspace_id));
    return json(await projectStorageAction(project.id, project.workspace_id, body));
  } catch (error) {
    return fail(error);
  }
}
