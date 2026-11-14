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
  if (Array.isArray(expected)) assert.ok(expected.includes(response.status), `${method} ${path}: ${response.status}`);
  else assert.equal(response.status, expected, `${method} ${path}`);
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
    '/app/conversion?period=7d';
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
  await req('/api/workspace', 'GET', undefined, 401, {
    'x-user-id': 'forged',
    'x-user-email': 'attacker@example.test',
  });
  if (testing) for (const view of ['fanout','fanout-detail']) await req('/api/reports?project=locked&view='+view,'GET',undefined,401);
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
  // First run: the installer set the key, so the wizard skips the admin step; only the signed-in admin finishes it, once.
  await req('/api/setup', 'POST', { action: 'admin', email: 'other@example.test', key: 'y'.repeat(43) }, 409);
  const wizard = await req(ownerDeepLink);
  assert.equal(new URL(wizard.response.url).pathname, '/app/setup', 'Every app address opens the setup wizard first');
  await req('/api/setup', 'POST', { action: 'complete' }, 401, { Cookie: '' });
  await req('/api/setup', 'POST', { action: 'complete' });
  const finished = await req('/app/setup');
  assert.equal(new URL(finished.response.url).pathname, '/app', 'A finished setup never opens again');
  await req('/api/setup', 'POST', { action: 'admin', email: 'other@example.test', key: 'y'.repeat(43) }, 409);
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
  // Only scraped AIs in this version (8/11/2026): ChatGPT, Gemini, AI Mode and AI Overviews.
  assert.deepEqual(workspace.capabilities.engines, ['chat_gpt', 'gemini', 'google_ai_mode', 'google_ai_overviews']);
  assert.equal(workspace.capabilities.promptLimit, null);
  assert.equal(workspace.config.providerSettings, true);
  // One owner, no members: the owner role, no workspace list and no members API in this edition.
  assert.equal(workspace.role, 'owner');
  assert.equal('workspaces' in workspace, false);
  await req('/api/members', 'GET', undefined, 404);
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
  // The owner pays the provider directly, so the export keeps the cost column; headers follow the language.
  const exported = (
    await req('/api/export?project=' + project, 'GET', undefined, 200, {
      Cookie: `${cookie}; lastfind_locale=pt-BR`,
    })
  ).data.replace(/^\uFEFF/, '');
  assert.match(exported, /^"Data UTC","Prompt",.*"Custo USD"\r\n$/);
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
        engine: 'gemini',
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
  assert.deepEqual(report.samples, {current:0,previous:0});
  assert.equal(report.metrics.responses, 0);
  if (testing) {
    const fanout = (await req('/api/reports?view=fanout&project='+project)).data;
    assert.equal(fanout.responses,0); assert.deepEqual(fanout.queries,[]);
    assert.equal(fanout.truncated,false);
    const detail = (await req('/api/reports?view=fanout-detail&key=unknown&project='+project)).data;
    assert.deepEqual(detail,{key:'unknown',variants:[],runs:[],cited:[],consulted:null});
    await req('/api/reports?view=fanout-detail&project='+project,'GET',undefined,400);
  }
  // Source types: an empty project reports an honest, unclassified state and never calls a provider.
  const types = (await req('/api/reports?view=source-types&project=' + project)).data;
  assert.equal(types.citations, 0);
  assert.equal(types.classifier.state, 'disabled');
  for (const kind of ['cited','consulted']) for (const group of ['domain','url']) {
    const sources = (await req(`/api/reports?view=sources&kind=${kind}&group=${group}&project=${project}`)).data;
    assert.equal(sources.classifier.state,'disabled');
    assert.equal(sources.presenceVersion,1);
    assert.deepEqual(sources.totals,{slots:0,questions:0,models:0});
    assert.deepEqual(sources.rows,[]);
  }
  const content = (await req('/api/reports?view=content-types&project=' + project)).data;
  assert.equal(content.citations, 0);
  assert.equal(content.classifier.state, 'disabled');
  await req('/api/reports?view=sources&owner=bogus&project=' + project, 'GET', undefined, 400);
  const domain = (await req('/api/reports?view=domain-detail&key=absent.test&project=' + project)).data;
  assert.equal(domain.metrics.citing, 0);
  assert.equal(domain.sourceType, 'unclassified');
  assert.equal(domain.presenceVersion,1);
  assert.equal(domain.presence,null);
  assert.deepEqual(domain.totals,{slots:0,questions:0,models:0});
  await req('/api/projects/' + project + '/source-types', 'POST', { kind: 'domain' }, 403);
  // Semantic Branding panel: a project outside Semantic Branding has no round and an honest empty report; only its owner changes the frequency.
  const panelPath = '/api/projects/' + project + '/semantic/panel';
  const panel = (await req(panelPath)).data;
  assert.equal(panel.status, 'disabled');
  assert.equal(panel.frequency, 'daily');
  assert.deepEqual([panel.periods, panel.scores, panel.sources], [[], [], []]);
  assert.equal((await req(panelPath + '/evidence?brand=Installation%20verification')).data.evidence.length, 0);
  assert.equal((await req(panelPath, 'PATCH', { frequency: 'monthly' })).data.frequency, 'monthly');
  await req(panelPath, 'PATCH', { frequency: 'hourly' }, 400);
  assert.equal((await req(panelPath)).data.frequency, 'monthly');
  // The screen asks for the page's date range and the frequency alone; this installation has no DataForSEO credentials, so it says it does not collect.
  assert.equal((await req(panelPath + '?days=7')).data.status, 'disabled');
  await req(panelPath + '?days=400', 'GET', undefined, 400);
  const settings = (await req(panelPath + '?view=settings')).data;
  assert.deepEqual([settings.frequency, typeof settings.collecting], ['monthly', 'boolean']);
  await req('/api/projects/not-mine/semantic/panel?view=settings', 'GET', undefined, 404);
  await req('/api/projects/not-mine/semantic/panel', 'GET', undefined, 404);
  await req('/api/projects/not-mine/semantic/panel', 'PATCH', { frequency: 'daily' }, 404);
  // Settings: the owner picks the frequency, the day and the hour in the workspace's time zone (none stored: America/Sao_Paulo,
  // UTC-3), and the project's prompts move to that slot.
  await req('/api/projects/' + project, 'PATCH', { interval_hours: 168, collection_hour: 5 });
  const scheduled = (await req('/api/workspace?project=' + project)).data;
  const row = scheduled.projects.find((item) => item.id === project);
  assert.deepEqual([row.interval_hours, row.collection_hour], [168, 5]);
  const due = new Date(scheduled.prompts.find((item) => item.id === prompt || item.subscription_ids?.includes(prompt)).next_run_at);
  assert.deepEqual([due.getUTCDay(), due.toISOString().slice(11)], [1, '08:00:00.000Z']);
  assert.ok(due.getTime() > Date.now() && due.getTime() <= Date.now() + 7 * 86400000);
  // Sunday, then the workspace in Lisbon: Sunday 05:00 there.
  await req('/api/projects/' + project, 'PATCH', { collection_day: 0 });
  await req('/api/workspace', 'PATCH', { time_zone: 'Europe/Lisbon' });
  const moved = (await req('/api/workspace?project=' + project)).data;
  assert.equal(moved.timeZone, 'Europe/Lisbon');
  const sunday = new Date(moved.prompts.find((item) => item.id === prompt || item.subscription_ids?.includes(prompt)).next_run_at);
  const lisbon = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Lisbon', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).format(sunday);
  assert.equal(lisbon, 'Sun, 05');
  await req('/api/workspace', 'PATCH', { time_zone: 'Nowhere/Zone' }, 400);
  await req('/api/projects/' + project, 'PATCH', { collection_day: 7 }, 400);
  await req('/api/projects/' + project, 'PATCH', { collection_hour: 24 }, 400);
  await req('/api/projects/' + project, 'PATCH', { interval_hours: 12 }, 400);
  // The address names the project by its slug (this edition has one workspace: `/app/<slug>`). A rename keeps it; the owner
  // edits it (the format and the reserved words are refused) and the old slug opens nothing.
  const previous = row.slug;
  assert.match(previous, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal('code' in row, false);
  assert.equal((await req(`/api/workspace?project=${previous}`)).data.selectedProjectId, project);
  await req('/api/projects/' + project, 'PATCH', { name: 'Renamed verification' });
  assert.equal((await req('/api/workspace?project=' + project)).data.projects.find((item) => item.id === project).slug, previous);
  await req('/api/projects/' + project, 'PATCH', { slug: 'Not A Slug' }, 400);
  await req('/api/projects/' + project, 'PATCH', { slug: 'admin' }, 400);
  await req('/api/projects/' + project, 'PATCH', { slug: 'verification' });
  assert.equal((await req('/api/workspace?project=verification')).data.selectedProjectId, project);
  assert.equal((await req(`/api/workspace?project=${previous}`)).data.selectedProjectId, null);
  assert.match((await req('/app/verification/prompts')).data, /Loading your workspace|Carregando seu workspace|<html/);
  await req('/api/projects/' + project, 'PATCH', { slug: previous });
  assert.equal((await req('/api/workspace?project=no-such-project')).data.selectedProjectId, null);
  // Provider keys are reported as booleans only, never values.
  assert.deepEqual([typeof scheduled.config.dataforseo, typeof scheduled.config.openrouter], ['boolean', 'boolean']);
  // The project's monthly budget (default US$ 50; the owner may set none), its month by module, no plan.
  const spending = (await req('/api/projects/' + project + '/spending')).data;
  assert.deepEqual([spending.budgetUsd, spending.defaultUsd, spending.plan, spending.canUnlimited], [50, 50, null, true]);
  assert.ok(spending.spentUsd >= 0 && Array.isArray(spending.modules));
  assert.equal((await req('/api/projects/' + project + '/spending', 'PUT', { monthly_usd: null })).data.budgetUsd, null);
  assert.equal((await req('/api/projects/' + project + '/spending', 'PUT', { monthly_usd: 'default' })).data.budgetUsd, 50);
  await req('/api/projects/not-mine/spending', 'GET', undefined, 404);
  // Backup download: the same export the storage CLI reads, as an attachment.
  for (let step = 0; step < 10 && !(await req('/api/projects/' + project + '/storage', 'POST', { action: 'sync' })).data?.done; step++);
  const backup = await req('/api/projects/' + project + '/storage?format=export');
  assert.match(backup.response.headers.get('content-disposition'), /^attachment; filename="lastfind-project-/);
  // Background backup (Settings > Project data): the store's alarm writes the same file to the bucket, the list follows
  // it until ready and the download is byte for byte the export.
  const backups = '/api/projects/' + project + '/backups';
  assert.deepEqual((await req(backups)).data.backups, []);
  const made = (await req(backups, 'POST', {}, 202)).data.id;
  // Idempotent: asking again (a second click, another tab) returns the same backup instead of making another file.
  assert.equal((await req(backups, 'POST', {}, 202)).data.id, made, 'a repeated request gets the same backup');
  let listed;
  for (let attempt = 0; attempt < 60; attempt++) {
    listed = (await req(backups)).data.backups.find((item) => item.id === made);
    if (listed?.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(listed?.status, 'ready');
  const stored = await req(backups + '/' + made);
  assert.equal(stored.data, backup.data, 'the background backup is the export');
  assert.equal(listed.bytes, new TextEncoder().encode(stored.data).byteLength);
  await req(backups + '/not-a-backup', 'GET', undefined, 404);
  // Restore over the same project through the storage actions the CLI uses; a tampered row never switches the store.
  const storage = (body, expected = 200) => req('/api/projects/' + project + '/storage', 'POST', body, expected).then((result) => result.data);
  const { inspectBackup } = await import('../../../packages/core/lib/project-backups.ts');
  const footer = await inspectBackup([stored.data]);
  const candidate = (await storage({ action: 'restore-begin', manifest: footer })).generation;
  const chunks = stored.data.trim().split('\n').map((line) => JSON.parse(line)).filter((line) => line.type === 'chunk');
  for (const chunk of chunks)
    await storage({ action: 'restore-chunk', generation: candidate, entity: chunk.entity, rows: chunk.entity === 'prompts' ? chunk.rows.map((row) => ({ ...row, text: row.text + ' (tampered)' })) : chunk.rows });
  let refused = 0;
  for (let batch = 0; batch < 20 && !refused; batch++) {
    const result = await fetch(base + '/api/projects/' + project + '/storage', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ action: 'restore-commit', generation: candidate }) });
    if (result.status !== 200 || (await result.json()).done) refused = result.status;
  }
  assert.equal(refused, 409, 'a tampered row fails the restore verification');
  await storage({ action: 'restore-begin', manifest: { ...footer, projectId: 'another-project' } }, 400);
  const before = (await req('/api/projects/' + project + '/storage')).data.registry.generation;
  // Background restore (Settings > Project data): the server makes a backup of the current state, uploads the verified
  // rows and switches, with no client in the loop; the panel only reads its state.
  const restores = '/api/projects/' + project + '/restores';
  const settle = async (id) => {
    let state;
    for (let attempt = 0; attempt < 120; attempt++) {
      state = (await req(restores)).data.restore;
      if (state?.id === id && !['running', 'uploading'].includes(state.status)) return state;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return state;
  };
  assert.equal((await req(restores)).data.restore, null);
  const fromBackup = (await req(restores, 'POST', { backup: made }, 202)).data.restore;
  assert.equal(fromBackup.status, 'running');
  // One at a time per project. A small project can finish its restore before this request arrives; then it is a new
  // restore of the same backup (202), which is what settles. Only a 409 exercises the rule, so the CLI's own wait is not
  // checked here: a begun CLI restore would stay open for the rest of the test.
  const second = await req(restores, 'POST', { backup: made }, [409, 202]);
  const restored = await settle(second.response.status === 202 ? second.data.restore.id : fromBackup.id);
  assert.equal(restored.status, 'done', JSON.stringify(restored));
  assert.ok(restored.rows > 0);
  const after = (await req('/api/projects/' + project + '/storage')).data.registry.generation;
  assert.notEqual(after, before, 'the restore switched to a verified generation');
  // The backup of the state before it: the data had not changed since `made`, so that same backup is it.
  assert.deepEqual((await req(backups)).data.backups.map((item) => item.id), [made]);
  // A file goes to the bucket in parts, then the same background restore runs; a tampered file fails at the boundary.
  const upload = async (text) => {
    const bytes = new TextEncoder().encode(text);
    const opened = (await req(restores, 'POST', { file: { name: 'backup.ndjson', bytes: bytes.byteLength } }, 202)).data;
    assert.equal(opened.restore.status, 'uploading');
    const path = restores + '/' + opened.restore.id;
    for (let part = 1; part <= opened.parts; part++) {
      const slice = bytes.subarray((part - 1) * opened.partBytes, part * opened.partBytes);
      const sent = await fetch(base + path + '?part=' + part, { method: 'PUT', headers: { Origin: base, Cookie: cookie }, body: slice });
      assert.equal(sent.status, 200, 'part upload');
    }
    const short = await fetch(base + path + '?part=1', { method: 'PUT', headers: { Origin: base, Cookie: cookie }, body: bytes.subarray(0, 1) });
    if (bytes.byteLength > 1) assert.equal(short.status, 400, 'a part of the wrong size is refused');
    return { path, id: opened.restore.id };
  };
  const good = await upload(stored.data);
  await req(good.path, 'POST', {}, 202);
  assert.equal((await settle(good.id)).status, 'done');
  const switched = (await req("/api/projects/" + project + "/storage")).data.registry.generation;
  // Over another generation, the backup of the current state is a new one.
  assert.equal((await req(backups)).data.backups.filter((item) => item.status === 'ready').length, 2);
  const otherProject = stored.data.replaceAll(JSON.stringify(project), JSON.stringify('another-project'));
  const wrong = await upload(otherProject);
  assert.match((await req(wrong.path, 'POST', {}, 400)).data.error, /another project/);
  assert.equal((await req(restores)).data.restore.error, 'other-project');
  const tampered = await upload(stored.data.replace(/"text":"/, '"text":"(tampered) '));
  await req(tampered.path, 'POST', {}, 202); // Manifest and footer are fine: the rows' checksum fails in the background.
  const failed = await settle(tampered.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'invalid');
  assert.equal((await req('/api/projects/' + project + '/storage')).data.registry.generation, switched, "a failed restore switches nothing");
  await req('/api/prompts/' + prompt, 'DELETE');
  await req('/api/projects/' + project, 'DELETE');
  // Archived: gone from the project menu.
  assert.equal((await req('/api/workspace')).data.projects.some((item) => item.id === project), false);
  // Settings > Projects lists it as archived and brings it back (monitoring stays paused); an active one is not unarchived.
  assert.ok((await req('/api/projects/archived')).data.projects.some((item) => item.id === project));
  await req('/api/projects/' + project + '/unarchive', 'POST', {});
  assert.equal((await req('/api/workspace')).data.projects.find((item) => item.id === project)?.daily_enabled, 0);
  assert.equal((await req('/api/projects/archived')).data.projects.some((item) => item.id === project), false);
  await req('/api/projects/' + project + '/unarchive', 'POST', {}, 404);
  await req('/api/projects/' + project + '/unarchive', 'POST', {}, 403, { Origin: 'https://evil.example' });
  await req('/api/projects/' + project, 'DELETE');
  project = null;
  const logout = await req('/api/auth/logout', 'POST');
  assert.match(logout.response.headers.get('set-cookie'), /Max-Age=0/);
  cookie = '';
  await req('/api/workspace', 'GET', undefined, 401);
  console.log(
    `PASS: ${checks} selfhost HTTP checks; owner login, CSRF, spoofed-header rejection, secure cookies, scraped-AI entitlements, CRUD, daily window, report, logout. No provider submissions.`,
  );
  console.log(`Selfhost URL: ${base}/app`);
} finally {
  if (project) await req('/api/projects/' + project, 'DELETE');
}
