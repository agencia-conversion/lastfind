import { requireActor } from '@/lib/server/auth';
import { requireAgent } from '@/lib/server/agent';
import { createSkillDraft, listSkills, saveSkill } from '@/lib/server/agent-skills';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// The workspace's skills (Agent > Skills):
// GET                              → { skills, canEdit, max }
// POST { title }                   → { artifact, canEdit }  ("New skill": a team draft from the template, members)
// POST { name, title?, content }   → the same  (a new team skill from a whole SKILL.md, on at once; members)
export async function GET() {
  try {
    const actor = await requireActor();
    await requireAgent(actor);
    return json(await listSkills(actor));
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireActor();
    await requireAgent(actor);
    const data = await body(request);
    return json(await (typeof data.content === 'string' ? saveSkill(actor, data) : createSkillDraft(actor, data)));
  } catch (error) {
    return fail(error);
  }
}
