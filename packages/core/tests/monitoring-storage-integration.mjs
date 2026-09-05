// Isolated Worker tests. All outbound fetches are replaced inside the test
// Worker; this never sends a request to DataForSEO or adds a product endpoint.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const bundle = await build({
  stdin: {
    contents: `
      import { provider } from './lib/server/dataforseo.ts';
      import { GET as health } from './app/api/health/route.ts';
      let outbound=0;
      globalThis.fetch=async()=>{outbound++;return Response.json({status_code:20000,tasks:[]})};
      export default {async fetch(request){
        const path=new URL(request.url).pathname.slice(1);
        if(path==='health')return health();
        try{await provider('chat_gpt',path,[{prompt:'No real submission'}]);return Response.json({outbound})}
        catch(error){return Response.json({outbound,error:error.message},{status:error.status||500})}
      }};
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  plugins: [
    {
      name: 'framework-response-only',
      setup(plugin) {
        // The HTTP framework helper imports Next's request context. Its response
        // and error semantics do not affect the production storage/provider gate.
        plugin.onResolve(
          { filter: /^(\.\/http|@\/lib\/server\/http)$/ },
          () => ({ path: 'http', namespace: 'test-http' }),
        );
        plugin.onLoad({ filter: /.*/, namespace: 'test-http' }, () => ({
          contents: `export class ApiError extends Error {constructor(status,message){super(message);this.status=status}};export const json=(value,status=200)=>Response.json(value,{status});`,
          loader: 'js',
        }));
      },
    },
  ],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  external: ['cloudflare:workers'],
  write: false,
});
let checks = 0;
for (const [rawArchive, projectStorage] of [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
]) {
  const directory = await mkdtemp(join(tmpdir(), 'lastfind-storage-gate-'));
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      name: 'lastfind-storage-gate-test',
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-05-22',
      d1Databases: { DB: 'health-test-control' },
      bindings: {
        DATAFORSEO_LOGIN: 'invalid-fixture',
        DATAFORSEO_PASSWORD: 'invalid-fixture',
        ...(rawArchive ? { RAW_RESPONSES: 'fixture-configured' } : {}),
        ...(projectStorage ? { PROJECT_STORES: 'fixture-configured' } : {}),
      },
      resourcePersistencePath: directory,
      unsafeDevRegistryPath: join(directory, 'registry'),
      telemetry: { enabled: false },
      logRequests: false,
    }),
  );
  try {
    const ready = rawArchive && projectStorage;
    const status = await runtime.dispatchFetch('https://fixture/health');
    assert.equal(status.status, ready ? 200 : 503);
    assert.deepEqual(await status.json(), {
      ok: ready,
      service: 'lastfind',
      database: true,
      rawArchive,
      projectStorage,
    });
    checks++;
    for (const path of ['task_post', 'live']) {
      const response = await runtime.dispatchFetch('https://fixture/' + path);
      const result = await response.json();
      assert.equal(response.status, ready ? 200 : 503);
      assert.equal(
        result.outbound,
        ready ? (path === 'task_post' ? 1 : 2) : 0,
        'Missing storage must block outbound paid requests',
      );
      checks++;
    }
  } finally {
    await runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}
console.log(
  `Monitoring storage integration passed: ${checks} health/provider checks; both paid methods stop before outbound I/O when either required store is missing.`,
);
