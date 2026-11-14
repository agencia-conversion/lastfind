import { isAdmin } from '@edition/lib/admin-access';
import { currentUser } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { handleAdmin } from '@/lib/admin-route';
import { adminClassifiers, saveAdminClassifier } from '@/lib/server/admin-settings';

export const dynamic = 'force-dynamic';
const deps = {
  isAdmin,
  currentUser,
  sameOrigin,
  body,
  json,
  fail,
  list: adminClassifiers,
  save: saveAdminClassifier,
};
/** Every method answers 404 to anyone but an admin; GET reads the models, PATCH saves one function's model. */
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
