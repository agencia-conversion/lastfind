// Private, ephemeral Miniflare namespace. No application bypass, live D1 or provider I/O.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { storeIdentity } from '../lib/project-store-contract.ts';
import { DETECTOR_VERSION } from '../lib/competitor-discovery.ts';
import { ANSWER_BRANDS_SQL, EFFECTIVE_MENTIONS_SQL } from '../lib/server/run-rows.ts';
import { mentionOffsets } from '../lib/metrics.ts';

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
  assert.equal((await rpc({ scope: foreign, action: 'query', statements: [{ sql: 'SELECT COUNT(*) AS count FROM runs', params: [] }] }))[0].results[0].count, 0);
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
    assert.equal((await query('SELECT COUNT(*) AS count FROM runs'))[0].count, 101);
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
  // The brand plus the maximum of monitored competitors (10) starts; one more is refused.
  const brands = (count) => Array.from({ length: count }, (_, index) => ({ name: `Brand ${index}`, domain: `brand${index}.test` }));
  const full = await rpc({
    scope,
    action: 'analysis-start',
    revision: 'targets-max',
    configVersion: 4,
    targets: brands(11),
    cutoff: '2026-06-01T00:00:00.000Z',
    maxRuns: 2,
  });
  assert.equal(full.revision, 'targets-max');
  await assert.rejects(
    rpc({ scope, action: 'analysis-start', revision: 'targets-over', configVersion: 5, targets: brands(12), cutoff: '2026-06-01T00:00:00.000Z', maxRuns: 2 }),
  );
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
      // The analysis waits for writes to settle (WRITES_QUIET_MS) before it goes on.
      await new Promise((resolve) => setTimeout(resolve, 60));
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
  // The detector's conclusion is saved with the suggestion: without it every
  // doubtful name would reach the Brands screen as a confirmed discovery.
  const northstar = seedWindowStatus.suggestions.find(
    (candidate) => candidate.name === 'Northstar Labs',
  );
  assert.equal(typeof northstar.ambiguous, 'boolean');
  assert.ok(Array.isArray(northstar.reasons));
  checks++;
  // Share of voice and position count every identified competitor: the answer keeps the discoveries the pass found
  // in it with where each is first named, and only the ones the Worker sends as counted ({key: group}) join the count, for
  // reports and their kept results.
  const answerBrands = async () =>
    (await seedWindowCall({ action: 'query', statements: [{ sql: `SELECT r.analysis_brands_json brands,${ANSWER_BRANDS_SQL} total FROM runs r WHERE r.id='long-answer'`, params: [] }] }))[0].results[0];
  const counted = await answerBrands();
  const offsets = JSON.parse(counted.brands);
  assert.equal(offsets['northstar labs'], mentionOffsets(seedWindowAnswer, [['Northstar Labs']])[0], 'where the name is first read, in the prose mention ranks compare');
  assert.equal(counted.total, 1, 'the monitored brand only, before anything is counted');
  const epochBefore = (await seedWindowCall({ action: 'status' })).epoch;
  assert.deepEqual(await seedWindowCall({ action: 'brand-counted', groups: { 'northstar labs': 'northstar labs' } }), { changed: true });
  assert.ok((await seedWindowCall({ action: 'status' })).epoch > epochBefore, 'a change of the counted brands starts a new data epoch');
  assert.equal((await answerBrands()).total, 2);
  const epochAfter = (await seedWindowCall({ action: 'status' })).epoch;
  assert.deepEqual(await seedWindowCall({ action: 'brand-counted', groups: { 'northstar labs': 'northstar labs' } }), { changed: false });
  assert.equal((await seedWindowCall({ action: 'status' })).epoch, epochAfter, 'the same groups write nothing');
  await seedWindowCall({ action: 'brand-counted', groups: {} });
  assert.equal((await answerBrands()).total, 1);
  // A discovered name a name question settled as a monitored brand itself ("Amazon Prime Video") is listed nowhere as a
  // discovery (12/11/2026); the same aliases write nothing again, and none lists it back.
  const listed = async () => (await seedWindowCall({ action: 'analysis-status' })).suggestions.some((candidate) => candidate.name === 'Northstar Labs');
  assert.equal(await listed(), true);
  await seedWindowCall({ action: 'brand-counted', groups: {}, aliases: ['northstar labs'] });
  assert.equal(await listed(), false);
  assert.deepEqual(await seedWindowCall({ action: 'brand-counted', groups: {}, aliases: ['northstar labs'] }), { changed: false });
  await seedWindowCall({ action: 'brand-counted', groups: {} });
  assert.equal(await listed(), true);

  // v12: a monitored name that is also a common word ("conversion rate") counts only by its evidence in the
  // answer; what the text cannot settle waits in mention_asks as the exact question, per overlay (slot), not counted, until
  // the Worker sends the decision model's verdict on that same question.
  const commonScope = { ...scope, generation: 'common-word-brand' };
  const commonCall = (message) => rpc({ scope: commonScope, ...message });
  await commonCall({ action: 'initialize' });
  const commonStamp = new Date().toISOString();
  const commonRun = (id, answer) => ({ entity: 'runs', id, revision: 1, data: { ...record, id, answer, created_at: commonStamp, completed_at: commonStamp } });
  await commonCall({
    action: 'apply',
    changes: [
      commonRun('cro-1', 'Conversion Rate Optimization (CRO): a taxa de conversion depende da página.'),
      commonRun('cro-2', 'Melhore a conversion rate com testes A/B.'),
      commonRun('agency', 'Para SEO, a Conversion (conversion.com.br) é uma das agências citadas.'),
      commonRun('lone', 'Para isso, a Conversion pode ajudar a medir resultados.'),
    ],
  });
  const commonTargets = [{ name: 'Conversion', domain: 'conversion.com.br' }];
  const runPass = async (restart) => {
    await commonCall({ action: 'analysis-start', revision: 'common-targets', configVersion: 1, ...(restart ? { restart: true } : {}), targets: commonTargets, cutoff: new Date(Date.now() - 90 * 86400000).toISOString(), maxRuns: 10000 });
    for (let attempts = 0; attempts < 100; attempts++) {
      if ((await commonCall({ action: 'analysis-status' })).status === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  await runPass(false);
  const commonMentions = async () =>
    Object.fromEntries((await commonCall({ action: 'query', statements: [{ sql: `SELECT r.id,${EFFECTIVE_MENTIONS_SQL} mentions FROM runs r ORDER BY r.id`, params: [] }] }))[0].results.map((row) => [row.id, JSON.parse(row.mentions).Conversion]));
  assert.deepEqual(await commonMentions(), { agency: true, 'cro-1': false, 'cro-2': false, lone: false });
  const asks = async () => (await commonCall({ action: 'query', statements: [{ sql: 'SELECT run_id,brand,slot,request_json,counted FROM mention_asks ORDER BY run_id,slot', params: [] }] }))[0].results;
  // "Conversion Rate Optimization" beside its acronym in one answer is no window evidence: asked, like the lone name. The
  // pass's questions became the active ones when it finished.
  assert.deepEqual((await asks()).map((row) => [row.run_id, row.slot, row.counted]), [['cro-1', 'active', null], ['lone', 'active', null]]);
  assert.equal(JSON.parse((await asks()).find((row) => row.run_id === 'lone').request_json).span, 'Conversion');
  // A new answer under the active analysis is read the same way.
  await commonCall({ action: 'apply', changes: [commonRun('lone-2', 'Hoje a Conversion publicou um estudo.')] });
  const asked = await asks();
  assert.deepEqual(asked.map((row) => row.run_id), ['cro-1', 'lone', 'lone-2']);
  const request = (id) => asked.find((row) => row.run_id === id).request_json;
  const commonEpoch = (await commonCall({ action: 'status' })).epoch;
  assert.deepEqual(
    await commonCall({ action: 'mention-verdicts', verdicts: [['lone', 'Conversion', 'active', request('lone'), true, 'm|m2|card'], ['lone-2', 'Conversion', 'active', request('lone-2'), false, 'm|m2|card'], ['cro-1', 'Conversion', 'active', '{"stale":true}', true, 'm|m2|card']] }),
    { applied: 2 },
    'a verdict on other evidence than the stored question is not applied',
  );
  assert.ok((await commonCall({ action: 'status' })).epoch > commonEpoch, 'a verdict that counts a mention starts a new data epoch');
  assert.deepEqual(await commonMentions(), { agency: true, 'cro-1': false, 'cro-2': false, lone: true, 'lone-2': false });
  // A verdict turns the brand off as well as on, in its own slot only.
  assert.deepEqual(await commonCall({ action: 'mention-verdicts', verdicts: [['lone', 'Conversion', 'pending', request('lone'), false, 'm|m2|card']] }), { applied: 0 });
  assert.deepEqual(await commonCall({ action: 'mention-verdicts', verdicts: [['lone-2', 'Conversion', 'active', request('lone-2'), true, 'm2|m2|card']] }), { applied: 1 });
  assert.equal((await commonMentions())['lone-2'], true);
  assert.equal((await rpc({ scope: commonScope, action: 'mention-verdicts', verdicts: [['lone', 'Conversion', true]] }, 409)).error, 'Invalid mention verdicts', 'the old verdict shape is refused');
  // A reprocess asks the same questions: each starts with the verdict the active one has, so nothing dips.
  await runPass(true);
  assert.deepEqual(await commonMentions(), { agency: true, 'cro-1': false, 'cro-2': false, lone: true, 'lone-2': true });
  assert.deepEqual((await asks()).map((row) => [row.run_id, row.slot, row.counted]), [['cro-1', 'active', null], ['lone', 'active', 1], ['lone-2', 'active', 1]]);
  // A removed answer takes its questions with it.
  await commonCall({ action: 'apply', changes: [{ entity: 'runs', id: 'lone-2', revision: 2, data: null }] });
  assert.deepEqual((await asks()).map((row) => row.run_id), ['cro-1', 'lone']);
  // Without a decision model (no key, an independent install): what the rules leave open counts, as the matcher did before
  // the common-word checks, and nothing waits for a model. The rules' own decisions stay (lowercase is the word).
  await commonCall({ action: 'analysis-start', revision: 'common-targets', configVersion: 1, restart: true, mentionModel: false, targets: commonTargets, cutoff: new Date(Date.now() - 90 * 86400000).toISOString(), maxRuns: 10000 });
  for (let attempts = 0; attempts < 100; attempts++) {
    if ((await commonCall({ action: 'analysis-status' })).status === 'complete') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(await commonMentions(), { agency: true, 'cro-1': true, 'cro-2': false, lone: true });
  assert.deepEqual(await asks(), []);
  checks++;

  // The preview import writes another store's analysis as it is (analysis-adopt): the copy counts the discoveries that store
  // counts, with its offsets, under its detector, and the same target list never starts a pass of the copy's own over them.
  const adoptScope = { ...scope, generation: 'adopted-analysis' };
  const adoptCall = (message, expected) => rpc({ scope: adoptScope, ...message }, expected);
  await adoptCall({ action: 'initialize' });
  await adoptCall({ action: 'apply', changes: [{ entity: 'runs', id: 'copied', revision: 1, data: { ...record, id: 'copied', answer: 'Zenith Works and Northstar Labs, then Acme Beacon.', mentions_json: '{"Acme Beacon":true}', created_at: seedWindowStamp, completed_at: seedWindowStamp } }] });
  const adoptedTargets = [{ name: 'Acme Beacon', domain: 'acme.test' }];
  const adoptedJob = { revision: 'production-targets', targets_json: JSON.stringify(adoptedTargets), config_version: 3, cutoff: seedWindowStamp, max_runs: 10000, processed: 1, scanned: 1, total_eligible: 1, truncated: 0, updated_at: seedWindowStamp };
  await adoptCall({ action: 'analysis-adopt', step: 'begin', job: adoptedJob, detector: 'structure-old' });
  assert.deepEqual(
    await adoptCall({
      action: 'analysis-adopt',
      step: 'rows',
      runs: [['copied', '{"Acme Beacon":true}', '{"zenith works":0,"northstar labs":16}'], ['not-in-this-store', null, null]],
      suggestions: [{ name: 'Zenith Works', identity: 'zenith works', domain: null, domain_state: 'none', score: 1, answer_count: 1, evidence_json: JSON.stringify([{ runId: 'copied', excerpt: 'Zenith Works', createdAt: seedWindowStamp }]), detection_json: null }],
    }),
    { answers: 1, suggestions: 1 },
  );
  await adoptCall({ action: 'analysis-adopt', step: 'commit', groups: { 'zenith works': 'zenith works', 'northstar labs': 'zenith works' } });
  const adoptedBrands = async () =>
    (await adoptCall({ action: 'query', statements: [{ sql: `SELECT ${ANSWER_BRANDS_SQL} total FROM runs r WHERE r.id='copied'`, params: [] }] }))[0].results[0].total;
  assert.equal(await adoptedBrands(), 2, 'the monitored brand and one group (Northstar Labs merged into Zenith Works)');
  let adopted = await adoptCall({ action: 'analysis-status' });
  assert.deepEqual([adopted.status, adopted.revision, adopted.detector, !!adopted.staleDetector, adopted.suggestions.map((item) => item.name)], ['complete', 'production-targets', 'structure-old', true, ['Zenith Works']]);
  adopted = await adoptCall({ action: 'analysis-start', revision: 'production-targets', configVersion: 0, targets: adoptedTargets, cutoff: new Date(Date.now() - 90 * 86400000).toISOString(), maxRuns: 10000 });
  assert.equal(adopted.status, 'complete', 'the same targets start no pass of the copy');
  assert.equal(await adoptedBrands(), 2);
  // An explicit restart of the same targets (Admin's reprocess) runs this detector's pass, even though the adopted job holds
  // the other store's newer config version (a preview copy keeps 0), and keeps that version.
  adopted = await adoptCall({ action: 'analysis-start', revision: 'production-targets', configVersion: 0, restart: true, targets: adoptedTargets, cutoff: new Date(Date.now() - 90 * 86400000).toISOString(), maxRuns: 10000 });
  for (let attempts = 0; attempts < 100 && adopted.status !== 'complete'; attempts++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    adopted = await adoptCall({ action: 'analysis-status' });
  }
  assert.deepEqual([adopted.status, !!adopted.staleDetector], ['complete', false], 'the restart ran under the current detector');
  assert.equal((await adoptCall({ action: 'query', statements: [{ sql: 'SELECT config_version FROM competitor_analysis_jobs', params: [] }] }))[0].results[0].config_version, 3);
  // The project's own version, confirmed after the store answered with a newer one (ensureCompetitorAnalysis): the job takes it
  // and the same targets start no pass. Before, the copy's status said "needs re-analysis" for good and every ensure was ignored.
  adopted = await adoptCall({ action: 'analysis-start', revision: 'production-targets', configVersion: 0, confirmed: true, targets: adoptedTargets, cutoff: new Date(Date.now() - 90 * 86400000).toISOString(), maxRuns: 10000 });
  assert.deepEqual([adopted.status, adopted.configVersion, adopted.revision], ['complete', 0, 'production-targets']);
  // Adopting again replaces everything: a store with no active analysis counts the monitored brands of the collection only.
  await adoptCall({ action: 'analysis-adopt', step: 'begin', job: null, detector: null });
  await adoptCall({ action: 'analysis-adopt', step: 'commit', groups: {} });
  adopted = await adoptCall({ action: 'analysis-status' });
  assert.deepEqual([adopted.status, adopted.suggestions.length, await adoptedBrands()], ['idle', 0, 1]);
  await adoptCall({ action: 'analysis-adopt', step: 'rows', runs: [['copied', null, '{}']] }, 409);
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
    // A settled competitor (`include`) is returned past the limit; the limit bounds only the other names.
    if (ready.suggestions.length > 1) {
      const last = ready.suggestions.at(-1).name;
      const key = last.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}+&]+/gu, ' ').trim();
      const bounded = await call({ action: 'analysis-status', limit: 1, include: [key] });
      assert.deepEqual(bounded.suggestions.map((item) => item.name), [ready.suggestions[0].name, last]);
    }
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
  // Source catalog: a cited URL is stored once per response in its canonical form. New
  // rows are canonicalized on write; rows stored before are rewritten page by page by the
  // store itself (an older build seeds them here), and rewriting never touches anything else.
  const bundleStore = async (legacy, extra = []) =>
    (
      await build({
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
        plugins: [
          ...(legacy
          ? [
              {
                name: 'before-the-catalog',
                setup(plugin) {
                  // The build before this feature: it stored URLs as cited, wrote no completion
                  // mark and never scheduled the rewrite.
                  plugin.onResolve({ filter: /source-url\.mjs$/ }, () => ({ path: 'legacy', namespace: 'legacy' }));
                  plugin.onLoad({ filter: /.*/, namespace: 'legacy' }, () => ({
                    contents: 'export const canonicalCitationsJson = (json) => json;',
                    loader: 'js',
                  }));
                  plugin.onLoad({ filter: /worker[\\/]project-store\.ts$/ }, async (args) => ({
                    contents: (await readFile(args.path, 'utf8'))
                      .replace("sources_canonical: 'done',", '')
                      .replace("if (this.meta('owner') && this.meta('sources_canonical') !== 'done')", 'if (false)'),
                    loader: 'ts',
                    resolveDir: dirname(args.path),
                  }));
                },
              },
            ]
          : []),
          ...extra,
        ],
      })
    ).outputFiles[0].text;
  const sourcesDirectory = await mkdtemp(join(tmpdir(), 'lastfind-project-store-sources-'));
  const startStore = async (script, persistence = sourcesDirectory) => {
    const instance = new Miniflare(
      convertV4MiniflareOptions({
        name: 'lastfind-project-store-sources',
        modules: true,
        script,
        compatibilityDate: '2026-05-22',
        durableObjects: { PROJECT_STORES: { className: 'ProjectStore', useSQLite: true } },
        resourcePersistencePath: persistence,
        unsafeDevRegistryPath: join(persistence, 'registry'),
        telemetry: { enabled: false },
        logRequests: false,
      }),
    );
    const stores = await instance.getDurableObjectNamespace('PROJECT_STORES');
    const sourceScope = { ownerId: 'owner-s', projectId: 'project-s', generation: 'first' };
    const call = async (message, callScope = sourceScope) => {
      const stub = stores.get(stores.idFromName(storeIdentity(callScope)));
      const response = await stub.fetch('https://project-store/rpc', {
        method: 'POST',
        body: JSON.stringify({ scope: callScope, ...message }),
      });
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data));
      checks++;
      return data;
    };
    const read = async (sql) => (await call({ action: 'query', statements: [{ sql, params: [] }] }))[0].results;
    return { instance, call, read, scope: sourceScope };
  };
  const pageUrl = 'https://news.example/best-streaming';
  const cited = (n) =>
    JSON.stringify([
      { url: `${pageUrl}?utm_source=chatgpt.com`, domain: 'news.example', title: 'Best streaming' },
      { url: `https://www.news.example/best-streaming/#:~:text=pick-${n}`, domain: 'news.example', title: 'Duplicate of the same page' },
      { url: `https://www.news.example/other-${n % 3}`, domain: 'news.example', title: `Other ${n % 3}` },
    ]);
  const sourceRun = (n) => ({
    ...record,
    id: `run-source-${String(n).padStart(3, '0')}`,
    owner_id: 'owner-s',
    project_id: 'project-s',
    sources_json: cited(n),
    consulted_sources_json: n % 2 ? null : cited(n + 1),
  });
  const seedRuns = Array.from({ length: 250 }, (_, n) => ({
    entity: 'runs',
    id: sourceRun(n).id,
    revision: 1,
    data: sourceRun(n),
  }));
  const legacy = await startStore(await bundleStore(true));
  try {
    await legacy.call({ action: 'initialize' });
    for (let at = 0; at < seedRuns.length; at += 100)
      await legacy.call({ action: 'apply', changes: seedRuns.slice(at, at + 100) });
    const seeded = await legacy.read("SELECT COUNT(*) n FROM runs WHERE sources_json LIKE '%utm_source%'");
    assert.equal(seeded[0].n, 250, 'the older build stores URLs as cited');
    assert.equal((await legacy.read("SELECT COUNT(*) n FROM store_meta WHERE key='sources_canonical'"))[0].n, 0, 'an older store has no completion mark');
  } finally {
    await legacy.instance.dispose();
  }
  const current = await startStore(await bundleStore(false));
  try {
    const rows = async () => await current.read("SELECT COUNT(*) n FROM runs WHERE sources_json LIKE '%utm_source%' OR sources_json LIKE '%www.%'");
    const deadline = Date.now() + 20000;
    await current.call({ action: 'status' });
    while ((await rows())[0].n && Date.now() < deadline) await new Promise((done) => setTimeout(done, 100));
    assert.equal((await rows())[0].n, 0, 'every stored response is rewritten');
    const first = (await current.read("SELECT sources_json,consulted_sources_json FROM runs WHERE id='run-source-000'"))[0];
    assert.deepEqual(JSON.parse(first.sources_json), [
      { url: pageUrl, domain: 'news.example', title: 'Best streaming' },
      { url: 'https://news.example/other-0', domain: 'news.example', title: 'Other 0' },
    ]);
    assert.equal(JSON.parse(first.consulted_sources_json).length, 2);
    assert.equal((await current.read("SELECT consulted_sources_json c FROM runs WHERE id='run-source-001'"))[0].c, null);
    // One catalog entry per page across all 250 responses (their prompts, days and engines).
    const distinct = await current.read(
      "SELECT COUNT(DISTINCT json_extract(s.value,'$.url')) urls,COUNT(*) occurrences FROM runs r,json_each(r.sources_json) s",
    );
    assert.deepEqual({ ...distinct[0] }, { urls: 4, occurrences: 500 });
    // New publications are canonical on write, whatever the producer sent.
    const late = sourceRun(900);
    await current.call({ action: 'apply', changes: [{ entity: 'runs', id: late.id, revision: 1, data: late }] });
    assert.deepEqual(
      JSON.parse((await current.read(`SELECT sources_json FROM runs WHERE id='${late.id}'`))[0].sources_json).map((item) => item.url),
      [pageUrl, 'https://news.example/other-0'],
    );
    // A restart resumes nothing: the work is done and recorded.
    assert.equal((await current.read("SELECT value FROM store_meta WHERE key='sources_canonical'"))[0].value, 'done');
  } finally {
    await current.instance.dispose();
    await rm(sourcesDirectory, { recursive: true, force: true });
  }
  // The lowercase check covers the whole analysed window, not just the page of 10 answers.
  // The newest page writes "Via", "Forte" and "Listada" only in capitals; the next page writes them in lowercase.
  {
    const noise = { ...scope, projectId: 'project-noise' };
    await rpc({ scope: noise, action: 'initialize' });
    const table = (names) =>
      `Agency | Focus | Best for\n--- | --- | ---\n**Conversion** | technical search visibility | distributed teams\n${names
        .map((name) => `**${name}** | technical search visibility | enterprise teams`)
        .join('\n')}\n`;
    const answers = [
      ...Array.from({ length: 10 }, () => table(['Via', 'Forte', 'Listada', 'Netlinks'])),
      ...Array.from({ length: 10 }, () => 'Conversion é uma agência de CRO que passa via formulário, com um prazo forte e uma página listada. Via oferece CRO e testes A/B. Via atende empresas.'),
    ];
    await rpc({
      scope: noise,
      action: 'apply',
      changes: answers.map((answer, index) => ({
        entity: 'runs',
        id: `noise-${String(index).padStart(2, '0')}`,
        revision: 300 + index,
        data: {
          ...record,
          id: `noise-${String(index).padStart(2, '0')}`,
          owner_id: noise.ownerId,
          project_id: noise.projectId,
          answer,
          targets_json: '[]',
          mentions_json: '{}',
          created_at: `2026-10-10T12:${String(59 - index).padStart(2, '0')}:00.000Z`,
        },
      })),
    });
    let noiseAnalysis = await rpc({
      scope: noise,
      action: 'analysis-start',
      revision: 'noise-a',
      configVersion: 1,
      targets: [{ name: 'Conversion', domain: 'conversion.com.br' }],
      cutoff: '2026-06-01T00:00:00.000Z',
      maxRuns: 20,
    });
    for (let index = 0; noiseAnalysis.status !== 'complete' && index < 20; index++)
      noiseAnalysis = await rpc({ scope: noise, action: 'analysis-process' });
    assert.equal(noiseAnalysis.status, 'complete');
    const names = (
      await rpc({
        scope: noise,
        action: 'query',
        statements: [{ sql: 'SELECT name FROM competitor_suggestions ORDER BY name', params: [] }],
      })
    )[0].results.map((row) => row.name);
    // A company role on the later page keeps Via, even though that page alone does not surface it.
    assert.deepEqual(names, ['Netlinks', 'Via']);
  }
  // Netflix, Oct 2026: a family named only by its models, each on its own page ("Ônix 15", "Ônix Watch"), takes the brand's
  // word, whose identity another page's spelling already held ("Onix"). The pass failed at its last page on the unique identity.
  // structure-v7: one identity is one name, so the models' family and "Onix" are one suggestion.
  {
    const clash = { ...scope, projectId: 'project-clash' };
    await rpc({ scope: clash, action: 'initialize' });
    const table = (names) =>
      `Phone | Best for\n--- | ---\n**Apple** | cameras\n${names.map((name) => `**${name}** | battery life`).join('\n')}\n`;
    const answers = ['Ônix 15', 'Ônix Watch', 'Onix'].flatMap((name) => Array.from({ length: 10 }, () => table([name])));
    await rpc({
      scope: clash,
      action: 'apply',
      changes: answers.map((answer, index) => ({
        entity: 'runs',
        id: `clash-${String(index).padStart(2, '0')}`,
        revision: 400 + index,
        data: {
          ...record,
          id: `clash-${String(index).padStart(2, '0')}`,
          owner_id: clash.ownerId,
          project_id: clash.projectId,
          answer,
          targets_json: '[]',
          mentions_json: '{}',
          created_at: `2026-10-10T12:${String(59 - index).padStart(2, '0')}:00.000Z`,
        },
      })),
    });
    let clashAnalysis = await rpc({
      scope: clash,
      action: 'analysis-start',
      revision: 'clash-a',
      configVersion: 1,
      targets: [{ name: 'Apple', domain: 'apple.com' }],
      cutoff: '2026-06-01T00:00:00.000Z',
      maxRuns: 30,
    });
    for (let index = 0; !['complete', 'failed'].includes(clashAnalysis.status) && index < 30; index++)
      clashAnalysis = await rpc({ scope: clash, action: 'analysis-process' });
    assert.equal(clashAnalysis.status, 'complete', clashAnalysis.error ?? '');
    const rows = (
      await rpc({ scope: clash, action: 'query', statements: [{ sql: 'SELECT name,answer_count FROM competitor_suggestions ORDER BY name', params: [] }] })
    )[0].results;
    assert.deepEqual(rows.map((row) => `${row.name} ${row.answer_count}`), ['Onix 30']);
  }

  // Algorithm versions: an analysis an older detector made is redone under the current one when new answers arrive
  // (10/11/2026: frozen, the new answers had no discoveries and share of voice lost them); a target change runs it too.
  {
    const freezeDirectory = await mkdtemp(join(tmpdir(), 'lastfind-project-store-freeze-'));
    const olderDetector = {
      name: 'older-detector',
      setup(plugin) {
        plugin.onLoad({ filter: /lib[\\/]competitor-discovery\.ts$/ }, async (args) => ({
          contents: (await readFile(args.path, 'utf8')).replace(/export const DETECTOR_VERSION = '[^']+'/, "export const DETECTOR_VERSION = 'structure-old'"),
          loader: 'ts',
          resolveDir: dirname(args.path),
        }));
      },
    };
    const scopes = ['project-fresh', 'project-targets', 'project-midpass'].map((projectId) => ({ ownerId: 'owner-f', projectId, generation: 'first' }));
    const answer = (scopeF, id, names, minutes) => {
      const stamp = new Date(Date.now() - minutes * 60000).toISOString();
      return {
        entity: 'runs',
        id,
        revision: 1,
        data: {
          ...record,
          id,
          owner_id: scopeF.ownerId,
          project_id: scopeF.projectId,
          answer: names.map((name) => `**${name}** coordinates release evidence for distributed teams.`).join(' '),
          targets_json: JSON.stringify([{ name: 'Acme Beacon', domain: 'acme.test' }]),
          mentions_json: '{"Acme Beacon":true}',
          created_at: stamp,
          completed_at: stamp,
        },
      };
    };
    const start = (scopeF, revision, configVersion, targets, restart = false) => ({
      action: 'analysis-start',
      revision,
      configVersion,
      targets,
      cutoff: new Date(Date.now() - 90 * 86400000).toISOString(),
      maxRuns: 100,
      restart,
    });
    const acme = [{ name: 'Acme Beacon', domain: 'acme.test' }];
    const finish = async (store, scopeF, status) => {
      for (let index = 0; status.status !== 'complete' && index < 40; index++)
        status = await store.call({ action: 'analysis-process' }, scopeF);
      assert.equal(status.status, 'complete');
      return status;
    };
    const names = (status) => status.suggestions.map((item) => item.name);
    const older = await startStore(await bundleStore(false, [olderDetector]), freezeDirectory);
    const midpass = scopes[2];
    try {
      // A pass the older detector began and left after one page of answers. Its own alarm would go on reading pages while
      // the other scopes run below, so it is frozen right away (one page of 100 answers, the whole window, is far from the end) and resumed
      // only under the current detector: the pass is mid-way at the switch on every run.
      await older.call({ action: 'initialize' }, midpass);
      for (let at = 0; at < 100; at += 50)
        await older.call({ action: 'apply', changes: Array.from({ length: 50 }, (_, index) => answer(midpass, `mid-${at + index}`, ['Acme Beacon', 'Northstar Labs'], 60 + at + index)) }, midpass);
      let partial = await older.call(start(midpass, 'mid-1', 1, acme), midpass);
      while (!(partial.phase === 'analysis' && partial.processed > 0)) partial = await older.call({ action: 'analysis-process' }, midpass);
      await older.call({ action: 'analysis-freeze', token: 'midpass', until: Date.now() + 60000 }, midpass);
      partial = await older.call({ action: 'analysis-status' }, midpass);
      assert.equal(partial.status, 'running');
      assert.ok(partial.processed < 100, `the older pass is mid-way (${partial.processed} of 100)`);
      for (const scopeF of scopes.slice(0, 2)) {
        await older.call({ action: 'initialize' }, scopeF);
        await older.call({ action: 'apply', changes: [answer(scopeF, 'run-1', ['Acme Beacon', 'Northstar Labs'], 60)] }, scopeF);
        const done = await finish(older, scopeF, await older.call(start(scopeF, 'freeze-1', 1, acme), scopeF));
        assert.equal(done.detector, 'structure-old');
      }
    } finally {
      await older.instance.dispose();
    }
    const current = await startStore(await bundleStore(false), freezeDirectory);
    try {
      const [fresh, targets] = scopes;
      // structure-v7 cannot add its pages to an older detector's: that pass starts again and finishes under this one.
      await current.call({ action: 'analysis-resume', token: 'midpass' }, midpass);
      const resumed = await finish(current, midpass, await current.call({ action: 'analysis-process' }, midpass));
      assert.equal(resumed.detector, DETECTOR_VERSION);
      assert.deepEqual(resumed.suggestions.map((item) => `${item.name} ${item.answerCount}`), ['Northstar Labs 100']);
      const meta = async (scopeF, key) =>
        (await current.call({ action: 'query', statements: [{ sql: 'SELECT value FROM store_meta WHERE key=?', params: [key] }] }, scopeF))[0].results[0]?.value;
      let status = await current.call({ action: 'analysis-status' }, fresh);
      assert.deepEqual(status.staleDetector, { current: 'structure-old', available: DETECTOR_VERSION });
      // A new answer: the pass runs again, under the current detector, and its discoveries count.
      await current.call({ action: 'apply', changes: [answer(fresh, 'run-2', ['Acme Beacon', 'Zenith Works'], 1)] }, fresh);
      status = await current.call({ action: 'analysis-status' }, fresh);
      assert.notEqual(status.status, 'complete', 'a new answer redoes an older detector\'s analysis');
      status = await finish(current, fresh, status);
      assert.equal(status.detector, DETECTOR_VERSION);
      assert.equal(status.staleDetector, null);
      assert.ok(names(status).includes('Zenith Works'));
      assert.equal(await meta(fresh, 'analysis_detector_available'), undefined);
      const read = (await current.call({ action: 'query', statements: [{ sql: "SELECT COUNT(*) n FROM run_rows WHERE analysis_revision='freeze-1'", params: [] }] }, fresh))[0].results[0].n;
      assert.equal(read, 2, 'the new answer is read with the old one');
      // On the current detector, the next new answer only extends the analysis (reads it, carries the rest): never a full pass.
      await current.call({ action: 'apply', changes: [answer(fresh, 'run-3', ['Acme Beacon', 'Zenith Works'], 0)] }, fresh);
      const job = async () => (await current.call({ action: 'query', statements: [{ sql: 'SELECT phase,status FROM competitor_analysis_jobs WHERE id=1', params: [] }] }, fresh))[0].results[0];
      assert.deepEqual(await job(), { phase: 'extend', status: 'pending' });
      status = await finish(current, fresh, await current.call({ action: 'analysis-status' }, fresh));
      assert.equal(status.detector, DETECTOR_VERSION);
      assert.equal((await current.call({ action: 'query', statements: [{ sql: "SELECT COUNT(*) n FROM run_rows WHERE analysis_revision='freeze-1'", params: [] }] }, fresh))[0].results[0].n, 3);
      // A target change still re-runs: the overlay has to be computed for the new list.
      await current.call({ action: 'apply', changes: [answer(targets, 'run-2', ['Acme Beacon', 'Zenith Works'], 1)] }, targets);
      // (the new answer redoes the older detector's pass first)
      await finish(current, targets, await current.call({ action: 'analysis-status' }, targets));
      status = await current.call(start(targets, 'freeze-2', 2, [...acme, { name: 'Northstar Labs', domain: 'northstar.test' }]), targets);
      assert.notEqual(status.status, 'complete');
      status = await finish(current, targets, status);
      assert.equal(status.revision, 'freeze-2');
      const overlay = (await current.call({ action: 'query', statements: [{ sql: "SELECT COUNT(*) n FROM run_rows WHERE analysis_revision='freeze-2'", params: [] }] }, targets))[0].results[0].n;
      assert.equal(overlay, 2, 'both answers are read again under the new targets');
    } finally {
      await current.instance.dispose();
      await rm(freezeDirectory, { recursive: true, force: true });
    }
  }
  console.log(
    `Project SQLite integration passed: ${checks} native RPC checks; idempotency, atomic rollback, tombstones, metadata preservation, tenant isolation and cumulative query byte limits.`,
  );
} finally {
  await runtime.dispose();
  await rm(directory, { recursive: true, force: true });
}
