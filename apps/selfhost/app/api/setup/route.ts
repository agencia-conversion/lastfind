import { setting, appOrigin } from '@/lib/server/env';
import { body, sameOrigin, json, fail, ApiError } from '@/lib/server/http';
import { requireActor } from '@/lib/server/auth';
import { setWorkspaceZone } from '@/lib/server/workspace';
import { saveAdminUsage } from '@/lib/server/admin-usage';
import { validTimeZone } from '@/lib/scheduling';
import { accessKeyHash, createOwnerSession, ownerSessionCookie } from '@edition/lib/owner-session';
import { setupAllows, validAccessKey, validAdminEmail } from '@edition/lib/setup-state';
import { createFirstAdmin, currentSetupStage, markSetupComplete, setupTokenRefusal } from '@edition/server/setup';

/**
 * The setup wizard (/app/setup). `{ action: 'admin', setupToken, email, key }`: creates the first admin while the installation has
 * none, with its one-time setup token (server/setup.ts), and signs it in. `{ action: 'complete', timeZone?, monthUsd? }`: the signed-in admin saves the defaults and finishes; the wizard
 * is never shown again. Provider keys are saved through Admin's own route (/api/admin/providers), as in Admin > Providers.
 */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const data = await body(request);
    const stage = await currentSetupStage();
    if (data.action === 'admin') {
      if (!setupAllows(stage, 'admin')) throw new ApiError(409, 'This installation already has an admin. Sign in with its access key.');
      const refused = await setupTokenRefusal(data.setupToken, request.headers.get('cf-connecting-ip') ?? 'unknown');
      if (refused === 429) throw new ApiError(429, 'Too many wrong setup tokens. Try again in 15 minutes.');
      if (refused) throw new ApiError(403, 'Enter the setup token of this installation.');
      const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
      if (!validAdminEmail(email)) throw new ApiError(400, 'Enter a valid email.');
      if (!validAccessKey(data.key)) throw new ApiError(400, 'Use an access key of 32 to 256 characters.');
      const secret = setting('SESSION_SECRET');
      if (secret.length < 32) throw new ApiError(500, 'This installation has no SESSION_SECRET. Set it as a Worker secret and open this page again.');
      const hash = await accessKeyHash(data.key);
      if (!(await createFirstAdmin(email, hash))) throw new ApiError(409, 'This installation already has an admin. Sign in with its access key.');
      const response = json({ ok: true });
      response.headers.set('Set-Cookie', ownerSessionCookie(await createOwnerSession(secret, hash, appOrigin())));
      return response;
    }
    if (data.action === 'complete') {
      const actor = await requireActor({ role: 'admin' });
      // Another tab of the same admin finished first: nothing left to do.
      if (stage === 'done') return json({ ok: true });
      if (!setupAllows(stage, 'complete')) throw new ApiError(409, 'Setup is already finished. Change these settings in Admin.');
      if (data.timeZone !== undefined) {
        if (!validTimeZone(data.timeZone)) throw new ApiError(400, 'Choose a time zone from the list.');
        await setWorkspaceZone(actor.workspaceId, data.timeZone);
      }
      // The installation's monthly cap: Admin > Usage and costs' own setting (empty: none).
      if (data.monthUsd !== undefined) await saveAdminUsage({ action: 'platform', monthUsd: data.monthUsd }, actor.email);
      await markSetupComplete(actor.email);
      return json({ ok: true });
    }
    throw new ApiError(400, 'Unknown setup action.');
  } catch (error) {
    return fail(error);
  }
}
