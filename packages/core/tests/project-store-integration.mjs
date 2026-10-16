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
  await rpc({ scope, action: 'apply', changes: [{ entity: 'prompts', id: 'prompt-a', revision: 1, data: { id: 'prompt-a', project_id: scope.projectId, text: 'Legacy question', engine: 'chat_gpt' } }] });
  assert.equal((await query('SELECT subscribed FROM prompts WHERE id=\'prompt-a\''))[0].subscribed, 1);
  await rpc({ scope, action: 'apply', changes: [{ entity: 'prompts', id: 'prompt-a', revision: 2, data: { id: 'prompt-a', project_id: scope.projectId, unit_id: 'prompt-a', engines_override_json: '["chat_gpt","gemini"]', subscribed: 1 } }] });
  assert.equal((await query('SELECT unit_id FROM prompts WHERE id=\'prompt-a\''))[0].unit_id, 'prompt-a');
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
  const semantic = {
    id: 'semantic-run-a-v1', owner_id: scope.ownerId, project_id: scope.projectId,
    run_id: record.id, config_revision: 1,
    assessment_json: JSON.stringify({ readings: [{ brand: 'Acme', attribute: 'value', state: 'insufficient', score: null, quote: null, reason: 'No supported association' }] }),
    answer_sha256: 'a'.repeat(64), rubric: 'association-v1', model: 'fixture',
    coverage: 'full', cost_usd: 0.002, created_at: record.completed_at,
  };
  const semanticChange = { entity: 'semantic_evaluations', id: semantic.id, revision: 1, data: semantic };
  assert.equal((await rpc({ scope, action: 'apply', changes: [semanticChange] })).applied, 1);
  assert.equal((await query('SELECT COUNT(*) count FROM semantic_evaluations'))[0].count, 1);
  assert.equal((await rpc({ scope, action: 'apply', changes: [{ ...semanticChange, revision: 2, data: { ...semantic, assessment_json: '{}' } }] },409)).error, 'Semantic assessment mutation rejected');
  assert.equal((await rpc({ scope, action: 'apply', changes: [{ ...semanticChange, revision: 2, data: null }] },409)).error, 'Semantic assessments are append-only');
  const semanticScan = await rpc({ scope, action: 'scan', entity: 'semantic_evaluations' });
  assert.deepEqual(semanticScan.rows[0], semantic);
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
  const analysisTargets = [
    { name: 'Example', domain: 'example.test' },
    { name: 'Nova', domain: 'nova.test' },
  ];
  await rpc({
    scope,
    action: 'apply',
    changes: [
      {
        entity: 'runs',
        id: 'analysis-newest',
        revision: 200,
        data: {
          ...record,
          id: 'analysis-newest',
          answer: 'Example and Nova are comparable software platforms.',
          targets_json: JSON.stringify([analysisTargets[0]]),
          mentions_json: JSON.stringify({ Example: true }),
          created_at: '2026-09-06T07:00:00.000Z',
        },
      },
      {
        entity: 'runs',
        id: 'analysis-old',
        revision: 201,
        data: {
          ...record,
          id: 'analysis-old',
          answer: 'Nova appeared in an old answer.',
          targets_json: JSON.stringify([analysisTargets[0]]),
          mentions_json: JSON.stringify({ Example: false }),
          created_at: '2026-01-01T07:00:00.000Z',
        },
      },
      {
        entity: 'runs',
        id: 'analysis-failed',
        revision: 202,
        data: {
          ...record,
          id: 'analysis-failed',
          status: 'failed',
          answer: 'Nova appeared in a failed task.',
          targets_json: JSON.stringify([analysisTargets[0]]),
          mentions_json: JSON.stringify({ Example: false }),
          created_at: '2026-09-06T06:00:00.000Z',
        },
      },
    ],
  });
  let analysis = await rpc({
    scope,
    action: 'analysis-start',
    revision: 'targets-a',
    configVersion: 1,
    targets: analysisTargets,
    cutoff: '2026-06-01T00:00:00.000Z',
    maxRuns: 2,
  });
  for (let index = 0; analysis.status !== 'complete' && index < 10; index++)
    analysis = await rpc({ scope, action: 'analysis-process' });
  assert.equal(analysis.status, 'complete');
  assert.equal(analysis.total, 2);
  const analyzed = (
    await query(
      `SELECT targets_json,mentions_json,analysis_targets_json,analysis_mentions_json,
       CASE WHEN analysis_revision=(SELECT value FROM store_meta WHERE key='analysis_revision')
       THEN analysis_mentions_json ELSE mentions_json END effective_mentions
       FROM runs WHERE id='analysis-newest'`,
    )
  )[0];
  assert.equal(
    analyzed.targets_json,
    JSON.stringify([analysisTargets[0]]),
    'the collection target snapshot stays immutable',
  );
  assert.deepEqual(JSON.parse(analyzed.effective_mentions), {
    Example: true,
    Nova: true,
  });
  // A delayed control publication changes collection metadata but cannot erase
  // the current analytical overlay.
  await rpc({
    scope,
    action: 'apply',
    changes: [
      {
        entity: 'runs',
        id: 'analysis-newest',
        revision: 203,
        data: {
          id: 'analysis-newest',
          owner_id: scope.ownerId,
          project_id: scope.projectId,
          targets_json: JSON.stringify([analysisTargets[0]]),
          cost: 0.002,
        },
      },
    ],
  });
  assert.deepEqual(
    JSON.parse(
      (
        await query(
          `SELECT CASE WHEN analysis_revision=(SELECT value FROM store_meta WHERE key='analysis_revision')
           THEN analysis_mentions_json ELSE mentions_json END mentions_json
           FROM runs WHERE id='analysis-newest'`,
        )
      )[0].mentions_json,
    ),
    { Example: true, Nova: true },
  );
  // A normalized answer publication must exercise the overlay recompute
  // branch too; the historical collection snapshot does not replace targets.
  await rpc({
    scope,
    action: 'apply',
    changes: [
      {
        entity: 'runs',
        id: 'analysis-newest',
        revision: 204,
        data: {
          id: 'analysis-newest',
          owner_id: scope.ownerId,
          project_id: scope.projectId,
          answer: 'Only Nova is mentioned now.',
          targets_json: JSON.stringify([analysisTargets[0]]),
          mentions_json: JSON.stringify({ Example: false }),
        },
      },
    ],
  });
  const republished = (
    await query(
      "SELECT targets_json,analysis_targets_json,analysis_mentions_json FROM runs WHERE id='analysis-newest'",
    )
  )[0];
  assert.deepEqual(JSON.parse(republished.targets_json), [analysisTargets[0]]);
  assert.deepEqual(
    JSON.parse(republished.analysis_targets_json),
    analysisTargets,
  );
  assert.deepEqual(JSON.parse(republished.analysis_mentions_json), {
    Example: false,
    Nova: true,
  });
  assert.ok(
    ['pending', 'running'].includes(
      (await rpc({ scope, action: 'analysis-status' })).status,
    ),
  );
  // Monotonic configuration versions make the latest edit win even when a
  // stale request arrives after an A → B → A sequence.
  await rpc({
    scope,
    action: 'analysis-start',
    revision: 'targets-b',
    configVersion: 2,
    targets: [{ name: 'Other', domain: 'other.test' }],
    cutoff: '2026-06-01T00:00:00.000Z',
    maxRuns: 2,
  });
  await rpc({
    scope,
    action: 'analysis-start',
    revision: 'targets-a',
    configVersion: 3,
    targets: analysisTargets,
    cutoff: '2026-06-01T00:00:00.000Z',
    maxRuns: 2,
  });
  const stale = await rpc({
    scope,
    action: 'analysis-start',
    revision: 'targets-b',
    configVersion: 2,
    targets: [{ name: 'Other', domain: 'other.test' }],
    cutoff: '2026-06-01T00:00:00.000Z',
    maxRuns: 2,
  });
  assert.equal(stale.revision, 'targets-a');
  assert.equal(stale.configVersion, 3);
  // Eligibility uses the same NUMERIC coercion and default as the runs table.
  const eligibilityScope = { ...scope, generation: 'eligibility-values' };
  const eligibilityCall = (message) =>
    rpc({ scope: eligibilityScope, ...message });
  await eligibilityCall({ action: 'initialize' });
  await eligibilityCall({
    action: 'analysis-start',
    revision: 'eligibility-targets',
    configVersion: 1,
    targets: [{ name: 'Acme Beacon', domain: 'acme.test' }],
    cutoff: new Date(Date.now() - 90 * 86400000).toISOString(),
    maxRuns: 10000,
  });
  const { response_available: _responseAvailable, ...recordUsingTableDefault } =
    record;
  await eligibilityCall({
    action: 'apply',
    changes: [
      {
        entity: 'runs',
        id: 'default-eligible',
        revision: 1,
        data: {
          ...recordUsingTableDefault,
          id: 'default-eligible',
          answer:
            'Acme Beacon and Northstar Labs provide comparable release analytics.',
          created_at: new Date().toISOString(),
        },
      },
    ],
  });
  const waitForEligibilityTotal = async (total) => {
    let status;
    for (let attempts = 0; attempts < 100; attempts++) {
      status = await eligibilityCall({ action: 'analysis-status' });
      if (status.status === 'complete' && status.total === total) return status;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail(
      `eligibility analysis did not reach total ${total}: ${JSON.stringify(status)}`,
    );
  };
  await waitForEligibilityTotal(1);
  for (const [revision, value, total] of [
    [2, '0', 0],
    [3, '1.0', 1],
    [4, null, 0],
  ]) {
    await eligibilityCall({
      action: 'apply',
      changes: [
        {
          entity: 'runs',
          id: 'default-eligible',
          revision,
          data: {
            id: 'default-eligible',
            owner_id: scope.ownerId,
            project_id: scope.projectId,
            response_available: value,
          },
        },
      ],
    });
    await waitForEligibilityTotal(total);
  }

  const cancelScope = { ...scope, generation: 'cancelled-analysis' };
  const cancelCall = (message) => rpc({ scope: cancelScope, ...message });
  await cancelCall({ action: 'initialize' });
  await cancelCall({
    action: 'analysis-start',
    revision: 'orphan-revision',
    configVersion: 1,
    targets: [{ name: 'Acme Beacon', domain: 'acme.test' }],
    cutoff: new Date(Date.now() - 90 * 86400000).toISOString(),
    maxRuns: 10000,
  });
  assert.deepEqual(
    await cancelCall({
      action: 'analysis-cancel',
      revision: 'different-revision',
    }),
    { cancelled: false },
  );
  assert.deepEqual(
    await cancelCall({
      action: 'analysis-cancel',
      revision: 'orphan-revision',
    }),
    { cancelled: true },
  );
  assert.equal(
    (await cancelCall({ action: 'analysis-status' })).status,
    'idle',
  );
  // An answer longer than the persisted seed window becomes its own truncated
  // reference on the page that analyses it. The extractor then masked a range the
  // window does not contain, the alarm marked the job failed and every call through
  // the Durable Object answered 503. The page must complete and still find the
  // competitor that only appears past the window.
  const seedWindowScope = {
    ...scope,
    generation: 'answer-longer-than-seed-window',
  };
  const seedWindowCall = (message) =>
    rpc({ scope: seedWindowScope, ...message });
  await seedWindowCall({ action: 'initialize' });
  const seedWindowFiller = Array.from(
    { length: 200 },
    (_, index) =>
      `Parágrafo ${index}: a equipe revisa relatórios de release e ajusta a cobertura semana a semana.`,
  ).join(' ');
  const seedWindowAnswer = [
    '**Acme Beacon** coordinates release evidence for distributed teams.',
    seedWindowFiller,
    '**Northstar Labs** coordinates release evidence for distributed teams.',
  ].join('\n\n');
  assert.ok(
    seedWindowAnswer.length > 8000 &&
      seedWindowAnswer.indexOf('Northstar Labs') > 8000,
    'the regression needs the competitor beyond the 8000-character seed window',
  );
  const seedWindowStamp = new Date().toISOString();
  await seedWindowCall({
    action: 'apply',
    changes: [
      {
        entity: 'runs',
        id: 'long-answer',
        revision: 1,
        data: {
          ...record,
          id: 'long-answer',
          answer: seedWindowAnswer,
          created_at: seedWindowStamp,
          completed_at: seedWindowStamp,
        },
      },
    ],
  });
  await seedWindowCall({
    action: 'analysis-start',
    revision: 'long-answer-targets',
    configVersion: 1,
    targets: [{ name: 'Acme Beacon', domain: 'acme.test' }],
    cutoff: new Date(Date.now() - 90 * 86400000).toISOString(),
    maxRuns: 10000,
  });
  let seedWindowStatus;
  for (let attempts = 0; attempts < 100; attempts++) {
    seedWindowStatus = await seedWindowCall({ action: 'analysis-status' });
    if (['complete', 'failed'].includes(seedWindowStatus.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(
    seedWindowStatus.status,
    'complete',
    `analysis over a long answer must not fail: ${seedWindowStatus.error}`,
  );
  assert.equal(seedWindowStatus.error, null);
  assert.equal(seedWindowStatus.total, 1);
  assert.ok(
    seedWindowStatus.suggestions.some(
      (candidate) => candidate.name === 'Northstar Labs',
    ),
    'the competitor past the seed window is still discovered',
  );
  checks++;

  // Empty windows must clear active suggestions and overlays after either
  // an answer expires, its response becomes unavailable, or it is deleted.
  // A pending restore job also completes by alarm with status-only polling.
  for (const operation of ['expire', 'unavailable', 'delete']) {
    const isolatedScope = { ...scope, generation: `empty-${operation}` };
    const call = (message) => rpc({ scope: isolatedScope, ...message });
    const timestamp = new Date().toISOString();
    const isolatedRecord = {
      ...record,
      id: 'eligible',
      answer:
        '**Acme Beacon** coordinates release evidence for distributed teams. **Northstar Labs** coordinates release evidence for distributed teams.',
      created_at: timestamp,
      completed_at: timestamp,
    };
    await call({ action: 'initialize' });
    await call({
      action: 'apply',
      changes: [
        { entity: 'runs', id: 'eligible', revision: 1, data: isolatedRecord },
      ],
    });
    await call({
      action: 'analysis-start',
      revision: 'restored-targets',
      configVersion: 1,
      targets: [{ name: 'Acme Beacon', domain: 'acme.test' }],
      cutoff: new Date(Date.now() - 90 * 86400000).toISOString(),
      maxRuns: 10000,
    });
    let ready;
    for (let attempts = 0; attempts < 100; attempts++) {
      ready = await call({ action: 'analysis-status' });
      if (ready.status === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      ready.status,
      'complete',
      'alarm resumes without analysis-process/GET repair',
    );
    assert.equal(ready.total, 1);
    assert.ok(
      ready.suggestions.some(
        (candidate) => candidate.name === 'Northstar Labs',
      ),
    );
    const data =
      operation === 'delete'
        ? null
        : {
            id: 'eligible',
            owner_id: scope.ownerId,
            project_id: scope.projectId,
            ...(operation === 'expire'
              ? { created_at: '2020-01-01T00:00:00.000Z' }
              : { response_available: 0 }),
          };
    await call({
      action: 'apply',
      changes: [{ entity: 'runs', id: 'eligible', revision: 2, data }],
    });
    const empty = await call({ action: 'analysis-status' });
    assert.equal(empty.status, 'complete');
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.suggestions, []);
    assert.ok(empty.mutationRevision > ready.mutationRevision);
    const emptyRows = (
      await call({
        action: 'query',
        statements: [
          {
            sql: 'SELECT analysis_revision,analysis_targets_json,analysis_mentions_json FROM runs',
            params: [],
          },
        ],
      })
    )[0].results;
    assert.ok(
      emptyRows.every((row) =>
        Object.values(row).every((value) => value === null),
      ),
    );
    const status = await call({ action: 'status' });
    assert.equal(status.analysisRevision, null);
    if (operation !== 'delete') {
      const collection = (
        await call({
          action: 'query',
          statements: [
            {
              sql: 'SELECT answer,targets_json,mentions_json,cost FROM runs',
              params: [],
            },
          ],
        })
      )[0].results[0];
      assert.equal(collection.answer, isolatedRecord.answer);
      assert.equal(collection.targets_json, isolatedRecord.targets_json);
      assert.equal(collection.mentions_json, isolatedRecord.mentions_json);
      assert.equal(collection.cost, isolatedRecord.cost);
    }
  }
  // An eligible schema-2 snapshot keeps its previous overlay while pending,
  // then derives positive mentions from the saved text through its alarm.
  const positiveScope = { ...scope, generation: 'restored-positive' };
  const positiveCall = (message) => rpc({ scope: positiveScope, ...message });
  await positiveCall({ action: 'initialize' });
  const positiveRecord = {
    ...record,
    answer: 'Example and Nova are comparable software platforms.',
    created_at: new Date().toISOString(),
    targets_json: JSON.stringify([analysisTargets[0]]),
    mentions_json: JSON.stringify({ Example: true }),
    analysis_revision: 'positive-targets',
    analysis_targets_json: JSON.stringify(analysisTargets),
    analysis_mentions_json: JSON.stringify({ Example: true, Nova: false }),
  };
  await positiveCall({
    action: 'apply',
    changes: [
      {
        entity: 'runs',
        id: positiveRecord.id,
        revision: 0,
        data: positiveRecord,
      },
    ],
  });
  await positiveCall({
    action: 'analysis-set-current',
    revision: 'positive-targets',
  });
  const positiveQuery = () =>
    positiveCall({
      action: 'query',
      statements: [{ sql: 'SELECT * FROM runs', params: [] }],
    });
  assert.deepEqual(
    JSON.parse((await positiveQuery())[0].results[0].analysis_mentions_json),
    { Example: true, Nova: false },
  );
  const positiveStart = await positiveCall({
    action: 'analysis-start',
    revision: 'positive-targets',
    configVersion: 1,
    targets: analysisTargets,
    cutoff: new Date(Date.now() - 90 * 86400000).toISOString(),
    maxRuns: 10000,
  });
  assert.equal(positiveStart.status, 'pending');
  let positiveDone;
  for (let attempts = 0; attempts < 100; attempts++) {
    positiveDone = await positiveCall({ action: 'analysis-status' });
    if (positiveDone.status === 'complete') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(positiveDone.status, 'complete');
  const positiveAfter = (await positiveQuery())[0].results[0];
  assert.deepEqual(JSON.parse(positiveAfter.analysis_mentions_json), {
    Example: true,
    Nova: true,
  });
  for (const column of ['answer', 'targets_json', 'mentions_json', 'cost'])
    assert.equal(positiveAfter[column], positiveRecord[column]);
  // A schema-2 restore can contain an overlay whose entire answer window has
  // expired. The current-window rebuild supersedes derived data, never raw data.
  const expiredScope = { ...scope, generation: 'restored-expired' };
  const expiredCall = (message) => rpc({ scope: expiredScope, ...message });
  await expiredCall({ action: 'initialize' });
  const expiredRecord = {
    ...record,
    created_at: '2020-01-01T00:00:00.000Z',
    analysis_revision: 'restored-targets',
    analysis_targets_json: JSON.stringify(analysisTargets),
    analysis_mentions_json: JSON.stringify({ Example: true, Nova: true }),
  };
  await expiredCall({
    action: 'apply',
    changes: [
      {
        entity: 'runs',
        id: expiredRecord.id,
        revision: 0,
        data: expiredRecord,
      },
    ],
  });
  await expiredCall({
    action: 'analysis-set-current',
    revision: 'restored-targets',
  });
  const rebuiltEmpty = await expiredCall({
    action: 'analysis-start',
    revision: 'restored-targets',
    configVersion: 1,
    targets: analysisTargets,
    cutoff: new Date(Date.now() - 90 * 86400000).toISOString(),
    maxRuns: 10000,
  });
  assert.equal(rebuiltEmpty.status, 'complete');
  assert.equal(rebuiltEmpty.total, 0);
  assert.deepEqual(rebuiltEmpty.suggestions, []);
  const expiredAfter = (
    await expiredCall({
      action: 'query',
      statements: [{ sql: 'SELECT * FROM runs', params: [] }],
    })
  )[0].results[0];
  for (const column of ['answer', 'targets_json', 'mentions_json', 'cost'])
    assert.equal(expiredAfter[column], expiredRecord[column]);
  for (const column of [
    'analysis_revision',
    'analysis_targets_json',
    'analysis_mentions_json',
  ])
    assert.equal(expiredAfter[column], null);
  console.log(
    `Project SQLite integration passed: ${checks} native RPC checks; idempotency, atomic rollback, tombstones, metadata preservation, tenant isolation and cumulative query byte limits.`,
  );
} finally {
  await runtime.dispose();
  await rm(directory, { recursive: true, force: true });
}
