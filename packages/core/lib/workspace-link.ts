// `?workspace=<owner id>` on an `/app` link (digest and alert emails): open that workspace when the signed-in
// account belongs to it. The page sends the link through `/api/workspace/select`, which remembers it in the
// cookie only after checking the membership, and comes back to the same address without the parameter.
export const WORKSPACE_COOKIE = 'lastfind_workspace';
/** The workspace (its slug) an app request acts in: the app sends the one its address names (Cloud, `lib/client.ts`). */
export const WORKSPACE_HEADER = 'x-lastfind-workspace';
type Query = Record<string, string | string[] | undefined>;

/** Where an app page with `?workspace=` goes first, or null when the link names none. */
export function workspaceLinkTarget(path: string, query: Query): string | null {
  const workspace = query.workspace;
  if (typeof workspace !== 'string' || !workspace) return null;
  const rest = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (key !== 'workspace') for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) rest.append(key, item);
  const next = rest.size ? `${path}?${rest}` : path;
  return `/api/workspace/select?${new URLSearchParams({ workspace, next })}`;
}

/** Only an address inside the app on this origin; anything else returns to `/app`. */
export function safeAppPath(value: string | null): string {
  return value && /^\/app(?:[/?]|$)/.test(value) && !/[\\\s]/.test(value) ? value : '/app';
}

/** The cookie for a verified workspace id, or null when the id cannot be stored as-is. */
export function workspaceCookie(id: string, secure: boolean): string | null {
  return /^[\w:.-]{1,128}$/.test(id) ? `${WORKSPACE_COOKIE}=${id}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}` : null;
}
