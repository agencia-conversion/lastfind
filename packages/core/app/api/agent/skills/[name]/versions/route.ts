import { requireActor } from '@/lib/server/auth';
import { requireAgent } from '@/lib/server/agent';
import { skillVersions } from '@/lib/server/agent-skills';
import { fail, json } from '@/lib/server/http';

// GET → { current, canRestore, versions }: a skill's history, newest first (none while Lastfind's is as shipped).
type Context = { params: Promise<{ name: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await requireActor();
    await requireAgent(actor);
    return json(await skillVersions(actor, (await params).name));
  } catch (error) {
    return fail(error);
  }
}
