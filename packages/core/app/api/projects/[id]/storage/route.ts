import { requireActor } from '@/lib/server/auth';
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
import { ownerRestore } from '@/lib/server/capabilities';
import { madeByLastfind } from '@/lib/server/project-backups';
import { projectRestoreActive } from '@/lib/server/project-restores';
import { json, fail, sameOrigin, ApiError } from '@/lib/server/http';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireActor({ role: 'owner' }),
      { id } = await params;
    await ownedProject(id, user.workspaceId);
    if (new URL(request.url).searchParams.get('format') === 'export')
      // Awaited, so a refused export (pending publications: 409) is answered by fail() instead of escaping as a 500.
      return await exportProjectStore(id, user.workspaceId, user.id); // the owner's own agent conversations only
    return json({
      configured: projectStorageConfigured(),
      registry: await getProjectStore(id, user.workspaceId),
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
    const user = await requireActor({ role: 'owner' }),
      { id } = await params;
    await ownedProject(id, user.workspaceId);
    const data = await storageActionBody(request);
    // Restoring rewrites the project's stored history. In Cloud a signed-in owner may only bring back a backup Lastfind
    // made of this project (same counts and chained digests, which restore-commit verifies row by row); any other file
    // stays an operator action (/api/operations/project-storage). Chunks and commit only fill a candidate begun that way.
    // A restore running in the background (Settings > Project data) owns the candidate generation until it ends.
    if (data.action === 'restore-begin' && (await projectRestoreActive(id, user.workspaceId)))
      throw new ApiError(409, 'A restore of this project is already running.');
    if (!ownerRestore && data.action === 'restore-begin' && !(await madeByLastfind(id, user.workspaceId, data.manifest)))
      throw new ApiError(403, 'Only backups Lastfind made of this project can be restored here.');
    return json(await projectStorageAction(id, user.workspaceId, data));
  } catch (error) {
    return fail(error);
  }
}
