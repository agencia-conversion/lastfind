import { currentUser, requireUser, resolveActor } from '@/lib/server/auth';
import { setting } from '@/lib/server/env';
import { inviteLinkAccount, readWorkspaceLinkToken } from '@/lib/server/workspace-link-token';
import { safeAppPath, workspaceCookie } from '@/lib/workspace-link';
import { workspaceIdBySlug } from '@edition/server/workspace-slugs';

// Opens a workspace in the browser (its cookie), then returns to `next`. Two ways in:
// - `?slug=`: an app address names a workspace other than the one open (route-page.tsx); the cookie changes only when the
//   account belongs to it, which the page checked already.
// - `?workspace=`: the landing of an email link. The cookie changes only when the link carries a valid signature minted
//   for this account (our emails) and the account has accepted membership of that workspace (or it is its own); an
//   invitation link is signed for the invited email and opens the workspace only after the invitation was accepted in the
//   app, which otherwise asks for it.
// Any other link is ignored, with the same redirect and nothing revealed.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const response = new Response(null, {
    status: 303,
    headers: { Location: new URL(safeAppPath(url.searchParams.get('next')), url.origin).href, 'Cache-Control': 'private, no-store' },
  });
  const token = url.searchParams.get('workspace');
  const slug = url.searchParams.get('slug');
  try {
    if ((token || slug) && (await currentUser())) {
      const user = await requireUser();
      const secret = setting('SESSION_SECRET');
      const workspace = slug
        ? await workspaceIdBySlug(slug)
        : ((await readWorkspaceLinkToken(secret, user.id, token!)) ?? (await readWorkspaceLinkToken(secret, inviteLinkAccount(user.email), token!)));
      const actor = workspace ? await resolveActor(user, workspace) : null;
      const cookie = actor && actor.workspaceId === workspace ? workspaceCookie(workspace, url.protocol === 'https:') : null;
      if (cookie) response.headers.append('Set-Cookie', cookie);
    }
  } catch {
    // Any failure leaves the current workspace: the app opens as usual.
  }
  return response;
}
