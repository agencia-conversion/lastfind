import { requireActor } from '@/lib/server/auth';
import { changeNames, requireAgent } from '@/lib/server/agent';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// POST { ids: [...] } → { labels: { id: name } }: the prompts and topics a waiting change names, for its card.
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor();
    await requireAgent(actor);
    return json(await changeNames(actor, (await params).id, (await body(request)).ids));
  } catch (error) {
    return fail(error);
  }
}
