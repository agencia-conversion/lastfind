import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { extendStoreDigest, type StoreRow } from '../lib/project-store-contract.ts';

// Execute the actual restore coordinator with deterministic D1/RPC failures.
// Native SQLite/alarm behavior is covered by project-store-integration.mjs.
const core = fileURLToPath(new URL('..', import.meta.url));
const stubs: Record<string, string> = {
  fixture: `let state; export const setFixture = value => state = value; export const current = () => state;`,
  env: `import {current} from 'fixture'; export const db = () => current().db; export const now = () => new Date().toISOString();`,
  leases: `export const withLease = async (_key, _duration, fn) => fn();`,
  http: `export class ApiError extends Error { constructor(status,message) { super(message); this.status=status; } }`,
  'project-store-transport': `import {current} from 'fixture'; export const projectStorageConfigured = () => true; export const projectStoreRpc = request => current().rpc(request);`,
};
const bundled = await build({
  stdin: {
    contents:
      "export {setFixture} from 'fixture'; export {commitProjectStoreRestore} from './lib/server/project-store.ts';",
    resolveDir: core,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'isolated-restore-transports',
      setup(builder) {
        builder.onResolve(
          {
            filter: /^(fixture|\.\/(env|leases|http|project-store-transport))$/,
          },
          (args) => ({
            path: args.path.replace('./', ''),
            namespace: 'restore-fixture',
          }),
        );
        builder.onResolve({ filter: /^@\// }, (args) => ({
          path: `${core}/${args.path.slice(2)}${args.path.endsWith('.mjs') ? '' : '.ts'}`,
        }));
        builder.onLoad(
          { filter: /.*/, namespace: 'restore-fixture' },
          (args) => ({ contents: stubs[args.path]!, loader: 'js' }),
        );
      },
    },
  ],
});
const { setFixture, commitProjectStoreRestore } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.text).toString('base64')}`
);
const emptyDigest = createHash('sha256').update('\n').digest('hex');

function fixture(schema = 2) {
  const events: string[] = [];
  const expected: Record<string, unknown> = {
    schema,
    projectId: 'project',
    ownerId: 'owner',
    generation: 'backup',
    revision: 5,
    counts: { prompts: 0, runs: 0 },
    digests: { prompts: emptyDigest, runs: emptyDigest },
    analysisRevision: 'active-targets',
    analysisMutationRevision: 7,
    restoreStartRevision: 5,
    restoreStartAnalysisRevision: 'active-targets',
    restoreStartAnalysisMutationRevision: 7,
    restoreStartTargetConfigVersion: 2,
  };
  const registry = {
    project_id: 'project',
    owner_id: 'owner',
    generation: 'active',
    initialized: 1,
    source_revision: 5,
    applied_revision: 5,
    verification_json: null as string | null,
    candidate_generation: 'candidate' as string | null,
    candidate_manifest_json: JSON.stringify(expected) as string | null,
  };
  const project = {
    id: 'project',
    owner_id: 'owner',
    name: 'Canonical Brand',
    domain: 'canonical.test',
    competitor_targets_revision: 2,
    aliases_json: '[]',
    additional_domains_json: '[]',
    competitors_json: '[]',
  };
  const state = {
    events,
    registry,
    project,
    expected,
    casFail: false,
    casUnknown: false,
    activateBeforeFence: false,
    throwAfterCas: false,
    mutateAfterJob: false,
    candidateMutated: false,
    promptRows: [] as StoreRow[],
    canonicalPrompts: [] as StoreRow[],
    applied: [] as StoreRow[],
    analysisMutationRevision: 7,
    starts: [] as Record<string, unknown>[],
    db: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async all() {
                assert.ok(sql.includes('SELECT id,project_id,unit_id,engines_override_json,subscribed FROM prompts'));
                assert.equal(args[0], 'project');
                return { results: state.canonicalPrompts.filter(row => JSON.parse(String(args[1])).includes(row.id)) };
              },
              async first() {
                if (sql.includes('FROM project_stores')) {
                  if (args[0] !== 'project' || args[1] !== 'owner') return null;
                  return { ...registry };
                }
                if (sql.includes('FROM projects')) return { ...project };
                throw new Error(`Unexpected query: ${sql}`);
              },
              async run() {
                if (sql.startsWith('INSERT OR IGNORE'))
                  return { meta: { changes: 0 } };
                if (sql.includes('SET verification_json=')) {
                  registry.verification_json = String(args[0]);
                  return { meta: { changes: 1 } };
                }
                if (sql.includes('SET candidate_generation=NULL')) {
                  if (state.activateBeforeFence) {
                    registry.generation = 'candidate';
                    registry.candidate_generation = null;
                    registry.candidate_manifest_json = null;
                    registry.verification_json = null;
                    return { meta: { changes: 0 } };
                  }
                  if (
                    registry.candidate_generation !== args[3] ||
                    registry.generation === args[4]
                  )
                    return { meta: { changes: 0 } };
                  registry.candidate_generation = null;
                  registry.candidate_manifest_json = null;
                  registry.verification_json = null;
                  return { meta: { changes: 1 } };
                }
                if (sql.includes('SET generation=candidate_generation')) {
                  events.push('cas');
                  if (state.casUnknown) return { meta: {} };
                  if (
                    state.casFail ||
                    args[4] !== registry.source_revision ||
                    args[6] !== project.competitor_targets_revision
                  )
                    return { meta: { changes: 0 } };
                  registry.generation = 'candidate';
                  registry.candidate_generation = null;
                  registry.candidate_manifest_json = null;
                  registry.verification_json = null;
                  if (state.throwAfterCas)
                    throw new Error('connection lost after committed CAS');
                  return { meta: { changes: 1 } };
                }
                throw new Error(`Unexpected mutation: ${sql}`);
              },
            };
          },
        };
      },
    },
    async rpc(message: Record<string, unknown>) {
      const scope = message.scope as {
        generation: string;
        ownerId: string;
        projectId: string;
      };
      assert.equal(scope.ownerId, 'owner');
      assert.equal(scope.projectId, 'project');
      events.push(`${message.action}:${scope.generation}`);
      switch (message.action) {
        case 'status':
          return {
            analysisRevision: 'active-targets',
            analysisMutationRevision: state.analysisMutationRevision,
          };
        case 'scan':
          return {
            rows: state.candidateMutated
              ? [{ id: 'unexpected-derived-row' }]
              : message.entity === 'prompts' ? state.promptRows : [],
            nextCursor: null,
          };
        case 'apply': {
          const changes = message.changes as { data: StoreRow }[];
          state.applied.push(...changes.map(change => change.data));
          state.promptRows = state.promptRows.map(row => ({...row,...changes.find(change => change.data.id === row.id)?.data}));
          return { applied: changes.length };
        }
        case 'analysis-freeze':
          return {
            revision: 'active-targets',
            mutationRevision: state.analysisMutationRevision,
          };
        case 'analysis-set-current':
        case 'analysis-resume':
          return { ok: true };
        case 'analysis-cancel':
          return { cancelled: true };
        case 'analysis-start':
          state.starts.push(message);
          if (state.mutateAfterJob) project.competitor_targets_revision++;
          return { status: 'pending' };
        default:
          throw new Error(`Unexpected RPC ${message.action}`);
      }
    },
  };
  setFixture(state);
  return state;
}
async function verifyPrompts() {
  assert.equal(
    (await commitProjectStoreRestore('project', 'owner', 'candidate')).done,
    false,
  );
}

void test('restore persists a canonical alarm job before CAS and successful retries do not reset it', async () => {
  for (const schema of [1, 2]) {
    const state = fixture(schema);
    await verifyPrompts();
    assert.equal(
      (await commitProjectStoreRestore('project', 'owner', 'candidate')).done,
      true,
    );
    assert.equal(state.starts.length, 1);
    const job = state.starts[0]!;
    assert.equal(job.configVersion, 2);
    assert.equal(job.maxRuns, 10000);
    assert.deepEqual(job.targets, [
      {
        name: 'Canonical Brand',
        domain: 'canonical.test',
        aliases: [],
        domains: ['canonical.test'],
      },
    ]);
    assert.ok(
      state.events.indexOf('analysis-start:candidate') <
        state.events.indexOf('cas'),
    );
    assert.equal(
      (await commitProjectStoreRestore('project', 'owner', 'candidate')).done,
      true,
    );
    assert.equal(state.starts.length, 1);
  }
});

void test('restore checksum, legacy baseline, analytical mutation and ownership fail before starting a job', async () => {
  const corrupt = fixture();
  corrupt.expected.digests = { prompts: emptyDigest, runs: '0'.repeat(64) };
  corrupt.registry.candidate_manifest_json = JSON.stringify(corrupt.expected);
  await verifyPrompts();
  await assert.rejects(
    commitProjectStoreRestore('project', 'owner', 'candidate'),
    /checksum/,
  );
  assert.equal(corrupt.starts.length, 0);
  assert.equal(corrupt.registry.generation, 'active');
  const legacy = fixture();
  delete legacy.expected.restoreStartAnalysisMutationRevision;
  legacy.registry.candidate_manifest_json = JSON.stringify(legacy.expected);
  await assert.rejects(
    commitProjectStoreRestore('project', 'owner', 'candidate'),
    /changed during restore/,
  );
  assert.equal(legacy.starts.length, 0);
  const changed = fixture();
  changed.analysisMutationRevision++;
  await assert.rejects(
    commitProjectStoreRestore('project', 'owner', 'candidate'),
    /changed during restore/,
  );
  assert.equal(changed.starts.length, 0);
  const foreign = fixture();
  await assert.rejects(
    commitProjectStoreRestore('project', 'foreign-owner', 'candidate'),
    /not found/,
  );
  assert.equal(foreign.starts.length, 0);
});

void test('CAS races keep active data intact, and a changed candidate cannot reuse the verified digest', async () => {
  const state = fixture();
  await verifyPrompts();
  state.mutateAfterJob = true;
  await assert.rejects(
    commitProjectStoreRestore('project', 'owner', 'candidate'),
    /changed before restore activation/,
  );
  assert.equal(state.registry.generation, 'active');
  assert.equal(state.starts.length, 1);
  assert.ok(state.events.includes('analysis-cancel:candidate'));
  assert.ok(state.events.includes('analysis-resume:active'));
  await assert.rejects(
    commitProjectStoreRestore('project', 'owner', 'candidate'),
    /Unknown restore generation/,
  );
  const interrupted = fixture();
  await verifyPrompts();
  interrupted.casFail = true;
  await assert.rejects(
    commitProjectStoreRestore('project', 'owner', 'candidate'),
    /changed before restore activation/,
  );
  interrupted.casFail = false;
  interrupted.candidateMutated = true;
  await assert.rejects(
    commitProjectStoreRestore('project', 'owner', 'candidate'),
    /Unknown restore generation/,
  );
  assert.equal(interrupted.registry.generation, 'active');

  const unknown = fixture();
  await verifyPrompts();
  unknown.casUnknown = true;
  await assert.rejects(
    commitProjectStoreRestore('project', 'owner', 'candidate'),
    /changed before restore activation/,
  );
  assert.ok(!unknown.events.includes('analysis-cancel:candidate'));

  const activatedByRetry = fixture();
  await verifyPrompts();
  activatedByRetry.casFail = true;
  activatedByRetry.activateBeforeFence = true;
  await assert.rejects(
    commitProjectStoreRestore('project', 'owner', 'candidate'),
    /changed before restore activation/,
  );
  assert.equal(activatedByRetry.registry.generation, 'candidate');
  assert.ok(!activatedByRetry.events.includes('analysis-cancel:candidate'));
});

void test('a lost response after committed CAS leaves the persisted job and an idempotent retry', async () => {
  const state = fixture();
  await verifyPrompts();
  state.throwAfterCas = true;
  await assert.rejects(
    commitProjectStoreRestore('project', 'owner', 'candidate'),
    /connection lost/,
  );
  assert.equal(state.registry.generation, 'candidate');
  assert.equal(state.starts.length, 1);
  assert.ok(!state.events.includes('analysis-cancel:candidate'));
  assert.equal(
    (await commitProjectStoreRestore('project', 'owner', 'candidate')).done,
    true,
  );
  assert.equal(state.starts.length, 1);
});

void test('legacy restore verifies old digests then restores canonical unit fields without changing IDs', async () => {
  for (const schema of [1, 2, 3] as const) {
    const state = fixture(schema);
    state.promptRows = [{ id: 'old-engine-id', project_id: 'project', text: 'Preserved question', engine: 'gemini' }];
    state.canonicalPrompts = [{ id: 'old-engine-id', project_id: 'project', unit_id: 'canonical-question', engines_override_json: '["chat_gpt","gemini"]', subscribed: 0 }];
    state.expected.counts = { prompts: 1, runs: 0, ...(schema >= 3 ? { semantic_evaluations: 0 } : {}) };
    state.expected.digests = { prompts: await extendStoreDigest('', 'prompts', state.promptRows, schema), runs: emptyDigest, ...(schema >= 3 ? { semantic_evaluations: emptyDigest } : {}) };
    state.registry.candidate_manifest_json = JSON.stringify(state.expected);
    for (let i = 0; i < 3; i++) if ((await commitProjectStoreRestore('project', 'owner', 'candidate')).done) break;
    assert.equal(state.registry.generation, 'candidate');
    assert.deepEqual(state.applied, state.canonicalPrompts);
    assert.equal(state.promptRows[0]!.id, 'old-engine-id');
    assert.equal(state.promptRows[0]!.text, 'Preserved question');
    assert.equal(state.promptRows[0]!.subscribed, 0);
    assert.ok(state.events.indexOf('apply:candidate') < state.events.indexOf('cas'));
  }
});
