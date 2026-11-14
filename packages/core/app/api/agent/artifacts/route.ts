import { requireActor } from '@/lib/server/auth';
import { createArtifact, listArtifacts, requireAgent } from '@/lib/server/agent';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// Agent > Artifacts: what the agent wrote in a project, for everyone in the workspace.
// GET  ?project=<id> → { artifacts: (ArtifactSummary & { conversation_id, created_at, shared })[] }  (newest first)
// POST { project, title, kind? } → 201 { artifact, canEdit }  (members and above: an empty one, a content its chat then writes)
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireAgent(actor);
    return json(await listArtifacts(actor, new URL(request.url).searchParams.get('project')));
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ write: true });
    await requireAgent(actor);
    const data = await body(request);
    return json(await createArtifact(actor, data.project, data), 201);
  } catch (error) {
    return fail(error);
  }
}
