import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { COLLECTED_ENGINES_SQL } from '../lib/engines.ts';

// An AI switched off (Claude, Perplexity, 8/11/2026) keeps its rows stored but never shows nor counts: every report read keeps
// to the AIs collected today, "all" included, and an old link that names one switched off drops it.
const root = resolve(import.meta.dirname, '../../..');
const { outputFiles } = await build({
  entryPoints: [resolve(root, 'packages/core/lib/server/report-filter.ts')],
  bundle: true, platform: 'node', format: 'esm', write: false,
  alias: { '@': resolve(root, 'packages/core') },
  plugins: [{
    name: 'http-stub',
    setup(b) {
      b.onResolve({ filter: /^\.\/http$/ }, ({ path }) => ({ path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }' }));
    },
  }],
});
const { parseReportFilter } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const engine = (query) => parseReportFilter(new URLSearchParams(query)).engine;

test('report reads keep to the AIs collected today', () => {
  assert.equal(engine(''), 'chat_gpt,gemini,google_ai_mode,google_ai_overviews');
  assert.equal(engine('engine=all'), 'chat_gpt,gemini,google_ai_mode,google_ai_overviews');
  assert.equal(engine('engine=gemini,claude'), 'gemini');
  assert.equal(engine('engine=perplexity'), '');
  assert.throws(() => engine('engine=bing'), /Invalid AI channel/);
  assert.equal(COLLECTED_ENGINES_SQL, "('chat_gpt','gemini','google_ai_mode','google_ai_overviews')");
});
