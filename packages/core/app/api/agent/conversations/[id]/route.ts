import { requireActor } from '@/lib/server/auth';
import { deleteConversation, readConversation, requireAgent, updateConversation } from '@/lib/server/agent';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// One conversation of the signed-in account:
// GET    → { conversation, project_id, messages: MessageView[], running, usage }
// PATCH  { title?, pinned? } → ConversationSummary
// DELETE → { ok: true }  (leaves the list; what it spent stays in the project's month)
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await requireActor();
    await requireAgent(actor);
    return json(await readConversation(actor, (await params).id));
  } catch (error) {
    return fail(error);
  }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor();
    await requireAgent(actor);
    return json(await updateConversation(actor, (await params).id, await body(request)));
  } catch (error) {
    return fail(error);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor();
    await requireAgent(actor);
    await deleteConversation(actor, (await params).id);
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
