/** Pure Admin request handling, with the edition's admin rule and the app's auth and HTTP helpers injected for tests. */
type User = { email: string } | null | undefined;
export type AdminDeps = {
  isAdmin: (user: User) => boolean;
  currentUser: () => Promise<User>;
  sameOrigin: (request: Request) => void;
  list: () => Promise<unknown>;
  /** A PATCH: saves (or checks) and may answer with its own result; otherwise the fresh `list()` is sent. */
  save: (value: Record<string, unknown>, actor: string) => Promise<unknown>;
  body: (request: Request) => Promise<Record<string, unknown>>;
  json: (value: unknown, status?: number) => Response;
  fail: (error: unknown) => Response | Promise<Response>;
};

const notFound = (deps: AdminDeps) => deps.json({ error: 'Not found.' }, 404);

/** Admin is checked FIRST: anyone else (signed out included) gets the same 404 for every method, before any other check. */
export async function handleAdmin(request: Request, deps: AdminDeps) {
  try {
    const user = await deps.currentUser();
    if (!user || !deps.isAdmin(user)) return notFound(deps);
    if (request.method === 'GET') return deps.json(await deps.list());
    if (request.method !== 'PATCH') return notFound(deps);
    deps.sameOrigin(request);
    const result = await deps.save(await deps.body(request), user.email);
    return deps.json(result ?? (await deps.list()));
  } catch (error) {
    return deps.fail(error);
  }
}
