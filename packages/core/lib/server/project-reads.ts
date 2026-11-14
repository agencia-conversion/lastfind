import { db } from './env';
import { ApiError } from './http';

// The statements of the reads every report starts with, for a caller that sends them in one `db().batch` (one round trip)
// beside others. `ownedProject` and `getProjectStore` run the same statements alone.
export const ownedProjectStatement = (id: string, userId: string) =>
  db().prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived=0').bind(id, userId);

/** The workspace's time zone for its collection schedule (lib/scheduling.ts); null is the default zone. */
export async function workspaceZone(workspaceId: string): Promise<string | null> {
  return (await db().prepare('SELECT time_zone FROM workspaces WHERE id=?').bind(workspaceId).first<{ time_zone: string | null }>())?.time_zone ?? null;
}

/** The project a batched {@link ownedProjectStatement} found; a missing one is a 404. */
export function foundProject(row: Record<string, unknown> | null | undefined) {
  if (!row) throw new ApiError(404, 'Projeto não encontrado.');
  return row;
}

export const projectStoreStatement = (projectId: string, workspaceId: string) =>
  db().prepare('SELECT * FROM project_stores WHERE project_id=? AND workspace_id=?').bind(projectId, workspaceId);
