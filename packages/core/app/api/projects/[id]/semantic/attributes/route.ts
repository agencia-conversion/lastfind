import { requireActor } from '@/lib/server/auth';
import { fail, json, sameOrigin } from '@/lib/server/http';
import { suggestAttributes } from '@/lib/server/semantic-attributes';
import { withoutEvaluator } from '@/lib/server/internal-models';

type Context = { params: Promise<{ id: string }> };

/** The attribute wizard's suggestions (paid, one model call); nothing is saved: the wizard saves through PATCH /semantic. */
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ write: true });
    const { id } = await params;
    // The model that wrote them is internal (Admin names it): the person gets the attributes.
    return json(withoutEvaluator(await suggestAttributes(id, user.workspaceId)));
  } catch (error) { return fail(error); }
}
