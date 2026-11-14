import { requireActor } from '@/lib/server/auth';
import { body, fail, json, sameOrigin } from '@/lib/server/http';
import { suggestForWizard, wizardInput } from '@/lib/server/new-project-ai';

// The New project wizard's AI suggestions (paid, one model call; whoever may create a project). Nothing is saved: the wizard sends
// the ones the person keeps with POST /api/onboarding.
// POST { step: 'competitors'|'topics'|'prompts'|'comparison', brand, domain, location, language, competitors?, topics?, quick? }
// (`quick`, competitors only: the first pass, without web search, asked beside the searched one)
// → { competitors: { name, domain, aliases, domains }[] } | { topics: { name, keyword, seed }[] } | { prompts: { text, topic, score }[] }
//   | { comparison: { products: { name, attributes }[], attributes: { name, description, group }[], personas: { name, description }[] } }
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const actor = await requireActor({ role: 'admin' });
    const { step, input } = wizardInput(await body(request));
    // Where the wait goes (the home page read, the model), for the browser's network panel and the wizard's timings.
    const timing: Record<string, number> = {};
    const response = json(await suggestForWizard(actor.workspaceId, step, input, timing));
    response.headers.set('Server-Timing', Object.entries(timing).map(([name, ms]) => `${name};dur=${ms}`).join(', '));
    return response;
  } catch (error) {
    return fail(error);
  }
}
