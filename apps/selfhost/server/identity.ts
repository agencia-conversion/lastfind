import { cookies } from 'next/headers';
import { OWNER_SESSION_COOKIE, ownerKeyHash, verifyOwnerSession } from '@edition/lib/owner-session';
import { db, now, setting, appOrigin } from '@/lib/server/env';
import { loadPlatformSettings } from '@/lib/server/platform-settings';
import type { Actor, User } from '@/lib/server/auth';
const verified = async (token: string) => verifyOwnerSession(token, setting('SESSION_SECRET'), await ownerKeyHash(setting), appOrigin());
export async function currentIdentity(): Promise<User | null> {
  const token = (await cookies()).get(OWNER_SESSION_COOKIE)?.value;
  if (!token) return null;
  if (!(await verified(token))) {
    // During the first run the admin was just created, maybe by another isolate: read the settings again before refusing.
    if (setting('SETUP_COMPLETED_AT')) return null;
    await loadPlatformSettings(true);
    if (!(await verified(token))) return null;
  }
  return { id: 'owner:local', email: setting('OWNER_EMAIL'), name: setting('OWNER_NAME') || setting('OWNER_EMAIL') || 'My installation' };
}
export async function ensureIdentity(user: User) {
  // The person; the installation's one workspace has their id and is created with the account (migration 0101's trigger).
  await db().prepare(`INSERT INTO accounts(id,email,name,created_at) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name
    WHERE accounts.email<>excluded.email OR accounts.name<>excluded.name`)
    .bind(user.id,user.email,user.name,now()).run();
}
// One owner key, no members: the owner always acts in its own workspace.
export async function resolveActor(user: User, _requested?: string): Promise<Actor> {
  return { ...user, workspaceId: user.id, role: 'owner' };
}
export async function workspaceChoices(_actor: Actor): Promise<undefined> {
  return undefined;
}
// One workspace: no other is ever created.
export function newWorkspaceGate(_choices: never): undefined {
  return undefined;
}
