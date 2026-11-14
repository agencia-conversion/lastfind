import { requireActor } from '@/lib/server/auth';
import { ownedProject } from '@/lib/server/workspace';
import { completeProjectRestoreUpload, uploadProjectRestorePart } from '@/lib/server/project-restores';
import { json, fail, sameOrigin } from '@/lib/server/http';
type Context = { params: Promise<{ id: string; restore: string }> };
// PUT ?part=N: one part of the file being uploaded (raw bytes). POST: the upload is complete; the restore starts.
export async function PUT(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ role: 'owner' }),
      { id, restore } = await params;
    await ownedProject(id, user.workspaceId);
    return json(await uploadProjectRestorePart(id, user.workspaceId, restore, Number(new URL(request.url).searchParams.get('part')), request));
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ role: 'owner' }),
      { id, restore } = await params;
    await ownedProject(id, user.workspaceId);
    return json(await completeProjectRestoreUpload(id, user.workspaceId, restore), 202);
  } catch (error) {
    return fail(error);
  }
}
