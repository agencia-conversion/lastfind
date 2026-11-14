// The independent edition runs the same automatic evaluations as the hosted one (sentiment and source types of every project on
// automatic evaluations), from its one cron trigger, and only while brand research is on for the Worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stubs = {
  '@/lib/engines': 'export const SCRAPED_ENGINES=["chatgpt"];',
  '@/lib/scheduling': 'export const positiveLimit=(value,fallback)=>Number(value)>0?Number(value):fallback;',
  '@/lib/server/env': 'export const setting=(key)=>globalThis.policyFixture.settings[key]??"";',
  '@/lib/server/operations': `export { runOperations } from './run-operations';
    export const evaluationOperations=()=>[['project-sentiment',async()=>{globalThis.policyFixture.ran.push('sentiment');return 2;}],['auto-classification',async()=>{globalThis.policyFixture.ran.push('sources');return 1;}]];`,
  '@/lib/server/project-evaluations': 'export const projectSentimentStep=async(id)=>{globalThis.policyFixture.ran.push(`sentiment:${id}`);return {done:3,busy:false};};',
  '@/lib/server/source-classification': 'export const autoClassificationStep=async()=>{globalThis.policyFixture.ran.push("sources-step");return 4;};',
};
const bundle = await build({
  entryPoints: [`${root}apps/selfhost/server/policy.ts`],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
  plugins: [
    {
      name: 'policy-fixture',
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) => {
          if (stubs[args.path]) return { path: args.path, namespace: 'fixture' };
          if (args.path === './run-operations') return { path: `${root}packages/core/lib/server/run-operations.ts` };
          return undefined;
        });
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js', resolveDir: root }));
      },
    },
  ],
});
const policy = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

test('the project operations run the shared sentiment and source-type steps after the tick, only with brand research on', async () => {
  globalThis.policyFixture = { settings: { BRAND_RESEARCH_ENABLED: 'true' }, ran: [] };
  assert.equal(policy.operationsWithTick, true, 'one cron trigger: the operations run right after the monitoring tick');
  assert.deepEqual(await policy.processProjectOperations(), { total: 3, failed: [] });
  assert.deepEqual(globalThis.policyFixture.ran.sort(), ['sentiment', 'sources']);
  assert.deepEqual(await policy.projectStep('sentiment', 'p1'), { done: 3, busy: false });
  assert.deepEqual(await policy.projectStep('sources', 'p1'), { done: 4, busy: false });
  assert.equal(await policy.projectStep('roles', 'p1'), null);
  globalThis.policyFixture = { settings: {}, ran: [] };
  assert.deepEqual(await policy.processProjectOperations(), { total: 0, failed: [] });
  assert.equal(await policy.projectStep('sentiment', 'p1'), null);
  assert.deepEqual(globalThis.policyFixture.ran, [], 'nothing runs while brand research is off on the Worker');
});
