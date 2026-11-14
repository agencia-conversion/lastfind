import { isAdmin } from '@edition/lib/admin-access';
import { currentUser } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { handleAdmin } from '@/lib/admin-route';
import { adminCloudflareUsage, saveAdminCloudflareUsage } from '@/lib/server/cloudflare-usage';

export const dynamic = 'force-dynamic';
const deps = {
  isAdmin,
  currentUser,
  sameOrigin,
  body,
  json,
  fail,
  list: () => adminCloudflareUsage(),
  save: saveAdminCloudflareUsage,
};
/** Every method answers 404 to anyone but an admin; GET reads this Cloudflare account's usage (cached an hour); nothing is saved here. */
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
