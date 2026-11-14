import { requireActor } from '@/lib/server/auth';
import { conversationChanges, requireAgent } from '@/lib/server/agent';
import { fail, json } from '@/lib/server/http';

// GET → { changes }: what the agent's curator changed after this conversation (the chat polls it after a 👎 or a comment).
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await requireActor();
    await requireAgent(actor);
    return json({ changes: await conversationChanges(actor, (await params).id) });
  } catch (error) {
    return fail(error);
  }
}
