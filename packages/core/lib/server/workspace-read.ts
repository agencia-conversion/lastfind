import { newWorkspaceGate, workspaceChoices, type Actor } from './auth';
import { workspace } from './workspace';

/** What `GET /api/workspace` answers for the acting person (the app page sends the same read along with itself). */
export async function workspaceFor(actor: Actor, selected: string | null) {
  const [data, workspaces] = await Promise.all([workspace({ ...actor, id: actor.workspaceId }, selected), workspaceChoices(actor)]);
  return { ...data, role: actor.role, workspaces, ...(workspaces ? { newWorkspace: newWorkspaceGate(workspaces) } : {}) };
}
