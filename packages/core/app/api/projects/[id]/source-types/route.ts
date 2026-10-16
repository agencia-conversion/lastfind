import { requireUser } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { enqueueSourceTypes, sourceTypeClassifier } from '@/lib/server/source-types';

type Context = { params: Promise<{ id: string }> };
// Reading never calls the provider; only the explicit POST queues bounded batches.
export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser(),
      { id } = await params;
    return json(await sourceTypeClassifier(id, user.id));
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireUser(),
      { id } = await params,
      data = await body(request);
    return json(
      await enqueueSourceTypes(id, user.id, new URL(request.url).searchParams, data.kind),
      202,
    );
  } catch (error) {
    return fail(error);
  }
}
