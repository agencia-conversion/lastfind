import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { truncateOlderToolResults } from 'agents/chat';

const core = fileURLToPath(new URL('..', import.meta.url));
const root = path.resolve(core, '../..');
const bundle = await build({
  absWorkingDir: root,
  stdin: { contents: `export { stepUsage } from './packages/core/lib/agent.ts';`, resolveDir: root, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  packages: 'external',
});
const { stepUsage } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test("a step's log line: cached and reasoning tokens apart, unknown fields null, never zero", () => {
  const step = {
    stepNumber: 2,
    model: { modelId: 'model-x' },
    usage: { inputTokens: 12000, inputTokenDetails: { noCacheTokens: 3000, cacheReadTokens: 9000, cacheWriteTokens: undefined }, outputTokens: 800, outputTokenDetails: { textTokens: 300, reasoningTokens: 500 } },
    finishReason: 'tool-calls',
    toolCalls: [{}, {}],
  };
  assert.deepEqual(stepUsage(step, 0.0042), { step: 2, model: 'model-x', input: 12000, cached: 9000, cache_written: null, cached_share: 0.75, output: 800, reasoning: 500, cost: 0.0042, finish: 'tool-calls', tool_calls: 2 });
  const bare = stepUsage({ stepNumber: 0 }, undefined);
  assert.equal(bare.input, null);
  assert.equal(bare.cached, null);
  assert.equal(bare.cached_share, null);
  assert.equal(bare.reasoning, null);
  assert.equal(bare.cost, null);
});

test("earlier turns' tool results are cut by Think's read-time truncation, which the agent keeps at its default", () => {
  const worker = readFileSync(path.join(core, 'worker/agent.ts'), 'utf8');
  // Overriding these would re-send every earlier page and search in full on every call, or move the cache prefix each turn.
  assert.doesNotMatch(worker, /truncationStep\s*=|hydrationByteBudget\s*=|toolOrder/);
  assert.match(worker, /console\.log\('Lastfind agent step', JSON\.stringify\(stepUsage\(/);
  // The dependency still cuts an older result and keeps its pair (same id), and leaves the recent ones whole.
  const big = 'x'.repeat(20_000);
  const ui = (id) => [
    { id: `a${id}`, role: 'assistant', parts: [{ type: 'tool-read_page', toolCallId: id, state: 'output-available', input: {}, output: { text: big } }] },
  ];
  const messages = [...ui('old'), { id: 'u', role: 'user', parts: [{ type: 'text', text: 'next' }] }, ...ui('new')];
  const model = (id) => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'read_page', output: { type: 'json', value: { text: big } } }] });
  const [older, recent] = truncateOlderToolResults([model('old'), model('new')], messages, { keepRecent: 1 });
  assert.equal(older.content[0].toolCallId, 'old');
  assert.ok(JSON.stringify(older.content[0].output).length < 1000);
  assert.equal(recent.content[0].output.value.text.length, 20_000);
});
