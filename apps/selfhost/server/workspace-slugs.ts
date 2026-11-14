// The independent edition has one workspace: its addresses leave it out (`/app/<project slug>/...`, app-routes.ts).
export const workspaceInPath = false;
export async function workspaceSlug(_workspaceId: string): Promise<string | null> {
  return null;
}
export async function workspaceIdBySlug(_slug: string): Promise<string | null> {
  return null;
}
