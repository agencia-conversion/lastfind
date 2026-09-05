import { setting, appOrigin } from '@/lib/server/env';
import { body, sameOrigin, json, fail, ApiError } from '@/lib/server/http';
import { secureEqual } from '@/lib/server/secure-equal';
import {
  accessKeyHash,
  createOwnerSession,
  OWNER_SESSION_COOKIE,
} from '@edition/lib/owner-session';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { key } = await body(request);
    const hash = setting('OWNER_ACCESS_KEY_HASH');
    if (
      typeof key !== 'string' ||
      key.length < 32 ||
      key.length > 256 ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      !secureEqual(await accessKeyHash(key), hash)
    )
      throw new ApiError(401, 'Chave de acesso inválida.');
    const token = await createOwnerSession(
      setting('SESSION_SECRET'),
      hash,
      appOrigin(),
    );
    const response = json({ ok: true });
    response.headers.set(
      'Set-Cookie',
      `${OWNER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
    );
    return response;
  } catch (e) {
    return fail(e);
  }
}
