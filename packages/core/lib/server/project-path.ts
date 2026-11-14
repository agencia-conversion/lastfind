import { workspaceSlug } from '@edition/server/workspace-slugs';
import { projectPath } from '@/components/analytics/app-routes';
import { db } from './env';
import { storeProjectSlugs } from './project-slugs';

/**
 * A project's address in the app (`/app/<workspace>/<project>`, its Overview; app-routes.ts), for the links made on the server
 * (the agent's, an artifact's chat, the emails); null when the workspace has no such project.
 */
export async function projectAppPath(workspaceId: string, projectId: string): Promise<string | null> {
  const [project, workspace] = await Promise.all([
    db().prepare('SELECT id,name,display_name,slug FROM projects WHERE id=? AND workspace_id=?').bind(projectId, workspaceId).first<{ id: string; name: string; display_name: string | null; slug: string | null }>(),
    workspaceSlug(workspaceId),
  ]);
  if (!project) return null;
  const named = { ...project, slug: project.slug ?? undefined };
  if (!named.slug) await storeProjectSlugs(workspaceId, [named]);
  return named.slug ? projectPath(workspace, named.slug) : null;
}
