import { freeSlug, slugBase } from '@/components/analytics/app-routes';
import { db } from './env';

/**
 * Gives each project still without a slug its own (app-routes.ts): at creation, and for one written by a script or left out by
 * the migration that named them all. Its name's, or with the next free number in the workspace ("conversion-2"). A concurrent
 * write that took the same slug first fails this one (projects_owner_slug), which reads the workspace's slugs again.
 */
export async function storeProjectSlugs(workspaceId: string, projects: { id: string; name: string; display_name?: string | null; slug?: string }[]) {
  const database = db();
  for (let attempt = 0; attempt < 4; attempt++) {
    const missing = projects.filter((project) => !project.slug);
    if (!missing.length) return;
    const taken = (await database.prepare('SELECT slug FROM projects WHERE workspace_id=? AND slug IS NOT NULL').bind(workspaceId).all<{ slug: string }>()).results.map((row) => row.slug);
    for (const project of missing) {
      const slug = freeSlug(slugBase(project.display_name || project.name, 'untitled'), taken);
      taken.push(slug);
      const stored = await database
        .prepare('UPDATE projects SET slug=COALESCE(slug,?) WHERE id=? AND workspace_id=? RETURNING slug')
        .bind(slug, project.id, workspaceId)
        .first<{ slug: string }>()
        .catch(() => null);
      if (stored) project.slug = stored.slug;
    }
  }
}
