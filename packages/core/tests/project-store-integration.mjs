// Private, ephemeral Miniflare namespace. No application bypass, live D1 or provider I/O.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { storeIdentity } from '../lib/project-store-contract.ts';

const directory = await mkdtemp(join(tmpdir(), 'lastfind-project-store-'));
const bundled = await build({
  stdin: {
    contents:
      "export { ProjectStore } from './worker/project-store.ts'; export default { fetch() { return new Response(null, {status:404}); } };",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  external: ['cloudflare:workers'],
  write: false,
});
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    name: 'lastfind-project-store-test',
    modules: true,
    script: bundled.outputFiles[0].text,
    compatibilityDate: '2026-05-22',
    durableObjects: {
      PROJECT_STORES: { className: 'ProjectStore', useSQLite: true },
    },
    resourcePersistencePath: directory,
    unsafeDevRegistryPath: join(directory, 'registry'),
    telemetry: { enabled: false },
    logRequests: false,
  }),
);
let checks = 0;
try {
  const namespace = await runtime.getDurableObjectNamespace('PROJECT_STORES');
  const scope = {
    ownerId: 'owner-a',
    projectId: 'project-a',
    generation: 'first',
  };
  async function rpc(message, expected = 200, routingScope = message.scope) {
    const stub = namespace.get(
      namespace.idFromName(storeIdentity(routingScope)),
    );
    const response = await stub.fetch('https://project-store/rpc', {
      method: 'POST',
      body: JSON.stringify(message),
    });
    const data = await response.json();
    assert.equal(response.status, expected, JSON.stringify(data));
    checks++;
    return data;
  }
  async function query(sql = 'SELECT * FROM runs ORDER BY id') {
    return (
      await rpc({ scope, action: 'query', statements: [{ sql, params: [] }] })
    )[0].results;
  }
  const record = {
    id: 'run-a',
    owner_id: scope.ownerId,
    project_id: scope.projectId,
    prompt_id: 'prompt-a',
    prompt_text: 'Pergunta de análise',
    engine: 'chat_gpt',
    status: 'complete',
    answer: 'Olá São Paulo — 東京',
    targets_json: '[]',
    mentions_json: '{"Acme":true}',
    sources_json: '[]',
    consulted_sources_json: null,
    search_queries_json: '[]',
    response_available: 1,
    cost: 0.0012,
    created_at: '2026-09-05T07:00:00.000Z',
    completed_at: '2026-09-05T08:00:00.000Z',
  };
  const change = (revision, data = record) => ({
    entity: 'runs',
    id: record.id,
    revision,
    data,
  });
  await rpc({ scope, action: 'status' }, 409);
  await rpc({ scope, action: 'initialize' });
  await rpc({ scope, action: 'initialize' });
  assert.equal(
    (await rpc({ scope, action: 'apply', changes: [change(10)] })).applied,
    1,
  );
  assert.equal(
    (
      await rpc({
        scope,
        action: 'apply',
        changes: [change(10), change(9, { ...record, answer: 'stale' })],
      })
    ).applied,
    0,
  );
  assert.equal((await query())[0].answer, record.answer);
  // Job metadata patches must retain normalized evidence after its outbox JSON is pruned.
  const patch = {
    id: record.id,
    project_id: scope.projectId,
    owner_id: scope.ownerId,
    cost: 0.0015,
    error: null,
  };
  await rpc({ scope, action: 'apply', changes: [change(11, patch)] });
  const patched = (await query())[0];
  assert.equal(patched.answer, record.answer);
  assert.equal(patched.cost, 0.0015);
  assert.equal(patched.consulted_sources_json, null);
  // An invalid second publication rolls back the first publication and its version.
  await rpc(
    {
      scope,
      action: 'apply',
      changes: [
        change(12, { ...patch, cost: 999 }),
        {
          ...change(13),
          id: 'invalid',
          data: { ...record, id: 'invalid', owner_id: 'owner-b' },
        },
      ],
    },
    409,
  );
  assert.equal((await query())[0].cost, 0.0015);
  assert.equal(
    (await rpc({ scope, action: 'apply', changes: [change(12, patch)] }))
      .applied,
    1,
  );
  await rpc(
    { scope: { ...scope, ownerId: 'owner-b' }, action: 'status' },
    409,
    scope,
  );
  await rpc(
    { scope: { ...scope, projectId: 'project-b' }, action: 'status' },
    409,
    scope,
  );
  await rpc(
    { scope: { ...scope, generation: 'other' }, action: 'status' },
    409,
    scope,
  );
  await rpc(
    {
      scope,
      action: 'query',
      statements: [{ sql: 'SELECT * FROM runs; DELETE FROM runs', params: [] }],
    },
    409,
  );
  await rpc(
    {
      scope,
      action: 'query',
      statements: [{ sql: 'PRAGMA table_info(runs)', params: [] }],
    },
    409,
  );
  await rpc({ scope, action: 'apply', changes: [change(20, null)] });
  await rpc({ scope, action: 'apply', changes: [change(19)] });
  assert.equal(
    (await query()).length,
    0,
    'An older retry cannot resurrect a tombstone',
  );
  await rpc({ scope, action: 'apply', changes: [change(21)] });
  const foreign = {
    ownerId: 'owner-b',
    projectId: 'project-b',
    generation: 'first',
  };
  await rpc({ scope: foreign, action: 'initialize' });
  assert.equal((await rpc({ scope: foreign, action: 'status' })).runs, 0);
  // Scans are deterministic and bounded even when an answer is large.
  const more = Array.from({ length: 100 }, (_, i) => ({
    ...change(30 + i),
    id: `z-${String(i).padStart(3, '0')}`,
    data: { ...record, id: `z-${String(i).padStart(3, '0')}` },
  }));
  await rpc({ scope, action: 'apply', changes: more });
  const first = await rpc({
    scope,
    action: 'scan',
    entity: 'runs',
    limit: 1000,
  });
  assert.equal(first.rows.length, 100);
  assert.ok(first.nextCursor);
  const second = await rpc({
    scope,
    action: 'scan',
    entity: 'runs',
    cursor: first.nextCursor,
  });
  assert.equal(second.rows.length, 1);
  assert.equal(second.nextCursor, null);
  assert.equal(
    new Set([...first.rows, ...second.rows].map((row) => row.id)).size,
    101,
  );
  // Stop accumulating results at 4 MiB, including all statements and UTF-8 bytes.
  const oversizedQueries = [
    [
      {
        sql: 'SELECT hex(zeroblob(524288)) AS payload FROM runs LIMIT 6',
        params: [],
      },
    ],
    Array.from({ length: 3 }, () => ({
      sql: 'SELECT hex(zeroblob(786432)) AS payload',
      params: [],
    })),
    [
      {
        sql: 'SELECT ? AS payload FROM runs LIMIT 3',
        params: ['世'.repeat(524288)],
      },
    ],
  ];
  for (const statements of oversizedQueries) {
    const rejected = await rpc({ scope, action: 'query', statements }, 409);
    assert.equal(rejected.error, 'Query result is too large');
    assert.equal((await rpc({ scope, action: 'status' })).runs, 101);
  }
  assert.equal(
    (await query('SELECT COUNT(*) AS count FROM runs'))[0].count,
    101,
  );
  console.log(
    `Project SQLite integration passed: ${checks} native RPC checks; idempotency, atomic rollback, tombstones, metadata preservation, tenant isolation and cumulative query byte limits.`,
  );
} finally {
  await runtime.dispose();
  await rm(directory, { recursive: true, force: true });
}
