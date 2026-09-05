import { sameOrigin, json, fail } from '@/lib/server/http';
import { OWNER_SESSION_COOKIE } from '@edition/lib/owner-session';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const response = json({ ok: true });
    response.headers.set('Set-Cookie', `${OWNER_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return response;
  } catch (error) { return fail(error); }
}
