import {
  engineSelection,
  reconcileInheritedPrompts,
} from '@/lib/server/prompts';
import { requireUser } from '@/lib/server/auth';
import { INTERVALS, nextRunTime, nextWeeklyRunTime } from '@/lib/scheduling';
import { accountCapabilities, capacityGuards } from '@/lib/server/capabilities';
import { startMonitoring } from '@/lib/server/monitor';
import { db, now } from '@/lib/server/env';
import { ownedProject } from '@/lib/server/workspace';
import { projectInput } from '@/lib/server/validation';
import { body, sameOrigin, json, fail, ApiError } from '@/lib/server/http';
import { ensureCompetitorAnalysis } from '@/lib/server/competitor-analysis';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Context) {
  try {
    let analysisScheduled = false;
    sameOrigin(request);
    const u = await requireUser(),
      { id } = await params;
    const owned = await ownedProject(id, u.id);
    const data = await body(request);
    const capabilities = await accountCapabilities(u.id);
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
      ...(profile ? { language_code: profile.language } : {}),
    };
    if ('engines' in data) {
      const engines = engineSelection(
        data.engines,
        String(nextProject.language_code),
        capabilities.engines,
      );
      nextProject.engines_json = JSON.stringify(engines);
      statements.push(
        db()
          .prepare(
            'UPDATE projects SET engines_json=? WHERE id=? AND owner_id=?',
          )
          .bind(nextProject.engines_json, id, u.id),
      );
    }
    if ('interval_hours' in data) {
      if (!INTERVALS.includes(data.interval_hours as 24))
        throw new ApiError(400, 'Frequência inválida.');
      const free = capabilities.promptLimit === 10;
      statements.push(
        db()
          .prepare(
            'UPDATE projects SET interval_hours=? WHERE id=? AND owner_id=?',
          )
          .bind(data.interval_hours, id, u.id),
        db()
          .prepare(
            `UPDATE prompts SET next_run_at=${free ? 'MAX' : 'MIN'}(next_run_at,?) WHERE project_id=? AND archived=0`,
          )
          .bind(
            free
              ? nextWeeklyRunTime(now())
              : nextRunTime(now(), Number(data.interval_hours)),
            id,
          ),
      );
    }
    if ('daily_enabled' in data) {
      if (typeof data.daily_enabled !== 'boolean')
        throw new ApiError(400, 'Agendamento inválido.');
      statements.push(
        db()
          .prepare(
            'UPDATE projects SET daily_enabled=? WHERE id=? AND owner_id=?',
          )
          .bind(Number(data.daily_enabled), id, u.id),
      );
    }
    if (profile) {
      if (
        profile.language !== 'en' &&
        (await db()
          .prepare(
            "SELECT id FROM prompts WHERE project_id=? AND engine='gemini' AND archived=0 AND subscribed=1 LIMIT 1",
          )
          .bind(id)
          .first())
      )
        throw new ApiError(
          400,
          'Remove Gemini monitoring before changing this project language.',
        );
      statements.push(
        db()
          .prepare(
            'UPDATE projects SET name=?,domain=?,aliases_json=?,additional_domains_json=?,competitors_json=?,location_code=?,language_code=?,category=?,audience=?,competitor_targets_revision=competitor_targets_revision+1 WHERE id=? AND owner_id=?',
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
            u.id,
          ),
      );
    }
    if ('engines' in data)
      statements.push(
        ...(await reconcileInheritedPrompts(id, u.id, undefined, nextProject)),
      );
    if (!statements.length)
      throw new ApiError(400, 'No project settings supplied.');
    await db().batch([...statements, ...capacityGuards(u.id)]);
    if (profile) {
      try {
        await ensureCompetitorAnalysis(id, u.id);
        analysisScheduled = true;
      } catch {
        analysisScheduled = false;
      }
    }
    if (
      'daily_enabled' in data ||
      'interval_hours' in data ||
      'engines' in data
    )
      await startMonitoring(u.id, id);
    return json({ ok: true, analysisScheduled });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const u = await requireUser(),
      { id } = await params;
    await ownedProject(id, u.id);
    await db()
      .prepare(
        'UPDATE projects SET archived=1,daily_enabled=0 WHERE id=? AND owner_id=?',
      )
      .bind(id, u.id)
      .run();
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
