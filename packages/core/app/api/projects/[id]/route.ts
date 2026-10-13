import { requireUser } from '@/lib/server/auth';
import { INTERVALS, nextRunTime, nextWeeklyRunTime } from '@/lib/scheduling';
import { accountCapabilities } from '@/lib/server/capabilities';
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
    await ownedProject(id, u.id);
    const data = await body(request);
    if ('daily_enabled' in data || 'interval_hours' in data) {
      if (
        'interval_hours' in data &&
        !INTERVALS.includes(data.interval_hours as 24)
      )
        throw new ApiError(400, 'Frequência inválida.');
      if ('interval_hours' in data) {
        const free = (await accountCapabilities(u.id)).promptLimit === 10;
        await db().batch([
          db()
            .prepare(
              'UPDATE projects SET interval_hours=? WHERE id=? AND owner_id=?',
            )
            .bind(data.interval_hours, id, u.id),
          db()
            .prepare(
              `UPDATE prompts SET next_run_at=${free ? 'MAX' : 'MIN'}(next_run_at,?) WHERE project_id=? AND archived=0`,
            )
            .bind(free ? nextWeeklyRunTime(now()) : nextRunTime(now(), Number(data.interval_hours)), id),
        ]);
      }
      if ('daily_enabled' in data) {
        if (typeof data.daily_enabled !== 'boolean')
          throw new ApiError(400, 'Agendamento inválido.');
        await db()
          .prepare(
            'UPDATE projects SET daily_enabled=? WHERE id=? AND owner_id=?',
          )
          .bind(data.daily_enabled ? 1 : 0, id, u.id)
          .run();
      }
      await startMonitoring(u.id, id);
    } else {
      const p = projectInput(data);
      if (
        p.language !== 'en' &&
        (await db()
          .prepare(
            "SELECT id FROM prompts WHERE project_id=? AND engine='gemini' AND archived=0 LIMIT 1",
          )
          .bind(id)
          .first())
      )
        throw new ApiError(
          400,
          'Arquive os prompts do Gemini antes de mudar este projeto para português.',
        );
      await db()
        .prepare(
          'UPDATE projects SET name=?,domain=?,aliases_json=?,additional_domains_json=?,competitors_json=?,location_code=?,language_code=?,category=?,audience=?,competitor_targets_revision=competitor_targets_revision+1 WHERE id=? AND owner_id=?',
        )
        .bind(
          p.name,
          p.domain,
          JSON.stringify(p.aliases),
          JSON.stringify(p.additionalDomains),
          JSON.stringify(p.competitors),
          p.location,
          p.language,
          p.category,
          p.audience,
          id,
          u.id,
        )
        .run();
      // The saved target revision is the durable request. A temporary storage
      // transport failure must not turn a committed settings change into an
      // apparent failure; the competitors screen repairs the derived job through POST ensure.
      try {
        await ensureCompetitorAnalysis(id, u.id);
        analysisScheduled = true;
      } catch {
        // Recovered by the origin-checked competitors ensure endpoint.
        analysisScheduled = false;
      }
    }
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
