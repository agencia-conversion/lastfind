import { requireUser } from '@/lib/server/auth';
import { workspace } from '@/lib/server/workspace';
import { json, fail } from '@/lib/server/http';
export async function GET(request: Request) {
  try {
    return json(
      await workspace(
        await requireUser(),
        new URL(request.url).searchParams.get('project'),
      ),
    );
  } catch (e) {
    return fail(e);
  }
}
