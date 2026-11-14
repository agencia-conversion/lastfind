import { requireActor } from '@/lib/server/auth';
import { workspaceFor } from '@/lib/server/workspace-read';
import { setWorkspaceZone } from '@/lib/server/workspace';
import { validTimeZone } from '@/lib/scheduling';
import { body, sameOrigin, json, fail, ApiError } from '@/lib/server/http';
import { withServerTiming } from '@/lib/server/server-timing';
export const GET = (request: Request) =>
  withServerTiming(async () => {
    try {
      // The owner's projects, capacity and usage; the signed-in person's own name and email in `user`.
      return json(await workspaceFor(await requireActor(), new URL(request.url).searchParams.get('project')));
    } catch (e) {
      return fail(e);
    }
  });
/** `{ time_zone }`: the workspace's time zone for its collection schedule, a workspace admin's choice. */
export async function PATCH(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ role: 'admin' });
    const data = await body(request);
    if (!validTimeZone(data.time_zone)) throw new ApiError(400, 'Choose a time zone from the list.');
    await setWorkspaceZone(actor.workspaceId, data.time_zone);
    return json({ ok: true, timeZone: data.time_zone });
  } catch (e) {
    return fail(e);
  }
}
