import { requireActor } from '@/lib/server/auth';
import { db } from '@/lib/server/env';
import { capacityGuards } from '@/lib/server/capabilities';
import { json, fail, sameOrigin, ApiError } from '@/lib/server/http';
// Brings an archived project back to the project menu. Its prompts and topics count again, so the plan's capacity checks
// run in the same batch and refuse it when full. Monitoring stays paused (archiving turned it off) until the owner resumes it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request);
    const user = await requireActor({ role: 'owner' }),
      { id } = await params;
    const [updated] = await db().batch([
      db().prepare('UPDATE projects SET archived=0 WHERE id=? AND workspace_id=? AND archived=1 AND deleted_at IS NULL').bind(id, user.workspaceId),
      ...capacityGuards(user.workspaceId),
    ]);
    if (!updated?.meta.changes) throw new ApiError(404, 'Archived project not found.');
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
