import { requireActor } from '@/lib/server/auth';
import { requireAgent } from '@/lib/server/agent';
import { restoreSkill } from '@/lib/server/agent-skills';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// POST { expected? } → { version }: that version's text as a new version (members); `expected`, only from that version (409 otherwise).
type Context = { params: Promise<{ name: string; version: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor();
    await requireAgent(actor);
    const { name, version } = await params;
    return json(await restoreSkill(actor, name, version, (await body(request)).expected));
  } catch (error) {
    return fail(error);
  }
}
