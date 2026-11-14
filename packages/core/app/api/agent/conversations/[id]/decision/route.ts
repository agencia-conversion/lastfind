import { requireActor } from '@/lib/server/auth';
import { decideChange } from '@/lib/server/agent';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// POST { execution, approve: boolean } → { ok: true }: runs or declines a change the conversation's agent is waiting on.
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const data = await body(request);
    await decideChange(await requireActor({ write: true }), (await params).id, data.execution, data.approve === true);
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
