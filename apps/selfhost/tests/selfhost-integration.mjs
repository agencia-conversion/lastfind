// Run only against an operator-owned installation just created by npm run setup.
// No paid provider task is submitted: the fixture project is paused first.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const testing = process.env.LASTFIND_TESTING === 'true';
const secrets = testing
  ? {}
  : JSON.parse(readFileSync('.lastfind/secrets.json', 'utf8'));
const base = testing ? process.env.LASTFIND_TEST_URL : secrets.APP_URL;
const key = testing
  ? process.env.LASTFIND_TEST_OWNER_KEY
  : readFileSync('.lastfind/access-key.txt', 'utf8').trim();
if (testing) {
  const url = new URL(base);
  assert.ok(
    url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.origin === base,
    'Test mode targets an exact loopback origin only',
  );
  assert.ok(
    typeof key === 'string' && key.length >= 32,
    'Set LASTFIND_TEST_OWNER_KEY to the isolated test installation key',
  );
} else assert.match(base, /^https:\/\/lastfind[^/]*\.workers\.dev$/);
let cookie = '',
  checks = 0,
  project;
async function req(path, method = 'GET', body, expected = 200, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    ...(body !== undefined && method !== 'GET'
      ? { body: JSON.stringify(body) }
      : {}),
  });
  assert.equal(response.status, expected, `${method} ${path}`);
  checks++;
  const data = (response.headers.get('content-type') || '').includes(
    'application/json',
  )
    ? await response.json()
    : await response.text();
  return { response, data };
}
try {
  await req('/api/health');
  const ownerDeepLink =
    '/app/workspaces/conversion/projects/conversion/overview?models=ChatGPT&days=7';
  const lockedPage = await req(ownerDeepLink);
  assert.match(
    lockedPage.data,
    /id="owner-key"/,
    'Direct owner links remain protected',
  );
  assert.equal(
    lockedPage.response.headers.get('cache-control'),
    'private, no-store',
  );
  assert.equal(
    lockedPage.response.headers.get('x-content-type-options'),
    'nosniff',
  );
  // The old mock copy of the app is gone: its URLs lead to the owner sign-in.
  for (const legacy of [
    '/app/preview/workspaces/conversion/projects/conversion/overview',
    '/app/preview?tab=competitors&models=ChatGPT&days=7',
  ]) {
    const preview = await req(legacy);
    assert.equal(new URL(preview.response.url).pathname, '/app');
    assert.match(preview.data, /id="owner-key"/);
    assert.equal(
      preview.response.headers.get('cache-control'),
      'private, no-store',
    );
  }
  await req('/api/workspace', 'GET', undefined, 401, {
    'x-user-id': 'forged',
    'x-user-email': 'attacker@example.test',
  });
  await req('/api/auth/login', 'POST', { key: 'x'.repeat(43) }, 401);
  await req('/api/auth/login', 'POST', { key }, 403, {
    Origin: 'https://attacker.test',
  });
  const login = await req('/api/auth/login', 'POST', { key });
  const setCookie = login.response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  cookie = setCookie.split(';')[0];
  const unlockedPage = await req(ownerDeepLink);
  assert.match(
    unlockedPage.data,
    /Loading your workspace|Carregando seu workspace/,
    'The same deep link works after owner login',
  );
  assert.doesNotMatch(unlockedPage.data, /id="owner-key"/);
  assert.equal(
    unlockedPage.response.headers.get('cache-control'),
    'private, no-store',
  );
  const workspace = (await req('/api/workspace')).data;
  assert.equal(workspace.capabilities.engines.length, 6);
  assert.equal(workspace.capabilities.promptLimit, null);
  assert.equal(workspace.config.providerSettings, true);
  project = (
    await req(
      '/api/projects',
      'POST',
      {
        name: 'Installation verification',
        domain: 'selfhost-fixture.test',
        language_code: 'en',
      },
      201,
    )
  ).data.id;
  assert.equal(
    (await req('/api/projects/' + project, 'PATCH', { daily_enabled: false }))
      .data.analysisScheduled,
    false,
  );
  const analysisPath = '/api/projects/' + project + '/competitor-analysis';
  const statusOnly = async (extra = {}) => {
    const response = await fetch(base + analysisPath, {
      headers: { Cookie: cookie, ...extra },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const initialAnalysis = await statusOnly();
  assert.equal(initialAnalysis.status, 'idle');
  assert.deepEqual(
    await statusOnly({ 'Sec-Fetch-Site': 'cross-site' }),
    initialAnalysis,
  );
  await req(analysisPath, 'POST', { action: 'ensure' }, 403, {
    Origin: 'https://attacker.test',
  });
  assert.equal((await statusOnly()).status, 'idle');
  const initialized = (await req(analysisPath, 'POST', { action: 'ensure' }))
    .data;
  const sameJob = (await req(analysisPath, 'POST', { action: 'ensure' })).data;
  assert.equal(initialized.revision, sameJob.revision);
  assert.equal(initialized.mutationRevision, sameJob.mutationRevision);
  assert.equal((await statusOnly()).needsEnsure, false);
  const prompt = (
    await req(
      '/api/prompts',
      'POST',
      {
        project_id: project,
        text: 'A paused installation verification prompt',
        engine: 'claude',
      },
      201,
    )
  ).data.id;
  const current = (await req('/api/workspace?project=' + project)).data;
  assert.equal(current.runs.length, 0);
  assert.equal(current.prompts[0].next_run_at.slice(11), '07:00:00.000Z');
  // Immediate collection needs monitoring on, which makes the edition submit the
  // run at once. That is a paid call against a real installation, so it is only
  // exercised on the isolated loopback runtime, which has no provider configured.
  if (testing) {
    // A new prompt is due now and its first collection is queued immediately.
    await req('/api/projects/' + project, 'PATCH', { daily_enabled: true });
    const usedBefore = (await req('/api/workspace?project=' + project)).data.usage.used;
    const immediate = (
      await req(
        '/api/prompts',
        'POST',
        {
          project_id: project,
          text: 'An installation verification prompt collected right away',
          engine: 'chat_gpt',
        },
        201,
      )
    ).data;
    assert.equal(immediate.monitoring.queued, true);
    // The Worker submits the run right after the response, and with no provider
    // configured that attempt fails within milliseconds, so "pending" is a race.
    // The run existing proves it was queued; leaving the queue proves it was
    // submitted at once instead of waiting for the scheduler.
    const queued = (await req('/api/workspace?project=' + project)).data;
    assert.equal(queued.usage.used, usedBefore + 1);
    let settled = queued.monitoring.pending;
    for (let i = 0; settled > 0 && i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      settled = (await req('/api/workspace?project=' + project)).data.monitoring.pending;
    }
    assert.equal(settled, 0);
    await req('/api/prompts/' + immediate.id, 'DELETE');
  }
  const report = (await req('/api/reports?project=' + project)).data;
  assert.equal(report.metrics.responses, 0);
  // Source types: an empty project reports an honest, unclassified state and never calls a provider.
  const types = (await req('/api/reports?view=source-types&project=' + project)).data;
  assert.equal(types.citations, 0);
  assert.equal(types.classifier.state, 'disabled');
  assert.equal((await req('/api/reports?view=sources&project=' + project)).data.classifier.state, 'disabled');
  const content = (await req('/api/reports?view=content-types&project=' + project)).data;
  assert.equal(content.citations, 0);
  assert.equal(content.classifier.state, 'disabled');
  await req('/api/reports?view=sources&owner=bogus&project=' + project, 'GET', undefined, 400);
  const domain = (await req('/api/reports?view=domain-detail&key=absent.test&project=' + project)).data;
  assert.equal(domain.metrics.citing, 0);
  assert.equal(domain.sourceType, 'unclassified');
  await req('/api/projects/' + project + '/source-types', 'POST', { kind: 'domain' }, 403);
  await req('/api/prompts/' + prompt, 'DELETE');
  await req('/api/projects/' + project, 'DELETE');
  project = null;
  const logout = await req('/api/auth/logout', 'POST');
  assert.match(logout.response.headers.get('set-cookie'), /Max-Age=0/);
  cookie = '';
  await req('/api/workspace', 'GET', undefined, 401);
  console.log(
    `PASS: ${checks} selfhost HTTP checks; owner login, CSRF, spoofed-header rejection, secure cookies, six-platform entitlements, CRUD, daily window, report, logout. No provider submissions.`,
  );
  console.log(`Selfhost URL: ${base}/app`);
} finally {
  if (project) await req('/api/projects/' + project, 'DELETE');
}
