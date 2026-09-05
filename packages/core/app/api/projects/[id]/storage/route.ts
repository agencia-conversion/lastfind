import { requireUser } from '@/lib/server/auth';
import { ownedProject } from '@/lib/server/workspace';
import {
  getProjectStore,
  exportProjectStore,
} from '@/lib/server/project-store';
import { projectStorageConfigured } from '@/lib/server/project-store-transport';
import {
  projectStorageAction,
  storageActionBody,
} from '@/lib/server/project-store-actions';
import { json, fail, sameOrigin } from '@/lib/server/http';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(),
      { id } = await params;
    await ownedProject(id, user.id);
    if (new URL(request.url).searchParams.get('format') === 'export')
      return exportProjectStore(id, user.id);
    return json({
      configured: projectStorageConfigured(),
      registry: await getProjectStore(id, user.id),
    });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(request);
    const user = await requireUser(),
      { id } = await params;
    await ownedProject(id, user.id);
    return json(
      await projectStorageAction(id, user.id, await storageActionBody(request)),
    );
  } catch (error) {
    return fail(error);
  }
}
