import {
  engineSelection,
  reconcileInheritedPrompts,
} from '@/lib/server/prompts';
import { requireActor, roleAtLeast } from '@/lib/server/auth';
import { INTERVALS, nextCollection, scheduleOf, validDay, validHour } from '@/lib/scheduling';
import { workspaceZone } from '@/lib/server/project-reads';
import { accountCapabilities, capacityGuards } from '@/lib/server/capabilities';
import { startMonitoring } from '@/lib/server/monitor';
import { db, now } from '@/lib/server/env';
import { ownedProject } from '@/lib/server/workspace';
import { projectInput, projectNameInput } from '@/lib/server/validation';
import { body, sameOrigin, json, fail, ApiError } from '@/lib/server/http';
import { ensureCompetitorAnalysis } from '@/lib/server/competitor-analysis';
import { ENGINE_LABELS, engineUnavailable, isEngine } from '@/lib/engines';
import { validRetention } from '@/lib/retention';
import { slugInput } from '@/lib/server/slugs';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Context) {
  try {
    let analysisScheduled = false;
    sameOrigin(request);
    const u = await requireActor({ write: true }),
      { id } = await params;
    const owned = await ownedProject(id, u.workspaceId);
    const data = await body(request);
    const capabilities = await accountCapabilities(u.workspaceId);
    const statements: D1PreparedStatement[] = [];
    const profileChanged = [
      'name',
      'domain',
      'aliases',
      'additional_domains',
      'competitors',
      'location_code',
      'language_code',
      'category',
      'audience',
    ].some((key) => key in data);
    const profile = profileChanged
      ? projectInput({
          ...owned,
          aliases: JSON.parse(String(owned.aliases_json || '[]')),
          additional_domains: JSON.parse(
            String(owned.additional_domains_json || '[]'),
          ),
          competitors: JSON.parse(String(owned.competitors_json || '[]')),
          ...data,
        })
      : null;
    const nextProject: Record<string, unknown> = {
      ...owned,
      ...(profile ? { language_code: profile.language, location_code: profile.location } : {}),
    };
    if ('engines' in data) {
      const engines = engineSelection(
        data.engines,
        nextProject,
        capabilities.engines,
      );
      nextProject.engines_json = JSON.stringify(engines);
      statements.push(
        db()
          .prepare(
            'UPDATE projects SET engines_json=? WHERE id=? AND workspace_id=?',
          )
          .bind(nextProject.engines_json, id, u.workspaceId),
      );
    }
    if ('interval_hours' in data || 'collection_hour' in data || 'collection_day' in data) {
      // The collection's frequency, day and hour (in the workspace's time zone) are a workspace admin's choice.
      if (!roleAtLeast(u.role, 'admin')) throw new ApiError(403, 'Only workspace admins change the collection schedule.');
      if ('interval_hours' in data && !INTERVALS.includes(data.interval_hours as 24))
        throw new ApiError(400, 'Frequência inválida.');
      if ('collection_hour' in data && !validHour(data.collection_hour))
        throw new ApiError(400, 'Invalid hour.');
      if ('collection_day' in data && !validDay(data.collection_day))
        throw new ApiError(400, 'Invalid day.');
      const free = !!capabilities.free;
      const schedule = scheduleOf({ ...owned, ...data }, free, await workspaceZone(u.workspaceId));
      const stamp = now();
      statements.push(
        db()
          .prepare(
            'UPDATE projects SET interval_hours=?,collection_hour=?,collection_day=? WHERE id=? AND workspace_id=?',
          )
          .bind(Number(data.interval_hours ?? owned.interval_hours), schedule.hour, schedule.day, id, u.workspaceId),
        // Prompts waiting for the cap or a pending answer stay due; the others move to the new slot. A slot whose date was
        // already collected is skipped by the run's request key (monitor.ts), so moving the hour never collects twice in a day.
        db()
          .prepare(
            'UPDATE prompts SET next_run_at=CASE WHEN next_run_at<=? THEN next_run_at ELSE ? END WHERE project_id=? AND archived=0',
          )
          .bind(stamp, nextCollection(stamp, schedule), id),
      );
    }
    // How the project's members start a piece of content (Agent > Contents): the wizard, the chat, or null to ask each time.
    if ('agent_content_mode' in data) {
      if (data.agent_content_mode !== null && data.agent_content_mode !== 'wizard' && data.agent_content_mode !== 'chat')
        throw new ApiError(400, 'Invalid value.');
      statements.push(db().prepare('UPDATE projects SET agent_content_mode=? WHERE id=? AND workspace_id=?').bind(data.agent_content_mode, id, u.workspaceId));
    }
    // How long the project keeps its answers' raw form (lib/retention.ts): days, or null to keep everything. A workspace admin's choice.
    if ('raw_retention_days' in data) {
      if (!roleAtLeast(u.role, 'admin')) throw new ApiError(403, 'Only workspace admins change data retention.');
      if (!validRetention(data.raw_retention_days)) throw new ApiError(400, 'Invalid retention.');
      statements.push(db().prepare('UPDATE projects SET raw_retention_days=? WHERE id=? AND workspace_id=?').bind(data.raw_retention_days, id, u.workspaceId));
    }
    // The project's own name (null shows the brand's): never the brand that answers are read for.
    if ('display_name' in data)
      statements.push(db().prepare('UPDATE projects SET display_name=? WHERE id=? AND workspace_id=?').bind(projectNameInput(data.display_name), id, u.workspaceId));
    // The project's slug in the app's addresses (Settings > Brand and market), unique in the workspace: a workspace admin's choice.
    if ('slug' in data) {
      if (!roleAtLeast(u.role, 'admin')) throw new ApiError(403, 'Only workspace admins change the address.');
      const slug = slugInput(data.slug);
      if (await db().prepare('SELECT 1 FROM projects WHERE workspace_id=? AND slug=? AND id<>?').bind(u.workspaceId, slug, id).first())
        throw new ApiError(409, 'Another project in this workspace already uses this address.');
      statements.push(db().prepare('UPDATE projects SET slug=? WHERE id=? AND workspace_id=?').bind(slug, id, u.workspaceId));
    }
    if ('daily_enabled' in data) {
      if (typeof data.daily_enabled !== 'boolean')
        throw new ApiError(400, 'Agendamento inválido.');
      statements.push(
        db()
          .prepare(
            'UPDATE projects SET daily_enabled=? WHERE id=? AND workspace_id=?',
          )
          .bind(Number(data.daily_enabled), id, u.workspaceId),
      );
    }
    if (profile) {
      // An AI the project monitors must still collect in the new country (every AI answers in both languages).
      const monitored = (
        await db()
          .prepare('SELECT DISTINCT engine FROM prompts WHERE project_id=? AND archived=0 AND subscribed=1')
          .bind(id)
          .all<{ engine: string }>()
      ).results.map((row) => row.engine).filter(isEngine);
      const blocked = monitored.filter((engine) => engineUnavailable(engine, profile.location));
      if (blocked.length)
        throw new ApiError(
          400,
          `Remove ${blocked.map((engine) => ENGINE_LABELS[engine]).join(', ')} monitoring before changing this project country.`,
        );
      statements.push(
        db()
          .prepare(
            'UPDATE projects SET name=?,domain=?,aliases_json=?,additional_domains_json=?,competitors_json=?,location_code=?,language_code=?,category=?,audience=?,competitor_targets_revision=competitor_targets_revision+1 WHERE id=? AND workspace_id=?',
          )
          .bind(
            profile.name,
            profile.domain,
            JSON.stringify(profile.aliases),
            JSON.stringify(profile.additionalDomains),
            JSON.stringify(profile.competitors),
            profile.location,
            profile.language,
            profile.category,
            profile.audience,
            id,
            u.workspaceId,
          ),
      );
    }
    if ('engines' in data)
      statements.push(
        ...(await reconcileInheritedPrompts(id, u.workspaceId, undefined, nextProject)),
      );
    if (!statements.length)
      throw new ApiError(400, 'No project settings supplied.');
    await db().batch([...statements, ...capacityGuards(u.workspaceId)]);
    if (profile) {
      try {
        await ensureCompetitorAnalysis(id, u.workspaceId);
        analysisScheduled = true;
      } catch {
        analysisScheduled = false;
      }
    }
    if (
      'daily_enabled' in data ||
      'interval_hours' in data ||
      'collection_hour' in data ||
      'collection_day' in data ||
      'engines' in data
    )
      await startMonitoring(u.workspaceId, id);
    return json({ ok: true, analysisScheduled });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const u = await requireActor({ role: 'owner' }),
      { id } = await params;
    await ownedProject(id, u.workspaceId);
    await db()
      .prepare(
        'UPDATE projects SET archived=1,daily_enabled=0 WHERE id=? AND workspace_id=?',
      )
      .bind(id, u.workspaceId)
      .run();
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
