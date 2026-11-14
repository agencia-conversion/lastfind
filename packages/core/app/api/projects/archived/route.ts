import { requireActor } from '@/lib/server/auth';
import { db } from '@/lib/server/env';
import { json, fail } from '@/lib/server/http';
// Archived projects of the workspace (Settings > Projects), for the owner, who archives and unarchives them.
export async function GET() {
  try {
    const user = await requireActor({ role: 'owner' });
    const { results } = await db()
      .prepare('SELECT id,name,domain,created_at FROM projects WHERE workspace_id=? AND archived=1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE,id')
      .bind(user.workspaceId)
      .all();
    return json({ projects: results });
  } catch (error) {
    return fail(error);
  }
}
