import { requireUser } from '@/lib/server/auth';
import {
  body,
  sameOrigin,
  json,
  fail,
  ApiError,
  textField,
} from '@/lib/server/http';
import { ownedProject } from '@/lib/server/workspace';
import { nextRunTime } from '@/lib/scheduling';
import { db, now } from '@/lib/server/env';
import { promptInput } from '@/lib/server/prompts';
import { startMonitoring } from '@/lib/server/monitor';
import { capacityGuards } from '@/lib/server/capabilities';
import { syncTopics } from '@/lib/server/topics';
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser(),
      data = await body(request),
      projectId = textField(data.project_id, 'Projeto', 1, 100);
    const project = await ownedProject(projectId, u.id);
    if (
      !Array.isArray(data.ids) ||
      !data.ids.length ||
      data.ids.length > 100 ||
      data.ids.some((id) => typeof id !== 'string')
    )
      throw new ApiError(400, 'Selecione até 100 prompts.');
    const ids = [...new Set(data.ids)] as string[],
      action = String(data.action);
    if (!['pause', 'resume', 'archive', 'restore', 'organize'].includes(action))
      throw new ApiError(400, 'Ação inválida.');

    const rows = (
      await db()
        .prepare(
          'SELECT id FROM prompts WHERE project_id=? AND id IN (SELECT value FROM json_each(?))',
        )
        .bind(projectId, JSON.stringify(ids))
        .all()
    ).results;
    if (rows.length !== ids.length)
      throw new ApiError(404, 'Prompt não encontrado neste projeto.');
    const org =
      action === 'organize'
        ? promptInput(
            {
              text: 'Organization only',
              engine: 'chat_gpt',
              tag: data.tag,
              tags: data.tags,
            },
            String(project.language_code),
          )
        : null;
    const selected = 'project_id=? AND id IN (SELECT value FROM json_each(?))';
    const selection = [projectId, JSON.stringify(ids)];
    const change = org
      ? db()
          .prepare(`UPDATE prompts SET tag=?,tags_json=? WHERE ${selected}`)
          .bind(org.tag, JSON.stringify(org.tags), ...selection)
      : action === 'archive'
        ? db()
            .prepare(
              `UPDATE prompts SET archived=1,active=0 WHERE ${selected} AND archived=0`,
            )
            .bind(...selection)
        : action === 'pause'
          ? db()
              .prepare(
                `UPDATE prompts SET active=0 WHERE ${selected} AND active=1`,
              )
              .bind(...selection)
          : db()
              .prepare(`UPDATE prompts SET active=1,archived=0,next_run_at=CASE WHEN active=0 OR archived=1 THEN ? ELSE next_run_at END
        WHERE ${selected} AND NOT EXISTS(SELECT 1 FROM prompts other WHERE other.project_id=prompts.project_id AND other.id<>prompts.id AND other.archived=0 AND other.text=prompts.text COLLATE NOCASE AND other.engine=prompts.engine)
        AND (engine<>'gemini' OR ?='en')`)
              .bind(nextRunTime(now()), ...selection, project.language_code);
    const results = await db().batch([
      change,
      syncTopics(projectId, u.id),
      ...(['restore', 'resume', 'organize'].includes(action)
        ? capacityGuards(u.id)
        : []),
    ]);
    const updated = results[0].meta.changes;
    await startMonitoring(u.id, projectId);
    return json({ updated, skipped: ids.length - updated });
  } catch (e) {
    return fail(e);
  }
}
