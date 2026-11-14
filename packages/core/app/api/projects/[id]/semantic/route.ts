import { requireActor } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { saveSemanticConfiguration, semanticReport } from '@/lib/server/semantic';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireActor();
    const { id } = await params;
    return json(await semanticReport(id, user.workspaceId, new URL(request.url).searchParams));
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ write: true });
    const { id } = await params;
    const data = await body(request);
    return json(await saveSemanticConfiguration(id, user.workspaceId, data, data.expectedRevision));
  } catch (error) { return fail(error); }
}
