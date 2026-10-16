import { requireUser } from '@/lib/server/auth';
import { ApiError, body, fail, json, sameOrigin } from '@/lib/server/http';
import {
  brandResearchReport,
  enqueueBrandResearch,
  processPreviewBrandResearch,
  saveBrandResearchConfiguration,
} from '@/lib/server/brand-research';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireUser(),
      { id } = await params;
    return json(
      await brandResearchReport(id, user.id, new URL(request.url).searchParams),
    );
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
    if (data.action === 'process')
      return json(
        await processPreviewBrandResearch(id, user.id, data.provider),
      );
    if (data.action != null && data.action !== 'enqueue')
      throw new ApiError(400, 'Invalid brand research operation.');
    return json(
      await enqueueBrandResearch(
        id,
        user.id,
        new URL(request.url).searchParams,
        data.provider,
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
    const user = await requireUser(),
      { id } = await params;
    return json(
      await saveBrandResearchConfiguration(id, user.id, await body(request)),
    );
  } catch (error) {
    return fail(error);
  }
}
