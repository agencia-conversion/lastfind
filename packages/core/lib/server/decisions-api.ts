import { RATE_LIMIT_WAITS_MS, sendDecisions } from '@/lib/decisions-transport';
import { directCost, failoverReason, type ModelProvider } from '@/lib/model-providers';
import { modelRoutes, providerKey, rest, type Route } from './model-routes';
import { recordModelCall } from './model-tally';

export { RATE_LIMIT_WAITS_MS };

// Every classifier and generative one-shot call of the server leaves through here (the agent's chat streams through
// model-chat.ts), to the first provider of the admin's order that serves it (model-routes.ts). Each answer keeps
// OpenRouter's shape, which the parsers read: a typed Decisions answer (`answers`, `usage.cost`) or a chat completion
// (`choices[0].message.content`, `usage.cost`). An error answer from one provider moves the call to the next (none bills an
// error) and is recorded for Admin; the last provider's error answer is returned as it is. A call sent without an answer (a
// timeout, a reset connection) may have been billed: it is never resent elsewhere, it throws as before. Plain fetch, as for
// OpenRouter and the search data provider: no SDK in the classifiers' path.

const OPENAI = 'https://api.openai.com/v1';
const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noRoute = (model: string) =>
  json({ error: { message: `No model provider with a key serves ${model.slice(0, 80)}. Add its key in Admin > Providers.` } }, 503);

type Outcome = { response: Response; cost: number | null } | { response: Response; status: number; body: string };

async function route(routes: Route[], task: string, model: string, send: (route: Route) => Promise<Outcome>): Promise<Response> {
  if (!routes.length) return noRoute(model);
  for (const [index, current] of routes.entries()) {
    const result = await send(current);
    if (!('status' in result)) {
      await recordModelCall(current.provider, task, current.model, { cost: result.cost });
      return result.response;
    }
    const reason = failoverReason(result.status, result.body);
    rest(current.provider, reason);
    await recordModelCall(current.provider, task, current.model, { failover: reason, status: result.status });
    const next = routes[index + 1];
    if (!next) return result.response;
    await result.response.body?.cancel();
    console.warn(`Lastfind model call: ${current.provider} answered HTTP ${result.status} (${reason}); trying ${next.provider}.`);
  }
  throw new Error('unreachable');
}

/** OpenRouter's own answer: its reported cost, or its error answer to move on from. */
async function openRouterOutcome(response: Response): Promise<Outcome> {
  if (response.ok) {
    const cost = ((await response.clone().json().catch(() => null)) as { usage?: { cost?: unknown } } | null)?.usage?.cost;
    return { response, cost: typeof cost === 'number' && Number.isFinite(cost) ? cost : null };
  }
  return { response, status: response.status, body: await response.clone().text().catch(() => '') };
}

/** A direct provider's answer: its parsed body, or its error answer (in OpenRouter's error shape) to move on from. */
async function directAnswer<T>(response: Response): Promise<{ ok: true; body: T } | { ok: false; outcome: Outcome }> {
  const text = await response.text();
  if (response.ok) return { ok: true, body: JSON.parse(text) as T };
  const message = ((): string => {
    try {
      const said = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
      return typeof said === 'string' ? said : text;
    } catch {
      return text;
    }
  })();
  return { ok: false, outcome: { status: response.status, body: text, response: json({ error: { message: message.slice(0, 300) } }, response.status) } };
}

type DecisionQuestion = { type: string; instructions?: unknown; criteria?: Record<string, unknown> };
type OpenAIDecisionAnswer = { type: string; name: string | null; choice?: string; probabilities?: { value: string; probability: number }[] };

/** OpenAI's Decisions API takes OpenRouter's keyed `choice` questions as a list, and its answers come back keyed again. */
async function openAIDecisions(model: string, payload: { model: string; state?: unknown; questions?: Record<string, DecisionQuestion> }, timeoutMs: number): Promise<Outcome> {
  const state = payload.state ?? {};
  const response = await fetch(`${OPENAI}/decisions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${providerKey('openai')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [{ role: 'user', content: [typeof state === 'object' && state !== null ? { type: 'input_json', data: state } : { type: 'input_text', text: String(state) }] }],
      questions: Object.entries(payload.questions ?? {}).map(([name, question]) => ({
        type: question.type,
        name,
        instructions: question.instructions,
        choices: Object.entries(question.criteria ?? {}).map(([value, description]) => ({ value, ...(description == null ? {} : { description: String(description) }) })),
      })),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const answer = await directAnswer<{ answers?: OpenAIDecisionAnswer[]; usage?: { input_tokens?: number } }>(response);
  if (!answer.ok) return answer.outcome;
  // A question the model declined is left out, as OpenRouter leaves it: the caller reads it as not answered.
  const answers = Object.fromEntries(
    (answer.body.answers ?? [])
      .filter((item) => item.type === 'choice' && item.name)
      .map((item) => [item.name, { type: 'choice', choice: item.choice, probabilities: Object.fromEntries((item.probabilities ?? []).map((entry) => [entry.value, entry.probability])) }]),
  );
  const cost = directCost('openai', model, { input: answer.body.usage?.input_tokens }, true);
  return { response: json({ model: payload.model, provider: 'openai', answers, usage: { cost } }), cost };
}

/**
 * One typed Decisions call (closed labels with probabilities). OpenRouter's contract (`state`, keyed `choice` questions) is
 * what callers build; OpenAI's own decision model takes the same questions on its Decisions API, answered in OpenRouter's
 * shape with the cost of its input tokens. A 429 from OpenRouter is the provider saying "not now" before any work: it is
 * sent again after a short wait, at most twice. Deterministic sampling is asked on OpenRouter (`sendDecisions`); OpenAI's
 * Decisions API has none to ask.
 */
export async function postDecisions(payload: unknown, timeoutMs = 30_000, waits = RATE_LIMIT_WAITS_MS) {
  const request = (payload ?? {}) as { model?: unknown; state?: unknown; questions?: Record<string, DecisionQuestion> };
  const model = typeof request.model === 'string' ? request.model : '';
  return route(modelRoutes(model, { decisions: true }), 'decisions', model, async (current) =>
    current.provider === 'openrouter'
      ? openRouterOutcome(await sendDecisions(payload, { key: providerKey('openrouter'), timeoutMs, waits }))
      : openAIDecisions(current.model, { ...request, model }, timeoutMs),
  );
}

type ChatPayload = {
  model?: unknown;
  messages?: { role: string; content: string }[];
  max_tokens?: number;
  reasoning?: { effort?: string };
  response_format?: { type?: string; json_schema?: { name?: string; schema?: Record<string, unknown> } };
  plugins?: { id?: string }[];
};
const chatAnswer = (model: string, provider: ModelProvider, content: string, cost: number | null): Outcome => ({
  response: json({ model, provider, choices: [{ message: { role: 'assistant', content } }], usage: { cost } }),
  cost,
});

/**
 * OpenAI's Responses API: the system messages as instructions, web search as its built-in tool, a JSON schema as the text
 * format. Sampling (temperature, seed) is not sent: its reasoning models refuse it.
 */
async function openAIChat(model: string, payload: ChatPayload, timeoutMs: number): Promise<Outcome> {
  const messages = payload.messages ?? [];
  const instructions = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const schema = payload.response_format?.type === 'json_schema' ? payload.response_format.json_schema : undefined;
  const response = await fetch(`${OPENAI}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${providerKey('openai')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      ...(instructions ? { instructions } : {}),
      input: messages.filter((message) => message.role !== 'system').map(({ role, content }) => ({ role, content })),
      max_output_tokens: payload.max_tokens ?? 4096,
      store: false,
      ...(payload.reasoning?.effort ? { reasoning: { effort: payload.reasoning.effort } } : {}),
      ...(payload.plugins?.some((plugin) => plugin.id === 'web') ? { tools: [{ type: 'web_search' }] } : {}),
      ...(schema?.schema ? { text: { format: { type: 'json_schema', name: schema.name ?? 'answer', schema: schema.schema, strict: true } } } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  type Item = { type: string; content?: { type: string; text?: string }[] };
  const answer = await directAnswer<{ output?: Item[]; usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } }>(response);
  if (!answer.ok) return answer.outcome;
  const output = answer.body.output ?? [];
  const content = output.flatMap((item) => (item.type === 'message' ? (item.content ?? []) : [])).filter((part) => part.type === 'output_text').map((part) => part.text ?? '').join('');
  const usage = answer.body.usage;
  const cost = directCost('openai', model, { input: usage?.input_tokens, cacheRead: usage?.input_tokens_details?.cached_tokens, output: usage?.output_tokens, searches: output.filter((item) => item.type === 'web_search_call').length });
  return chatAnswer(model, 'openai', content, cost);
}

/**
 * Anthropic's Messages API: the system messages as the system prompt, web search as its server tool, a JSON schema as the
 * output format, the effort asked as the output effort. Sampling is not sent: these models refuse it.
 */
async function anthropicChat(model: string, payload: ChatPayload, timeoutMs: number): Promise<Outcome> {
  const messages = payload.messages ?? [];
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const schema = payload.response_format?.type === 'json_schema' ? payload.response_format.json_schema : undefined;
  const effort = payload.reasoning?.effort;
  const output = { ...(effort ? { effort: effort === 'none' || effort === 'minimal' ? 'low' : effort } : {}), ...(schema?.schema ? { format: { type: 'json_schema', schema: schema.schema } } : {}) };
  const response = await fetch(ANTHROPIC, {
    method: 'POST',
    headers: { 'x-api-key': providerKey('anthropic'), 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: payload.max_tokens ?? 4096,
      ...(system ? { system } : {}),
      messages: messages.filter((message) => message.role !== 'system').map(({ role, content }) => ({ role, content })),
      // The newest web search runs on Sonnet and Opus; Haiku takes the basic one.
      ...(payload.plugins?.some((plugin) => plugin.id === 'web') ? { tools: [{ type: model.includes('haiku') ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 5 }] } : {}),
      ...(Object.keys(output).length ? { output_config: output } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; server_tool_use?: { web_search_requests?: number } };
  const answer = await directAnswer<{ content?: { type: string; text?: string }[]; usage?: Usage }>(response);
  if (!answer.ok) return answer.outcome;
  const content = (answer.body.content ?? []).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('');
  const usage = answer.body.usage;
  // Anthropic's input_tokens leaves the cached ones out: the total is the three together.
  const read = usage?.cache_read_input_tokens ?? 0;
  const write = usage?.cache_creation_input_tokens ?? 0;
  const cost = directCost('anthropic', model, {
    input: typeof usage?.input_tokens === 'number' ? usage.input_tokens + read + write : undefined,
    cacheRead: read,
    cacheWrite: write,
    output: usage?.output_tokens,
    searches: usage?.server_tool_use?.web_search_requests ?? 0,
  });
  return chatAnswer(model, 'anthropic', content, cost);
}

/**
 * One chat completion, for a decision that must write text (the fan-out intents: names and descriptions), a reader that
 * quotes, or a generative task (the wizards, the learning review). `task` (the classifier id) lets a provider whose family
 * the saved model is not run the task's model of its own (lib/model-providers.ts); without it only the saved model runs.
 * Same jobs ledger and ceilings as the Decisions calls.
 */
export async function postChat(payload: unknown, timeoutMs = 60_000, task?: string) {
  const request = (payload ?? {}) as ChatPayload;
  const model = typeof request.model === 'string' ? request.model : '';
  return route(modelRoutes(model, { task, decisions: false }), task ?? 'chat', model, async (current) => {
    if (current.provider === 'openai') return openAIChat(current.model, request, timeoutMs);
    if (current.provider === 'anthropic') return anthropicChat(current.model, request, timeoutMs);
    return openRouterOutcome(
      await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${providerKey('openrouter')}`, 'Content-Type': 'application/json', 'X-Title': 'Lastfind' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
  });
}

/**
 * What the provider said when it refused a call, for the stored error (its message and the model's provider, no content).
 * The wording stays the one Admin's failure checks read; which provider failed is in the day's tally (model-tally.ts).
 */
export async function refusal(response: Response) {
  const raw = (await response.json().catch(() => null)) as { error?: { message?: unknown; metadata?: { provider_name?: unknown } } } | null;
  const said = [raw?.error?.metadata?.provider_name, raw?.error?.message].filter((part) => typeof part === 'string' && part).join(': ');
  return `OpenRouter returned HTTP ${response.status}${said ? ` (${said.slice(0, 120)})` : ''}.`;
}
