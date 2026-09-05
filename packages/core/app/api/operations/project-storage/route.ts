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
export async function POST(request: Request) {
  try {
    const secret = setting('CRON_SECRET');
    if (
      secret.length < 32 ||
      !secureEqual(
        request.headers.get('authorization') || '',
        `Bearer ${secret}`,
      )
    )
      throw new ApiError(401, 'Access denied.');
    const body = await storageActionBody(request);
    if (body.action === 'flush')
      return json(await flushProjectStores({ projects: 2, rows: 50 }));
    const project = await db()
      .prepare('SELECT id,owner_id FROM projects WHERE id=?')
      .bind(typeof body.projectId === 'string' ? body.projectId : '')
      .first<{ id: string; owner_id: string }>();
    if (!project) throw new ApiError(404, 'Project not found.');
    if (body.action === 'export')
      return await exportProjectStore(project.id, project.owner_id);
    if (body.action === 'status')
      return json({
        registry: await getProjectStore(project.id, project.owner_id),
      });
    return json(await projectStorageAction(project.id, project.owner_id, body));
  } catch (error) {
    return fail(error);
  }
}
