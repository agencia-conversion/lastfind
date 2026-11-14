import { isAdmin } from '@edition/lib/admin-access';
import { currentUser } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { handleAdmin } from '@/lib/admin-route';
import { panelDiagnostics } from '@/lib/server/semantic-panel';

export const dynamic = 'force-dynamic';
const deps = {
  isAdmin,
  currentUser,
  sameOrigin,
  body,
  json,
  fail,
  list: panelDiagnostics,
  // Read only: a PATCH changes nothing and answers with the list.
  save: async () => undefined,
};
/** Every method answers 404 to anyone but an admin; GET reads each project's latest Semantic Branding round diagnostics (read only). */
const handler = (request: Request) => handleAdmin(request, deps);
export {
  handler as GET,
  handler as PATCH,
  handler as POST,
  handler as PUT,
  handler as DELETE,
  handler as HEAD,
  handler as OPTIONS,
};
