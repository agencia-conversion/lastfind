import { requireUser } from '@/lib/server/auth';
import { reserveRuns } from '@/lib/server/monitor';
import { body, sameOrigin, json, fail, textField } from '@/lib/server/http';
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const u = await requireUser(),
      data = await body(request),
      key = textField(data.request_key, 'Identificador', 8, 100),
      projectId = textField(data.project_id, 'Projeto', 1, 100);
    const runs = await reserveRuns(
      u.id,
      projectId,
      key,
      data.prompt_id ? textField(data.prompt_id, 'Prompt', 1, 100) : undefined,
    );
    return json({ queued: runs.length, ids: runs.map((r) => r.id) }, 202);
  } catch (e) {
    return fail(e);
  }
}
