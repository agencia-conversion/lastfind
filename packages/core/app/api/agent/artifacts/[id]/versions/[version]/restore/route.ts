import { requireActor } from '@/lib/server/auth';
import { requireAgent, restoreVersion } from '@/lib/server/agent';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { ARTIFACT_PARTS } from '@/lib/agent';

// POST { expected?, part? } → { version }: that version's text as a new version (members); `expected`, only from that
// version (409 otherwise); `part`, of a content's outline or research.
type Context = { params: Promise<{ id: string; version: string }> };
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor();
    await requireAgent(actor);
    const { id, version } = await params;
    const data = await body(request);
    const part = ARTIFACT_PARTS.find((item) => item === data.part) ?? null;
    return json(await restoreVersion(actor, { table: 'agent_artifacts', id, part }, version, data.expected));
  } catch (error) {
    return fail(error);
  }
}
