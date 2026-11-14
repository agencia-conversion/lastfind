import { db, setting, appOrigin } from '@/lib/server/env';
import { body, sameOrigin, json, fail, ApiError } from '@/lib/server/http';
import { secureEqual } from '@/lib/server/secure-equal';
import { clientAddress } from '@/lib/server/api-access';
import {
  accessKeyHash,
  createOwnerSession,
  ownerKeyHash,
  reserveLoginAttempt,
  ownerSessionCookie,
} from '@edition/lib/owner-session';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { key } = await body(request);
    // Counted before the compare: a refused try costs the same as a wrong key.
    if (!(await reserveLoginAttempt(db(), clientAddress(request) ?? 'unknown')))
      throw new ApiError(429, 'Too many attempts. Try again in a minute.');
    const hash = await ownerKeyHash(setting);
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
    response.headers.set('Set-Cookie', ownerSessionCookie(token));
    return response;
  } catch (e) {
    return fail(e);
  }
}
