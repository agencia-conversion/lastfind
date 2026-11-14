import { requireActor } from '@/lib/server/auth';
import { addBrainFile, projectBrain, requireAgent, saveBrainFiles } from '@/lib/server/agent';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// Agent > Brain: the project's files of what the team taught the agent (made from a template the first time a member
// opens it; read and edited as any artifact, at /api/agent/artifacts/<id>).
// GET  ?project=<id>&locale=en|pt-BR → { files: { id, title, updated_at }[] }
// POST { project, title }            → 201 { id }  (a new, empty file; members and above)
// PUT  { project, files }            → { files }   (the wizard's kept files: each replaces the file it names or is added; members)
export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await requireAgent(actor);
    const query = new URL(request.url).searchParams;
    return json(await projectBrain(actor, query.get('project'), query.get('locale')));
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
    return json(await addBrainFile(actor, data.project, data.title), 201);
  } catch (error) {
    return fail(error);
  }
}
export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ write: true });
    await requireAgent(actor);
    const data = await body(request);
    return json(await saveBrainFiles(actor, data.project, data.files));
  } catch (error) {
    return fail(error);
  }
}
