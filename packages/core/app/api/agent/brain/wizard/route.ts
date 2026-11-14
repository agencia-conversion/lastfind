import { requireActor } from '@/lib/server/auth';
import { requireAgent } from '@/lib/server/agent';
import { generateBrain } from '@/lib/server/brain-wizard';
import { ApiError, body, fail, json, sameOrigin } from '@/lib/server/http';
import { withoutEvaluator } from '@/lib/server/internal-models';

// The Brain wizard's generation (paid, one model call with web search; members and above). Nothing is saved: the wizard saves the
// files the person keeps through PUT /api/agent/brain.
// POST { project, site?, language? } → { files: { key, title, content, found }[], site, language, pages } (the model is internal)
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ write: true });
    await requireAgent(actor);
    const data = await body(request);
    if (typeof data.project !== 'string' || !data.project) throw new ApiError(400, 'Choose a project.');
    return json(withoutEvaluator(await generateBrain(data.project, actor.workspaceId, { site: data.site, language: data.language })));
  } catch (error) {
    return fail(error);
  }
}
