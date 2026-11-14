import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { streamText, wrapLanguageModel } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

// When the AI service or the database fails, the page still opens and only the feature that needs them says so, in neutral
// words: the agent's model answering 402 (no credit) or 5xx, a research job's stored refusal, D1 busy during a scheduler
// tick. A mocked fetch answers for the AI service: nothing leaves.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const file = (base) => [`${base}.ts`, `${base}.tsx`, base].find((candidate) => existsSync(candidate)) ?? base;
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents: "export { neutralModelErrors, AI_UNAVAILABLE } from './packages/core/lib/server/model-errors.ts'; export { retryRead } from './packages/core/lib/server/env.ts'; export { publicResearchReport } from './packages/core/lib/server/internal-models.ts';",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'error',
  external: ['ai'],
  plugins: [{
    name: 'workers',
    setup(plugin) {
      plugin.onResolve({ filter: /^cloudflare:/ }, (args) => ({ path: args.path, namespace: 'workers' }));
      plugin.onLoad({ filter: /.*/, namespace: 'workers' }, () => ({ contents: 'export const env={};', loader: 'js' }));
      plugin.onResolve({ filter: /^@\// }, (args) => ({ path: file(path.join(root, 'packages/core', args.path.slice(2))) }));
    },
  }],
});
const { neutralModelErrors, AI_UNAVAILABLE, retryRead, publicResearchReport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const PROVIDER = /openrouter|insufficient|credits|402|502|503|bad gateway|upstream/i;
/** The agent's model over a mocked AI service: what Think sends the chat when the stream fails (its `onError` text). */
async function chatError(answer, locale = 'en') {
  const provider = createOpenRouter({ apiKey: 'sk-or-test', fetch: async () => answer() });
  const model = wrapLanguageModel({ model: provider.chat('openai/gpt-test'), middleware: neutralModelErrors(locale) });
  const logged = console.error;
  console.error = () => {};
  try {
    const result = streamText({ model, prompt: 'hello', maxRetries: 0, onError: () => {} });
    const errors = [];
    for await (const chunk of result.toUIMessageStream({ onError: (error) => (error instanceof Error ? error.message : String(error)) }))
      if (chunk.type === 'error') errors.push(chunk.errorText);
    return errors;
  } finally {
    console.error = logged;
  }
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('the agent says the AI service is unavailable when it answers 402, 5xx or nothing, never its name or reply', async () => {
  const cases = {
    credit: () => json(402, { error: { message: 'Insufficient credits. Add more using https://openrouter.ai/settings/credits', code: 402 } }),
    down: () => json(503, { error: { message: 'OpenRouter upstream 503: bad gateway', code: 503 } }),
    html: () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    network: () => Promise.reject(new TypeError('fetch failed: connect ECONNREFUSED openrouter.ai')),
    // A 200 whose stream carries the failure (the model's provider erring mid-answer).
    stream: () => new Response('data: {"error":{"message":"OpenRouter: provider returned error 502","code":502}}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
  };
  for (const [name, answer] of Object.entries(cases)) {
    const errors = await chatError(answer);
    assert.deepEqual(errors, [AI_UNAVAILABLE], name);
  }
  assert.deepEqual(await chatError(cases.credit, 'pt-BR'), ['O serviço de IA está indisponível agora. Tente de novo em alguns minutos.']);
  assert.ok(!PROVIDER.test(AI_UNAVAILABLE));
});

test('a failure before the first word is asked once more, unseen, and the log keeps its reason', async () => {
  const sse = (...events) => new Response(events.map((event) => `data: ${event}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const failing = '{"error":{"message":"Provider returned error","code":502}}';
  const words = '{"id":"x","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"}}]}';
  const finish = '{"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}';
  const run = async (answers) => {
    let calls = 0;
    const provider = createOpenRouter({ apiKey: 'sk-or-test', fetch: async () => answers[Math.min(calls++, answers.length - 1)]() });
    const model = wrapLanguageModel({ model: provider.chat('openai/gpt-test'), middleware: neutralModelErrors('en') });
    const logged = [];
    const error = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      const result = streamText({ model, prompt: 'hello', maxRetries: 0, onError: () => {} });
      const parts = { text: '', errors: [] };
      for await (const chunk of result.toUIMessageStream({ onError: (e) => (e instanceof Error ? e.message : String(e)) }))
        if (chunk.type === 'text-delta') parts.text += chunk.delta;
        else if (chunk.type === 'error') parts.errors.push(chunk.errorText);
      return { ...parts, calls, logged };
    } finally {
      console.error = error;
    }
  };
  const recovered = await run([() => sse(failing), () => sse(words, finish, '[DONE]')]);
  assert.deepEqual([recovered.text, recovered.errors, recovered.calls], ['Hello', [], 2]);
  assert.match(recovered.logged.join('\n'), /asking again.*Provider returned error/);
  assert.doesNotMatch(recovered.logged.join('\n'), /object Object/);

  const twice = await run([() => sse(failing)]);
  assert.deepEqual([twice.errors, twice.calls], [[AI_UNAVAILABLE], 2]);
  assert.match(twice.logged.at(-1), /model call failed: .*Provider returned error/);

  // After the first word the person is already reading: no second call, the failure shows.
  const late = await run([() => sse(words, failing)]);
  assert.deepEqual([late.text, late.errors, late.calls], ['Hello', [AI_UNAVAILABLE], 1]);
});

test('a stop by the person is not turned into an outage', async () => {
  const middleware = neutralModelErrors('en');
  const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  await assert.rejects(middleware.wrapStream({ doStream: () => Promise.reject(abort) }), (error) => error === abort);
});

test('a page read waits out a busy database and fails only on a real error', async () => {
  const busy = new Error('D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window');
  let calls = 0;
  assert.equal(await retryRead(async () => (++calls < 3 ? Promise.reject(busy) : 'user'), [0, 0, 0]), 'user');
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(retryRead(async () => (++calls, Promise.reject(busy)), [0, 0]), busy);
  assert.equal(calls, 3, 'tried once, then once per wait');
  calls = 0;
  const wrong = new Error('D1_ERROR: no such column: updated_at');
  await assert.rejects(retryRead(async () => (++calls, Promise.reject(wrong)), [0, 0]), wrong);
  assert.equal(calls, 1, 'a query error is not retried');
});

test("a research job's refusal reaches the customer as a failure, without the provider's reply", () => {
  const report = { provider: 'liquid', model: 'liquid/d1-ultra', configuration: { enabled: true, provider: 'jev' }, jobs: [{ id: 'a', status: 'failed', error: 'OpenRouter returned HTTP 402 (Insufficient credits).' }, { id: 'b', status: 'completed', error: null }] };
  const shown = publicResearchReport(report);
  assert.deepEqual(shown.jobs, [{ id: 'a', status: 'failed', error: 'failed' }, { id: 'b', status: 'completed', error: null }]);
  assert.equal(JSON.stringify(shown).match(/OpenRouter|liquid|jev/), null);
  assert.deepEqual(publicResearchReport(shown), shown, 'a kept copy passes again unchanged');
});
