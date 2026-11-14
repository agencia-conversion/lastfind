import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare-production';
import { storeIdentity } from '../lib/project-store-contract.ts';

// A deleted project's store generation is wiped by `erase` (lib/server/project-erase.ts), in Cloudflare's runtime; another
// project's scope is refused and leaves the data.
const root = resolve(import.meta.dirname, '../../..');
const bundle = await build({
  stdin: {
    contents: "export { ProjectStore } from './packages/core/worker/project-store.ts'; export default { fetch() { return new Response(null, { status: 404 }); } };",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  external: ['cloudflare:workers'],
  write: false,
});

test('erase wipes the generation and refuses another project', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'lastfind-erase-'));
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: 'lastfind-store-erase',
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-05-22',
      durableObjects: { PROJECT_STORES: { className: 'ProjectStore', useSQLite: true } },
      resourcePersistencePath: directory,
      unsafeDevRegistryPath: resolve(directory, 'registry'),
      telemetry: { enabled: false },
      logRequests: false,
    }),
  );
  try {
    const scope = { ownerId: 'owner', projectId: 'doomed', generation: 'g1' };
    const namespace = await runtime.getDurableObjectNamespace('PROJECT_STORES');
    const stub = namespace.get(namespace.idFromName(storeIdentity(scope)));
    const call = async (message, as = scope) => {
      const response = await stub.fetch('https://project-store/rpc', { method: 'POST', body: JSON.stringify({ scope: as, ...message }) });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await call({ action: 'initialize' })).status, 200);
    const prompt = { id: 'p1', project_id: 'doomed', text: 'Best tools?', engine: 'chat_gpt', tag: '', tags_json: '[]', next_run_at: '2026-11-10T00:00:00.000Z', active: 1, archived: 0, created_at: '2026-11-10T00:00:00.000Z' };
    assert.equal((await call({ action: 'apply', changes: [{ entity: 'prompts', id: 'p1', revision: 1, data: prompt }] })).status, 200);
    assert.notEqual((await call({ action: 'erase' }, { ...scope, projectId: 'other' })).status, 200);
    assert.equal((await call({ action: 'status' })).status, 200, 'refused erase leaves the store');
    assert.deepEqual((await call({ action: 'erase' })).body, { erased: true });
    assert.notEqual((await call({ action: 'status' })).status, 200, 'nothing is left to answer from');
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
