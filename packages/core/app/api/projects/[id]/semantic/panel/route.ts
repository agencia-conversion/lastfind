import { requireActor } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { panelReport, panelSettings, savePanelFrequency } from '@/lib/server/semantic-panel';

type Context = { params: Promise<{ id: string }> };

// The report of the Semantic Branding panel (query ?period=YYYY-MM-DD&periods=N, and the page's date range `days` or `start`/`end`)
// and, with PATCH, the project's collection frequency. `?view=settings` is the frequency alone, for the configuration screen.
export async function GET(request: Request, { params }: Context) {
  try {
    const user = await requireActor();
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    return json(query.get('view') === 'settings' ? await panelSettings(id, user.workspaceId) : await panelReport(id, user.workspaceId, query));
  } catch (error) { return fail(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ write: true });
    const { id } = await params;
    return json(await savePanelFrequency(id, user.workspaceId, (await body(request)).frequency));
  } catch (error) { return fail(error); }
}
