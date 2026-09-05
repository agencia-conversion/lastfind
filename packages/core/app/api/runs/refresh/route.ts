import { requireUser } from '@/lib/server/auth';
import { db } from '@/lib/server/env';
import { sameOrigin, json, fail } from '@/lib/server/http';
// Compatibility endpoint: refreshing the UI must never perform provider I/O.
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    const row = await db()
      .prepare(
        "SELECT COUNT(*) pending FROM runs WHERE owner_id=? AND status IN ('queued','submitting','pending')",
      )
      .bind(user.id)
      .first<{ pending: number }>();
    return json({ checked: 0, pending: row?.pending ?? 0, scheduled: true });
  } catch (e) {
    return fail(e);
  }
}
