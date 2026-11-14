import { requireActor } from '@/lib/server/auth';
import { requireAgent } from '@/lib/server/agent';
import { getCurationBudget, setCurationBudget } from '@/lib/server/agent-curator';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// The optional monthly limit of the agent's learning in a project (Settings > Agent; none by default):
// GET ?project=<id>                          → { cap, spent, canSet, disabled }  (cap null: no limit)
// PUT { project, monthly_usd: number | null } → the same  (workspace admins; 0 turns learning off, null removes the limit)
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireAgent(actor);
    return json(await getCurationBudget(actor, new URL(request.url).searchParams.get('project')));
  } catch (error) {
    return fail(error);
  }
}
export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireActor();
    await requireAgent(actor);
    const data = await body(request);
    return json(await setCurationBudget(actor, data.project, data.monthly_usd));
  } catch (error) {
    return fail(error);
  }
}
