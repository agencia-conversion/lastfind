import { requireActor } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { deleteProject } from '@/lib/server/project-erase';

type Context = { params: Promise<{ id: string }> };

/**
 * Deletes a project for good (active or archived), owner only, as archiving is: `{ name }` must be the project's name as
 * shown. The project leaves every screen at once; the scheduler erases what it held (lib/server/project-erase.ts).
 */
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ role: 'owner' });
    const { id } = await params;
    const data = await body(request);
    await deleteProject(id, user.workspaceId, user.email, data.name);
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
