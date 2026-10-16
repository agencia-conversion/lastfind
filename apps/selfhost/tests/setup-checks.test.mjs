import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SetupError,
  checkDataForSeo,
  checkOpenRouter,
  explainFailure,
  gatherCredentials,
  installerLanguage,
  mergeEnv,
  nodeVersionProblem,
  parseEnv,
  researchVars,
  saveEnv,
  validEmail,
  validInstallationName,
} from '../../../scripts/setup-checks.mjs';

const GOOD = { login: 'owner@example.com', password: 'api-password-fixture' };
function answer(status, body) {
  return async () => ({ status, json: async () => body });
}
// A fake network: valid credentials are the fixtures above and `sk-or-good`.
function network(calls = []) {
  return async (url, { headers }) => {
    calls.push({ url, headers });
    if (url.includes('dataforseo')) {
      const expected =
        'Basic ' + Buffer.from(`${GOOD.login}:${GOOD.password}`).toString('base64');
      return headers.Authorization === expected
        ? {
            status: 200,
            json: async () => ({
              status_code: 20000,
              tasks: [{ result: [{ money: { balance: 12.5 } }] }],
            }),
          }
        : { status: 401, json: async () => ({ status_code: 40100 }) };
    }
    return headers.Authorization === 'Bearer sk-or-good'
      ? { status: 200, json: async () => ({ data: { limit_remaining: null } }) }
      : { status: 401, json: async () => ({ error: { code: 401 } }) };
  };
}
function scripted(replies) {
  const queue = [...replies];
  return async () => queue.shift() ?? '';
}

test('language follows --lang, then the environment, and defaults to English', () => {
  assert.equal(installerLanguage({ lang: 'pt-BR', env: {} }), 'pt-BR');
  assert.equal(installerLanguage({ env: { LANG: 'pt_BR.UTF-8' } }), 'pt-BR');
  assert.equal(installerLanguage({ env: { LANG: 'en_US.UTF-8' } }), 'en');
  assert.equal(installerLanguage({ env: {} }), 'en');
});

test('Node versions older than 22.13 are reported', () => {
  assert.equal(nodeVersionProblem('22.13.0'), null);
  assert.equal(nodeVersionProblem('24.1.0'), null);
  assert.equal(nodeVersionProblem('22.12.9'), '22.12.9');
  assert.equal(nodeVersionProblem('20.19.0'), '20.19.0');
});

test('DataForSEO check reports accepted, rejected and unreachable credentials', async () => {
  const ok = await checkDataForSeo(GOOD, { fetchImpl: network() });
  assert.deepEqual(ok, { ok: true, balance: 12.5 });
  assert.deepEqual(
    await checkDataForSeo({ ...GOOD, password: 'wrong' }, { fetchImpl: network() }),
    { ok: false, reason: 'invalid' },
  );
  assert.deepEqual(
    await checkDataForSeo(GOOD, {
      fetchImpl: answer(200, { status_code: 40100 }),
    }),
    { ok: false, reason: 'invalid' },
  );
  assert.deepEqual(
    await checkDataForSeo(GOOD, {
      fetchImpl: async () => {
        throw new Error('offline');
      },
    }),
    { ok: false, reason: 'unreachable' },
  );
  assert.deepEqual(
    await checkDataForSeo(GOOD, { fetchImpl: answer(500, null) }),
    { ok: false, reason: 'unexpected', status: 500 },
  );
});

test('OpenRouter check reports accepted, rejected and unreachable keys', async () => {
  assert.deepEqual(await checkOpenRouter('sk-or-good', { fetchImpl: network() }), {
    ok: true,
    remaining: null,
  });
  assert.deepEqual(await checkOpenRouter('sk-or-bad', { fetchImpl: network() }), {
    ok: false,
    reason: 'invalid',
  });
  assert.equal(
    (
      await checkOpenRouter('sk-or-good', {
        fetchImpl: answer(200, { data: { limit_remaining: 4.25 } }),
      })
    ).remaining,
    4.25,
  );
  assert.deepEqual(
    await checkOpenRouter('x', {
      fetchImpl: async () => {
        throw new Error('offline');
      },
    }),
    { ok: false, reason: 'unreachable' },
  );
});

test('env updates keep comments and unrelated lines and are idempotent', () => {
  const start = '# keep me\nAUTH_MODE=owner\nDATAFORSEO_LOGIN=\nOTHER=1\n';
  const once = mergeEnv(start, {
    DATAFORSEO_LOGIN: 'me@example.com',
    OPENROUTER_API_KEY: 'sk-or-x',
  });
  assert.equal(
    once,
    '# keep me\nAUTH_MODE=owner\nDATAFORSEO_LOGIN=me@example.com\nOTHER=1\nOPENROUTER_API_KEY=sk-or-x\n',
  );
  assert.equal(
    mergeEnv(once, { DATAFORSEO_LOGIN: 'me@example.com', OPENROUTER_API_KEY: 'sk-or-x' }),
    once,
  );
  assert.deepEqual(parseEnv('A=1\n# c\nB = "two"\nbad line\n'), { A: '1', B: 'two' });
});

test('typed credentials are saved to a private .env without touching other keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lastfind-setup-'));
  try {
    const file = join(dir, '.env');
    saveEnv(file, { DATAFORSEO_LOGIN: 'a@b.co', DATAFORSEO_PASSWORD: 'secret' });
    saveEnv(file, { DATAFORSEO_LOGIN: 'c@d.co' });
    assert.equal(readFileSync(file, 'utf8'), 'DATAFORSEO_LOGIN=c@d.co\nDATAFORSEO_PASSWORD=secret\n');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.throws(() => saveEnv(file, { X: 'a\nb' }), /line break/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installation name and email are validated', () => {
  assert.ok(validInstallationName('my-lastfind'));
  assert.ok(!validInstallationName('Lastfind'));
  assert.ok(!validInstallationName('ab'));
  assert.ok(validEmail('a@b.co'));
  assert.ok(!validEmail('nope'));
});

test('an interactive run corrects a wrong DataForSEO login and skips OpenRouter', async () => {
  const lines = [];
  const result = await gatherCredentials({
    env: {},
    interactive: true,
    ask: scripted(['wrong@example.com', GOOD.login]),
    askSecret: scripted(['wrong-password', GOOD.password, '']),
    log: (text) => lines.push(text),
    fetchImpl: network(),
  });
  assert.equal(result.dataforseo.login, GOOD.login);
  assert.equal(result.openrouter, null);
  assert.deepEqual(result.typed, {
    DATAFORSEO_LOGIN: GOOD.login,
    DATAFORSEO_PASSWORD: GOOD.password,
  });
  const output = lines.join('\n');
  assert.match(output, /did not accept/);
  assert.match(output, /balance US\$ 12\.50/);
  assert.ok(!output.includes('wrong-password') && !output.includes(GOOD.password));
});

test('three wrong attempts stop with a plain explanation and no secret', async () => {
  const lines = [];
  await assert.rejects(
    gatherCredentials({
      env: {},
      interactive: true,
      ask: scripted(['a@b.co', 'a@b.co', 'a@b.co']),
      askSecret: scripted(['hunter2-one', 'hunter2-two', 'hunter2-three']),
      log: (text) => lines.push(text),
      fetchImpl: network(),
    }),
    (error) =>
      error instanceof SetupError &&
      /API Access/.test(error.message) &&
      !/hunter2/.test(error.message),
  );
  assert.ok(!lines.join('\n').includes('hunter2'));
});

test('a non-interactive run needs credentials in the environment and rejects wrong ones', async () => {
  await assert.rejects(
    gatherCredentials({ env: {}, interactive: false, ask: scripted([]), askSecret: scripted([]), log() {}, fetchImpl: network() }),
    /DATAFORSEO_LOGIN/,
  );
  await assert.rejects(
    gatherCredentials({
      env: { DATAFORSEO_LOGIN: GOOD.login, DATAFORSEO_PASSWORD: 'wrong' },
      interactive: false,
      ask: scripted([]),
      askSecret: scripted([]),
      log() {},
      fetchImpl: network(),
    }),
    (error) => error instanceof SetupError && /did not accept/.test(error.message) && !error.message.includes('wrong'),
  );
});

test('environment credentials are used without any prompt and OpenRouter is verified when given', async () => {
  const calls = [];
  const result = await gatherCredentials({
    env: {
      DATAFORSEO_LOGIN: GOOD.login,
      DATAFORSEO_PASSWORD: GOOD.password,
      OPENROUTER_API_KEY: 'sk-or-good',
    },
    interactive: false,
    ask: scripted([]),
    askSecret: scripted([]),
    log() {},
    fetchImpl: network(calls),
  });
  assert.equal(result.openrouter.key, 'sk-or-good');
  assert.deepEqual(result.typed, {});
  assert.equal(calls.length, 2);
  await assert.rejects(
    gatherCredentials({
      env: { DATAFORSEO_LOGIN: GOOD.login, DATAFORSEO_PASSWORD: GOOD.password, OPENROUTER_API_KEY: 'sk-or-bad' },
      interactive: false,
      ask: scripted([]),
      askSecret: scripted([]),
      log() {},
      fetchImpl: network(),
    }),
    /OpenRouter did not accept/,
  );
});

test('Portuguese messages are used on request and Cloudflare failures get a plain hint', async () => {
  await assert.rejects(
    gatherCredentials({ env: {}, interactive: false, ask: scripted([]), askSecret: scripted([]), log() {}, language: 'pt-BR', fetchImpl: network() }),
    /Faltam o login/,
  );
  assert.match(
    explainFailure({ output: 'Authentication error [code: 10000]' }, 'pt-BR'),
    /Cloudflare recusou/,
  );
  assert.equal(explainFailure(new Error('something else')), null);
});

test('re-running setup keeps research settings the owner already chose', () => {
  assert.deepEqual(researchVars({}, true), {
    BRAND_RESEARCH_ENABLED: 'true',
    BRAND_RESEARCH_PROJECTS: '*',
  });
  assert.deepEqual(researchVars({}, false), {});
  const edited = {
    BRAND_RESEARCH_ENABLED: 'false',
    BRAND_RESEARCH_PROJECTS: 'project-a,project-b',
  };
  assert.deepEqual(researchVars(edited, true), edited);
});
