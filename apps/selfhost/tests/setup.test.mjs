// The first run's gate (lib/setup-state.ts) and its database (server/setup.ts): an empty installation opens the setup wizard,
// one admin is created, and a finished or in-use installation never shows it again. The real modules over a fake Worker
// environment and a D1 made of node:sqlite; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const resolveFrom = (base, rest) => {
  const file = path.join(root, base, rest);
  return ['', '.ts', '.tsx'].map((extension) => file + extension).find((candidate) => existsSync(candidate) && !candidate.endsWith('/')) ?? file;
};
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents: `export * from './apps/selfhost/server/setup.ts';
      export * from './apps/selfhost/lib/setup-state.ts';
      export { accessKeyHash } from './apps/selfhost/lib/owner-session.ts';
      export { forgetStoredSettings, replaceStoredSettings } from './packages/core/lib/server/stored-settings.ts';
      export { setting } from './packages/core/lib/server/env.ts';`,
    resolveDir: root,
    loader: 'ts',
  },
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
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const env = new Proxy({}, { get: (_, key) => globalThis.fixtureEnv?.[key] });', loader: 'js' }));
        plugin.onResolve({ filter: /^@\// }, (args) => ({ path: resolveFrom('packages/core', args.path.slice(2)) }));
        plugin.onResolve({ filter: /^@edition\// }, (args) => ({ path: resolveFrom('apps/selfhost', args.path.slice(9)) }));
      },
    },
  ],
});
const setup = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

function d1(sqlite) {
  const prepare = (sql, params = []) => ({
    sql,
    params,
    bind: (...values) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
  });
  return {
    prepare,
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => ({ meta: { changes: sqlite.prepare(statement.sql).run(...statement.params).changes } }));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
function fixture(env = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(path.join(root, 'apps/selfhost/drizzle/0040_platform_settings.sql'), 'utf8'));
  sqlite.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)');
  sqlite.exec('CREATE TABLE system_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  globalThis.fixtureEnv = { DB: d1(sqlite), SESSION_SECRET: 'isolated-setup-test-secret-0123456789abcdef', ...env };
  // A new installation: nothing in this isolate's copy either.
  setup.replaceStoredSettings([]);
  setup.forgetStoredSettings();
  return sqlite;
}
const KEY = 'isolated-setup-test-access-key-0123456789';

test('the gate: admin first, then the wizard, then never again', () => {
  assert.equal(setup.setupStage({ owner: false, completed: false, projects: false }), 'admin');
  assert.equal(setup.setupStage({ owner: true, completed: false, projects: false }), 'setup');
  assert.equal(setup.setupStage({ owner: true, completed: true, projects: false }), 'done');
  // An installation in use before the wizard, even without a key in sight, never offers "create the admin".
  assert.equal(setup.setupStage({ owner: false, completed: false, projects: true }), 'done');
  assert.equal(setup.setupStage({ owner: false, completed: true, projects: false }), 'done');
  assert.ok(setup.setupAllows('admin', 'admin') && !setup.setupAllows('setup', 'admin') && !setup.setupAllows('done', 'admin'));
  assert.ok(setup.setupAllows('setup', 'complete') && !setup.setupAllows('admin', 'complete') && !setup.setupAllows('done', 'complete'));
  assert.ok(setup.validAccessKey(KEY) && !setup.validAccessKey('short') && !setup.validAccessKey('x'.repeat(257)));
  assert.ok(setup.validAdminEmail('owner@example.test') && !setup.validAdminEmail('owner') && !setup.validAdminEmail(42));
});

test('an empty installation creates one admin, finishes once and cannot go back', async () => {
  const sqlite = fixture();
  assert.equal(await setup.currentSetupStage(), 'admin');
  const hash = await setup.accessKeyHash(KEY);
  assert.equal(await setup.createFirstAdmin('owner@example.test', hash), true);
  assert.equal(setup.setting('OWNER_EMAIL'), 'owner@example.test');
  assert.equal(setup.setting('OWNER_ACCESS_KEY_HASH'), hash, 'in effect at once: the session it signs verifies');
  assert.equal(await setup.currentSetupStage(), 'setup');
  // A second visitor (or a second tab) cannot take the installation, even with another email.
  assert.equal(await setup.createFirstAdmin('other@example.test', await setup.accessKeyHash(KEY + 'x')), false);
  assert.equal(setup.setting('OWNER_EMAIL'), 'owner@example.test');
  await setup.markSetupComplete('owner@example.test');
  assert.equal(await setup.currentSetupStage(), 'done');
  // Finishing again changes nothing; creating an admin stays refused.
  const at = setup.setting('SETUP_COMPLETED_AT');
  await setup.markSetupComplete('owner@example.test');
  assert.equal(setup.setting('SETUP_COMPLETED_AT'), at);
  assert.equal(await setup.createFirstAdmin('other@example.test', hash), false);
  assert.deepEqual(sqlite.prepare('SELECT key FROM admin_audit_log ORDER BY id').all().map((row) => row.key), ['OWNER_ACCESS_KEY_HASH', 'SETUP_COMPLETED_AT', 'SETUP_COMPLETED_AT']);
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM platform_settings').all()).includes(KEY), 'only the hash is stored');
});

test('another isolate sees the admin and the finished setup without waiting for its copy to expire', async () => {
  fixture();
  await setup.currentSetupStage();
  await setup.createFirstAdmin('owner@example.test', await setup.accessKeyHash(KEY));
  setup.forgetStoredSettings();
  assert.equal(await setup.currentSetupStage(), 'setup');
  await setup.markSetupComplete('owner@example.test');
  setup.forgetStoredSettings();
  assert.equal(await setup.currentSetupStage(), 'done');
});

test('a key set by the installer skips the admin step; an installation in use is done and recorded', async () => {
  fixture({ OWNER_ACCESS_KEY_HASH: await setup.accessKeyHash(KEY) });
  assert.equal(await setup.currentSetupStage(), 'setup');
  const sqlite = fixture();
  sqlite.exec("INSERT INTO projects(id) VALUES('existing')");
  assert.equal(await setup.currentSetupStage(), 'done');
  assert.ok(setup.setting('SETUP_COMPLETED_AT'), 'recorded, so the next request reads nothing');
  assert.equal(await setup.createFirstAdmin('owner@example.test', await setup.accessKeyHash(KEY)), false);
});

test('the admin step needs the setup token: none or a wrong one is refused, too many wrong ones are rate-limited', async () => {
  fixture({ SETUP_TOKEN: 'isolated-setup-token-0123456789abcdef' });
  assert.equal(await setup.currentSetupStage(), 'admin');
  assert.equal(await setup.setupTokenRefusal(undefined, '192.0.2.1'), 403, 'no token');
  assert.equal(await setup.setupTokenRefusal('', '192.0.2.1'), 403);
  for (let attempt = 3; attempt <= setup.SETUP_TOKEN_ATTEMPTS; attempt++) assert.equal(await setup.setupTokenRefusal('wrong', '192.0.2.1'), 403);
  // Past the limit even the right token waits out the window from that address; another address is not held.
  assert.equal(await setup.setupTokenRefusal('isolated-setup-token-0123456789abcdef', '192.0.2.1'), 429);
  assert.equal(await setup.setupTokenRefusal('isolated-setup-token-0123456789abcdef', '198.51.100.7'), null);
  assert.equal(await setup.createFirstAdmin('owner@example.test', await setup.accessKeyHash(KEY)), true);
  assert.equal(await setup.createFirstAdmin('other@example.test', await setup.accessKeyHash(KEY + 'x')), false, 'once');
});

test('without a SETUP_TOKEN the installation generates one, prints it once and requires it', async () => {
  const sqlite = fixture();
  const printed = [];
  const log = console.log;
  console.log = (line) => printed.push(String(line));
  try {
    assert.equal(await setup.currentSetupStage(), 'admin');
    assert.equal(await setup.currentSetupStage(), 'admin');
    setup.forgetStoredSettings();
    assert.equal(await setup.currentSetupStage(), 'admin');
  } finally {
    console.log = log;
  }
  assert.equal(printed.length, 1, 'printed once, by the request that made it');
  const token = /: (\S+)$/.exec(printed[0])[1];
  assert.ok(token.length >= 43);
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM platform_settings').all()).includes(token), 'only its hash is stored');
  assert.equal(await setup.setupTokenRefusal('wrong', '192.0.2.9'), 403);
  assert.equal(await setup.setupTokenRefusal(token, '192.0.2.9'), null);
});
