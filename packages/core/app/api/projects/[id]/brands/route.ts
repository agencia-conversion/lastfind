import { requireActor } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { brandEvidence, brandsOverview, decideBrand } from '@/lib/server/brand-decisions';
import { brandsDigest } from '@/lib/brand-decisions';
import { discoverBrandDomainsOnVisit } from '@/lib/server/brand-domain-discovery';
import { withServerTiming } from '@/lib/server/server-timing';
import { projectReadsById } from '@/lib/server/reports';

type Context = { params: Promise<{ id: string }> };

// Server-Timing says where the time goes (D1 batch, analysis status, store), never anything private.
export async function GET(request: Request, { params }: Context) {
  return withServerTiming(async () => {
    try {
      const { id } = await params;
      const query = new URL(request.url).searchParams;
      // The project's D1 reads leave before the session is resolved (the owner is compared when both are back).
      const early = query.get('evidence') ? undefined : projectReadsById(id);
      early?.catch(() => {});
      const user = await requireActor();
      // The side panel of one brand: its answer excerpts only.
      const evidence = query.get('evidence');
      if (evidence) return json(await brandEvidence(id, user.workspaceId, evidence));
      // `fresh`: read now, not the last list (the screen asks so after a decision and after painting a kept list).
      const overview = await brandsOverview(id, user.workspaceId, { fresh: query.get('fresh') === '1', early });
      // `top`: the Overview's ranking only, not the whole list.
      return json(query.has('top') ? brandsDigest(overview, Number(query.get('top'))) : overview);
    } catch (error) {
      return fail(error);
    }
  });
}

export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const user = await requireActor({ write: true });
    const { id } = await params;
    const input = await body(request);
    // Not a decision: it fills in domains for brands that have none (free first, paid only when configured).
    if (input.action === 'discover-domains') return json(await discoverBrandDomainsOnVisit(id, user.workspaceId));
    // The decision belongs to the workspace owner; its author stays the signed-in person's email.
    return json(await decideBrand(id, { ...user, id: user.workspaceId }, input));
  } catch (error) {
    return fail(error);
  }
}
