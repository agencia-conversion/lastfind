import { requireActor } from '@/lib/server/auth';
import { ApiError, body, fail, json, sameOrigin } from '@/lib/server/http';
import {
  brandResearchReport,
  enqueueBrandResearch,
  keptResearchReport,
  researchCopyReads,
  processPreviewBrandResearch,
  saveBrandResearchConfiguration,
} from '@/lib/server/brand-research';
import { publicResearchReport, withoutEvaluator } from '@/lib/server/internal-models';
import { withServerTiming } from '@/lib/server/server-timing';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return withServerTiming(async () => {
    try {
      const { id } = await params;
      const q = new URL(request.url).searchParams;
      // `fresh`: computed now, not the last report (the screens ask so after painting a kept one).
      const fresh = q.get('fresh') === '1';
      q.delete('fresh');
      // The project's D1 reads leave before the session is resolved (the owner is compared when both are back).
      const early = researchCopyReads(id);
      early.catch(() => {});
      const user = await requireActor();
      // Public again on the way out: a copy kept before a rule changed passes through it too.
      return json(
        publicResearchReport(
          await keptResearchReport(id, user.workspaceId, q, { fresh, early }, async () =>
            publicResearchReport(await brandResearchReport(id, user.workspaceId, q)),
          ),
        ),
      );
    } catch (error) {
      return fail(error);
    }
  });
}
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ write: true }),
      { id } = await params,
      data = await body(request);
    if (data.action === 'process')
      return json(
        withoutEvaluator(await processPreviewBrandResearch(id, user.workspaceId, data.provider)),
      );
    if (data.action != null && data.action !== 'enqueue')
      throw new ApiError(400, 'Invalid brand research operation.');
    return json(
      withoutEvaluator(
        await enqueueBrandResearch(id, user.workspaceId, new URL(request.url).searchParams, data.provider),
      ),
      202,
    );
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ write: true }),
      { id } = await params;
    return json(
      withoutEvaluator(await saveBrandResearchConfiguration(id, user.workspaceId, await body(request))),
    );
  } catch (error) {
    return fail(error);
  }
}
