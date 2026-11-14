import { requireActor } from '@/lib/server/auth';
import { rateAnswer, requireAgent } from '@/lib/server/agent';
import { startRunners } from '@/lib/server/project-runners';
import { body, fail, json, sameOrigin } from '@/lib/server/http';

// PUT { message: <answer id>, rating: 1 | -1 | 0, reason?, comment? } → { ok: true, learning }  (0 removes the rating; the
// conversation's author only). A 👎 or a comment starts the project's curator at once (Cloud); without the runners (the
// independent edition) the scheduler's next tick runs it. `learning`: the chat polls for what it changes.
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, { params }: Context) {
  try {
    sameOrigin(request);
    const actor = await requireActor();
    await requireAgent(actor);
    const data = await body(request);
    const rated = await rateAnswer(actor, (await params).id, data.message, data.rating, data.reason, data.comment);
    if (rated.learn) await startRunners('learn', [rated.projectId]).catch((error) => console.error('Learning start failed:', error instanceof Error ? error.message.slice(0, 200) : 'Unknown error'));
    return json({ ok: true, learning: rated.learn });
  } catch (error) {
    return fail(error);
  }
}
