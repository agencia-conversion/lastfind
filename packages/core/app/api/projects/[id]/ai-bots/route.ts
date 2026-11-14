import { requireActor, roleAtLeast } from '@/lib/server/auth';
import { aiBotsReport, chooseZone, disconnect, saveToken, savedTokenZones } from '@/lib/server/ai-bots';
import { ApiError, body, fail, json, sameOrigin } from '@/lib/server/http';
import { ownedProject } from '@/lib/server/workspace';

type Context = { params: Promise<{ id: string }> };

// AI bots (lib/server/ai-bots.ts), the workspace's project:
// GET  ?days|start&end[&compareStart&compareEnd]           → { connection, report | null } (every role reads it)
// POST { action: 'token', token }                           → { ok, zones, current } | { ok: false, problem } (admins and above)
// POST { action: 'zones' }                                → { ok, zones, current } with the saved token
// POST { action: 'zone', zone }                             → { ok } | { ok: false, problem }
// POST { action: 'disconnect' }                             → { ok }
// The token is never sent back: the connection names only its last four characters.
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireActor();
    const { id } = await params;
    const project = await ownedProject(id, actor.workspaceId);
    return json(await aiBotsReport(id, actor.workspaceId, project, new URL(request.url).searchParams, roleAtLeast(actor.role, 'admin')));
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ write: true, role: 'admin' });
    const { id } = await params;
    await ownedProject(id, actor.workspaceId);
    const data = await body(request, 4000);
    if (data.action === 'token') return json(await saveToken(id, actor.workspaceId, actor.id, data.token));
    if (data.action === 'zones') return json(await savedTokenZones(id, actor.workspaceId));
    if (data.action === 'zone') return json(await chooseZone(id, actor.workspaceId, data.zone));
    if (data.action === 'disconnect') {
      await disconnect(id, actor.workspaceId);
      return json({ ok: true });
    }
    throw new ApiError(400, 'Invalid value.');
  } catch (error) {
    return fail(error);
  }
}
