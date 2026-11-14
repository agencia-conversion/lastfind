import { requireActor } from '@/lib/server/auth';
import { listVersions, requireAgent } from '@/lib/server/agent';
import { ARTIFACT_PARTS } from '@/lib/agent';
import { fail, json } from '@/lib/server/http';

// GET [?part=outline|research] → { current, canRestore, versions }: an artifact's history (a Brain file, the Memory, a
// content's outline or research), newest first.
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireActor();
    await requireAgent(actor);
    const part = ARTIFACT_PARTS.find((item) => item === new URL(request.url).searchParams.get('part')) ?? null;
    return json(await listVersions(actor, { table: 'agent_artifacts', id: (await params).id, part }));
  } catch (error) {
    return fail(error);
  }
}
