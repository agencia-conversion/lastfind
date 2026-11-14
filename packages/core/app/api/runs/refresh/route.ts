import { requireActor } from '@/lib/server/auth';
import { db, setting } from '@/lib/server/env';
import { sameOrigin, json, fail } from '@/lib/server/http';
// Compatibility endpoint: refreshing the UI must never perform provider I/O.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireActor({ write: true });
    const row = await db()
      .prepare(
        "SELECT COUNT(*) pending FROM runs WHERE workspace_id=? AND status IN ('queued','submitting','pending')",
      )
      .bind(user.workspaceId)
      .first<{ pending: number }>();
    // Without provider credentials nothing is collected, so nothing is scheduled.
    const scheduled = !!setting('DATAFORSEO_LOGIN') && !!setting('DATAFORSEO_PASSWORD');
    return json({ checked: 0, pending: row?.pending ?? 0, scheduled });
  } catch (e) {
    return fail(e);
  }
}
