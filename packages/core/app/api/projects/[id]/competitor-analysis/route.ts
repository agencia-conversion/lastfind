import { requireActor } from '@/lib/server/auth';
import {
  competitorAnalysisStatus,
  ensureCompetitorAnalysis,
} from '@/lib/server/competitor-analysis';
import { withoutDecided } from '@/lib/server/brand-decision-events';
import { ApiError, body, fail, json, sameOrigin } from '@/lib/server/http';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await requireActor();
    const { id } = await params;
    const status = await competitorAnalysisStatus(id, user.workspaceId);
    return json({ ...status, suggestions: await withoutDecided(id, status.suggestions) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ write: true });
    const { id } = await params;
    const data = await body(request);
    if (data.action !== 'refresh' && data.action !== 'ensure')
      throw new ApiError(400, 'Invalid competitor analysis operation.');
    return json(
      await ensureCompetitorAnalysis(id, user.workspaceId, data.action === 'refresh'),
    );
  } catch (error) {
    return fail(error);
  }
}
