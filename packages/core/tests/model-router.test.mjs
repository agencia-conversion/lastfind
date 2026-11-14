import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The model router (lib/server/decisions-api.ts, lib/server/model-routes.ts) with every provider a fetch in this file: nothing
// paid is called and nothing leaves the process. Both editions' migrations hold the day's tally.
const root = fileURLToPath(new URL('../../../', import.meta.url));
// The public export has only the independent edition.
const EDITIONS = ['cloud', 'selfhost'].filter((name) => existsSync(root + `apps/${name}/drizzle`));

function d1(sqlite) {
  const prepare = (sql, params = []) => ({
    sql,
    params,
    bind: (...values) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async () => sqlite.prepare(sql).get(...params) || null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
  });
  return { prepare };
}
const stubs = {
  './env': 'export const db=()=>globalThis.routerFixture.db;export const now=()=>new Date().toISOString();export const setting=(name)=>globalThis.routerFixture.settings[name]??"";',
};
const bundle = await build({
  absWorkingDir: root,
  stdin: { contents: "export * from './decisions-api.ts';export { forgetRests } from './model-routes.ts';", resolveDir: root + 'packages/core/lib/server', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
  plugins: [
    {
      name: 'fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /^\.\/env$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
        plugin.onResolve({ filter: /^@\// }, (args) => ({ path: root + 'packages/core/' + args.path.slice(2) + '.ts' }));
      },
    },
  ],
});
const router = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

function setup(edition, settings) {
  const sqlite = new DatabaseSync(':memory:');
  const dir = root + `apps/${edition}/drizzle/`;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(dir + name, 'utf8'));
  globalThis.routerFixture = { db: d1(sqlite), settings };
  return sqlite;
}
/** Every request the providers got, and a fetch answering from `answer(url, body)`. */
function providers(answer) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, headers: new Headers(init?.headers) });
    const [status, json] = answer(url, body);
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}
const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

const decision = {
  model: 'openai/gpt-6-luna-decisions',
  state: { answer: 'Acme is the best choice.' },
  questions: { b0: { type: 'choice', instructions: 'Does this answer name Acme?', criteria: { brand: 'Yes.', ambiguous: 'Another entity.' } } },
};
const openAIDecision = {
  model: 'gpt-6-luna',
  answers: [{ type: 'choice', name: 'b0', choice: 'brand', confidence: 0.9, probabilities: [{ value: 'brand', probability: 0.95 }, { value: 'ambiguous', probability: 0.05 }] }],
  usage: { input_tokens: 2000, output_tokens: 3 },
};

for (const edition of EDITIONS)
  test(`${edition}: OpenAI's decision model answers on OpenAI's key, in OpenRouter's shape, and the call is tallied`, async () => {
    router.forgetRests();
    const sqlite = setup(edition, { OPENAI_API_KEY: 'sk-isolated-openai', OPENROUTER_API_KEY: 'sk-or-isolated' });
    const calls = providers((url) => (url.endsWith('/decisions') ? [200, openAIDecision] : [500, {}]));
    const response = await router.postDecisions(decision);
    assert.equal(response.status, 200);
    const raw = await response.json();
    assert.equal(raw.model, 'openai/gpt-6-luna-decisions');
    assert.deepEqual(raw.answers, { b0: { type: 'choice', choice: 'brand', probabilities: { brand: 0.95, ambiguous: 0.05 } } });
    assert.ok(Math.abs(raw.usage.cost - 0.0002) < 1e-12);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/decisions');
    assert.equal(calls[0].headers.get('authorization'), 'Bearer sk-isolated-openai');
    assert.deepEqual(calls[0].body.questions, [{ type: 'choice', name: 'b0', instructions: 'Does this answer name Acme?', choices: [{ value: 'brand', description: 'Yes.' }, { value: 'ambiguous', description: 'Another entity.' }] }]);
    const tally = sqlite.prepare('SELECT provider,task,calls,failovers,cost_usd FROM llm_provider_usage').all().map((row) => ({ ...row }));
    assert.deepEqual(tally, [{ provider: 'openai', task: 'decisions', calls: 1, failovers: 0, cost_usd: 0.0002 }]);
  });

test('credits exhausted on OpenAI move the call to OpenRouter at once, the reason is recorded, and OpenAI rests', async () => {
  const sqlite = setup(EDITIONS[0], { OPENAI_API_KEY: 'sk-isolated-openai', OPENROUTER_API_KEY: 'sk-or-isolated' });
  const calls = providers((url) =>
    url.endsWith('/v1/decisions')
      ? [429, { error: { message: 'You have run out of credits.', type: 'insufficient_quota', code: 'credit_balance_exhausted' } }]
      : [200, { model: 'openai/gpt-6-luna-decisions', answers: { b0: { type: 'choice', choice: 'brand', probabilities: { brand: 0.9, ambiguous: 0.1 } } }, usage: { cost: 0.0004 } }],
  );
  const response = await router.postDecisions(decision, 30_000, []);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).usage.cost, 0.0004);
  assert.deepEqual(calls.map((call) => call.url), ['https://api.openai.com/v1/decisions', 'https://openrouter.ai/api/alpha/decisions']);
  const rows = Object.fromEntries(sqlite.prepare('SELECT provider,calls,failovers,last_error FROM llm_provider_usage').all().map((row) => [row.provider, { ...row }]));
  assert.deepEqual(rows.openai, { provider: 'openai', calls: 0, failovers: 1, last_error: 'credit (HTTP 429)' });
  assert.equal(rows.openrouter.calls, 1);
  // Resting: the next call starts at OpenRouter.
  calls.length = 0;
  await router.postDecisions(decision, 30_000, []);
  assert.deepEqual(calls.map((call) => call.url), ['https://openrouter.ai/api/alpha/decisions']);
});

test('a decision model only OpenRouter has never goes to OpenAI or Anthropic; with no provider for it the call says so', async () => {
  setup('selfhost', { OPENAI_API_KEY: 'sk-isolated-openai', ANTHROPIC_API_KEY: 'sk-ant-isolated' });
  const calls = providers(() => [500, {}]);
  const response = await router.postDecisions({ ...decision, model: 'typesafe/jev-1.14' });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error.message, /No model provider with a key serves typesafe\/jev-1\.14/);
  assert.equal(calls.length, 0);
});

test('a generative task follows the order: Anthropic first runs its own model, and its answer reads as a chat completion', async () => {
  const sqlite = setup(EDITIONS[0], { ANTHROPIC_API_KEY: 'sk-ant-isolated', OPENROUTER_API_KEY: 'sk-or-isolated', LLM_PROVIDER_ORDER: 'anthropic,openrouter,openai' });
  const calls = providers((url) =>
    url === 'https://api.anthropic.com/v1/messages'
      ? [200, { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: '{"intents":[]}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 100 } }]
      : [500, {}],
  );
  const payload = { model: 'openai/gpt-6-luna', temperature: 0, seed: 1, max_tokens: 4000, usage: { include: true }, messages: [{ role: 'system', content: 'Group the searches.' }, { role: 'user', content: 'searches' }] };
  const response = await router.postChat(payload, 60_000, 'fanout_intents');
  const raw = await response.json();
  assert.equal(raw.choices[0].message.content, '{"intents":[]}');
  assert.ok(Math.abs(raw.usage.cost - (1000 * 0.1 + 100 * 0.5) / 1e6) < 1e-12);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, 'claude-haiku-5-5');
  assert.equal(calls[0].headers.get('x-api-key'), 'sk-ant-isolated');
  // Sampling is not sent to a model that refuses it; the system message stays the system prompt.
  assert.equal(calls[0].body.temperature, undefined);
  assert.equal(calls[0].body.system, 'Group the searches.');
  assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: 'searches' }]);
  assert.deepEqual(sqlite.prepare('SELECT provider,task,calls FROM llm_provider_usage').all().map((row) => ({ ...row })), [{ provider: 'anthropic', task: 'fanout_intents', calls: 1 }]);
});

test('a reader whose verdict is tied to its model never runs another family; a timeout is never resent elsewhere', async () => {
  setup(EDITIONS[0], { OPENAI_API_KEY: 'sk-isolated-openai', OPENROUTER_API_KEY: 'sk-or-isolated' });
  router.forgetRests();
  const calls = providers((url) => (url.startsWith('https://openrouter.ai/') ? [200, { choices: [{ message: { content: 'ok' } }], usage: { cost: 0.001 } }] : [500, {}]));
  // No task: an Anthropic model runs only on Anthropic (no key here) or OpenRouter.
  const response = await router.postChat({ model: 'anthropic/claude-haiku-5.5', messages: [{ role: 'user', content: 'x' }] }, 60_000);
  assert.equal((await response.json()).choices[0].message.content, 'ok');
  assert.deepEqual(calls.map((call) => call.url), ['https://openrouter.ai/api/v1/chat/completions']);
  // A call sent without an answer may have been billed: it throws, and the next provider is not asked.
  globalThis.fetch = async () => {
    throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
  };
  await assert.rejects(router.postDecisions(decision, 30_000, []));
});

test('a wizard with web search runs on OpenAI first with its own model and the built-in search, priced with its searches', async () => {
  router.forgetRests();
  setup('selfhost', { OPENAI_API_KEY: 'sk-isolated-openai', OPENROUTER_API_KEY: 'sk-or-isolated' });
  const calls = providers((url) =>
    url === 'https://api.openai.com/v1/responses'
      ? [200, { id: 'resp_1', output: [{ type: 'web_search_call', id: 'ws_1', status: 'completed' }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"about":"- Fact."}', annotations: [] }] }], usage: { input_tokens: 10_000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1_000 } }]
      : [500, {}],
  );
  const payload = { model: 'google/gemini-4-argon', max_tokens: 6000, reasoning: { effort: 'low' }, usage: { include: true }, plugins: [{ id: 'web' }], messages: [{ role: 'user', content: 'Write the Brain.' }] };
  const raw = await (await router.postChat(payload, 60_000, 'brain_wizard')).json();
  assert.equal(raw.choices[0].message.content, '{"about":"- Fact."}');
  // 10k input at US$ 2, 1k output at US$ 10, one search at US$ 0.01.
  assert.ok(Math.abs(raw.usage.cost - (0.02 + 0.01 + 0.01)) < 1e-12);
  assert.equal(calls.length, 1);
  const body = calls[0].body;
  assert.deepEqual({ model: body.model, tools: body.tools, reasoning: body.reasoning, max: body.max_output_tokens }, { model: 'gpt-6-sol', tools: [{ type: 'web_search' }], reasoning: { effort: 'low' }, max: 6000 });
  assert.deepEqual(body.input, [{ role: 'user', content: 'Write the Brain.' }]);
});
