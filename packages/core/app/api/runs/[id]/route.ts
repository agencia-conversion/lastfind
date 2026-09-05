import { requireUser } from '@/lib/server/auth';
import { db } from '@/lib/server/env';
import { projectReadDatabase } from '@/lib/server/project-store-read';
import { runFromRow } from '@/lib/server/workspace';
import { json, fail, ApiError } from '@/lib/server/http';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const u = await requireUser(),
      { id } = await params;
    const project = await db()
      .prepare(
        'SELECT r.project_id FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.owner_id=? AND p.owner_id=? AND p.archived=0',
      )
      .bind(id, u.id, u.id)
      .first<{ project_id: string }>();
    if (!project) throw new ApiError(404, 'Response not found.');
    const database = await projectReadDatabase(project.project_id, u.id);
    const row = await database
      .prepare('SELECT * FROM runs WHERE id=? AND project_id=? AND owner_id=?')
      .bind(id, project.project_id, u.id)
      .first<Record<string, unknown>>();
    if (!row) throw new ApiError(404, 'Response not found.');
    const response = json(runFromRow(row));
    response.headers.set('X-Lastfind-Storage', database.mode);
    return response;
  } catch (e) {
    return fail(e);
  }
}
