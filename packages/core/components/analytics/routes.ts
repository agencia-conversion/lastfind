// The app's addresses are app-routes.ts; this keeps the prompts' address slugs and the first workspace read.

export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72)
      .replace(/-+$/g, '') || 'untitled'
  );
}

/** The workspace read the app starts with (the project its long-form address names); the server sends it with the page. */
export function initialWorkspacePath(search: string, api = '/api') {
  const project = new URLSearchParams(search).get('project');
  return `${api}/workspace${project ? `?project=${encodeURIComponent(project)}` : ''}`;
}
