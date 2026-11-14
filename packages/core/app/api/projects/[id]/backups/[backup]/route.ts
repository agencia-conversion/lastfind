import { requireActor } from '@/lib/server/auth';
import { ownedProject } from '@/lib/server/workspace';
import { downloadProjectBackup } from '@/lib/server/project-backups';
import { fail } from '@/lib/server/http';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; backup: string }> }) {
  try {
    const user = await requireActor({ role: 'owner' }),
      { id, backup } = await params;
    await ownedProject(id, user.workspaceId);
    return await downloadProjectBackup(id, user.workspaceId, backup);
  } catch (error) {
    return fail(error);
  }
}
