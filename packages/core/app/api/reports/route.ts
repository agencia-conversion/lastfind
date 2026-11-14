import { requireActor } from '@/lib/server/auth';
import { projectReadsById } from '@/lib/server/reports';
import { reportResponse } from '@/lib/server/report-response';
import { fail } from '@/lib/server/http';
import { withServerTiming } from '@/lib/server/server-timing';

export const GET = (request: Request) => withServerTiming(() => read(request));

async function read(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    // The project's D1 reads leave before the session is resolved (the owner is compared when both are back).
    const early = q.get('project') ? projectReadsById(q.get('project')!) : undefined;
    early?.catch(() => {});
    const user = await requireActor();
    const { body, expires, storage } = await reportResponse(user.workspaceId, q, early);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Lastfind-Cache-Expires': String(expires),
        'X-Lastfind-Storage': storage,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
