import { engineSelection, reconcileInheritedPrompts } from '@/lib/server/prompts';
import { MAX_TOPIC_WEIGHT, readTopicWeights } from '@/lib/topic-weights';
import { accountCapabilities } from '@/lib/server/capabilities';
import { requireActor } from '@/lib/server/auth';
import { db, now } from '@/lib/server/env';
import { ownedProject } from '@/lib/server/workspace';
import { capacityGuards } from '@/lib/server/capabilities';
import {
  body,
  sameOrigin,
  json,
  fail,
  textField,
  ApiError,
} from '@/lib/server/http';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireActor({ write: true }),
      data = await body(request);
    const project = textField(data.project_id, 'Projeto', 1, 100),
      name = textField(data.name, 'Tópico', 1, 40);
    await ownedProject(project, u.workspaceId);
    const id = crypto.randomUUID();
    await db().batch([
      db()
        .prepare(
          'INSERT INTO topics(id,project_id,name,created_at) VALUES(?,?,?,?)',
        )
        .bind(id, project, name, now()),
      ...capacityGuards(u.workspaceId),
    ]);
    return json({ id }, 201);
  } catch (e) {
    return fail(e);
  }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireActor({ write: true }),
      data = await body(request);
    const id = textField(data.id, 'Tópico', 1, 100),
      rawName = data.name;
    const topic = await db()
      .prepare(
        'SELECT t.* FROM topics t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.workspace_id=? AND p.archived=0',
      )
      .bind(id, u.workspaceId)
      .first<{ project_id: string; name: string; engines_override_json: string | null }>();
    if (!topic) throw new ApiError(404, 'Tópico não encontrado.');
    const name = rawName === undefined ? topic.name : textField(rawName, 'Name', 1, 40);
    const project = await ownedProject(topic.project_id, u.workspaceId);
    const override = 'engines' in data ? data.engines === null ? null : JSON.stringify(engineSelection(data.engines, project, (await accountCapabilities(u.workspaceId)).engines)) : topic.engines_override_json;
    const inherited = await reconcileInheritedPrompts(topic.project_id, u.workspaceId, topic.name, project, override);
    // Topic weights (lib/topic-weights) live on the project, by topic name: a rename moves the weight, `weight` sets or
    // (null) clears it.
    if ('weight' in data && data.weight !== null && (typeof data.weight !== 'number' || !Number.isFinite(data.weight) || data.weight < 0 || data.weight > MAX_TOPIC_WEIGHT))
      throw new ApiError(400, 'Weight: use a number from 0 to 1000.');
    const weights = new Map(readTopicWeights(project.topic_weights_json) ?? []);
    const weight = 'weight' in data ? (data.weight as number | null) : weights.get(topic.name) ?? null;
    weights.delete(topic.name);
    if (weight !== null) weights.set(name, weight);
    const weightsJson = weights.size ? JSON.stringify(Object.fromEntries(weights)) : null;
    await db().batch([
      ...inherited,
      db().prepare('UPDATE projects SET topic_weights_json=? WHERE id=? AND workspace_id=?').bind(weightsJson, topic.project_id, u.workspaceId),
      db().prepare('UPDATE topics SET name=?,engines_override_json=? WHERE id=?').bind(name, override, id),
      db()
        .prepare('UPDATE prompts SET tag=? WHERE project_id=? AND tag=?')
        .bind(name, topic.project_id, topic.name),
      ...capacityGuards(u.workspaceId),
    ]);
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireActor({ write: true }),
      data = await body(request);
    const id = textField(data.id, 'Tópico', 1, 100);
    const result = await db()
      .prepare(`DELETE FROM topics WHERE id=? AND project_id IN(SELECT id FROM projects WHERE workspace_id=? AND archived=0)
      AND NOT EXISTS(SELECT 1 FROM prompts WHERE project_id=topics.project_id AND tag=topics.name AND archived=0)`)
      .bind(id, u.workspaceId)
      .run();
    if (!result.meta.changes)
      throw new ApiError(
        409,
        'Mova ou arquive os prompts antes de excluir o tópico.',
      );
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
