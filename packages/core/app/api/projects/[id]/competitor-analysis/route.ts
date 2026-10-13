import { requireUser } from '@/lib/server/auth';
import {
  competitorAnalysisStatus,
  ensureCompetitorAnalysis,
} from '@/lib/server/competitor-analysis';
import { ApiError, body, fail, json, sameOrigin } from '@/lib/server/http';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return json(await competitorAnalysisStatus(id, user.id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    const { id } = await params;
    const data = await body(request);
    if (data.action !== 'refresh' && data.action !== 'ensure')
      throw new ApiError(400, 'Invalid competitor analysis operation.');
    return json(
      await ensureCompetitorAnalysis(id, user.id, data.action === 'refresh'),
    );
  } catch (error) {
    return fail(error);
  }
}
