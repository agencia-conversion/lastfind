// Production's pipelines of each project run in Durable Object alarms of their own (six outbound connections each), one
// bounded step per alarm, chained while a step did work. Real runner and step code; the steps' work, the database and the
// Durable Object storage are faked. Nothing paid is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stubs = {
  'cloudflare:workers': `export const env=new Proxy({},{get:(_,key)=>globalThis.runnerFixture?.[key]});export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}`,
  './env': 'export const db=()=>globalThis.runnerFixture.db;export const setting=(k)=>globalThis.runnerFixture.settings[k]??"";export const now=()=>new Date().toISOString();',
  '../lib/server/env': 'export const setting=(k)=>globalThis.runnerFixture.settings[k]??"";',
  '../lib/server/platform-settings': 'export const loadPlatformSettings=async()=>{globalThis.runnerFixture.loaded++;};',
  './brand-role-jobs': `export const processBrandRoles=async(ids)=>globalThis.runnerFixture.work('roles',ids);`,
  './brand-domain-discovery': `export const processBrandDomains=async(ids)=>globalThis.runnerFixture.work('domains',ids);`,
  './fanout-intents': `export const processFanoutIntents=async(ids)=>globalThis.runnerFixture.work('intents',ids);`,
  './capabilities': `export const projectStep=async(pipeline,id)=>globalThis.runnerFixture.edition(pipeline,id);`,
  './project-store': `export const syncProjectStore=async(id,owner,rows)=>globalThis.runnerFixture.publish(id,owner,rows);`,
  './semantic-panel-worker': `export const RUNNER_SEND_BUDGET_MS=240000, SEND_TIMEOUT_MS=40000; export const semanticPanelStep=async(id)=>globalThis.runnerFixture.work('panel',[id]);`,
  './comparison-worker': `export const COMPARISON_RUNNER_MS=240000; export const comparisonStep=async(id)=>globalThis.runnerFixture.work('comparison',[id]);`,
  '../lib/server/monitor': `export const submitQueued=async(user,runs,renew,shard)=>globalThis.runnerFixture.work('perplexity',[user,runs,renew,shard]);`,
};
async function load(entry) {
  const bundle = await build({
    entryPoints: [root + entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [{
      name: 'fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) => (args.path in stubs ? { path: args.path, namespace: 'fixture' } : undefined));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}
const steps = await load('packages/core/lib/server/project-runners.ts');
const { ProjectRunner } = await load('packages/core/worker/project-runner.ts');
const leases = await load('packages/core/lib/server/leases.ts');
const OVERLOADED = 'D1_ERROR: D1 DB is overloaded. Requests queued for too long.';

const edition = ['cloud', 'selfhost'].find((name) => existsSync(`${root}apps/${name}/drizzle`));
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(`${root}apps/${edition}/drizzle`).filter((file) => file.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(`${root}apps/${edition}/drizzle/${name}`, 'utf8'));
  const prepare = (sql, params = []) => ({
    bind: (...values) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
  });
  globalThis.runnerFixture = { db: { prepare }, settings: {}, loaded: 0, calls: [], work: async () => 0, edition: async () => null };
  return sqlite;
}
// A Durable Object's storage, as far as the runner uses it.
function storage() {
  const values = new Map();
  let alarm = null;
  return {
    get: async (key) => values.get(key),
    put: async (key, value) => void values.set(key, structuredClone(value)),
    getAlarm: async () => alarm,
    setAlarm: async (at) => void (alarm = at),
    take: () => {
      const at = alarm;
      alarm = null;
      return at;
    },
  };
}

test('a runner runs one step per alarm and chains the next while a step did work; busy waits, idle stops', async () => {
  setup();
  const store = storage();
  const runner = new ProjectRunner({ storage: store }, {});
  const results = [{ done: 3, busy: false }, { done: 0, busy: true }, { done: 2, busy: false }, { done: 0, busy: false }];
  const seen = [];
  globalThis.runnerFixture.edition = async (pipeline, id) => (seen.push([pipeline, id]), results.shift());
  await runner.start('sentiment', 'p1');
  assert.ok(Math.abs(store.take() - Date.now()) < 1000, 'the first step runs at once');
  await runner.alarm();
  assert.ok(store.take() <= Date.now(), 'work done: the next step at once');
  await runner.alarm();
  assert.ok(store.take() - Date.now() > 20_000, 'busy: tried again later');
  await runner.alarm();
  store.take();
  await runner.alarm();
  assert.equal(store.take(), null, 'nothing left: the chain stops until the next start');
  assert.deepEqual(seen, Array(4).fill(['sentiment', 'p1']));
  assert.equal(globalThis.runnerFixture.loaded, 4, 'the Admin settings (the provider key) are read in every alarm');
  // A start while a step is scheduled leaves that chain alone.
  await store.setAlarm(123);
  await runner.start('sentiment', 'p1');
  assert.equal(store.take(), 123);
  // Maintenance pauses every runner.
  globalThis.runnerFixture.settings.MAINTENANCE_MODE = 'true';
  await runner.start('sentiment', 'p1');
  store.take();
  await runner.alarm();
  assert.equal(seen.length, 4);
});

test('a step that is busy again and again stops after its retries; one that throws ends the chain and is logged', async (t) => {
  setup();
  const store = storage();
  const runner = new ProjectRunner({ storage: store }, {});
  globalThis.runnerFixture.edition = async () => ({ done: 0, busy: true });
  await runner.start('sources', 'all');
  let alarms = 0;
  while (store.take() !== null && alarms < 50) {
    await runner.alarm();
    alarms++;
  }
  assert.equal(alarms, 11);
  const errors = [];
  t.mock.method(console, 'error', (message) => errors.push(message));
  globalThis.runnerFixture.edition = async () => {
    throw new TypeError('store gone');
  };
  await runner.start('sources', 'all');
  store.take();
  await runner.alarm();
  assert.equal(store.take(), null);
  assert.deepEqual(errors, ['Project runner sources step failed (TypeError: store gone).']);
});

test('roles and domains steps: one per project at a time (lease), made due at once only when chained', async () => {
  const sqlite = setup();
  const calls = [];
  globalThis.runnerFixture.work = async (pipeline, ids) => {
    calls.push([pipeline, ids, !!sqlite.prepare('SELECT 1 FROM system_state WHERE key=?').get(`brand-${pipeline}-checked:${ids[0]}`)]);
    return 4;
  };
  sqlite.prepare("INSERT INTO system_state(key,value) VALUES('brand-roles-checked:p1',?),('brand-domains-checked:p1',?)").run(new Date().toISOString(), new Date().toISOString());
  assert.deepEqual(await steps.runProjectStep('roles', 'p1', false), { done: 4, busy: false });
  assert.deepEqual(calls.pop(), ['roles', ['p1'], true], 'the first step of a chain keeps the scheduler spacing');
  assert.deepEqual(await steps.runProjectStep('domains', 'p1'), { done: 4, busy: false });
  assert.deepEqual(calls.pop(), ['domains', ['p1'], false], 'a chained step is due at once');
  // The fan-out intents step keeps its own look-at key.
  sqlite.prepare("INSERT INTO system_state(key,value) VALUES('fanout-intents-checked:p1',?)").run(new Date().toISOString());
  assert.deepEqual(await steps.runProjectStep('intents', 'p1'), { done: 4, busy: false });
  assert.deepEqual(calls.pop()[0], 'intents');
  assert.equal(sqlite.prepare("SELECT 1 FROM system_state WHERE key='fanout-intents-checked:p1'").get(), undefined, 'a chained step is due at once');
  sqlite.prepare("INSERT INTO job_leases(key,owner,expires_at) VALUES('roles:p1','elsewhere',?)").run(Date.now() + 60_000);
  assert.deepEqual(await steps.runProjectStep('roles', 'p1'), { done: 0, busy: true }, 'another invocation is on it');
  assert.equal(calls.length, 0);
  // Sentiment and source types are the edition's (Cloud); none here means nothing to do.
  assert.deepEqual(await steps.runProjectStep('sentiment', 'p1'), { done: 0, busy: false });
});

test('a Semantic Branding step runs one project at a time (lease); a Perplexity runner sends its share of the queue', async () => {
  const sqlite = setup();
  const calls = [];
  globalThis.runnerFixture.work = async (pipeline, args) => (calls.push([pipeline, args]), 18);
  assert.deepEqual(await steps.runProjectStep('panel', 'p1'), { done: 18, busy: false });
  assert.deepEqual(calls.pop(), ['panel', ['p1']]);
  sqlite.prepare("INSERT INTO job_leases(key,owner,expires_at) VALUES('panel:p1','elsewhere',?)").run(Date.now() + 60_000);
  assert.deepEqual(await steps.runProjectStep('panel', 'p1'), { done: 0, busy: true }, 'another invocation is on it');
  const store = storage();
  const runner = new ProjectRunner({ storage: store }, {});
  await runner.start('perplexity', '2');
  store.take();
  await runner.alarm();
  assert.deepEqual(calls.pop(), ['perplexity', [undefined, undefined, undefined, 2]], 'the scheduler-wide queue, its share, no lease renewal');
  assert.ok(store.take() <= Date.now(), 'it sent: the next step at once');
  assert.equal(calls.length, 0);
});

test('publication: 100 rows a step until the store is caught up; another publisher or a restarting store is busy', async () => {
  const sqlite = setup();
  const stamp = '2026-10-01T00:00:00.000Z';
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('o','o@example.test','O',?)").run(stamp);
  sqlite.prepare("INSERT INTO projects(id,workspace_id,name,domain,competitors_json,location_code,language_code,daily_enabled,created_at) VALUES('p1','o','P','x.example','[]',2840,'en',1,?)").run(stamp);
  const replies = [{ done: false, published: 100 }, { done: true, published: 40 }, Object.assign(new Error('busy'), { status: 409 }), Object.assign(new Error('down'), { status: 503 })];
  const asked = [];
  globalThis.runnerFixture.publish = async (id, owner, rows) => {
    asked.push([id, owner, rows]);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  assert.deepEqual(await steps.runProjectStep('publish', 'p1'), { done: 100, busy: false });
  assert.deepEqual(await steps.runProjectStep('publish', 'p1'), { done: 0, busy: false }, 'caught up: the chain stops');
  assert.deepEqual(await steps.runProjectStep('publish', 'p1'), { done: 0, busy: true });
  assert.deepEqual(await steps.runProjectStep('publish', 'p1'), { done: 0, busy: true });
  assert.deepEqual(asked[0], ['p1', 'o', 100]);
  assert.deepEqual(await steps.runProjectStep('publish', 'unknown'), { done: 0, busy: false });
});

test('the scheduler starts one runner per pipeline and project, the least recently looked at first; without the binding it runs inline', async () => {
  const sqlite = setup();
  assert.equal(await steps.startRunners('sentiment', ['p1']), null);
  assert.equal(await steps.startProjectRunners('roles'), null);
  const started = [];
  globalThis.runnerFixture.PROJECT_RUNNERS = {
    idFromName: (name) => name,
    get: (name) => ({ start: async (pipeline, id) => started.push([name, pipeline, id]) }),
  };
  const stamp = '2026-10-01T00:00:00.000Z';
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('o','o@example.test','O',?)").run(stamp);
  for (const id of ['a', 'b', 'c', 'archived', 'empty'])
    sqlite.prepare("INSERT INTO projects(id,workspace_id,name,domain,competitors_json,location_code,language_code,daily_enabled,archived,created_at) VALUES(?,'o',?,'x.example','[]',2840,'en',1,?,?)").run(id, id, id === 'archived' ? 1 : 0, stamp);
  sqlite.prepare("UPDATE project_stores SET initialized=CASE WHEN project_id='empty' THEN 0 ELSE 1 END").run();
  sqlite.prepare("INSERT INTO system_state(key,value) VALUES('brand-roles-checked:a','2026-10-29T10:00:00.000Z'),('brand-roles-checked:b','2026-10-29T09:00:00.000Z')").run();
  assert.equal(await steps.startProjectRunners('roles'), 3);
  assert.deepEqual(started, [['roles:c', 'roles', 'c'], ['roles:b', 'roles', 'b'], ['roles:a', 'roles', 'a']]);
  // Publication: only the stores behind.
  started.length = 0;
  sqlite.prepare("UPDATE project_stores SET source_revision=applied_revision+1 WHERE project_id='b'").run();
  assert.equal(await steps.startProjectRunners('publish'), 2, 'b, and the store never initialized');
  assert.deepEqual(started.map(([name]) => name).sort(), ['publish:b', 'publish:empty']);
  started.length = 0;
  assert.equal(await steps.startRunners('sentiment', ['a', 'b']), 2);
  assert.deepEqual(started.map(([name]) => name), ['sentiment:a', 'sentiment:b']);
  // Spaced: never every pipeline of every project in the same second (D1 refused that burst as overloaded).
  started.length = 0;
  globalThis.runnerFixture.PROJECT_RUNNERS.get = (name) => ({ start: async (pipeline, id, delay) => started.push([name, delay]) });
  await steps.startRunners('roles', ['a', 'b', 'c']);
  assert.deepEqual(started.map(([, delay]) => delay), [10_000, 13_000, 16_000]);
  const delays = ['publish', 'panel', 'roles', 'domains', 'intents', 'learn'].flatMap((pipeline) =>
    Array.from({ length: steps.RUNNER_PROJECTS_PER_TICK }, (_, index) => steps.runnerDelay(pipeline, index)),
  );
  assert.ok(delays.every((delay) => delay >= 0 && delay < steps.RUNNER_WINDOW_MS), 'every start inside the window, before the operations tick');
  const perSecond = new Map();
  for (const delay of delays) perSecond.set(Math.floor(delay / 1000), (perSecond.get(Math.floor(delay / 1000)) ?? 0) + 1);
  assert.ok(Math.max(...perSecond.values()) <= 6, `at most a few starts a second (${Math.max(...perSecond.values())})`);
  assert.ok(steps.RUNNER_PROJECTS_PER_TICK >= 3);
  delete globalThis.runnerFixture.PROJECT_RUNNERS;
});

test('a runner started with a delay runs its first step then; an overloaded D1 makes a step wait, not end the chain', async (t) => {
  setup();
  const store = storage();
  const runner = new ProjectRunner({ storage: store }, {});
  await runner.start('roles', 'p1', 13_000);
  const at = store.take();
  assert.ok(at - Date.now() > 12_000 && at - Date.now() <= 13_000);
  const warnings = [];
  const errors = [];
  t.mock.method(console, 'warn', (message) => warnings.push(message));
  t.mock.method(console, 'error', (message) => errors.push(message));
  globalThis.runnerFixture.edition = async () => {
    throw new Error(OVERLOADED);
  };
  await runner.start('sentiment', 'p1');
  store.take();
  await runner.alarm();
  const retry = store.take() - Date.now();
  assert.ok(retry > 25_000 && retry <= 45_000, `tried again about 30 s later (${retry})`);
  assert.deepEqual(warnings, ['Project runner sentiment step waits: D1 is overloaded.']);
  assert.deepEqual(errors, []);
});

test('an overloaded D1 is waited out: the lease claim is asked again, a refused release is left to expire, other errors still fail', async () => {
  const sqlite = setup();
  let refusals = 0;
  assert.equal(await leases.overloadBackOff(async () => (refusals++ < 2 ? Promise.reject(new Error(OVERLOADED)) : 'ran'), [1, 1]), 'ran');
  assert.equal(refusals, 3);
  await assert.rejects(leases.overloadBackOff(async () => Promise.reject(new Error(OVERLOADED)), [1]), /overloaded/);
  let other = 0;
  await assert.rejects(leases.overloadBackOff(async () => (other++, Promise.reject(new Error('no such table'))), [1, 1]), /no such table/);
  assert.equal(other, 1, 'any other error is not retried');
  assert.equal(leases.d1Overloaded(new Error('UNIQUE constraint failed')), false);
  // The release refused as overloaded: the work's result stands, the lease expires by itself.
  const prepare = globalThis.runnerFixture.db.prepare;
  globalThis.runnerFixture.db = {
    prepare: (sql) => (sql.startsWith('DELETE FROM job_leases') ? { bind: () => ({ run: async () => Promise.reject(new Error(OVERLOADED)) }) } : prepare(sql)),
  };
  assert.equal(await leases.withLease('roles:p1', 60_000, async () => 'done'), 'done');
  assert.ok(sqlite.prepare("SELECT 1 FROM job_leases WHERE key='roles:p1'").get(), 'held until it expires');
});
