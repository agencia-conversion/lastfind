import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

// AI bots' connection and collection (lib/server/ai-bots.ts): the real module over a D1 of node:sqlite with the migration, a
// fake project store and a fake Cloudflare API answering recorded shapes. No network, no real token.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const core = path.join(root, 'packages/core');
const SECRET = 'isolated-ai-bots-test-secret-0123456789abcdefghij';
const ZONE = '0123456789abcdef0123456789abcdef';
const TOKEN = 'not-a-real-cloudflare-token-abcd1234';
const recorded = JSON.parse(readFileSync(path.join(core, 'tests/fixtures/ai-bots-graphql.json'), 'utf8'));

const fixtures = {
  'cloudflare:workers': 'export const env = new Proxy({}, { get: (_, key) => globalThis.fixtureEnv?.[key] }); export const waitUntil = (promise) => globalThis.waited.push(promise);',
  store: 'export const ensureProjectStore = async () => ({ generation: "g1" }); export const projectStoreRpc = async (message) => globalThis.storeCalls.push(message) && (message.action === "query" ? globalThis.queryAnswer ?? [] : {});',
  http: 'export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }',
};
const bundle = await build({
  absWorkingDir: root,
  stdin: { contents: "export * from './packages/core/lib/server/ai-bots.ts';", resolveDir: root, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  external: ['node:async_hooks'],
  plugins: [
    {
      name: 'fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'fixture' }));
        plugin.onResolve({ filter: /^\.\/project-store(-transport)?$/ }, () => ({ path: 'store', namespace: 'fixture' }));
        plugin.onResolve({ filter: /^\.\/http$/ }, () => ({ path: 'http', namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtures[args.path], loader: 'js' }));
        plugin.onResolve({ filter: /^@\// }, (args) => {
          const resolved = path.join(core, args.path.slice(2));
          for (const extension of ['', '.ts', '.tsx', '.mjs']) if (readable(resolved + extension)) return { path: resolved + extension };
          return { path: resolved };
        });
      },
    },
  ],
});
function readable(file) {
  try {
    return !!readFileSync(file);
  } catch {
    return false;
  }
}
const bots = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

function d1(sqlite) {
  const prepare = (sql, params = []) => ({
    bind: (...values) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async () => {
      const row = sqlite.prepare(sql).get(...params);
      return row ? { ...row } : null;
    },
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
  });
  return { prepare };
}
/** Cloudflare's API as the connection meets it: `graphql` answers each day's query (default: the recorded day). */
function cloudflare({ active = true, zones = [{ id: ZONE, name: 'example.test', plan: { name: 'Pro Website', legacy_id: 'pro' } }], graphql = () => ({ data: recorded.day.data }) } = {}) {
  const asked = [];
  globalThis.fetch = async (url, init = {}) => {
    const address = new URL(url);
    asked.push({ path: address.pathname, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null });
    if (address.pathname.endsWith('/user/tokens/verify')) return Response.json({ success: active, result: { status: active ? 'active' : 'disabled' } }, { status: active ? 200 : 401 });
    if (address.pathname.endsWith('/zones')) return Response.json({ success: true, result: zones });
    if (address.pathname.endsWith('/graphql')) return Response.json(graphql(JSON.parse(init.body)));
    return Response.json({}, { status: 404 });
  };
  return asked;
}
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES(\'project-a\');');
  sqlite.exec('CREATE TABLE job_leases(key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);');
  sqlite.exec(readFileSync(path.join(root, 'apps/selfhost/drizzle/0087_ai_bots.sql'), 'utf8'));
  sqlite.exec('ALTER TABLE ai_bot_connections RENAME COLUMN owner_id TO workspace_id'); // as 0101_workspaces does
  globalThis.fixtureEnv = { DB: d1(sqlite), CREDENTIALS_KEY: SECRET };
  globalThis.waited = [];
  globalThis.storeCalls = [];
  return sqlite;
}
const row = (sqlite) => ({ ...sqlite.prepare("SELECT * FROM ai_bot_connections WHERE project_id='project-a'").get() });
const today = () => new Date().toISOString().slice(0, 10);
const shift = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

test('a token is checked before anything is saved, then sealed; it never comes back', async () => {
  const sqlite = fixture();
  cloudflare({ active: false });
  assert.deepEqual(await bots.saveToken('project-a', 'owner-a', 'user-a', TOKEN), { ok: false, problem: 'auth' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM ai_bot_connections').get().n, 0, 'a refused token is not kept');
  cloudflare({ zones: [] });
  assert.deepEqual(await bots.saveToken('project-a', 'owner-a', 'user-a', TOKEN), { ok: false, problem: 'zones' });
  await assert.rejects(bots.saveToken('project-a', 'owner-a', 'user-a', 'has spaces in it'), /Enter the key/);

  const asked = cloudflare();
  const saved = await bots.saveToken('project-a', 'owner-a', 'user-a', ` ${TOKEN} `);
  assert.deepEqual(saved, { ok: true, zones: [{ id: ZONE, name: 'example.test', plan: 'Pro Website', paid: true }], current: null });
  assert.ok(asked.every((call) => call.auth === `Bearer ${TOKEN}`));
  const stored = row(sqlite);
  assert.equal(stored.state, 'zone');
  assert.equal(stored.token_hint, '1234');
  assert.ok(!JSON.stringify(stored).includes('not-a-real'), 'sealed at rest');
  const view = bots.connectionView(stored, true);
  assert.equal(view.state, 'zone');
  assert.ok(!JSON.stringify(view).includes('not-a-real'), 'the screen never gets the token');
});

test('choosing the zone probes what it can read, starts a new history and collects 30 days, then one a day', async () => {
  const sqlite = fixture();
  cloudflare({
    graphql: (body) =>
      // A Free zone: the referral field is refused, the rest answers.
      body.query.includes('clientRefererHost') ? recorded.unknownField : { data: recorded.day.data },
  });
  await bots.saveToken('project-a', 'owner-a', 'user-a', TOKEN);
  assert.deepEqual(await bots.chooseZone('project-a', 'owner-a', ZONE), { ok: true });
  let stored = row(sqlite);
  assert.equal(stored.state, 'active');
  assert.deepEqual(JSON.parse(stored.capabilities_json), { pages: true, referrals: false, utm: false });
  assert.deepEqual(globalThis.storeCalls.map((call) => call.action), ['bots-clear'], 'a new zone starts a new history');
  assert.equal(globalThis.waited.length, 1, 'the first days are read after the answer');
  await Promise.all(globalThis.waited);
  globalThis.storeCalls = [];

  // The rest of the backfill, as the scheduler's step reads it.
  const asked = cloudflare();
  await bots.syncProject('project-a', 'owner-a', 40);
  stored = row(sqlite);
  assert.equal(stored.synced_through, shift(today(), -1), 'the whole days are kept up to yesterday');
  assert.equal(stored.next_sync_at.slice(0, 10), shift(today(), 1), 'next: tomorrow');
  const puts = globalThis.storeCalls.filter((call) => call.action === 'bots-put');
  assert.ok(puts.length >= 1);
  assert.equal(puts.at(-1).days[0].day, today(), 'today is read again on every run, as partial');
  assert.equal(puts.at(-1).days[0].complete, false);
  assert.ok(asked.filter((call) => call.path.endsWith('/graphql')).every((call) => !call.body.query.includes('clientRefererHost')), 'a Free zone is never asked for referrals');
  // Over the two runs, every one of the 31 days was stored once at least.
  assert.equal(stored.last_sync_at.slice(0, 10), today());
});

test('a revoked token marks the connection invalid; the rate limit only waits; disconnecting forgets the token', async () => {
  const sqlite = fixture();
  cloudflare();
  await bots.saveToken('project-a', 'owner-a', 'user-a', TOKEN);
  await bots.chooseZone('project-a', 'owner-a', ZONE);
  await Promise.all(globalThis.waited);

  sqlite.prepare("UPDATE ai_bot_connections SET synced_through=NULL,next_sync_at='2000-01-01T00:00:00.000Z'").run();
  cloudflare({ graphql: () => recorded.budget });
  assert.deepEqual(await bots.syncProject('project-a', 'owner-a', 10), { requests: 1, budget: true });
  assert.equal(row(sqlite).state, 'active');

  cloudflare({ graphql: () => recorded.authz });
  assert.equal(await bots.syncAiBots(), 1);
  const invalid = row(sqlite);
  assert.equal(invalid.state, 'invalid');
  assert.equal(bots.connectionView(invalid, true).problem, 'auth');

  // A replacement token for the same zone goes on collecting it, history kept.
  cloudflare();
  const replaced = await bots.saveToken('project-a', 'owner-a', 'user-a', `${TOKEN}x`);
  assert.equal(replaced.current, ZONE);
  assert.equal(row(sqlite).state, 'active');

  await bots.disconnect('project-a', 'owner-a');
  const gone = row(sqlite);
  assert.equal(gone.token_sealed, null);
  assert.equal(gone.state, 'none');
  assert.equal(bots.connectionView(gone, true).state, 'none');
  assert.deepEqual(await bots.syncProject('project-a', 'owner-a', 10), { requests: 0, budget: false });
});

test('a zone connected before utm_source visits were read finds out once, then reads its window again', async () => {
  const sqlite = fixture();
  cloudflare();
  await bots.saveToken('project-a', 'owner-a', 'user-a', TOKEN);
  await bots.chooseZone('project-a', 'owner-a', ZONE);
  await Promise.all(globalThis.waited);
  assert.equal(JSON.parse(row(sqlite).capabilities_json).utm, true, 'a new zone is probed for it');
  sqlite.prepare(`UPDATE ai_bot_connections SET capabilities_json='{"pages":true,"referrals":true}',synced_through=?,next_sync_at='2000-01-01T00:00:00.000Z'`).run(shift(today(), -1));
  globalThis.storeCalls = [];
  const asked = cloudflare();
  await bots.syncProject('project-a', 'owner-a', 40);
  assert.equal(JSON.parse(row(sqlite).capabilities_json).utm, true);
  const queries = asked.filter((call) => call.path.endsWith('/graphql')).map((call) => call.body.query);
  assert.ok(queries.length > 30 && queries.slice(1).every((query) => query.includes('clientRequestQuery_like')), 'the 30 days read again, with the utm visits');
  // Known now: the next run asks nothing more than its day.
  sqlite.prepare("UPDATE ai_bot_connections SET next_sync_at='2000-01-01T00:00:00.000Z'").run();
  const again = cloudflare();
  await bots.syncProject('project-a', 'owner-a', 40);
  assert.equal(again.filter((call) => call.path.endsWith('/graphql')).length, 1);
});

test('landing pages of the days collected before them: the last 30 days read again once, through the daily collection', async () => {
  const sqlite = fixture();
  cloudflare();
  await bots.saveToken('project-a', 'owner-a', 'user-a', TOKEN);
  await bots.chooseZone('project-a', 'owner-a', ZONE);
  await Promise.all(globalThis.waited);
  sqlite.prepare("UPDATE ai_bot_connections SET synced_through=?,next_sync_at='2999-01-01T00:00:00.000Z'").run(shift(today(), -1));
  // A dry run only lists.
  assert.deepEqual(await bots.rereadLandings({}), { dryRun: true, projects: [{ projectId: 'project-a', result: 'queued' }] });
  assert.equal(row(sqlite).synced_through, shift(today(), -1));
  await bots.rereadLandings({ dryRun: false });
  const queued = row(sqlite);
  assert.equal(queued.synced_through, shift(today(), -31), 'the next collection starts 30 days back');
  assert.ok(queued.next_sync_at <= new Date().toISOString(), 'and is due now');
  // Landing pages already kept from the window's first day: nothing to read again.
  globalThis.queryAnswer = [{ results: [{ day: shift(today(), -30) }] }];
  try {
    assert.deepEqual((await bots.rereadLandings({ dryRun: false })).projects, [{ projectId: 'project-a', result: 'done' }]);
  } finally {
    globalThis.queryAnswer = undefined;
  }
  // A Free zone has no referrals to read.
  sqlite.prepare(`UPDATE ai_bot_connections SET capabilities_json='{"pages":true,"referrals":false}'`).run();
  assert.deepEqual((await bots.rereadLandings({ dryRun: false })).projects, [{ projectId: 'project-a', result: 'free' }]);
});
