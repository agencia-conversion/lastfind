import { requireUser } from '@/lib/server/auth';
import { accessOverview, createToken, revokeCredential } from '@/lib/server/api-access';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// Settings > AI apps, for the signed-in account only (an AI app's token cannot reach it):
// GET    → { credentials: CredentialView[], audit: AuditRow[], limit }  (active tokens and connected apps, last 20 changes)
// POST   { name, workspace_id: string | null, scope: 'lastfind:read' | 'lastfind:read lastfind:write', days: 30 | 90 | 365 }
//        → 201 { token, credential }  (the token is shown this once)
// DELETE { id } → { ok: true }  (revokes a token or disconnects an app, at once)
// Types in `@/lib/server/api-access`; errors are `{ error }`, localised.
export async function GET() {
  try {
    return json(await accessOverview(await requireUser()));
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    return json(await createToken(user, await body(request)), 201);
  } catch (error) {
    return fail(error);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireUser();
    await revokeCredential(user, (await body(request)).id);
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
