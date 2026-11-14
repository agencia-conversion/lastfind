import { requireActor } from '@/lib/server/auth';
import { ownedProject } from '@/lib/server/workspace';
import { latestProjectRestore, startProjectRestore } from '@/lib/server/project-restores';
import { body, json, fail, sameOrigin } from '@/lib/server/http';
type Context = { params: Promise<{ id: string }> };
// Restores are the owner's, like backups (Settings > Project data). GET: the newest restore and its state.
export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireActor({ role: 'owner' }),
      { id } = await params;
    await ownedProject(id, user.workspaceId);
    return json({ restore: await latestProjectRestore(id, user.workspaceId) });
  } catch (error) {
    return fail(error);
  }
}
// POST, after the owner confirmed: `{ backup }` restores a stored backup; `{ file: { name, bytes } }` opens the upload.
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ role: 'owner' }),
      { id } = await params;
    await ownedProject(id, user.workspaceId);
    return json(await startProjectRestore(id, user.workspaceId, user.id, await body(request)), 202);
  } catch (error) {
    return fail(error);
  }
}
