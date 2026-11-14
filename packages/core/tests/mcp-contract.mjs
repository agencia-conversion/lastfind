// The MCP endpoint over real HTTP, for both editions (apps/*/tests/mcp-integration.mjs): discovery, both protocol eras,
// every tool with its filters and a cursor, every change with its audit row, and the refusals. Local D1 and project store
// only, no provider call: the answers are seeded as the collector publishes them, and the prompts stay inactive.
// Tokens are seeded as rows (any account, workspace and scope): only their SHA-256 is stored, as api-access does.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MODERN = '2026-07-28';
const LEGACY = '2025-06-18';
const READ_TOOLS = ['list_projects', 'get_project', 'get_overview', 'list_prompts', 'get_prompt', 'list_responses', 'get_response', 'compare_brands', 'list_discovered_brands', 'get_sentiment', 'list_sources', 'get_source_types', 'get_source', 'compare_ai_models', 'get_query_fanout', 'list_opportunities', 'get_semantic_branding', 'get_semantic_evidence', 'get_products', 'get_ai_bots', 'get_comparison'];
const WRITE_TOOLS = ['create_prompts', 'update_prompt', 'set_prompt_status', 'organize_prompts', 'create_topic', 'update_topic', 'delete_topic', 'decide_brand'];
const BILLING = /"(cost|cost_usd|credits\w*|usage|capabilities|config|color|reserved_usd)"\s*:/;
const DAY = 86400000;
const iso = (time) => new Date(time).toISOString();

/** The local D1 file of this checkout's emulator (never a path outside `.wrangler`). */
export function localDatabase(directory = process.env.LASTFIND_TEST_DB_DIR || '.wrangler/state/v3/d1') {
  const root = realpathSync(resolve('.wrangler'));
  const path = realpathSync(resolve(directory));
  assert.ok(path.startsWith(root + '/'), 'The test database must stay under this checkout .wrangler directory');
  for (const file of readdirSync(path, { recursive: true })) {
    if (!String(file).endsWith('.sqlite') || String(file).endsWith('metadata.sqlite')) continue;
    const database = new DatabaseSync(realpathSync(resolve(path, String(file))));
    if (database.prepare("SELECT name FROM sqlite_master WHERE name='api_credentials'").get()) {
      database.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON');
      return database;
    }
    database.close();
  }
  throw new Error('Apply the local migrations (with mcp_access) before the MCP checks.');
}

/**
 * `base`: the local app origin; `headers`: a signed-in session of `owner` (Cookie, Origin); `database`: its local D1;
 * `members`: whether the edition has workspace members (Cloud), for the viewer refusal.
 */
export async function runMcpChecks({ base, headers, database, owner, members = false }) {
  assert.match(base, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/, 'Refusing a non-local target');
  const run = randomUUID().replaceAll('-', '');
  const project = `mcp_${run}`;
  const foreign = `mcp_foreign_${run}`;
  const credentials = [];
  let checks = 0;

  // ------------------------------------------------------------ fixtures
  const app = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const text = await response.text();
    assert.equal(response.status, 200, `${method} ${path}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  };
  const units = [
    { text: 'Best pricing for tools', topic: 'Pricing', tags: ['paid'], domains: ['acme.test', 'pricing.example', 'shared.example'] },
    { text: 'Cheapest tool for teams', topic: 'Pricing', tags: ['paid', 'budget'], domains: ['deals.example', 'shared.example'] },
    { text: 'Compare Acme and Rival', topic: 'Comparison', tags: [], domains: ['rival.test', 'review.example', 'shared.example'] },
    { text: 'Which tool is best', topic: 'Comparison', tags: ['budget'], domains: ['wiki.example', 'shared.example', 'forum.example'] },
  ];
  const engines = ['chat_gpt', 'gemini', 'google_ai_mode'];
  const now = Date.now();
  database.exec('BEGIN IMMEDIATE');
  try {
    const account = database.prepare('INSERT INTO accounts(id,email,name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING');
    account.run(owner, `${owner.replace(/\W/g, '')}@example.test`, 'MCP owner', iso(now));
    account.run(foreign, `${foreign}@example.test`, 'Foreign account', iso(now));
    const insertProject = database.prepare('INSERT INTO projects(id,workspace_id,name,domain,competitors_json,created_at) VALUES(?,?,?,?,?,?)');
    insertProject.run(project, owner, 'Acme', 'acme.test', JSON.stringify([{ name: 'Rival', domain: 'rival.test' }]), iso(now - 200 * DAY));
    insertProject.run(foreign, foreign, 'Foreign brand', 'foreign.example', '[]', iso(now));
    for (const topic of ['Pricing', 'Comparison'])
      database.prepare('INSERT INTO topics(id,project_id,name,created_at) VALUES(?,?,?,?)').run(`${project}_${topic}`, project, topic, iso(now));
    units.forEach((unit, index) => {
      for (const engine of engines)
        database
          .prepare('INSERT INTO prompts(id,unit_id,project_id,text,engine,tag,tags_json,active,created_at) VALUES(?,?,?,?,?,?,?,0,?)')
          .run(`${project}_p${index}_${engine}`, `${project}_p${index}_chat_gpt`, project, unit.text, engine, unit.topic, JSON.stringify(unit.tags), iso(now - 200 * DAY));
    });
    let serial = 0;
    for (let day = 0; day < 45; day++)
      units.forEach((unit, index) =>
        engines.forEach((engine, position) => {
          serial++;
          if ((serial * 7) % 11 === 0) return;
          const id = `${project}_r${serial}`;
          const created = iso(now - day * DAY - (1 + (serial % 20)) * 3600000);
          const acme = (serial * (index + 2) + position) % (index + 2) === 0;
          const rival = (serial + day) % 3 !== 0;
          const cited = unit.domains.slice(0, 1 + ((serial + position) % unit.domains.length)).map((domain, page) => ({ url: `https://${domain}/page-${(serial + page) % 3}`, title: `${domain} ${page}`, domain }));
          const control = {
            id, workspace_id: owner, project_id: project, prompt_id: `${project}_p${index}_${engine}`, request_key: `mcp:${run}:${serial}`,
            prompt_text: unit.text, engine, targets_json: JSON.stringify([{ name: 'Acme', domain: 'acme.test' }, { name: 'Rival', domain: 'rival.test' }]),
            location_code: 2840, language_code: 'en', callback_token: 'fixture', status: 'complete', cost: 0.001, created_at: created, completed_at: created,
          };
          database.prepare(`INSERT INTO runs(${Object.keys(control)}) VALUES(${Object.keys(control).map(() => '?')})`).run(...Object.values(control));
          // The project store names the workspace owner_id (its own format), as monitor.ts publishes it.
          const { workspace_id: workspace, ...published } = control;
          const payload = {
            ...published,
            owner_id: workspace,
            answer: `Answer ${serial}.\u0007 ${acme ? 'Acme leads. ' : ''}${rival ? 'Rival follows. ' : ''}${serial % 5 ? '' : 'Newco also helps.'}`,
            response_available: 1, model: null,
            mentions_json: JSON.stringify({ Acme: acme, Rival: rival }),
            sources_json: JSON.stringify(cited),
            consulted_sources_json: serial % 2 ? JSON.stringify(cited.slice(-1)) : null,
            search_queries_json: JSON.stringify([`${unit.topic.toLowerCase()} tools ${serial % 4}`, 'best tools', `${engine} ${index}`]),
            raw_response_status: 'not_captured', raw_response_key: null, raw_response_sha256: null, raw_response_bytes: null, raw_response_stored_at: null, raw_response_error: null, error: null,
          };
          database.prepare("UPDATE project_store_outbox SET data_json=? WHERE project_id=? AND entity='runs' AND entity_id=?").run(JSON.stringify(payload), project, id);
        }),
      );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  for (let done = false, round = 0; !done; round++) {
    assert.ok(round < 200, 'publication finishes');
    done = (await app(`/api/projects/${project}/storage`, 'POST', { action: 'sync' })).done;
  }

  /** A credential and its access token, as rows (scope read, or read and write). */
  const token = ({ account = owner, write = false, workspace = null, revoked = false } = {}) => {
    const value = `lf_pat_${randomBytes(32).toString('base64url')}`;
    const id = `mcp_cred_${randomUUID()}`;
    const expires = iso(now + 30 * DAY);
    database
      .prepare('INSERT INTO api_credentials(id,account_id,workspace_id,kind,name,scope,resource,hint,expires_at,created_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, account, workspace, 'pat', 'MCP checks', write ? 'lastfind:read lastfind:write' : 'lastfind:read', `${base}/mcp`, value.slice(-4), expires, iso(now), revoked ? iso(now) : null);
    database.prepare('INSERT INTO api_tokens(token_hash,credential_id,expires_at) VALUES(?,?,?)').run(createHash('sha256').update(JSON.stringify(value)).digest('hex'), id, expires);
    credentials.push(id);
    return { value, id };
  };

  // ------------------------------------------------------------ protocol
  let serial = 0;
  async function post(bearer, message, { era = 'modern', extra = {} } = {}) {
    const name = message.method === 'tools/call' ? message.params.name : undefined;
    const body = { jsonrpc: '2.0', id: ++serial, ...message };
    if (era === 'modern') body.params = { ...message.params, _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN, 'io.modelcontextprotocol/clientCapabilities': {} } };
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(era === 'modern' ? { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': message.method, ...(name ? { 'Mcp-Name': name } : {}) } : message.method === 'initialize' ? {} : { 'MCP-Protocol-Version': LEGACY }),
        ...extra,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const text = await response.text();
    checks++;
    // A 2025 client may get its answer as one server-sent event.
    const json = text.startsWith('{') ? text : text.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('');
    return { status: response.status, headers: response.headers, message: json ? JSON.parse(json) : null };
  }
  async function tool(bearer, name, args = {}, era = 'modern') {
    const { status, message } = await post(bearer, { method: 'tools/call', params: { name, arguments: args } }, { era });
    assert.equal(status, 200, `${name}: HTTP ${status}`);
    assert.ok(message.result, `${name}: ${JSON.stringify(message.error)}`);
    const result = message.result;
    assert.doesNotMatch(result.content[0].text, BILLING, `${name} sends no billing or configuration`);
    return result.isError ? { error: result.structuredContent?.error ?? { code: 'invalid_argument', message: result.content[0].text } } : { data: result.structuredContent };
  }
  async function ok(bearer, name, args) {
    const { data, error } = await tool(bearer, name, args);
    assert.equal(error, undefined, `${name}(${JSON.stringify(args)}): ${JSON.stringify(error)}`);
    return data;
  }

  try {
    const reader = token();
    const writer = token({ write: true });

    // ------------------------------------------------------------ discovery and refusals at the door
    const anonymous = await post(null, { method: 'tools/list', params: {} });
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get('www-authenticate') ?? '', /^Bearer .*resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
    assert.equal((await post('lf_pat_' + 'x'.repeat(43), { method: 'tools/list', params: {} })).status, 401);
    const revoked = token({ write: true, revoked: true });
    assert.equal((await post(revoked.value, { method: 'tools/list', params: {} })).status, 401, 'a revoked token is refused at once');
    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(`${base}/mcp`, { method, headers: { Authorization: `Bearer ${reader.value}` } });
      assert.equal(response.status, 405, method);
      checks++;
    }
    assert.equal((await post(reader.value, { method: 'tools/list', params: {} }, { extra: { Origin: 'https://attacker.test' } })).status, 403, 'a foreign Origin is refused');
    assert.equal((await post(reader.value, { method: 'tools/list', params: {} }, { extra: { Origin: base } })).status, 200, 'the app origin itself is allowed');

    // ------------------------------------------------------------ both eras
    const discover = await post(reader.value, { method: 'server/discover', params: {} });
    assert.equal(discover.status, 200);
    assert.ok(discover.message.result.supportedVersions.includes(MODERN));
    assert.match(discover.message.result.instructions, /never read it as zero/);
    const initialize = await post(reader.value, { method: 'initialize', params: { protocolVersion: LEGACY, capabilities: {}, clientInfo: { name: 'mcp-checks', version: '1' } } }, { era: 'legacy' });
    assert.equal(initialize.status, 200);
    assert.equal(initialize.message.result.protocolVersion, LEGACY);
    assert.match(initialize.message.result.instructions, /never read it as zero/);
    const listed = async (bearer, era) => (await post(bearer, { method: 'tools/list', params: {} }, { era })).message.result.tools;
    const readList = await listed(reader.value, 'modern');
    assert.deepEqual(readList.map((item) => item.name), READ_TOOLS, 'a read token lists only the read tools, in order');
    assert.deepEqual((await listed(reader.value, 'legacy')).map((item) => item.name), READ_TOOLS, 'the 2025 era lists the same tools');
    const writeList = await listed(writer.value, 'modern');
    assert.deepEqual(writeList.map((item) => item.name), [...READ_TOOLS, ...WRITE_TOOLS]);
    for (const item of writeList) {
      assert.equal(item.inputSchema.type, 'object', item.name);
      assert.equal(item.outputSchema?.type, 'object', item.name);
      assert.equal(item.annotations.readOnlyHint, !WRITE_TOOLS.includes(item.name), `${item.name} readOnlyHint`);
      assert.equal(item.annotations.openWorldHint, false, item.name);
    }

    // ------------------------------------------------------------ every read tool, its filters and a cursor
    const projects = await ok(reader.value, 'list_projects', {});
    assert.ok(projects.workspaces.some((workspace) => workspace.projects.some((item) => item.id === project)));
    assert.ok(!projects.workspaces.some((workspace) => workspace.projects.some((item) => item.id === foreign)), 'another account stays out');
    const detail = await ok(reader.value, 'get_project', { project });
    assert.equal(detail.project.id, project);
    assert.deepEqual(detail.topics.map((topic) => topic.name).sort(), ['Comparison', 'Pricing']);

    const overview = await ok(reader.value, 'get_overview', { project });
    assert.ok(overview.metrics.responses > 0 && typeof overview.metrics.visibility === 'number');
    assert.equal(overview.daily, undefined, 'the day series only when asked');
    assert.ok((await ok(reader.value, 'get_overview', { project, include_daily: true })).daily.length > 0);
    const same = (a, b) => JSON.stringify(a.metrics) === JSON.stringify(b.metrics);
    const tagged = await ok(reader.value, 'get_overview', { project, tags: ['paid'] });
    assert.ok(same(tagged, await ok(reader.value, 'get_overview', { project, topic: 'Pricing' })), 'the tag selects the tagged prompts (their topic reads the same)');
    assert.ok(!same(tagged, overview), 'the tag filters');
    assert.ok(!same(await ok(reader.value, 'get_overview', { project, engines: ['gemini'] }), overview), 'the model filters');
    const compareStart = iso(now - 40 * DAY).slice(0, 10), compareEnd = iso(now - 35 * DAY).slice(0, 10);
    const compared = await ok(reader.value, 'get_overview', { project, compare_start: compareStart, compare_end: compareEnd });
    assert.equal(compared.comparison.previousStart.slice(0, 10), compareStart, 'the comparison window is the one asked');
    assert.notEqual(JSON.stringify(compared.comparison.previous), JSON.stringify(overview.comparison.previous));
    // Nothing collected in this window: unmeasured, not zero.
    const empty = await ok(reader.value, 'get_overview', { project, start: iso(now - 89 * DAY).slice(0, 10), end: iso(now - 80 * DAY).slice(0, 10) });
    assert.equal(empty.metrics.visibility, null);

    const prompts = await ok(reader.value, 'list_prompts', { project });
    assert.equal(prompts.total, 4);
    assert.ok(prompts.prompts.every((item) => item.status === 'paused' && item.metrics?.responses > 0));
    assert.equal((await ok(reader.value, 'list_prompts', { project, topic: 'Pricing' })).total, 2);
    assert.equal((await ok(reader.value, 'list_prompts', { project, tags: ['budget'] })).total, 2);
    await ok(reader.value, 'list_prompts', { project, competitor_gaps_only: true });
    const promptId = prompts.prompts[0].id;
    const prompt = await ok(reader.value, 'get_prompt', { project, prompt: promptId });
    assert.ok(prompt.platforms.length > 0 && prompt.next_cursor);
    assert.ok((await ok(reader.value, 'get_prompt', { project, prompt: promptId, cursor: prompt.next_cursor })).history.runs.length > 0);

    const responses = await ok(reader.value, 'list_responses', { project });
    assert.equal(responses.responses.length, 25);
    assert.match(responses.next_cursor, /^k:/);
    const next = await ok(reader.value, 'list_responses', { project, cursor: responses.next_cursor });
    assert.ok(next.responses.length > 0 && next.responses[0].id !== responses.responses[0].id, 'the cursor moves to the next page');
    assert.ok((await ok(reader.value, 'list_responses', { project, engines: ['gemini'] })).responses.every((item) => item.engine === 'gemini'));
    await ok(reader.value, 'list_responses', { project, mention: 'missing', brand: 'Rival', source: 'shared.example' });
    const { error: badCursor } = await tool(reader.value, 'list_responses', { project, cursor: 'p:2' });
    assert.equal(badCursor.code, 'invalid_argument');
    const response = await ok(reader.value, 'get_response', { project, response: responses.responses[0].id });
    assert.match(response.response.answer, /^Answer \d+\. /, 'the answer text, control characters removed');

    const brands = await ok(reader.value, 'compare_brands', { project });
    assert.ok(brands.platforms.some((row) => row.name === 'Rival'));
    await ok(reader.value, 'list_discovered_brands', { project, status: 'all' });
    await ok(reader.value, 'get_sentiment', { project, tags: ['paid'] });
    const sources = await ok(reader.value, 'list_sources', { project });
    assert.ok(sources.sources.some((row) => row.key === 'shared.example'));
    const urls = await ok(reader.value, 'list_sources', { project, group: 'url', kind: 'cited', owners: ['third-party'] });
    assert.ok(urls.sources.length > 0 && urls.sources.every((row) => row.ownership === 'third-party'));
    await ok(reader.value, 'get_source_types', { project });
    await ok(reader.value, 'get_source_types', { project, by: 'content' });
    const source = await ok(reader.value, 'get_source', { project, source: 'shared.example' });
    assert.ok(source.metrics.citing > 0);
    await ok(reader.value, 'get_source', { project, source: 'https://shared.example/page-1' });
    const models = await ok(reader.value, 'compare_ai_models', { project });
    assert.deepEqual(models.models.map((row) => row.key).filter((key) => engines.includes(key)).sort(), [...engines].sort());
    const fanout = await ok(reader.value, 'get_query_fanout', { project });
    await ok(reader.value, 'get_query_fanout', { project, query_key: 'best tools' });
    assert.ok(JSON.stringify(fanout).includes('best tools'));
    // No intent classified yet in the fixture: the period's searches wait, and there is no opportunity (not an error).
    const opportunities = await ok(reader.value, 'list_opportunities', { project });
    assert.deepEqual(opportunities.opportunities, []);
    assert.equal(opportunities.classified, 0);
    await ok(reader.value, 'get_semantic_branding', { project });
    const evidence = await tool(reader.value, 'get_semantic_evidence', { project, brand: 'Acme' });
    assert.ok(evidence.data || evidence.error.code === 'invalid_argument', 'no panel collected: the brand is refused, never an error');

    // ------------------------------------------------------------ refusals inside
    const outside = await tool(writer.value, 'get_overview', { project: foreign });
    assert.equal(outside.error?.code, 'not_found', "another account's project does not exist for this token");
    assert.equal((await tool(writer.value, 'create_topic', { project: foreign, name: 'Nope' })).error?.code, 'not_found');
    const scoped = await post(reader.value, { method: 'tools/call', params: { name: 'create_topic', arguments: { project, name: 'Nope' } } });
    assert.equal(scoped.status, 403, 'a read token calling a change is challenged for the write scope');
    assert.match(scoped.headers.get('www-authenticate') ?? '', /error="insufficient_scope"/);
    assert.match(scoped.headers.get('www-authenticate') ?? '', /scope="lastfind:read lastfind:write"/);
    if (members) {
      const viewer = `mcp_viewer_${run}`;
      database.prepare('INSERT INTO accounts(id,email,name,created_at) VALUES(?,?,?,?)').run(viewer, `${viewer}@example.test`, 'Viewer', iso(now));
      database.prepare('INSERT INTO workspace_members(workspace_id,email,role,invited_by,invited_at,accepted_account_id) VALUES(?,?,?,?,?,?)').run(owner, `${viewer}@example.test`, 'viewer', owner, iso(now), viewer);
      const watcher = token({ account: viewer, write: true, workspace: owner });
      assert.ok((await ok(watcher.value, 'get_overview', { project })).metrics.responses > 0, 'a viewer reads');
      assert.equal((await tool(watcher.value, 'create_topic', { project, name: 'Nope' })).error?.code, 'permission_denied', 'a viewer changes nothing');
      assert.deepEqual(database.prepare('SELECT tool,outcome FROM api_audit_log WHERE credential_id=?').all(watcher.id).map((row) => [row.tool, row.outcome]), [['create_topic', 'denied']]);
    }

    // ------------------------------------------------------------ every change, audited
    const topic = await ok(writer.value, 'create_topic', { project, name: 'MCP topic' });
    const created = await ok(writer.value, 'create_prompts', { project, prompts: [{ text: 'Which tool helps small teams?', topic: 'MCP topic', tags: ['mcp'] }] });
    const [createdId] = created.ids;
    // Created active (as the app does); paused at once, so the check schedules nothing.
    await ok(writer.value, 'set_prompt_status', { project, prompts: [createdId], status: 'pause' });
    await ok(writer.value, 'update_prompt', { project, prompt: createdId, text: 'Which tool helps small teams most?' });
    await ok(writer.value, 'organize_prompts', { project, prompts: [createdId], tags: ['mcp', 'edited'] });
    await ok(writer.value, 'update_topic', { project, topic: topic.id, name: 'MCP topic renamed' });
    const row = (await ok(reader.value, 'list_prompts', { project, include_archived: true })).prompts.find((item) => item.id === createdId);
    assert.deepEqual([row.text, row.topic, row.tags, row.status], ['Which tool helps small teams most?', 'MCP topic renamed', ['mcp', 'edited'], 'paused']);
    assert.equal((await tool(writer.value, 'delete_topic', { project, topic: topic.id })).error?.code, 'conflict', 'a topic with prompts stays');
    await ok(writer.value, 'set_prompt_status', { project, prompts: [createdId], status: 'archive' });
    await ok(writer.value, 'delete_topic', { project, topic: topic.id });
    const decision = await ok(writer.value, 'decide_brand', { project, action: 'confirm', name: 'Newco', domain: 'newco.test' });
    assert.ok((await ok(reader.value, 'get_project', { project })).project.competitors.some((item) => item.name === 'Newco'));
    await ok(writer.value, 'decide_brand', { project, action: 'undo', decision: decision.id });
    assert.ok(!(await ok(reader.value, 'get_project', { project })).project.competitors.some((item) => item.name === 'Newco'));
    const audited = database.prepare('SELECT tool,target,outcome FROM api_audit_log WHERE credential_id=? ORDER BY id').all(writer.id);
    assert.deepEqual(
      audited.map((entry) => [entry.tool, entry.outcome]),
      // The foreign project was out of reach before any workspace: nothing to audit there.
      [['create_topic', 'ok'], ['create_prompts', 'ok'], ['set_prompt_status', 'ok'], ['update_prompt', 'ok'], ['organize_prompts', 'ok'], ['update_topic', 'ok'], ['delete_topic', 'error'], ['set_prompt_status', 'ok'], ['delete_topic', 'ok'], ['decide_brand', 'ok'], ['decide_brand', 'ok']],
      'every change is audited',
    );
    assert.ok(audited.every((entry) => !entry.target || entry.target.split(',').every((part) => /^[\w:-]*$/.test(part))), 'the audit keeps ids, never free text');

    // ------------------------------------------------------------ 60 calls a minute per credential
    const limited = token();
    let status = 200;
    // A minute boundary inside the loop restarts the count: two windows' worth of calls always reach a 61st in one of them.
    for (let call = 0; call < 122 && status === 200; call++) status = (await post(limited.value, { method: 'server/discover', params: {} })).status;
    assert.equal(status, 429, 'the 61st call in a minute is refused');
    return checks;
  } finally {
    database.exec('BEGIN IMMEDIATE');
    database.prepare('UPDATE projects SET archived=1 WHERE id IN (?,?)').run(project, foreign);
    for (const id of credentials) database.prepare('UPDATE api_credentials SET revoked_at=? WHERE id=?').run(iso(Date.now()), id);
    database.exec('COMMIT');
  }
}
