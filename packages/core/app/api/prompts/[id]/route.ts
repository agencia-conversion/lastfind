import { requireUser } from '@/lib/server/auth';
import { body, sameOrigin, json, fail } from '@/lib/server/http';
import { updatePrompt } from '@/lib/server/prompts';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const u = await requireUser(),
      { id } = await params;
    return json(await updatePrompt(id, u.id, await body(request)));
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const u = await requireUser(),
      { id } = await params;
    return json(await updatePrompt(id, u.id, { archived: true }));
  } catch (e) {
    return fail(e);
  }
}
