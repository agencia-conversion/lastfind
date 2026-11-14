import { requireActor } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { projectBudget, setProjectBudget } from '@/lib/server/project-budgets';

type Context = { params: Promise<{ id: string }> };

// Settings > Monitoring > Budget, workspace admins and above, the workspace's project (the actor's workspace, not the user):
// GET                                             → { budgetUsd, spentUsd, leftUsd, modules, share, projectedUsd, alarm, exhausted, blocked, plan, ... }
// PUT { monthly_usd: number | null | "default" }  → the same (null, no budget, is a Lastfind admin's in Cloud)
// Every sum is the one the reservation guards read (packages/core/lib/platform-spend.ts): the screen shows what the scheduler stops at.
export async function GET(_request: Request, { params }: Context) {
  try {
    // The workspace's project, read by its admins and owner (costs are not for members and viewers).
    const actor = await requireActor({ role: 'admin' });
    return json(await projectBudget(actor, (await params).id));
  } catch (error) {
    return fail(error);
  }
}
export async function PUT(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ write: true, role: 'admin' });
    const { id } = await params;
    await setProjectBudget(actor, id, (await body(request)).monthly_usd);
    return json(await projectBudget(actor, id));
  } catch (error) {
    return fail(error);
  }
}
