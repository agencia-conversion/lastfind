// Run only against an operator-owned installation just created by npm run setup.
// No paid provider task is submitted: the fixture project is paused first.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const testing = process.env.LASTFIND_TESTING === 'true';
const secrets = testing ? {} : JSON.parse(readFileSync('.lastfind/secrets.json', 'utf8'));
const base = testing ? process.env.LASTFIND_TEST_URL : secrets.APP_URL;
const key = testing ? process.env.LASTFIND_TEST_OWNER_KEY : readFileSync('.lastfind/access-key.txt', 'utf8').trim();
if (testing) {
  const url = new URL(base);
  assert.ok(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname) && url.origin===base, 'Test mode targets an exact loopback origin only');
  assert.ok(typeof key==='string' && key.length>=32, 'Set LASTFIND_TEST_OWNER_KEY to the isolated test installation key');
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
  const data = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : await response.text();
  return { response, data };
}
try {
  await req('/api/health');
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
  await req('/api/projects/' + project, 'PATCH', { daily_enabled: false });
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
  const report = (await req('/api/reports?project=' + project)).data;
  assert.equal(report.metrics.responses, 0);
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
