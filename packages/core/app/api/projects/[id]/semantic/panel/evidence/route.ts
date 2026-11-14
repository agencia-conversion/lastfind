import { requireActor } from '@/lib/server/auth';
import { fail, json } from '@/lib/server/http';
import { panelEvidence } from '@/lib/server/semantic-panel';

type Context = { params: Promise<{ id: string }> };

// What each AI answered behind a score (query ?brand=&attribute=&engine=&period=&cursor=).
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireActor();
    const { id } = await params;
    return json(await panelEvidence(id, user.workspaceId, new URL(request.url).searchParams));
  } catch (error) { return fail(error); }
}
