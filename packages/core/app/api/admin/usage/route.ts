import { isAdmin } from '@edition/lib/admin-access';
import { currentUser } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { handleAdmin } from '@/lib/admin-route';
import { adminUsage, saveAdminUsage } from '@/lib/server/admin-usage';

export const dynamic = 'force-dynamic';
const deps = {
  isAdmin,
  currentUser,
  sameOrigin,
  body,
  json,
  fail,
  list: adminUsage,
  save: saveAdminUsage,
};
/** Every method answers 404 to anyone but an admin; GET reads the ledgers, PATCH saves a project's evaluation ceiling. */
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
