import { requireActor } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { enqueueSourceTypes, sourceTypeClassifier } from '@/lib/server/source-types';
import { withoutEvaluator } from '@/lib/server/internal-models';

type Context = { params: Promise<{ id: string }> };
// Reading never calls the provider; only the explicit POST queues bounded batches.
export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireActor(),
      { id } = await params;
    return json(withoutEvaluator(await sourceTypeClassifier(id, user.workspaceId)));
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ write: true }),
      { id } = await params,
      data = await body(request);
    return json(
      withoutEvaluator(await enqueueSourceTypes(id, user.workspaceId, new URL(request.url).searchParams, data.kind)),
      202,
    );
  } catch (error) {
    return fail(error);
  }
}
