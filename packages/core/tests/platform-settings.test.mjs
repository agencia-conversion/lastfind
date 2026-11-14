import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const core = path.join(root, 'packages/core');
const SECRET = 'isolated-platform-settings-test-secret-0123456789abcdef';

// The real modules (env, the in-memory copy, the sealed store, the classifier resolution) over a fake Worker
// environment and a D1 made of node:sqlite. No network: a provider check gets the fetch it is given.
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents: `export * from './packages/core/lib/server/platform-settings.ts';
      export { setting, workerSetting } from './packages/core/lib/server/env.ts';
      export { forgetStoredSettings, storedSettingUnreadable } from './packages/core/lib/server/stored-settings.ts';
      export { classifierModels, classifierFunctionStatus } from './packages/core/lib/server/classifier-models.ts';
      export { checkCloudflare, checkDataForSeo, checkOpenRouter } from './packages/core/lib/server/provider-check.ts';`,
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
        plugin.onResolve({ filter: /^@\// }, (args) => {
          const resolved = path.join(core, args.path.slice(2));
          for (const extension of ['', '.ts', '.tsx']) if (readable(resolved + extension)) return { path: resolved + extension };
          return { path: resolved };
        });
      },
    },
  ],
});
function readable(file) {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}
const settings = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

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
function fixture(env = {}, { migrate = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  if (migrate) sqlite.exec(readFileSync(path.join(root, 'apps/selfhost/drizzle/0040_platform_settings.sql'), 'utf8'));
  globalThis.fixtureEnv = { DB: d1(sqlite), SESSION_SECRET: SECRET, ...env };
  settings.forgetStoredSettings();
  return sqlite;
}
const audit = (sqlite) => sqlite.prepare('SELECT actor,action,key FROM admin_audit_log ORDER BY id').all().map((row) => ({ ...row }));

test('a sealed credential opens only with the secret that sealed it', async () => {
  const sealed = await settings.sealSecret('sk-or-v1-not-a-real-key', SECRET);
  assert.match(sealed, /^v1\.[\w-]{16}\.[\w-]+$/);
  assert.ok(!sealed.includes('not-a-real'), 'the ciphertext never carries the value');
  assert.equal(await settings.openSecret(sealed, SECRET), 'sk-or-v1-not-a-real-key');
  assert.equal(await settings.openSecret(sealed, SECRET.replace('0', '1')), null);
  assert.equal(await settings.openSecret(sealed.slice(0, -2) + 'AA', SECRET), null, 'a tampered value does not open');
  assert.notEqual(await settings.sealSecret('same', SECRET), await settings.sealSecret('same', SECRET), 'a fresh nonce every time');
});

test('a stored credential is used when the Worker has none, is sealed at rest and is audited without its value', async () => {
  const sqlite = fixture();
  await settings.loadPlatformSettings(true);
  assert.equal(settings.setting('OPENROUTER_API_KEY'), '');
  await settings.savePlatformSetting('OPENROUTER_API_KEY', ' sk-or-v1-abcdef0123456789 ', 'admin@example.test');
  assert.equal(settings.setting('OPENROUTER_API_KEY'), 'sk-or-v1-abcdef0123456789', 'in effect at once, trimmed');
  assert.equal(settings.workerSetting('OPENROUTER_API_KEY'), '', 'never reported as a Worker variable');
  const row = sqlite.prepare('SELECT value,secret,updated_by FROM platform_settings WHERE key=?').get('OPENROUTER_API_KEY');
  assert.equal(row.secret, 1);
  assert.equal(row.updated_by, 'admin@example.test');
  assert.ok(!row.value.includes('abcdef0123456789'), 'sealed at rest');
  // Another isolate (a fresh in-memory copy) reads the same value back from the database.
  settings.forgetStoredSettings();
  await settings.loadPlatformSettings();
  assert.equal(settings.setting('OPENROUTER_API_KEY'), 'sk-or-v1-abcdef0123456789');
  await settings.savePlatformSetting('OPENROUTER_API_KEY', '', 'admin@example.test');
  assert.equal(settings.setting('OPENROUTER_API_KEY'), '');
  assert.deepEqual(audit(sqlite), [
    { actor: 'admin@example.test', action: 'set', key: 'OPENROUTER_API_KEY' },
    { actor: 'admin@example.test', action: 'clear', key: 'OPENROUTER_API_KEY' },
  ]);
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM admin_audit_log').all()).includes('abcdef'), 'the log holds no value');
});

test('a credential saved in Admin wins over the Worker\'s own, which comes back when it is removed', async () => {
  fixture({ DATAFORSEO_LOGIN: 'worker@example.test', DATAFORSEO_PASSWORD: 'worker-password' });
  await settings.loadPlatformSettings(true);
  await settings.savePlatformSetting('DATAFORSEO_LOGIN', 'stored@example.test', 'admin@example.test');
  assert.equal(settings.setting('DATAFORSEO_LOGIN'), 'stored@example.test');
  assert.equal(settings.workerSetting('DATAFORSEO_LOGIN'), 'worker@example.test');
  await settings.savePlatformSetting('DATAFORSEO_LOGIN', '', 'admin@example.test');
  assert.equal(settings.setting('DATAFORSEO_LOGIN'), 'worker@example.test');
});

test('a row that Admin cannot save never stands in for a Worker setting', async () => {
  const sqlite = fixture({ MAINTENANCE_MODE: 'false' });
  sqlite.prepare("INSERT INTO platform_settings(key,value,secret,updated_at,updated_by) VALUES('MAINTENANCE_MODE','true',0,'2026-01-01','x')").run();
  await settings.loadPlatformSettings(true);
  assert.equal(settings.setting('MAINTENANCE_MODE'), 'false');
});

test('a rotated SESSION_SECRET leaves the stored credential unreadable instead of wrong', async () => {
  const sqlite = fixture();
  await settings.loadPlatformSettings(true);
  await settings.savePlatformSetting('OPENROUTER_API_KEY', 'sk-or-v1-abcdef0123456789', 'admin@example.test');
  globalThis.fixtureEnv = { ...globalThis.fixtureEnv, SESSION_SECRET: SECRET.replace('0', '9') };
  settings.forgetStoredSettings();
  await settings.loadPlatformSettings();
  assert.equal(settings.setting('OPENROUTER_API_KEY'), '');
  assert.equal(settings.storedSettingUnreadable('OPENROUTER_API_KEY'), true);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM platform_settings').get().n, 1, 'nothing is deleted');
});

test('CREDENTIALS_KEY seals new credentials; rows sealed under SESSION_SECRET stay readable, and SESSION_SECRET can then rotate', async () => {
  const sqlite = fixture();
  await settings.loadPlatformSettings(true);
  await settings.savePlatformSetting('OPENROUTER_API_KEY', 'sk-or-v1-before-the-key', 'admin@example.test');
  const KEY = 'credentials-key-fixture-not-production-0123456789';
  globalThis.fixtureEnv = { ...globalThis.fixtureEnv, CREDENTIALS_KEY: KEY };
  settings.forgetStoredSettings();
  await settings.loadPlatformSettings();
  assert.equal(settings.setting('OPENROUTER_API_KEY'), 'sk-or-v1-before-the-key', 'the old row opens with the fallback');
  await settings.savePlatformSetting('DATAFORSEO_LOGIN', 'login-after-the-key', 'admin@example.test');
  const sealed = (key) => sqlite.prepare('SELECT value FROM platform_settings WHERE key=?').get(key).value;
  assert.equal(await settings.openSecret(sealed('DATAFORSEO_LOGIN'), KEY), 'login-after-the-key', 'new values use CREDENTIALS_KEY');
  assert.equal(await settings.openSecret(sealed('DATAFORSEO_LOGIN'), SECRET), null);
  // SESSION_SECRET rotates: what was saved under CREDENTIALS_KEY still opens; the row from before asks to be set again.
  globalThis.fixtureEnv = { ...globalThis.fixtureEnv, SESSION_SECRET: SECRET.replace('0', '9') };
  settings.forgetStoredSettings();
  await settings.loadPlatformSettings();
  assert.equal(settings.setting('DATAFORSEO_LOGIN'), 'login-after-the-key');
  assert.equal(settings.storedSettingUnreadable('OPENROUTER_API_KEY'), true);
  // A short CREDENTIALS_KEY is never used as a key.
  globalThis.fixtureEnv = { ...globalThis.fixtureEnv, CREDENTIALS_KEY: 'short', SESSION_SECRET: SECRET };
  assert.deepEqual(settings.credentialKeys(), [SECRET]);
});

test('an installation whose migration has not run keeps the Worker variables and never throws', async () => {
  fixture({ OPENROUTER_API_KEY: 'sk-or-v1-worker' }, { migrate: false });
  await settings.loadPlatformSettings(true);
  assert.equal(settings.setting('OPENROUTER_API_KEY'), 'sk-or-v1-worker');
});

test('only known keys are saved, and a value never spans lines', async () => {
  fixture();
  await settings.loadPlatformSettings(true);
  for (const [key, value] of [['SESSION_SECRET', 'x'], ['DB', 'x'], ['classifier:nope!', 'x'], ['OPENROUTER_API_KEY', 'a\nb']])
    await assert.rejects(settings.savePlatformSetting(key, value, 'admin@example.test'), (error) => error.status === 400, `${key}`);
});

test('a classifier model saved in Admin wins over LASTFIND_CLASSIFIER_MODELS, which wins over the code default', async () => {
  fixture({ LASTFIND_CLASSIFIER_MODELS: '{"source_types":"liquid/d1-ultra","brand_research_jev":"vendor/env-sentiment"}' });
  await settings.loadPlatformSettings(true);
  const by = (id) => settings.classifierFunctionStatus().find((fn) => fn.id === id);
  assert.deepEqual(settings.classifierModels('source_types', 'typesafe/jev-1.14'), { model: 'liquid/d1-ultra', fallback: 'typesafe/jev-1.14' });
  assert.equal(by('source_types').source, 'env');
  assert.equal(by('brand_roles').source, 'default');
  await settings.savePlatformSetting('classifier:source_types', 'vendor/admin-model', 'admin@example.test');
  assert.deepEqual(settings.classifierModels('source_types', 'typesafe/jev-1.14'), { model: 'vendor/admin-model', fallback: 'typesafe/jev-1.14' });
  assert.equal(by('source_types').source, 'stored');
  assert.equal(by('source_types').effective, 'vendor/admin-model');
  // One sentiment model for every evaluator a project may still name.
  await settings.savePlatformSetting('classifier:sentiment', 'vendor/admin-sentiment', 'admin@example.test');
  for (const [id, current] of [['brand_research_liquid', 'liquid/d1-ultra'], ['brand_research_jev', 'typesafe/jev-1.14'], ['brand_research_decisions', 'openai/gpt-6-luna-decisions']])
    assert.deepEqual(settings.classifierModels(id, current), { model: 'vendor/admin-sentiment', fallback: current }, id);
  // Clearing goes back to the server setting, then to the code default.
  await settings.savePlatformSetting('classifier:sentiment', '', 'admin@example.test');
  assert.deepEqual(settings.classifierModels('brand_research_jev', 'typesafe/jev-1.14'), { model: 'vendor/env-sentiment', fallback: 'typesafe/jev-1.14' });
  assert.deepEqual(settings.classifierModels('brand_research_liquid', 'liquid/d1-ultra'), { model: 'liquid/d1-ultra', fallback: null });
  assert.equal(sqlite_rows(), 1);
  // Comparison's reader is fixed: a model saved for it before is not used, and Admin shows the code's.
  await settings.savePlatformSetting('classifier:comparison_reader', 'liquid/d1-ultra', 'admin@example.test');
  assert.deepEqual([by('comparison_reader').source, by('comparison_reader').effective, by('comparison_reader').stored], ['fixed', 'openai/gpt-6-luna', null]);
  await settings.savePlatformSetting('classifier:comparison_reader', '', 'admin@example.test');
  function sqlite_rows() {
    return settings.classifierFunctionStatus().filter((fn) => fn.stored).length;
  }
});

test('provider checks call only the free endpoints and never leak the credential in their answer', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, authorization: init.headers.Authorization });
    if (url.includes('dataforseo')) return Response.json({ status_code: 20000, tasks: [{ result: [{ money: { balance: 12.5 } }] }] });
    return new Response('nope', { status: 401 });
  };
  assert.deepEqual(await settings.checkDataForSeo('login@example.test', 'pw', fetchImpl), { ok: true, balance: 12.5 });
  assert.deepEqual(await settings.checkOpenRouter('sk-or-bad', fetchImpl), { ok: false, reason: 'invalid' });
  assert.deepEqual(calls.map((call) => call.url), ['https://api.dataforseo.com/v3/appendix/user_data', 'https://openrouter.ai/api/v1/key']);
  assert.deepEqual(await settings.checkOpenRouter('sk', async () => { throw new Error('offline'); }), { ok: false, reason: 'unreachable' });
  assert.deepEqual(await settings.checkDataForSeo('l', 'p', async () => Response.json({ status_code: 40100 })), { ok: false, reason: 'invalid' });
  assert.deepEqual(await settings.checkDataForSeo('l', 'p', async () => new Response('', { status: 500 })), { ok: false, reason: 'unexpected', status: 500 });
});

test('the Cloudflare check verifies the token, then reads one day of the account: only read-only endpoints', async () => {
  const calls = [];
  const cloudflare = ({ verify = 200, active = 'active', graphql = { data: { viewer: { accounts: [{ workersInvocationsAdaptive: [] }] } } } } = {}) => async (url, init) => {
    calls.push({ url, method: init.method ?? 'GET', authorization: init.headers.Authorization });
    if (url.endsWith('/tokens/verify')) return Response.json({ success: verify === 200, result: { status: active } }, { status: verify });
    return Response.json(graphql);
  };
  const account = '0123456789abcdef0123456789abcdef';
  assert.deepEqual(await settings.checkCloudflare('cf-token', account, cloudflare()), { ok: true, balance: null });
  assert.deepEqual(calls.map((call) => [call.method, call.url]), [['GET', 'https://api.cloudflare.com/client/v4/user/tokens/verify'], ['POST', 'https://api.cloudflare.com/client/v4/graphql']]);
  assert.ok(calls.every((call) => call.authorization === 'Bearer cf-token'));
  calls.length = 0;
  // A token the account owns is not a user token: the account's verify endpoint answers for it.
  const owned = async (url, init) => (url.includes('/user/') ? Response.json({ success: false }, { status: 401 }) : cloudflare()(url, init));
  assert.deepEqual(await settings.checkCloudflare('cf-token', account, owned), { ok: true, balance: null });
  assert.deepEqual(await settings.checkCloudflare('bad', account, cloudflare({ verify: 401 })), { ok: false, reason: 'invalid' });
  assert.deepEqual(await settings.checkCloudflare('old', account, cloudflare({ active: 'disabled' })), { ok: false, reason: 'invalid' });
  assert.deepEqual(await settings.checkCloudflare('no-analytics', account, cloudflare({ graphql: { data: null, errors: [{ message: 'not authorized for that account' }] } })), { ok: false, reason: 'permission' });
  assert.deepEqual(await settings.checkCloudflare('t', account, async () => { throw new Error('offline'); }), { ok: false, reason: 'unreachable' });
});
