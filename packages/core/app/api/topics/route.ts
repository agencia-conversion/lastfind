import { requireUser } from '@/lib/server/auth';
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
    const u = await requireUser(),
      data = await body(request);
    const project = textField(data.project_id, 'Projeto', 1, 100),
      name = textField(data.name, 'Tópico', 1, 40);
    await ownedProject(project, u.id);
    const id = crypto.randomUUID();
    await db().batch([
      db()
        .prepare(
          'INSERT INTO topics(id,project_id,name,created_at) VALUES(?,?,?,?)',
        )
        .bind(id, project, name, now()),
      ...capacityGuards(u.id),
    ]);
    return json({ id }, 201);
  } catch (e) {
    return fail(e);
  }
}
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser(),
      data = await body(request);
    const id = textField(data.id, 'Tópico', 1, 100),
      name = textField(data.name, 'Nome', 1, 40);
    const topic = await db()
      .prepare(
        'SELECT t.* FROM topics t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.owner_id=? AND p.archived=0',
      )
      .bind(id, u.id)
      .first<{ project_id: string; name: string }>();
    if (!topic) throw new ApiError(404, 'Tópico não encontrado.');
    await db().batch([
      db().prepare('UPDATE topics SET name=? WHERE id=?').bind(name, id),
      db()
        .prepare('UPDATE prompts SET tag=? WHERE project_id=? AND tag=?')
        .bind(name, topic.project_id, topic.name),
    ]);
    return json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser(),
      data = await body(request);
    const id = textField(data.id, 'Tópico', 1, 100);
    const result = await db()
      .prepare(`DELETE FROM topics WHERE id=? AND project_id IN(SELECT id FROM projects WHERE owner_id=? AND archived=0)
      AND NOT EXISTS(SELECT 1 FROM prompts WHERE project_id=topics.project_id AND tag=topics.name AND archived=0)`)
      .bind(id, u.id)
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
