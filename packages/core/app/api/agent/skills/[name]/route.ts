import { requireActor } from '@/lib/server/auth';
import { requireAgent } from '@/lib/server/agent';
import { deleteSkill, readSkill, saveSkill, setSkill } from '@/lib/server/agent-skills';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { errorLocale } from '@/lib/server/errors-i18n';
import { skillTitle } from '@/lib/agent-learning';

// One skill, by name, shaped as an artifact (the artifact view edits it):
// GET                                                   → { artifact: { id, name, title, content (its body), version, ..., skill }, canEdit }
// PUT { content, description?, title?, version }        → the same  (its new body against the version loaded: 409 when it moved on; members)
// PATCH { title?, description?, locked?, status?, proposal? } → the same  (status active or deprecated; proposal apply or dismiss; members)
// DELETE                            → { deleted, restored }  (a team skill leaves; Lastfind's goes back to its text)
type Context = { params: Promise<{ name: string }> };
async function run(request: Request, { params }: Context, work: (actor: Awaited<ReturnType<typeof requireActor>>, name: string) => Promise<unknown>) {
  try {
    if (request.method !== 'GET') sameOrigin(request);
    const actor = await requireActor();
    await requireAgent(actor);
    const out = (await work(actor, (await params).name)) as { artifact?: { name: string; title: string; skill: { title: string | null; source: string } } };
    // A skill's title in the person's language (Lastfind's are named in both; a team skill keeps its own).
    const pt = errorLocale(request.headers.get('cookie')) === 'pt-BR';
    if (out.artifact) out.artifact.title = skillTitle(out.artifact.name, pt, out.artifact.skill.source === 'team' || out.artifact.skill.source === 'learned' ? out.artifact.skill.title : null);
    return json(out);
  } catch (error) {
    return fail(error);
  }
}
export const GET = (request: Request, context: Context) => run(request, context, (actor, name) => readSkill(actor, name));
export const PUT = (request: Request, context: Context) => run(request, context, async (actor, name) => saveSkill(actor, { ...(await body(request)), name }));
export const PATCH = (request: Request, context: Context) => run(request, context, async (actor, name) => setSkill(actor, name, await body(request)));
export const DELETE = (request: Request, context: Context) => run(request, context, (actor, name) => deleteSkill(actor, name));
