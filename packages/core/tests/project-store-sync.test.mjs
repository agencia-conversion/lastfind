// A publication step acknowledges what it published, marks the store caught up and reads it back in one D1 round trip.
// Real publisher code on the edition's migrations; only the store's RPC is faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const core = `${root}packages/core/`;
const edition = ['cloud', 'selfhost'].find((name) => existsSync(`${root}apps/${name}/drizzle`));
const stubs = {
  env: 'export const db=()=>globalThis.storeFixture.db;export const now=()=>new Date().toISOString();export const setting=()=>"";',
  'project-store-transport': 'export const projectStorageConfigured=()=>true;export const projectStoreRpc=async(message)=>globalThis.storeFixture.rpc(message);',
  http: 'export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}',
};
const firstExisting = (base) => [base, `${base}.ts`, `${base}.mjs`, `${base}/index.ts`].find((path) => /\.(ts|mjs)$/.test(path) && existsSync(path)) ?? base;
const bundle = await build({
  entryPoints: [`${core}lib/server/project-store.ts`],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'fixtures',
    setup(plugin) {
      plugin.onResolve({ filter: /^\.\/(env|project-store-transport|http)$/ }, (args) => ({ path: args.path.slice(2), namespace: 'fixture' }));
      plugin.onResolve({ filter: /^@\// }, (args) => ({ path: firstExisting(`${core}${args.path.slice(2)}`) }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
    },
  }],
});
const store = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

test('a publication step sends the outbox, then acknowledges it, marks the store caught up and reads it back in one round trip', async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(`${root}apps/${edition}/drizzle`).filter((file) => file.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(`${root}apps/${edition}/drizzle/${name}`, 'utf8'));
  const trips = [];
  const prepare = (sql, params = []) => ({
    sql, params,
    bind: (...values) => prepare(sql, values),
    all: async () => (trips.push(1), { results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async () => (trips.push(1), sqlite.prepare(sql).get(...params) ?? null),
    run: async () => (trips.push(1), { meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
  });
  const db = {
    prepare,
    async batch(statements) {
      trips.push(statements.length);
      return statements.map(({ sql, params }) => /^\s*SELECT/i.test(sql)
        ? { results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })), meta: { changes: 0 } }
        : { results: [], meta: { changes: sqlite.prepare(sql).run(...params).changes } });
    },
  };
  const sent = [];
  let afterRpc = null;
  globalThis.storeFixture = { db, rpc: async (message) => { sent.push(message); if (message.action === 'apply') afterRpc = trips.length; return {}; } };
  const stamp = '2026-10-31T07:00:00.000Z';
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('o','o@example.test','O',?)").run(stamp);
  sqlite.prepare("INSERT INTO projects(id,workspace_id,name,domain,competitors_json,location_code,language_code,daily_enabled,created_at) VALUES('p','o','P','p.example','[]',2840,'en',1,?)").run(stamp);
  await store.registerProjectStoreStatement('p', 'o').run();
  sqlite.prepare("UPDATE project_stores SET initialized=1,source_revision=3,applied_revision=0 WHERE project_id='p'").run();
  for (let revision = 1; revision <= 3; revision++)
    sqlite.prepare("INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json) VALUES('p','runs',?,?,'upsert',?)").run(`r${revision}`, revision, JSON.stringify({ id: `r${revision}` }));

  const result = await store.syncProjectStore('p', 'o', 100);
  assert.equal(result.published, 3);
  assert.equal(result.done, true);
  assert.equal(result.registry.applied_revision, 3);
  assert.deepEqual(sent.map((message) => [message.action, message.changes?.length]), [['apply', 3]]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM project_store_outbox WHERE project_id='p'").get().n, 0, 'acknowledged');
  // After the RPC: one batch of three statements (three round trips before), then the lease is released.
  assert.deepEqual(trips.slice(afterRpc, afterRpc + 1), [3]);
  assert.equal(trips.length - afterRpc, 2);
  // Nothing new: no RPC, the store is marked and read back in one batch.
  trips.length = 0;
  sent.length = 0;
  assert.equal((await store.syncProjectStore('p', 'o', 100)).published, 0);
  assert.equal(sent.length, 0);
  assert.ok(trips.includes(2), 'mark and read back together');
});

// 12/11/2026 (preview pool): a publication that throws mid-way must release its lock, so the next call publishes instead of
// answering 409 "already running" until the lock expires; a release D1 refuses once is asked again; a call that finds the lock
// held does not extend it.
test('a publication that fails releases its lock, and the next one goes on', async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(`${root}apps/${edition}/drizzle`).filter((file) => file.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(`${root}apps/${edition}/drizzle/${name}`, 'utf8'));
  let failDelete = 0;
  const prepare = (sql, params = []) => ({
    sql, params,
    bind: (...values) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => {
      if (sql.startsWith('DELETE FROM job_leases') && failDelete > 0) {
        failDelete--;
        throw new Error('D1_ERROR: Network connection lost.');
      }
      return { meta: { changes: sqlite.prepare(sql).run(...params).changes } };
    },
  });
  const db = {
    prepare,
    async batch(statements) {
      return statements.map(({ sql, params }) => /^\s*SELECT/i.test(sql)
        ? { results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })), meta: { changes: 0 } }
        : { results: [], meta: { changes: sqlite.prepare(sql).run(...params).changes } });
    },
  };
  let failApply = 1;
  globalThis.storeFixture = { db, rpc: async (message) => { if (message.action === 'apply' && failApply-- > 0) throw new Error('store apply failed'); return {}; } };
  const stamp = '2026-11-12T02:00:00.000Z';
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('o','o@example.test','O',?)").run(stamp);
  sqlite.prepare("INSERT INTO projects(id,workspace_id,name,domain,competitors_json,location_code,language_code,daily_enabled,created_at) VALUES('p','o','P','p.example','[]',2840,'en',1,?)").run(stamp);
  await store.registerProjectStoreStatement('p', 'o').run();
  sqlite.prepare("UPDATE project_stores SET initialized=1,source_revision=2,applied_revision=0 WHERE project_id='p'").run();
  for (let revision = 1; revision <= 2; revision++)
    sqlite.prepare("INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json) VALUES('p','runs',?,?,'upsert',?)").run(`r${revision}`, revision, JSON.stringify({ id: `r${revision}` }));
  const leases = () => sqlite.prepare("SELECT count(*) n FROM job_leases WHERE key='project-storage:p'").get().n;

  // The store fails, and the release fails once too: the original error surfaces and the lock is still released.
  failDelete = 1;
  await assert.rejects(store.syncProjectStore('p', 'o', 100), /store apply failed/);
  assert.equal(leases(), 0);
  const result = await store.syncProjectStore('p', 'o', 100);
  assert.equal(result.published, 2);
  assert.equal(result.done, true);

  // A lock someone holds: the call answers 409 and leaves its expiry as it was.
  const expires = Date.now() + 60_000;
  sqlite.prepare("INSERT INTO job_leases(key,owner,expires_at) VALUES('project-storage:p','other',?)").run(expires);
  await assert.rejects(store.syncProjectStore('p', 'o', 100), (error) => error.status === 409);
  assert.equal(sqlite.prepare("SELECT expires_at FROM job_leases WHERE key='project-storage:p'").get().expires_at, expires);
});

// 12/11/2026 (preview pool): the acknowledgement finds each published row by its unique key. Testing every queued row against the
// batch read ~12 thousand × 100 rows per call on a preview's Netflix copy and D1 answered "overloaded".
test('the acknowledgement deletes only the published rows, each found by its key, however long the queue', async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(`${root}apps/${edition}/drizzle`).filter((file) => file.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(`${root}apps/${edition}/drizzle/${name}`, 'utf8'));
  const deletes = [];
  const prepare = (sql, params = []) => ({
    sql, params,
    bind: (...values) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
  });
  const db = {
    prepare,
    async batch(statements) {
      return statements.map(({ sql, params }) => {
        if (sql.startsWith('DELETE FROM project_store_outbox WHERE rowid')) deletes.push({ sql, params });
        return /^\s*SELECT/i.test(sql)
          ? { results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })), meta: { changes: 0 } }
          : { results: [], meta: { changes: sqlite.prepare(sql).run(...params).changes } };
      });
    },
  };
  globalThis.storeFixture = { db, rpc: async () => ({}) };
  const stamp = '2026-11-12T05:00:00.000Z';
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('o','o@example.test','O',?)").run(stamp);
  for (const project of ['p', 'other'])
    sqlite.prepare("INSERT INTO projects(id,workspace_id,name,domain,competitors_json,location_code,language_code,daily_enabled,created_at) VALUES(?,'o','P','p.example','[]',2840,'en',1,?)").run(project, stamp);
  await store.registerProjectStoreStatement('p', 'o').run();
  sqlite.prepare("UPDATE project_stores SET initialized=1,source_revision=250,applied_revision=0 WHERE project_id='p'").run();
  const queue = sqlite.prepare("INSERT INTO project_store_outbox(project_id,entity,entity_id,revision,operation,data_json) VALUES(?,'runs',?,?,'upsert',?)");
  for (let revision = 1; revision <= 250; revision++) queue.run('p', `r${revision}`, revision, JSON.stringify({ id: `r${revision}` }));
  // The same row ids in another project stay queued.
  for (let revision = 1; revision <= 5; revision++) queue.run('other', `r${revision}`, revision, JSON.stringify({ id: `r${revision}` }));

  const result = await store.syncProjectStore('p', 'o', 100);
  assert.equal(result.published, 100);
  const left = (project) => sqlite.prepare('SELECT count(*) n FROM project_store_outbox WHERE project_id=?').get(project).n;
  assert.equal(left('p'), 150);
  assert.equal(left('other'), 5);
  assert.equal(sqlite.prepare("SELECT min(revision) n FROM project_store_outbox WHERE project_id='p'").get().n, 101);
  // Each element of the batch is found through the outbox's unique key, never by reading the project's whole queue.
  const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${deletes[0].sql}`).all(...deletes[0].params).map((row) => row.detail).join('\n');
  assert.match(plan, /SCAN x VIRTUAL TABLE[\s\S]*SEARCH o USING INDEX idx_project_outbox_(entity \(project_id=\? AND entity=\? AND entity_id=\?\)|revision \(project_id=\? AND revision=\?\))/);
});
