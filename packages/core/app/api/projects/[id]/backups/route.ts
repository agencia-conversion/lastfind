import { requireActor } from '@/lib/server/auth';
import { ownedProject } from '@/lib/server/workspace';
import { listProjectBackups, startProjectBackup } from '@/lib/server/project-backups';
import { json, fail, sameOrigin } from '@/lib/server/http';
type Context = { params: Promise<{ id: string }> };
// Backups are the owner's, like the export and the restore (Settings > Project data).
export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireActor({ role: 'owner' }),
      { id } = await params;
    await ownedProject(id, user.workspaceId);
    return json({ backups: await listProjectBackups(id, user.workspaceId) });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ role: 'owner' }),
      { id } = await params;
    await ownedProject(id, user.workspaceId);
    return json(await startProjectBackup(id, user.workspaceId, user.id), 202);
  } catch (error) {
    return fail(error);
  }
}
