import { requireActor } from '@/lib/server/auth';
import { deleteArtifact, readArtifact, requireAgent, updateArtifact, writeArtifact } from '@/lib/server/agent';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// One artifact of the workspace:
// GET    → { artifact: Artifact, canEdit }  (?live=1: its live data blocks computed now, nothing written)
// PUT    { content, title?, version, force? } → { artifact }  (members and above; 409 when it changed since that version)
// PATCH  { title?, kind?, live?: boolean, shared?: boolean, outline?, research? } → { artifact }  (members and above; shared makes or
//        removes its public link; outline and research are a content's other tabs)
// DELETE → { ok: true }  (members and above; its link stops working)
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const actor = await requireActor();
    await requireAgent(actor);
    return json(await readArtifact(actor, (await params).id, new URL(request.url).searchParams.get('live') === '1'));
  } catch (error) {
    return fail(error);
  }
}
export async function PUT(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ write: true });
    await requireAgent(actor);
    return json(await writeArtifact(actor, (await params).id, await body(request)));
  } catch (error) {
    return fail(error);
  }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ write: true });
    await requireAgent(actor);
    return json(await updateArtifact(actor, (await params).id, await body(request)));
  } catch (error) {
    return fail(error);
  }
}
export async function DELETE(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ write: true });
    await requireAgent(actor);
    await deleteArtifact(actor, (await params).id);
    return json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
