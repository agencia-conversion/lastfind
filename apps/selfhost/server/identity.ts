import { cookies } from 'next/headers';
import { OWNER_SESSION_COOKIE, verifyOwnerSession } from '@edition/lib/owner-session';
import { db, now, setting, appOrigin } from '@/lib/server/env';
import type { User } from '@/lib/server/auth';
export async function currentIdentity(): Promise<User | null> {
  const token = (await cookies()).get(OWNER_SESSION_COOKIE)?.value;
  if (!token || !(await verifyOwnerSession(token, setting('SESSION_SECRET'), setting('OWNER_ACCESS_KEY_HASH'), appOrigin()))) return null;
  return { id: 'owner:local', email: setting('OWNER_EMAIL'), name: setting('OWNER_NAME') || setting('OWNER_EMAIL') || 'My installation' };
}
export async function ensureIdentity(user: User) {
  await db().prepare(`INSERT INTO accounts(id,email,name,created_at) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name
    WHERE accounts.email<>excluded.email OR accounts.name<>excluded.name`)
    .bind(user.id,user.email,user.name,now()).run();
}
