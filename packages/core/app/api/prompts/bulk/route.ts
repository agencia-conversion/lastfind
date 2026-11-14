import { db } from '@/lib/server/env';
import { capacityGuards } from '@/lib/server/capabilities';
import { syncTopics } from '@/lib/server/topics';
import { startMonitoring } from '@/lib/server/monitor';
import { requireActor } from '@/lib/server/auth';
import {
  body,
  sameOrigin,
  json,
  fail,
  ApiError,
  textField,
} from '@/lib/server/http';
import { promptUpdateStatements } from '@/lib/server/prompts';
import { ownedProject } from '@/lib/server/workspace';
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireActor({ write: true }),
      data = await body(request);
    const project = textField(data.project_id, 'Project', 1, 100);
    if (
      !Array.isArray(data.ids) ||
      !data.ids.length ||
      data.ids.length > 100 ||
      data.ids.some((id) => typeof id !== 'string')
    )
      throw new ApiError(400, 'Select up to 100 questions.');
    const ids = [...new Set(data.ids)] as string[];
    const changes: Record<string, Record<string, unknown>> = {
      pause: { active: false },
      resume: { active: true, archived: false },
      archive: { archived: true },
      restore: { archived: false, active: true },
      organize: {
        ...('tag' in data ? { tag: data.tag } : {}),
        ...('tags' in data ? { tags: data.tags } : {}),
      },
    };
    const change = changes[String(data.action)];
    if (!change) throw new ApiError(400, 'Invalid action.');
    // One read checks that every question is in this owner's project (json_each: D1 binds at most 100 values).
    const owned = await db()
      .prepare(
        'SELECT COUNT(*) AS n FROM prompts JOIN projects ON projects.id=prompts.project_id WHERE prompts.id IN (SELECT value FROM json_each(?)) AND prompts.project_id=? AND projects.workspace_id=? AND projects.archived=0',
      )
      .bind(JSON.stringify(ids), project, user.workspaceId)
      .first<{ n: number }>();
    if (owned?.n !== ids.length)
      throw new ApiError(404, 'Question not found in this project.');
    const projectRow = await ownedProject(project, user.workspaceId);
    const statements: D1PreparedStatement[] = [];
    const capacityChecks = { engines: false, prompts: false, topics: false };
    for (const id of ids) {
      const prepared = await promptUpdateStatements(id, user.workspaceId, change, projectRow);
      statements.push(...prepared.statements);
      for (const key of ['engines', 'prompts', 'topics'] as const)
        capacityChecks[key] ||= prepared.capacityChecks[key];
    }
    await db().batch([
      ...statements,
      syncTopics(project, user.workspaceId),
      ...capacityGuards(user.workspaceId, capacityChecks),
    ]);
    await startMonitoring(user.workspaceId, project);
    const updated = ids.length;
    return json({ updated, skipped: ids.length - updated });
  } catch (error) {
    return fail(error);
  }
}
