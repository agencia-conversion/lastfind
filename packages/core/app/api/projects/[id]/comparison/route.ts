import { isAdmin } from '@edition/lib/admin-access';
import { requireActor } from '@/lib/server/auth';
import { ApiError, body, fail, json, sameOrigin } from '@/lib/server/http';
import { comparisonAnswers, comparisonReport, comparisonSettings, saveComparison, suggestComparison } from '@/lib/server/comparison';

type Context = { params: Promise<{ id: string }> };

// Comparison (lib/server/comparison.ts), the workspace's project:
// GET   ?days|start&end[&compareStart&compareEnd][&engine][&product][&persona][&attribute]  → the report (every role; `capped` a Lastfind admin's only)
// GET   ?view=settings                                                          → the configuration, the plan's bound, the AIs asked
// GET   ?view=answers&<the report's filters>                                      → the newest 25 answers of the period and their reading
// PATCH { config, expectedRevision }                                            → saves a revision (members and above)
// POST  { action: 'suggest' }                                                   → the wizard's suggestions, nothing saved (paid, members and above)
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    const view = query.get('view');
    return json(view === 'settings' ? await comparisonSettings(id, actor.workspaceId) : view === 'answers' ? await comparisonAnswers(id, actor.workspaceId, query) : await comparisonReport(id, actor.workspaceId, query, isAdmin(actor)));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ write: true });
    const { id } = await params;
    const data = await body(request, 64_000);
    return json(await saveComparison(id, actor.workspaceId, data.config, data.expectedRevision));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ write: true });
    const { id } = await params;
    const data = await body(request, 1000);
    if (data.action !== 'suggest') throw new ApiError(400, 'Invalid value.');
    return json(await suggestComparison(id, actor.workspaceId));
  } catch (error) {
    return fail(error);
  }
}
