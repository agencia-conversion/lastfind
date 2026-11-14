import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { build } from 'esbuild';

// A kept copy larger than the store keeps travels gzipped and comes back as it was (the Brands report with every
// brand's evidence passed 1 MB, was never kept, and every visit computed it again).
const root = resolve(import.meta.dirname, '../../..');
const shims = {
  'cloudflare:workers': 'export const env={};export const waitUntil=(promise)=>globalThis.packFixture.kept.push(promise);',
  './analytics-query-cache': 'export const cachedAnalyticsQuery=()=>{};export const sharedQuery=()=>{};',
  './env': 'export const appOrigin=()=>"";',
  './server-timing': 'export const timed=(name,run)=>run();',
  './project-store': 'export const ensureProjectStore=async()=>null;export const syncProjectStore=async()=>{};',
  './project-store-transport': 'export const projectStoreRpc=(message)=>globalThis.packFixture.rpc(message);',
  './http': 'export class ApiError extends Error {}',
};
const bundle = await build({
  entryPoints: [resolve(root, 'packages/core/lib/server/project-store-read.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  alias: { '@': resolve(root, 'packages/core') },
  plugins: [
    {
      name: 'pack-shims',
      setup(builder) {
        builder.onResolve({ filter: /^(\.\/(analytics-query-cache|env|server-timing|project-store|project-store-transport|http)|cloudflare:workers)$/ }, (args) => ({ path: args.path, namespace: 'shim' }));
        builder.onLoad({ filter: /.*/, namespace: 'shim' }, (args) => ({ contents: shims[args.path], loader: 'js' }));
      },
    },
  ],
});
const { storedCopy } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('a copy above the store limit is kept packed and read back whole', async () => {
  const stored = new Map();
  globalThis.packFixture = {
    kept: [],
    rpc: async (message) => {
      if (message.action === 'copy-put') return stored.set(message.key, message.value);
      return { key: 'k', epoch: 1, ...(stored.has('k') ? { value: stored.get('k'), storedAt: 1 } : {}), ...(stored.has('k') && message.copy.last ? { last: { value: stored.get('k'), storedAt: 1 } } : {}) };
    },
  };
  const scope = { workspaceId: 'o', projectId: 'p', generation: 'g' };
  const report = JSON.stringify({ details: Array.from({ length: 6000 }, (_, index) => ({ index, evidence: ['The answer names this brand '.repeat(20)] })) });
  assert.ok(report.length > 1024 * 1024, 'the fixture passes the limit');
  (await storedCopy(scope, ['r'], { last: true })).keep(report);
  await Promise.all(globalThis.packFixture.kept);
  const sent = stored.get('k');
  assert.ok(sent.startsWith('gz:') && sent.length <= 1024 * 1024, 'sent packed, within the limit');
  const read = await storedCopy(scope, ['r'], { last: true });
  assert.equal(read.value, report);
  assert.equal(read.last.value, report);
  // A small one goes as it is.
  stored.clear();
  (await storedCopy(scope, ['r'])).keep('{"small":1}');
  await Promise.all(globalThis.packFixture.kept);
  assert.equal(stored.get('k'), '{"small":1}');
});
