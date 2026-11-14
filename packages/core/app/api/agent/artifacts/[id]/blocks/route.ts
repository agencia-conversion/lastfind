import { requireActor } from '@/lib/server/auth';
import { artifactBlock, requireAgent } from '@/lib/server/agent';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// A data block computed for an artifact's editor (Insert): POST { block } → { block } with its figures, read from the
// artifact's project (viewers and above; no model, no paid provider).
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor();
    await requireAgent(actor);
    return json(await artifactBlock(actor, (await params).id, (await body(request)).block));
  } catch (error) {
    return fail(error);
  }
}
