import { requireActor } from '@/lib/server/auth';
import { body, sameOrigin, json, fail } from '@/lib/server/http';
import { updatePrompt } from '@/lib/server/prompts';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const u = await requireActor({ write: true }),
      { id } = await params;
    return json(await updatePrompt(id, u.workspaceId, await body(request)));
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const u = await requireActor({ write: true }),
      { id } = await params;
    return json(await updatePrompt(id, u.workspaceId, { archived: true }));
  } catch (e) {
    return fail(e);
  }
}
