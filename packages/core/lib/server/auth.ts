import { currentIdentity, ensureIdentity } from '@edition/server/identity';
import { ApiError } from './http';
export type User = { id: string; email: string; name: string };
export const currentUser = currentIdentity;
export async function requireUser(): Promise<User> {
  const user = await currentIdentity();
  if (!user) throw new ApiError(401, 'Entre na sua conta para continuar.');
  await ensureIdentity(user);
  return user;
}
