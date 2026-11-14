import { AsyncLocalStorage } from 'node:async_hooks';
import { waitUntil } from 'cloudflare:workers';
import { currentIdentity, ensureIdentity, newWorkspaceGate, resolveActor, workspaceChoices } from '@edition/server/identity';
export { ensureIdentity, newWorkspaceGate, resolveActor, workspaceChoices };
import type { WorkspaceRole } from '@/lib/types';
import { ApiError } from './http';
export type User = { id: string; email: string; name: string };
/** The signed-in person acting in a workspace: `id` is the person (accounts), `workspaceId` the workspace every row it touches belongs to. */
export type Actor = User & { workspaceId: string; role: WorkspaceRole };
/**
 * The signed-in browser session's account, or null. Under an AI app's token or the in-app agent (`withTokenActor`) there is no
 * browser session: null, without reading cookies (the agent's Durable Object has no request to read them from, and a route
 * that asked would fail for it, as reading Semantic Branding did).
 */
export const currentUser = async (): Promise<User | null> => (tokenActor.getStore() ? null : currentIdentity());
// ensureIdentity is an idempotent upsert on the D1 primary (a write on every API call); once a minute per user in an isolate is enough.
const IDENTITY_TTL_MS = 60_000;
const ensured = new Map<string, number>();
/**
 * An AI app's access token acting for its account (set only by the MCP endpoint, `withTokenActor`). Under it the routes
 * see that account in the workspace the token reaches: `requireActor` returns this actor, a change also needs the
 * `lastfind:write` scope, and anything account-wide (`requireUser`) or role-gated (`role`) is refused.
 */
export type TokenActor = { actor: Actor; scopes: readonly string[]; credentialId: string };
const tokenActor = new AsyncLocalStorage<TokenActor>();
export const withTokenActor = <T>(context: TokenActor, run: () => T): T => tokenActor.run(context, run);
export const currentTokenActor = () => tokenActor.getStore();
async function signedIn() {
  const token = tokenActor.getStore();
  if (token) return { id: token.actor.id, email: token.actor.email, name: token.actor.name };
  const user = await currentIdentity();
  if (!user) throw new ApiError(401, 'Entre na sua conta para continuar.');
  return user;
}
/**
 * Keeps the account row in step with the identity. A read does not wait for it (it changes nothing the read depends on: the
 * account exists from sign-in): it finishes after the response, and a
 * failure is tried again by the next request. Anything that writes waits for it.
 */
const syncing = new Map<string, Promise<void>>();
async function ensure(user: User, inBackground = false) {
  const key = JSON.stringify([user.id, user.email, user.name]);
  // A write waits for a sync a read left running (and does it itself if that one failed).
  if (!inBackground) await syncing.get(key);
  if ((ensured.get(key) ?? 0) > Date.now()) return;
  if (ensured.size >= 500) ensured.clear();
  if (!inBackground) {
    await ensureIdentity(user);
    ensured.set(key, Date.now() + IDENTITY_TTL_MS);
    return;
  }
  ensured.set(key, Date.now() + IDENTITY_TTL_MS);
  const sync = ensureIdentity(user)
    .catch((error) => {
      ensured.delete(key);
      console.error('Lastfind identity sync failed:', error instanceof Error ? error.message : 'Unknown error');
    })
    .finally(() => syncing.delete(key));
  syncing.set(key, sync);
  waitUntil(sync);
}
export async function requireUser(): Promise<User> {
  if (tokenActor.getStore()) throw new ApiError(403, 'AI apps cannot use this action.');
  const user = await signedIn();
  await ensure(user);
  return user;
}
const RANK: Record<WorkspaceRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const roleAtLeast = (role: WorkspaceRole, needed: WorkspaceRole) => RANK[role] >= RANK[needed];
/**
 * The workspace a request acts in. The edition resolves it on every request (Cloud re-reads the membership, so a
 * removal takes effect at once); `write` needs member or above, `role` a stricter minimum (admin, owner).
 */
export async function requireActor({ write = false, role }: { write?: boolean; role?: WorkspaceRole } = {}): Promise<Actor> {
  const token = tokenActor.getStore();
  if (token) {
    if (role) throw new ApiError(403, 'AI apps cannot use this action.');
    if (write && !token.scopes.includes('lastfind:write')) throw new ApiError(403, 'This access does not allow changes.');
    if (!roleAtLeast(token.actor.role, write ? 'member' : 'viewer'))
      throw new ApiError(403, 'Your role in this workspace does not allow this action.');
    return token.actor;
  }
  const user = await signedIn();
  const [actor] = await Promise.all([resolveActor(user), ensure(user, !write && !role)]);
  if (!roleAtLeast(actor.role, role ?? (write ? 'member' : 'viewer')))
    throw new ApiError(403, 'Your role in this workspace does not allow this action.');
  return actor;
}
