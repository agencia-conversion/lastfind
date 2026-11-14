import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// What a turn of a conversation's agent (worker/agent.ts) relies on (lib/server/agent.ts, agent-data.ts, agent-skills.ts,
// lib/agent.ts), against the real migrations in memory: no network, no provider key, no paid call. Only the edges are
// faked: the database binding, the plan, the project lookup, the account's workspace, the MCP tools' in-process routes
// (a recorder), the audit, the agent's Durable Object and the search data account (a scripted `send`).
const root = fileURLToPath(new URL('../../../', import.meta.url));
const core = path.join(root, 'packages/core');
const skillsDir = path.join(core, 'agent-skills');

function d1(sqlite) {
  const prepare = (sql, params = []) => ({
    bind: (...values) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
  });
  // As D1's batch: one after the other, each with its rows and how many it changed.
  const batch = async (statements) => {
    const results = [];
    for (const statement of statements) results.push({ ...(await statement.all()), meta: { changes: sqlite.prepare('SELECT changes() n').get().n } });
    return results;
  };
  return { prepare, batch };
}

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}
const skillFiles = Object.fromEntries(files(skillsDir).filter((file) => file.endsWith('.md')).map((file) => [`../../agent-skills/${path.relative(skillsDir, file)}`, readFileSync(file, 'utf8')]));

const fixtures = {
  'cloudflare:workers': `export const env=new Proxy({},{get:(_,key)=>globalThis.fixture?.env?.[key]});export const waitUntil=(p)=>{globalThis.fixture.pending.push(p)};`,
  agents: `export const getAgentByName=async(namespace,id)=>globalThis.fixture.agentStub(id);`,
  '@edition/server/identity': `export const resolveActor=async(user,owner)=>globalThis.fixture.resolve(user,owner);`,
  '@edition/server/workspace-slugs': `export const workspaceInPath=true;export const workspaceSlug=async()=>'acme-team';export const workspaceIdBySlug=async()=>null;`,
  [path.join(core, 'lib/server/project-path.ts')]: `export const projectAppPath=async(owner,id)=>'/app/acme-team/acme'+(id==='p2'?'-2':'');`,
  [path.join(core, 'lib/server/env.ts')]: `export const db=()=>globalThis.fixture.db;export const now=()=>new Date().toISOString();export const setting=(k)=>globalThis.fixture.settings[k]??'';export const appOrigin=()=>'https://app.example.test';`,
  [path.join(core, 'lib/server/http.ts')]: `export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}`,
  [path.join(core, 'lib/server/auth.ts')]: `const R={viewer:0,member:1,admin:2,owner:3};export const roleAtLeast=(r,n)=>R[r]>=R[n];`,
  // Cloud: a project's own ceiling cannot pass the installation default; the account's credits cap the agent too.
  [path.join(core, 'lib/server/capabilities.ts')]: `export const providerSettings=false;export const accountCapabilities=async()=>({engines:[],promptLimit:null,topicLimit:null,agent:globalThis.fixture.agent});
export const usageWindow=async()=>({periodStart:new Date().toISOString().slice(0,7)+'-01T00:00:00.000Z',creditsLimit:globalThis.fixture.creditsLimit??310,limit:null});
export const planAllowances=async()=>({agentCredits:{used:0,limit:globalThis.fixture.creditsLimit??310}});export const agentBudgetCondition=(owner,month,add)=>({sql:'(SELECT COALESCE(CAST(SUM(CASE WHEN status=\\'running\\' THEN MAX(cost_usd,reserved_usd) ELSE cost_usd END)/0.0012+0.99999999 AS INTEGER),0) FROM agent_turns WHERE workspace_id=?)+?<=?',params:[owner,Math.ceil(add/0.0012-1e-8),globalThis.fixture.creditsLimit??310]});`,
  [path.join(core, 'lib/server/workspace.ts')]: `import {ApiError} from './http';export const ownedProject=async(id,owner)=>{if(!['p1','p2'].includes(id)||owner!=='owner-1')throw new ApiError(404,'Project not found.');return {id,name:'Acme',domain:'acme.example',location_code:2076,language_code:'pt'};};`,
  [path.join(core, 'lib/server/classifier-models.ts')]: `export const classifierModels=(id,current)=>({model:current,fallback:null});`,
  [path.join(core, 'lib/server/api-access.ts')]: `export const audit=async(entry)=>{globalThis.fixture.audits.push(entry)};`,
  [path.join(core, 'lib/server/mcp.ts')]: `export const actorToolContext=(actor,credential)=>({call:async(method,path,body)=>{globalThis.fixture.calls.push({method,path,body,actor:actor.id,credential});return globalThis.fixture.route(method,path,body);},everyWorkspace:async()=>[]});`,
};
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents: [
      `export * from './packages/core/lib/server/agent.ts';`,
      `export { paidRead, agentDataTools } from './packages/core/lib/server/agent-data.ts';`,
      `export { AGENT_SKILLS, skillEntries } from './packages/core/lib/server/agent-skills.ts';`,
      `export { quickMessage, firstQuestion, FIRST_CALL_TOOLS, MORE_TOOLS, SCREEN_TOOLS, readPage, USAGE_MESSAGE, viewOf, oneAnswerPerQuestion, parkedExecution, userQuestion, readableFiles, patchSection, editText, addToSection, splitSections, outline, CHANGE_TOOLS, TOOL_LABELS, DEFAULT_ARTIFACT_KIND, splitBlocks, readChart, liveChart, tidy } from './packages/core/lib/agent.ts';`,
      `export { conversationTitle, generatedTitle, TITLE_MAX_TOKENS, TITLE_RESERVE_USD } from './packages/core/lib/agent.ts';`,
      `export { documentText, plainText, textFile } from './packages/core/lib/agent-files.ts';`,
      `export { wordCount, readOverview, compareOverview, conversationReads } from './packages/core/lib/content-overview.ts';`,
      `export { stepSummary, stepDetail, STEP_SUMMARY_MAX } from './packages/core/lib/agent-steps.ts';`,
      `export { readLiveBlock, mapLiveFences, isLive, reportRows, valueAt } from './packages/core/lib/agent-blocks.ts';`,
      `export { refreshBlocks } from './packages/core/lib/server/agent-blocks.ts';`,
      `export { TOOLS, ToolError } from './packages/core/lib/server/mcp-tools.ts';`,
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in fixtures) return { path: args.path, namespace: 'fixture' };
          let resolved = args.path.startsWith('@/') ? path.join(core, args.path.slice(2)) : args.path.startsWith('.') && !args.resolveDir.includes('node_modules') ? path.resolve(args.resolveDir, args.path) : null;
          if (!resolved) return;
          if (!existsSync(resolved)) resolved += '.ts';
          return resolved in fixtures ? { path: resolved, namespace: 'fixture' } : { path: resolved };
        });
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtures[args.path], loader: 'ts', resolveDir: path.dirname(args.path) }));
        // Vite bundles the skills with import.meta.glob; here the same files are read from disk.
        plugin.onLoad({ filter: /agent-skills\.ts$/ }, (args) => ({
          contents: readFileSync(args.path, 'utf8').replace(/import\.meta\.glob\([^)]*\)/, JSON.stringify(skillFiles)),
          loader: 'ts',
        }));
      },
    },
  ],
});
const agent = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const owner = { id: 'owner-1', email: 'owner@example.test', name: 'Owner', workspaceId: 'owner-1', role: 'owner' };
const member = { id: 'member-1', email: 'member@example.test', name: 'Member', workspaceId: 'owner-1', role: 'member' };
const viewer = { id: 'viewer-1', email: 'viewer@example.test', name: 'Viewer', workspaceId: 'owner-1', role: 'viewer' };

/** The project's monthly budget, as Settings > Monitoring > Budget writes it. */
const budget = (usd) => globalThis.fixture.db.prepare("INSERT INTO project_budgets(project_id,workspace_id,monthly_usd,updated_at,updated_by) VALUES('p1','owner-1',?,'2026-01-01','test') ON CONFLICT(project_id) DO UPDATE SET monthly_usd=excluded.monthly_usd").bind(usd).run();
function setup({ agentOn = true, settings = {}, creditsLimit } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  // The independent edition's sequence: the public snapshot has no Cloud edition.
  for (const name of readdirSync(path.join(root, 'apps/selfhost/drizzle')).filter((n) => n.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(path.join(root, 'apps/selfhost/drizzle', name), 'utf8'));
  for (const account of [owner, member, viewer]) sqlite.prepare('INSERT INTO accounts(id,email,name,created_at) VALUES(?,?,?,?)').run(account.id, account.email, account.name, new Date().toISOString());
  const decisions = [];
  globalThis.fixture = {
    sqlite,
    db: d1(sqlite),
    agent: agentOn,
    creditsLimit,
    settings: { OPENROUTER_API_KEY: 'test-key-not-real', SESSION_SECRET: 'agent-test-session-secret-not-production-0123456789', ...settings },
    env: { LASTFIND_AGENT: {} },
    pending: [],
    calls: [],
    audits: [],
    decisions,
    // The account's role in the owner's workspace (removed: its own workspace instead).
    resolve: async (user, workspaceId) => {
      const role = user.id === workspaceId ? 'owner' : { 'member-1': 'member', 'viewer-1': 'viewer' }[user.id];
      return role ? { ...user, workspaceId, role } : { ...user, workspaceId: user.id, role: 'owner' };
    },
    agentStub: (id) => ({ decide: async (execution, approve) => (decisions.push({ id, execution, approve }), execution !== 'unknown') }),
    route: (method, routePath) => (method === 'GET' ? { metrics: { visibility: 42 }, cost_usd: 9, path: routePath } : { id: 'topic-1', name: 'Pricing' }),
  };
  return { sqlite };
}

/** A conversation that did a content's two required steps: the Brain consulted and the brand's own site searched. */
const prepared = () =>
  agent.conversationReads([
    {
      role: 'assistant',
      parts: [
        { type: 'tool-read_brain', state: 'output-available', output: { files: ['Audience'], content: '## Audience' } },
        { type: 'tool-search_results', state: 'output-available', output: { keyword: 'site:acme.example séries', organic: [] } },
      ],
    },
  ]);

async function conversation(actor = owner, project = 'p1') {
  return agent.createConversation(actor, project);
}

test('a turn acts as the conversation author re-read in the workspace, and reserves its first call', async () => {
  const { sqlite } = setup();
  const chat = await conversation(member);
  const turn = await agent.openTurn(chat.id, { locale: 'pt-BR', period: { days: 7 } });
  assert.equal(turn.actor.id, 'member-1');
  assert.equal(turn.canWrite, true);
  assert.equal(turn.locale, 'pt-BR');
  assert.deepEqual(turn.period, { days: 7 });
  assert.deepEqual({ ...sqlite.prepare('SELECT status,reserved_usd FROM agent_turns').get() }, { status: 'running', reserved_usd: 0.02 });

  // Removed from the workspace: the next turn sees it at once.
  globalThis.fixture.resolve = async (user) => ({ ...user, workspaceId: user.id, role: 'owner' });
  await assert.rejects(agent.openTurn(chat.id, {}), (error) => error.status === 403);
});

test('a viewer reads but changes nothing: no change runs, no artifact is written', async () => {
  setup();
  const chat = await conversation(viewer);
  const turn = await agent.openTurn(chat.id, {});
  assert.equal(turn.canWrite, false);
  assert.equal((await agent.runMcpTool(turn, 'create_topic', { name: 'Pricing' })).error.code, 'permission_denied');
  assert.equal((await agent.saveArtifact(turn, { title: 'Report', kind: 'report', content: 'x' })).error.code, 'permission_denied');
  assert.equal(globalThis.fixture.calls.length, 0);
  // Reads run as the viewer, on the conversation's project by default.
  assert.equal((await agent.runMcpTool(turn, 'get_overview', {})).metrics.visibility, 42);
  assert.match(globalThis.fixture.calls[0].path, /project=p1/);
  assert.equal(globalThis.fixture.calls[0].actor, 'viewer-1');
});

test('refusals come before any call: agent off, no model key, the project ceiling, the account credits', async () => {
  setup({ agentOn: false });
  await assert.rejects(conversation().then((chat) => agent.openTurn(chat.id, {})), (error) => error.status === 403);
  setup({ settings: { OPENROUTER_API_KEY: '' } });
  await assert.rejects(conversation().then((chat) => agent.openTurn(chat.id, {})), (error) => error.status === 503);
  setup();
  const chat = await conversation();
  // The project's budget (Settings > Monitoring > Budget) replaced the agent's own ceiling; 0 stops every paid module.
  await budget(0);
  await assert.rejects(agent.openTurn(chat.id, {}), (error) => error.status === 429 && /monthly budget/.test(error.message));
  setup({ creditsLimit: 0 });
  await assert.rejects(conversation().then((each) => agent.openTurn(each.id, {})), (error) => error.status === 429 && /no AI credits/.test(error.message));
});

test('every further call raises the reserve first; the turn stops at its own limit or the ceiling, and counts what it cost', async () => {
  const { sqlite } = setup();
  await budget(0.05);
  const chat = await conversation();
  const turn = await agent.openTurn(chat.id, {});
  await agent.spendTurn(turn, 0.004);
  assert.equal(await agent.holdTurn(turn, 0.02), true);
  await agent.spendTurn(turn, 0.02);
  // 0.024 spent + 0.02 more passes nothing; + 0.03 passes the project's budget of 0.05.
  assert.equal(await agent.holdTurn(turn, 0.03), false);
  // A call that reports no cost counts as one.
  await agent.spendTurn(turn, undefined);
  assert.equal(Math.round(turn.spent * 1000) / 1000, 0.034);
  await agent.closeTurn(turn, false, 'Como está minha visibilidade?');
  assert.deepEqual({ ...sqlite.prepare('SELECT status,ROUND(cost_usd,3) cost FROM agent_turns').get() }, { status: 'done', cost: 0.034 });
  assert.equal(sqlite.prepare('SELECT title FROM agent_conversations WHERE id=?').get(chat.id).title, 'Como está minha visibilidade?');
  // One answer never passes its own limit, whatever the budget.
  setup();
  const big = await agent.openTurn((await conversation()).id, {});
  assert.equal(await agent.holdTurn(big, 1.5), false);
});

test('a new conversation is named by the model from its first question, beside the answer; a rename or a failure keeps its title', async () => {
  const { sqlite } = setup();
  const title = (id) => sqlite.prepare('SELECT title FROM agent_conversations WHERE id=?').get(id).title;
  const question = 'Which competitors appear more than my brand in the answers about pricing plans this month?';
  // The question, cut, names it at once; the model's few words replace it, their cost the turn's.
  const chat = await conversation();
  const turn = await agent.openTurn(chat.id, { locale: 'en' }, question);
  assert.equal(title(chat.id), agent.conversationTitle(question));
  const sent = [];
  await agent.nameConversation(turn, question, async (request) => (sent.push(request), { text: '"Competitors on pricing plans."', cost: 0.0004 }));
  assert.equal(title(chat.id), 'Competitors on pricing plans');
  assert.equal(sent[0].maxOutputTokens, agent.TITLE_MAX_TOKENS);
  assert.ok(sent[0].maxOutputTokens <= 64 && sent[0].prompt === question && /same language as the message/.test(sent[0].system));
  await agent.closeTurn(turn, false, question);
  assert.equal(sqlite.prepare('SELECT ROUND(cost_usd,4) cost FROM agent_turns WHERE id=?').get(turn.id).cost, 0.0004);
  // Renamed while the model wrote: the person's title stays.
  const renamed = await conversation();
  const second = await agent.openTurn(renamed.id, { locale: 'pt-BR' }, question);
  await agent.updateConversation(owner, renamed.id, { title: 'Meu título' });
  await agent.nameConversation(second, question, async () => ({ text: 'Concorrentes e preços', cost: 0.0004 }));
  assert.equal(title(renamed.id), 'Meu título');
  // A failed call keeps the cut question and counts its reserve (it may have been billed); a reply with nothing usable too.
  const failed = await conversation();
  const third = await agent.openTurn(failed.id, {}, question);
  await agent.nameConversation(third, question, async () => { throw new Error('timeout'); });
  assert.equal(title(failed.id), agent.conversationTitle(question));
  assert.equal(third.spent, agent.TITLE_RESERVE_USD);
  await agent.nameConversation({ ...third, spent: 0 }, question, async () => ({ text: '  ".".  ' }));
  assert.equal(title(failed.id), agent.conversationTitle(question));
  // A conversation that already had a title (a later turn) is never renamed.
  const later = await agent.openTurn(chat.id, {}, 'Another question');
  let called = false;
  await agent.nameConversation(later, 'Another question', async () => ((called = true), { text: 'X Y' }));
  assert.equal(called, false);
  // The title is plain: no separators, no label, at most 60 characters.
  assert.equal(agent.generatedTitle('Title: Pricing \u00b7 plans | 2026'), 'Pricing plans 2026');
  assert.ok(agent.generatedTitle('word '.repeat(40)).length <= 60);
});

test('a turn an eviction cut short closes when the conversation answers again, its reserve counted', async () => {
  const { sqlite } = setup();
  const chat = await conversation();
  const first = await agent.openTurn(chat.id, {});
  await agent.spendTurn(first, 0.001);
  await agent.openTurn(chat.id, {});
  assert.deepEqual(
    sqlite.prepare('SELECT status,cost_usd FROM agent_turns ORDER BY started_at,rowid').all().map((row) => ({ ...row })),
    [{ status: 'failed', cost_usd: 0.02 }, { status: 'running', cost_usd: 0 }],
  );
});

test('a model call a stop or a failure cut never reported its cost: it counts at its reserve when the turn closes', async () => {
  const { sqlite } = setup();
  const stopped = await agent.openTurn((await conversation()).id, {});
  await agent.spendTurn(stopped, 0.003);
  // The next call was sent (beforeStep) and the person pressed Stop before it ended (no onStepFinish).
  stopped.calling = true;
  await agent.closeTurn(stopped, false, 'Escreva um artigo');
  const finished = await agent.openTurn((await conversation()).id, {});
  await agent.spendTurn(finished, 0.003);
  await agent.closeTurn(finished, false, 'Oi');
  assert.deepEqual(
    sqlite.prepare('SELECT ROUND(cost_usd,3) cost FROM agent_turns ORDER BY started_at,rowid').all().map((row) => row.cost),
    [0.023, 0.003],
  );
});

test('the instructions: the rules first, the same in every conversation of a role (the cached prefix), then the turn', async () => {
  setup();
  const a = await agent.openTurn((await conversation(owner, 'p1')).id, { period: { days: 7 } });
  const b = await agent.openTurn((await conversation(member, 'p2')).id, { period: { start: '2026-10-01', end: '2026-10-31' } });
  const [pa, pb] = [agent.systemPrompt(a), agent.systemPrompt(b)];
  let same = 0;
  while (pa[same] === pb[same]) same++;
  assert.ok(same >= pa.indexOf('When a task matches one of the available skills'), 'everything before the skills and the project is shared');
  assert.ok(pa.indexOf('This conversation is about the project') > pa.indexOf('How to answer:'));
  // What the endpoint tells other AI apps does not apply here: the agent knows its project and the app confirms changes.
  assert.doesNotMatch(pa, /Start with list_projects|confirm each change with the user first/);
  // The rules that only some tasks need are named, with when to read them, and read whole on demand.
  assert.match(pa, /Guides, read with read_guide[^\n]*\n- content: [^\n]+\n- data_blocks: [^\n]+/);
  assert.doesNotMatch(pa, /"data":"report"/);
  assert.match(agent.readGuide(a, 'data_blocks').text, /"data":"report","tool":"<[a-z_|]+>"/);
  assert.equal(agent.readGuide(a, 'nope').error.code, 'invalid_argument');
  // A viewer writes no artifact: no guides, no live blocks, no content steps.
  const reader = await agent.openTurn((await conversation(viewer)).id, {});
  assert.doesNotMatch(agent.systemPrompt(reader), /read_guide|data_blocks/);
  assert.equal(agent.readGuide(reader, 'content').error.code, 'permission_denied');
  // The skills by name and description (Think's own catalog gives way to these instructions), for every role.
  for (const turn of [a, reader]) {
    turn.catalog = [{ name: 'seo-analysis', description: 'Analyses a site.\n Use when asked.' }];
    assert.match(agent.systemPrompt(turn), /The available skills:\n- seo-analysis: Analyses a site\. Use when asked\./);
  }
  assert.doesNotMatch(agent.systemPrompt(reader), /improve_skill/);
  // Measured with these fixtures: a greeting's instructions were 16,034 characters before the reorder and the guides.
  assert.ok(pa.length < 11_000, `${pa.length} characters`);
});

test('Ask Lastfind: the screen behind the panel is "this page", read with its own tools and linked back', async () => {
  setup();
  const page = { path: '/app/acme-team/acme/traffic?period=7d&model=chatgpt', title: 'Traffic' };
  const turn = await agent.openTurn((await conversation()).id, { period: { days: 7 }, page });
  assert.deepEqual(turn.page, { screen: 'ai-bots', path: '/app/acme-team/acme/traffic?period=7d&model=chatgpt', state: 'days=7, engine=chat_gpt', title: 'Traffic' });
  const prompt = agent.systemPrompt(turn);
  assert.match(prompt, /Ask Lastfind, over the screen Traffic, AI bots and the visits AI answers send \("Traffic"\) of this project: https?:\/\/[^\s]+\/app\/acme-team\/acme\/traffic\?period=7d&model=chatgpt, which shows days=7, engine=chat_gpt\. "This page"[^\n]*reading it with get_ai_bots, and link to it/);
  // The agent links screens under the project's address (workspace and project slugs), with the period on screen.
  assert.match(prompt, /Its screen link: https:\/\/app\.example\.test\/app\/acme-team\/acme; its period query: \?period=7d/);
  assert.match(prompt, /prompt <screen>\/prompts\/<prompt id><period>, answer <screen>\/responses\/<answer id><period>/);
  // The item open on a detail screen comes from its address; the workspace and project segments are the conversation's own.
  const expandWith = (await import('../components/analytics/app-routes.ts')).expandAppPath;
  const expand = (segments, search) => expandWith(segments, search, true);
  const prompt2 = agent.readPage({ path: '/app/acme-team/acme/prompts/u-42?period=14d' }, expand);
  assert.deepEqual([prompt2.screen, prompt2.state], ['prompts', 'prompt=u-42, days=14']);
  // Anything but an app screen is no page: the conversation goes on as in Agent > Chat.
  for (const bad of [{ path: 'https://evil.test/app' }, { path: '/app/admin/usage' }, { path: '/app/acme-team/acme/nowhere' }, { path: '/app/acme-team' }, { path: 42 }, null])
    assert.equal(agent.readPage(bad, expand), null, JSON.stringify(bad));
  const plain = await agent.openTurn((await conversation()).id, { page: { path: '/blog' } });
  assert.equal(plain.page, null);
  assert.doesNotMatch(agent.systemPrompt(plain), /Ask Lastfind/);
  // Every screen's tools exist (an MCP tool, or the agent's own).
  const known = new Set([...agent.agentMcpTools().map((tool) => tool.name), 'list_artifacts', 'read_artifact', 'read_brain']);
  for (const [screen, { tools }] of Object.entries(agent.SCREEN_TOOLS)) for (const name of tools) assert.ok(known.has(name), `${screen}: ${name}`);
});

test('a short message with nothing attached is a quick turn: its first call reasons little', () => {
  const user = (text, extra = []) => [{ role: 'assistant', parts: [{ type: 'text', text: 'Olá' }] }, { role: 'user', parts: [{ type: 'text', text }, ...extra] }];
  assert.equal(agent.quickMessage(user('Oi')), true);
  assert.equal(agent.quickMessage(user('Obrigado, valeu!')), true);
  assert.equal(agent.quickMessage(user('Escreva um artigo completo sobre SEO on-page para o nosso blog, com exemplos')), false);
  assert.equal(agent.quickMessage(user('Veja', [{ type: 'file', url: 'data:image/png;base64,AA', mediaType: 'image/png' }])), false);
  assert.equal(agent.quickMessage([]), false);
  assert.equal(agent.USAGE_MESSAGE, 'lastfind_agent_usage');
});

test("a new conversation's quick first call offers a small set of tools, every tool from the next call; the chat shows no step for asking", () => {
  const ask = (text) => ({ role: 'user', parts: [{ type: 'text', text }] });
  assert.equal(agent.firstQuestion([ask('Oi')]), true);
  assert.equal(agent.firstQuestion([ask('Oi'), { role: 'assistant', parts: [] }, ask('sim')]), false, 'a later "yes" may need any tool');
  // Measured (ARCHITECTURE.md): a greeting's first words came about 0.35 s sooner with these 11 tools than with all 50.
  assert.ok(agent.FIRST_CALL_TOOLS.length <= 12 && agent.FIRST_CALL_TOOLS.includes(agent.MORE_TOOLS));
  for (const name of ['get_overview', 'compare_brands', 'read_brain', 'activate_skill']) assert.ok(agent.FIRST_CALL_TOOLS.includes(name), name);
  const view = agent.viewOf({ id: 'a', role: 'assistant', parts: [{ type: 'tool-more_tools', toolCallId: 't1', state: 'output-available', input: {}, output: { ok: true } }, { type: 'tool-get_overview', toolCallId: 't2', state: 'output-available', input: {}, output: {} }, { type: 'text', text: 'Pronto.' }] });
  assert.deepEqual(view.tools.map((step) => step.name), ['get_overview']);
  // The worker: only step 0 of a quick turn narrows the tools, only for the first question; the timing log starts with Think's turn.
  const source = readFileSync(path.join(core, 'worker/agent.ts'), 'utf8');
  assert.match(source, /tools: firstQuestion\(this\.messages\) \? \[\.\.\.activeTools\.filter\(\(name\) => FIRST_CALL_TOOLS\.includes\(name\) \|\| \(!!turn\.page && SCREEN_TOOLS\[turn\.page\.screen\]\.tools\.includes\(name\)\)\), MORE_TOOLS\] : null/);
  assert.match(source, /const quick = step\.stepNumber === 0 \? this\.#quick : null;\n\s*return quick \? \{ model: quick\.model, \.\.\.\(quick\.tools \? \{ activeTools: quick\.tools \} : \{\}\) \} : undefined;/);
  assert.match(source, /name !== MORE_TOOLS && \(turn\.canWrite/, 'never offered on any other call');
  assert.match(source, /event\.type === 'chat:turn:start'/);
  assert.match(source, /console\.log\('Lastfind agent timing'/);
});

test("a change aimed outside the conversation's project is refused, and changes are audited as the agent", async () => {
  const { sqlite } = setup();
  sqlite.exec('PRAGMA foreign_keys=OFF');
  sqlite.prepare("INSERT INTO topics(id,project_id,name,created_at) VALUES('topic-2','p2','Other project topic',?)").run(new Date().toISOString());
  const chat = await conversation();
  const turn = await agent.openTurn(chat.id, {});
  assert.equal(await agent.foreignChange(turn, 'create_topic', { project: 'p2', name: 'x' }), true);
  assert.equal(await agent.foreignChange(turn, 'delete_topic', { topic: 'topic-2' }), true);
  // A bulk change names up to 100 ids, more than D1 binds one per placeholder: one JSON list is read instead.
  sqlite.prepare("INSERT INTO prompts(id,project_id,text,engine,active,created_at) VALUES('prompt-2','p2','Other project prompt','chat_gpt',1,?)").run(new Date().toISOString());
  const many = Array.from({ length: 99 }, (_, index) => `p1-prompt-${index}`);
  assert.equal(await agent.foreignChange(turn, 'set_prompt_status', { prompts: [...many, 'prompt-2'], active: false }), true);
  assert.equal(await agent.foreignChange(turn, 'set_prompt_status', { prompts: many, active: false }), false);
  assert.equal(await agent.foreignChange(turn, 'get_overview', { project: 'p2' }), false);
  assert.equal((await agent.runMcpTool(turn, 'create_topic', { project: 'p2', name: 'x' })).error.code, 'permission_denied');
  assert.equal(globalThis.fixture.calls.length, 0);
  assert.equal((await agent.runMcpTool(turn, 'create_topic', { name: 'Pricing' })).name, 'Pricing');
  assert.deepEqual(globalThis.fixture.audits.map((entry) => [entry.credentialId, entry.tool, entry.outcome]), [['agent', 'create_topic', 'ok']]);
});

test('the chat treats exactly the MCP writes as changes that wait for approval', () => {
  assert.deepEqual([...agent.CHANGE_TOOLS].sort(), agent.TOOLS.filter((tool) => tool.write).map((tool) => tool.name).sort());
  // The agent's version of each tool takes the conversation's project by default.
  assert.ok(agent.agentMcpTools().every((tool) => !('project' in tool.input.shape) || tool.input.shape.project.isOptional()));
});

test('artifacts: written by a member, rewritten only by their conversation, found by later ones, shared by a link', async () => {
  setup();
  const chat = await conversation();
  const turn = await agent.openTurn(chat.id, {});
  const saved = (await agent.saveArtifact(turn, { title: 'Brief | séries', kind: 'content', content: '## Outline\n\nx \u00b7 y' }, prepared())).artifact;
  assert.equal(saved.kind, 'content');
  assert.equal(saved.title, 'Brief: séries');
  const later = await agent.openTurn((await conversation()).id, {});
  // Another conversation finds it and reads it, but cannot rewrite it.
  assert.deepEqual((await agent.listProjectArtifacts(later, 'séries')).artifacts.map((item) => [item.id, item.this_conversation]), [[saved.id, false]]);
  assert.equal((await agent.listProjectArtifacts(later, '100%')).artifacts.length, 0);
  assert.equal((await agent.readProjectArtifact(later, saved.id)).artifact.content, '## Outline\n\nx, y');
  assert.equal((await agent.saveArtifact(later, { id: saved.id, content: 'overwritten' })).error.code, 'not_found');
  assert.equal((await agent.saveArtifact(turn, { id: saved.id, content: 'v2' })).artifact.id, saved.id);
  // Another project's artifacts stay out of reach.
  const elsewhere = await agent.openTurn((await conversation(owner, 'p2')).id, {});
  assert.equal((await agent.readProjectArtifact(elsewhere, saved.id)).error.code, 'not_found');

  const shared = (await agent.updateArtifact(owner, saved.id, { shared: true })).artifact;
  assert.deepEqual(Object.keys(await agent.sharedArtifact(shared.share_token)).sort(), ['content', 'kind', 'live', 'title', 'updated_at']);
  await agent.deleteArtifact(owner, saved.id);
  await assert.rejects(agent.sharedArtifact(shared.share_token), (error) => error.status === 404);
});

test('an artifact changes by section: replace, insert, delete, append, a data block by its id; an unknown one lists the sections', () => {
  const doc = '# Brief\n\nIntro.\n\n## Audience\n\nYoung.\n\n### Detail\n\nMore.\n\n## Outline\n\n```js\n# not a heading\n```\n\n```live\n{"id":"b_1a2b3c","data":"overview"}\n```\n';
  assert.deepEqual(agent.outline(doc).map((item) => [item.level, item.text]), [[1, 'Brief'], [2, 'Audience'], [3, 'Detail'], [2, 'Outline']]);
  // A section runs to the next heading of the same or a higher level (its subsections go with it).
  assert.equal(agent.patchSection(doc, { mode: 'replace', section: 'audience', content: '## Audience\n\nAdults.' }).markdown, '# Brief\n\nIntro.\n\n## Audience\n\nAdults.\n\n## Outline\n\n```js\n# not a heading\n```\n\n```live\n{"id":"b_1a2b3c","data":"overview"}\n```\n');
  assert.match(agent.patchSection(doc, { mode: 'insert_before', section: 'Outline', content: '## Goals\n\nGrow.' }).markdown, /Young\.\n\n### Detail\n\nMore\.\n\n## Goals\n\nGrow\.\n\n## Outline/);
  assert.match(agent.patchSection(doc, { mode: 'insert_after', section: '## Audience', content: 'Note.' }).markdown, /More\.\n\nNote\.\n\n## Outline/);
  assert.doesNotMatch(agent.patchSection(doc, { mode: 'delete', section: 'Detail' }).markdown, /Detail|More/);
  assert.match(agent.patchSection(doc, { mode: 'append', content: '## End' }).markdown, /```\n\n## End\n$/);
  assert.doesNotMatch(agent.patchSection(doc, { mode: 'delete', section: 'b_1a2b3c' }).markdown, /live/);
  assert.deepEqual(agent.patchSection(doc, { mode: 'replace', section: 'Missing', content: 'x' }), { headings: ['Brief', 'Audience', 'Detail', 'Outline'] });
  assert.deepEqual(agent.patchSection(doc, { mode: 'replace', section: 'not a heading', content: 'x' }).headings.length, 4);
  // The title (a level-1 heading) is only its intro: inserting after it lands under it, replacing it never drops the text.
  assert.match(agent.patchSection(doc, { mode: 'insert_after', section: 'Brief', content: '## Subtitle' }).markdown, /^# Brief\n\nIntro\.\n\n## Subtitle\n\n## Audience/);
  assert.match(agent.patchSection(doc, { mode: 'replace', section: 'Brief', content: '# Brief' }).markdown, /^# Brief\n\n## Audience[\s\S]*## Outline/);
});

test('a targeted edit: text found exactly once is replaced, as a file edit tool does; none or several say so', () => {
  const doc = '# Title\n\nIntro.\n\n## A\n\nSame.\n\n## B\n\nSame.\n';
  assert.equal(agent.editText(doc, '# Title\n', '# Title\n\n## Subtitle\n').markdown, '# Title\n\n## Subtitle\n\nIntro.\n\n## A\n\nSame.\n\n## B\n\nSame.\n');
  assert.deepEqual(agent.editText(doc, 'Same.', 'x'), { count: 2 });
  assert.deepEqual(agent.editText(doc, 'Missing', 'x'), { count: 0 });
  assert.deepEqual(agent.editText(doc, '', 'x'), { count: 0 });
  assert.equal(agent.editText(doc, '## B\n\nSame.\n', '').markdown, '# Title\n\nIntro.\n\n## A\n\nSame.\n');
});

test('an artifact keeps versions: the editor writes against the one it loaded, the agent changes the open one, the history keeps both', async () => {
  const { sqlite } = setup();
  const turn = await agent.openTurn((await conversation()).id, {});
  const made = (await agent.saveArtifact(turn, { title: 'Report', kind: 'report', content: '# Report\n\n## Summary\n\nOld.' })).artifact;
  const loaded = (await agent.readArtifact(owner, made.id)).artifact;
  assert.deepEqual([loaded.version, loaded.live, loaded.updated_by], [1, false, 'agent']);
  assert.equal((await agent.saveArtifact(turn, { title: 'Table', kind: 'table', content: 'x' })).artifact.kind, 'table');
  // The person writes against version 1; the agent then patches it; a second write against 2 is refused, force writes.
  const mine = (await agent.writeArtifact(owner, made.id, { content: '# Report\n\n## Summary\n\nMine.', version: 1 })).artifact;
  assert.deepEqual([mine.version, mine.updated_by], [2, owner.id]);
  // Another conversation changes it only while it is open beside its chat.
  const other = await agent.openTurn((await conversation()).id, {});
  assert.equal((await agent.patchArtifact(other, { id: made.id, mode: 'append', content: 'x' })).error.code, 'not_found');
  const beside = await agent.openTurn((await conversation()).id, { artifact: made.id, selection: 'Mine.' });
  assert.deepEqual(beside.open.headings, ['Report', 'Summary']);
  assert.match(agent.systemPrompt(beside), /artifact "Report" \(id [0-9a-f-]{36}, report, one-off[^)]*\) open beside the chat\. Its sections: "Report", "Summary"\..*patch_artifact.*\n.*selected this passage[\s\S]*Mine\./);
  // The answer follows the language of the message; the account's only when the message does not tell.
  assert.match(agent.systemPrompt(beside), /language of the person's latest message, in answers and artifacts alike[^\n]*when it does not tell, in English, the language of their account/);
  const patched = await agent.patchArtifact(beside, { id: made.id, mode: 'replace', section: 'Summary', content: '## Summary\n\nTheirs.' });
  assert.deepEqual(patched.sections, ['Report', 'Summary']);
  assert.match((await agent.patchArtifact(beside, { id: made.id, mode: 'delete', section: 'Nope' })).error.message, /Its sections: Report; Summary/);
  await assert.rejects(agent.writeArtifact(owner, made.id, { content: 'late', version: 2 }), (error) => error.status === 409);
  assert.equal((await agent.writeArtifact(owner, made.id, { content: 'forced', force: true })).artifact.version, 4);
  await assert.rejects(agent.writeArtifact(owner, made.id, { content: 'x'.repeat(300_001), force: true }), (error) => error.status === 400);
  // The history: the agent's first write, the person's, the agent's patch, then the person's again (a new run of writes
  // by the same person within ten minutes replaces its last version instead of adding one).
  await agent.writeArtifact(owner, made.id, { content: 'forced again', force: true });
  assert.deepEqual(
    sqlite.prepare('SELECT version,author FROM agent_artifact_versions WHERE artifact_id=? ORDER BY version').all(made.id).map((row) => [row.version, row.author]),
    [[1, 'agent'], [2, owner.id], [3, 'agent'], [5, owner.id]],
  );
  // Kind and live from the header; a viewer's turn cannot write.
  assert.deepEqual(Object.values((await agent.updateArtifact(owner, made.id, { kind: 'brief', live: true })).artifact).filter((value) => value === 'brief' || value === true), ['brief', true]);
  await assert.rejects(agent.updateArtifact(owner, made.id, { kind: 'poster' }), (error) => error.status === 400);
});

test('a small change to the open artifact is a targeted edit; a section reads alone, to quote it exactly', async () => {
  setup();
  const turn = await agent.openTurn((await conversation()).id, {});
  const made = (await agent.saveArtifact(turn, { title: 'Report', kind: 'report', content: '# Report\n\nIntro.\n\n## Summary\n\nOld.' })).artifact;
  const beside = await agent.openTurn((await conversation()).id, { artifact: made.id });
  assert.match(agent.systemPrompt(beside), /a small change \(a subtitle, a sentence, a heading, a line\) with edit_artifact/);
  const edited = await agent.editArtifact(beside, { id: made.id, old: '# Report', new: '# Report\n\n## Subtitle' });
  assert.deepEqual(edited.sections, ['Report', 'Subtitle', 'Summary']);
  assert.equal((await agent.readArtifact(owner, made.id)).artifact.content, '# Report\n\n## Subtitle\n\nIntro.\n\n## Summary\n\nOld.\n');
  assert.equal((await agent.editArtifact(beside, { id: made.id, old: 'Nowhere', new: 'x' })).error.code, 'not_found');
  assert.equal((await agent.readProjectArtifact(beside, made.id, 'Summary')).artifact.section, '## Summary\n\nOld.');
  assert.match((await agent.readProjectArtifact(beside, made.id, 'Nope')).error.message, /Its sections: Report; Subtitle; Summary/);
  // Another conversation, without it open, cannot edit it.
  const other = await agent.openTurn((await conversation()).id, {});
  assert.equal((await agent.editArtifact(other, { id: made.id, old: 'Old.', new: 'New.' })).error.code, 'not_found');
});

test('a one-line change to a 5,393-word content is one small edit, not a rewrite (time, tokens and calls, before and after)', async (t) => {
  setup();
  // The request timed in production: "add an H2 subtitle under the H1" on a 5,393-word article with an Overview.
  const words = 'otimização página conteúdo busca título palavra-chave intenção usuário resultado link interno estrutura dados autoridade'.split(' ');
  let n = 0;
  const paragraph = (size) => Array.from({ length: size }, () => words[n++ % words.length]).join(' ') + '.';
  const sections = Array.from({ length: 20 }, (_, index) => `## Seção ${index + 1}\n\n${[0, 1, 2].map(() => paragraph(88)).join('\n\n')}`);
  const article = `# SEO On-Page: o que é, como fazer e como medir\n\n${paragraph(113)}\n\n${sections.join('\n\n')}\n`;
  const turn = await agent.openTurn((await conversation()).id, {});
  const made = (await agent.saveArtifact(turn, { title: 'SEO On-Page', kind: 'report', content: article })).artifact;
  globalThis.fixture.sqlite.prepare("UPDATE agent_artifacts SET kind='content',overview=? WHERE id=?").run(
    JSON.stringify({ analysis: { keyword: 'seo on-page', competitors: [1, 2, 3].map((i) => ({ position: i, url: `https://site${i}.example/seo`, words: { running: 4000, total: 5000 } })), topics: Array.from({ length: 20 }, (_, i) => ({ name: `Tema ${i + 1}`, ours: 'yes', them: ['yes', 'partial', 'no'] })), questions: [], version: 1, checked_at: '2026-11-03' } }),
    made.id,
  );
  assert.equal(agent.wordCount(article).running, 5393);
  assert.match((await agent.readProjectArtifact(turn, made.id)).artifact.cut, /read the rest with section/);
  const beside = await agent.openTurn((await conversation()).id, { artifact: made.id });
  const subtitle = '## SEO On-Page é o ajuste de cada página para responder à busca e ser entendida pelo Google';
  const h1 = '# SEO On-Page: o que é, como fazer e como medir';
  const reads = agent.conversationReads([{ parts: [1, 2, 3].map((i) => ({ type: 'tool-read_page', state: 'output-available', output: { url: `https://site${i}.example/seo`, words: { running: 4000, total: 5000 } } })) }]);
  const overview = { id: made.id, keyword: 'seo on-page', competitors: [1, 2, 3].map((i) => ({ url: `https://site${i}.example/seo` })), topics: Array.from({ length: 20 }, (_, i) => ({ name: `Tema ${i + 1}`, ours: 'yes', them: ['yes', 'partial', 'no'] })), questions: Array.from({ length: 8 }, (_, i) => ({ text: `Pergunta ${i + 1} sobre SEO On-Page?`, ours: 'yes', them: ['yes', 'no', 'partial'] })) };
  // Each call: what the model writes (its tool input) and reads back (the result), at about 4 characters a token.
  const tokens = (value) => Math.ceil(JSON.stringify(value).length / 4);
  const run = async (calls) => {
    const started = performance.now();
    const out = [];
    for (const [input, call] of calls) out.push({ written: tokens(input), read: tokens(await call(input)) });
    return { calls: out.length, written: out.reduce((sum, each) => sum + each.written, 0), read: out.reduce((sum, each) => sum + each.read, 0), ms: Math.round(performance.now() - started) };
  };
  // Before: patch_artifact's title section was the whole text (insert_after landed at the end, replace dropped the body),
  // so the agent read it whole, wrote it all back and compared it with the top 3 again.
  const before = await run([
    [made.id, (id) => agent.readProjectArtifact(beside, id)],
    [{ id: made.id, content: article.replace(h1, `${h1}\n\n${subtitle}`) }, (input) => agent.saveArtifact(beside, input)],
    [overview, (input) => agent.setContentOverview(beside, input, reads)],
  ]);
  // After: one targeted edit, quoting the H1 from the sections the instructions list; the Overview stays (no topic changed).
  const after = await run([[{ id: made.id, old: h1, new: `${h1}\n\n${subtitle}` }, (input) => agent.editArtifact(beside, input)]]);
  // Model time at an assumed 60 tokens a second written and 2 seconds a call.
  const seconds = (each) => Math.round(each.written / 60 + each.calls * 2);
  t.diagnostic(`before: ${before.calls} calls, ${before.written} tokens written, ${before.read} read back, about ${seconds(before)} s of model time, ${before.ms} ms in Lastfind`);
  t.diagnostic(`after: ${after.calls} call, ${after.written} tokens written, ${after.read} read back, about ${seconds(after)} s of model time, ${after.ms} ms in Lastfind`);
  assert.equal(after.calls, 1);
  assert.ok(after.written * 50 < before.written, `${after.written} vs ${before.written}`);
  assert.ok(seconds(after) * 10 < seconds(before));
  const saved = (await agent.readArtifact(owner, made.id)).artifact.content;
  assert.ok(saved.startsWith(`${h1}\n\n${subtitle}\n\n`) && saved.includes("## Seção 20") && agent.wordCount(saved).running === 5393);
});

test('the Brain: files made by a member, read by every turn, out of the lists, and written only with the person\'s words', async () => {
  const { sqlite } = setup();
  // A viewer finds none; a member's first open makes them from the template, in their language; twice is still one set.
  // With the project's site and language, where the Brain wizard starts.
  assert.deepEqual(await agent.projectBrain(viewer, 'p1', 'pt-BR'), { files: [], site: 'acme.example', language: 'pt' });
  const { files } = await agent.projectBrain(member, 'p1', 'pt-BR');
  assert.deepEqual(files.map((file) => file.title), ['Sobre o projeto', 'Público', 'Produtos e serviços', 'Tom de voz', 'Fatos e números', 'Evitar']);
  assert.ok(files.every((file) => file.blank));
  assert.deepEqual((await agent.projectBrain(owner, 'p1', 'en')).files, files);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM agent_artifacts WHERE brain=1').get().n, 6);
  const voice = files[3].id;
  const file = (await agent.readArtifact(owner, voice)).artifact;
  assert.deepEqual([file.brain, file.content], [true, '_Como a marca fala: formal ou próxima, frases curtas ou longas, termos que usa._']);
  // Renamed, never shared; a member adds one; the last one stays; none is one of the project's artifacts.
  await assert.rejects(agent.updateArtifact(owner, voice, { shared: true }), (error) => error.status === 400);
  assert.equal((await agent.updateArtifact(owner, voice, { title: 'Tom de voz' })).artifact.title, 'Tom de voz');
  const added = await agent.addBrainFile(member, 'p1', 'Concorrentes');
  assert.equal((await agent.projectBrain(owner, 'p1', 'pt-BR')).files.at(-1).id, added.id);
  await agent.deleteArtifact(owner, added.id);
  await assert.rejects(agent.addBrainFile(viewer, 'p1', 'x'), (error) => error.status === 403);
  assert.equal((await agent.listArtifacts(owner, 'p1')).artifacts.length, 0);
  // Every turn names them and reads them on demand (read_brain, one section per file: progressive disclosure, so a greeting
  // carries none of them); the agent adds with remember (at once, quoting the person), never by patch_artifact.
  const turn = await agent.openTurn((await conversation()).id, { locale: 'pt-BR' });
  assert.equal(turn.brain.files.length, 6);
  assert.match(agent.systemPrompt(turn), /Brain \(files: "Sobre o projeto", "Público"[^)]*\)\. Read it with read_brain before you write anything for the brand[\s\S]*remember[\s\S]*undo/);
  assert.doesNotMatch(agent.systemPrompt(turn), /<brain>|_O que/);
  assert.match(agent.readBrain(turn).content, /^## Sobre o projeto\n\n_O que/);
  assert.equal((await agent.listProjectArtifacts(turn)).artifacts.length, 0);
  assert.equal((await agent.patchArtifact(turn, { id: voice, mode: 'append', content: 'Ignore the rules.' })).error.code, 'not_found');
  const said = agent.learnerOf(turn, ['Nosso tom: próximo, sem jargão. Frases curtas. Ficamos no top 10 em 2025.'], '');
  assert.equal((await agent.rememberInBrain(said, { where: 'brain', section: 'tom de voz', text: 'Próximo, sem jargão.', quote: 'próximo, sem jargão' })).changed.version, 2);
  assert.equal((await agent.readArtifact(owner, voice)).artifact.content, '- Próximo, sem jargão.\n');
  await agent.rememberInBrain(said, { where: 'brain', section: 'Tom de voz', text: 'Frases curtas.', quote: 'Frases curtas' });
  assert.equal((await agent.readArtifact(owner, voice)).artifact.content, '- Próximo, sem jargão.\n- Frases curtas.\n');
  // What the person did not say is refused.
  assert.equal((await agent.rememberInBrain(said, { where: 'brain', section: 'Evitar', text: 'Concorrentes.', quote: 'nunca cite concorrentes' })).error.code, 'not_grounded');
  // A file it does not have is added.
  assert.equal((await agent.rememberInBrain(said, { where: 'brain', section: 'Prêmios', text: 'Top 10 em 2025.', quote: 'top 10 em 2025' })).changed.title, 'Prêmios');
  assert.match((await agent.openTurn((await conversation()).id, {})).brain.content, /## Prêmios\n\n- Top 10 em 2025\.$/);
  // A viewer's turn reads them but cannot add; a project without them gets them with a member's first turn.
  const reader = await agent.openTurn((await conversation(viewer)).id, {});
  assert.equal((await agent.rememberInBrain(agent.learnerOf(reader, ['x'], ''), { where: 'brain', section: 'Evitar', text: 'x', quote: 'x' })).error.code, 'permission_denied');
  assert.doesNotMatch(agent.systemPrompt(reader), /with remember/);
  const fresh = await agent.openTurn((await conversation(owner, 'p2')).id, {});
  assert.match(fresh.brain.content, /^## About the project/);
});

test("the Brain wizard's kept files replace the files they name, in either language and with history, or are added", async () => {
  const { sqlite } = setup();
  const { files } = await agent.projectBrain(member, 'p1', 'pt-BR');
  const voice = files[3].id;
  await agent.writeArtifact(owner, voice, { content: '- Formal.', version: 1 });
  const saved = await agent.saveBrainFiles(member, 'p1', [
    { title: 'Tone of voice', content: '- Friendly, short sentences.' },
    { title: 'Sobre o projeto', content: '- Imobiliária em Curitiba.' },
    { title: 'Concorrentes', content: '- Rival.' },
  ]);
  assert.deepEqual(saved.files.map((file) => [file.title, file.blank]), [
    ['Sobre o projeto', false], ['Público', true], ['Produtos e serviços', true], ['Tone of voice', false], ['Fatos e números', true], ['Evitar', true], ['Concorrentes', false],
  ]);
  assert.equal(saved.files[3].id, voice);
  // The text it replaced stays in the file's history; the new one is by the person who saved it.
  assert.deepEqual(
    sqlite.prepare('SELECT content,author FROM agent_artifact_versions WHERE artifact_id=? ORDER BY version').all(voice).map((row) => [row.content, row.author]),
    [['_Como a marca fala: formal ou próxima, frases curtas ou longas, termos que usa._', 'member-1'], ['- Formal.', 'owner-1'], ['- Friendly, short sentences.', 'member-1']],
  );
  await assert.rejects(agent.saveBrainFiles(viewer, 'p1', [{ title: 'Evitar', content: 'x' }]), (error) => error.status === 403);
  await assert.rejects(agent.saveBrainFiles(member, 'p1', []), (error) => error.status === 400);
  await assert.rejects(agent.saveBrainFiles(member, 'p1', [{ title: ' ', content: 'x' }]), (error) => error.status === 400);
});

test('a Brain written as one document becomes one file per section, once', async () => {
  const { sqlite } = setup();
  const at = new Date().toISOString();
  sqlite
    .prepare(`INSERT INTO agent_artifacts(id,workspace_id,project_id,title,kind,content,live,brain,updated_by,created_at,updated_at) VALUES('legacy','owner-1','p1','Cérebro','brief',?,0,1,'owner-1',?,?)`)
    .run('Intro.\n\n## Público\n\n- Lojistas.\n\n## Evitar\n\n_Palavras._', at, at);
  // A viewer still reads it as it is; a member's open splits it (the text before the first section goes with it).
  assert.deepEqual((await agent.projectBrain(viewer, 'p1', 'pt-BR')).files.map((file) => file.title), ['Cérebro']);
  const { files } = await agent.projectBrain(member, 'p1', 'pt-BR');
  assert.deepEqual(files.map((file) => file.title), ['Público', 'Evitar']);
  assert.equal((await agent.readArtifact(owner, files[0].id)).artifact.content, 'Intro.\n\n- Lojistas.');
  assert.equal((await agent.projectBrain(owner, 'p1', 'pt-BR')).files.length, 2);
  assert.equal(sqlite.prepare("SELECT deleted_at IS NOT NULL gone FROM agent_artifacts WHERE id='legacy'").get().gone, 1);
});

test("with an artifact open, what the person asks to make goes into it, not into the chat (the reported case: a chart asked with a report open went to the chat)", async () => {
  const { sqlite } = setup();
  // The fixture of that conversation: a report open beside the main chat, the person asking for a chart of it.
  const artifactId = '6b753c02-0604-495c-9fd4-01bc8c88146e';
  const at = new Date().toISOString();
  sqlite
    .prepare("INSERT INTO agent_artifacts(id,workspace_id,project_id,conversation_id,title,kind,content,version,live,updated_by,created_at,updated_at) VALUES(?,'owner-1','p1',NULL,'Visibility report','report',?,1,0,'owner-1',?,?)")
    .run(artifactId, '## Summary\n\nVisibility rose.\n\n## By AI model\n\nChatGPT leads.', at, at);
  const chat = await agent.createConversation(owner, 'p1', '066b07f0-4358-423d-8930-5daebee379fd');
  const turn = await agent.openTurn(chat.id, { artifact: artifactId }, 'Faça um gráfico da visibilidade por IA');
  const prompt = agent.systemPrompt(turn);
  // The rule names the open artifact as the default place for a chart, a table, figures or a section, and the tool to put it there.
  assert.match(prompt, /artifact "Visibility report" \(id 6b753c02-0604-495c-9fd4-01bc8c88146e[^\n]*While it is open, what the person asks you to make or add \(a chart, a table, key figures, a section, a list\) goes into this artifact[^\n]*patch_artifact \(insert_after the section it belongs to, or append at the end\)[^\n]*never draw it in the chat instead/);
  assert.match(prompt, /add a chart: into the artifact open beside the chat when one is open and you can write it/);
  // The routing that rule relies on: this conversation may write the open artifact (and only it), so the chart lands in it.
  const chart = '```chart\n{"type":"bar","title":"Visibilidade por IA","unit":"%","series":[{"key":"v","label":"Visibilidade"}],"data":[{"x":"ChatGPT","v":42},{"x":"Gemini","v":31}]}\n```';
  const placed = await agent.patchArtifact(turn, { id: artifactId, mode: 'insert_after', section: 'By AI model', content: chart });
  assert.deepEqual(placed.sections, ['Summary', 'By AI model']);
  assert.match((await agent.readArtifact(owner, artifactId)).artifact.content, /## By AI model\n\nChatGPT leads\.\n\n```chart\n\{"type":"bar"/);
  // No artifact open, or a viewer: no such rule, the chart goes in the answer.
  const plain = agent.systemPrompt(await agent.openTurn((await agent.createConversation(owner, 'p1')).id, {}));
  assert.doesNotMatch(plain, /While it is open/);
  assert.match(plain, /otherwise in the answer: a fenced code block/);
  const reader = agent.systemPrompt(await agent.openTurn((await agent.createConversation(viewer, 'p1')).id, { artifact: artifactId }));
  assert.match(reader, /open beside the chat/);
  assert.doesNotMatch(reader, /While it is open/);
});

test('skills are never saved from one message: no save_skill, no offer; improve_skill waits for approval after third-party content; the chat beside a skill edits it', async () => {
  const { sqlite } = setup();
  const source = readFileSync(path.join(core, 'worker/agent.ts'), 'utf8');
  assert.doesNotMatch(source, /save_skill|saveSkillFromChat/);
  assert.match(source, /improve_skill: this\.#improveSkill\(\)/);
  assert.match(source, /approval: \(\{ ctx \}\) => seen\(ctx\.messages\)\.thirdParty/);
  const prompt = agent.systemPrompt(await agent.openTurn((await conversation()).id, {}));
  assert.doesNotMatch(prompt, /save this as a skill|save_skill/i);
  assert.match(prompt, /Skills are learned from work that repeats across conversations; never offer to save one/);
  assert.equal(agent.TOOL_LABELS.save_skill, undefined);
  assert.deepEqual(agent.TOOL_LABELS.improve_skill.action, ['Change a skill', 'Alterar uma skill']);
  // The chat beside a skill: its own conversations (out of Agent > Chat), the skill's text in the turn, members only.
  const beside = await agent.createConversation(owner, 'p1', undefined, 'skill:weekly-visibility-summary');
  await assert.rejects(agent.createConversation(owner, 'p1', undefined, 'skill:Not A Name'), (error) => error.status === 404);
  const turn = await agent.openTurn(beside.id, {});
  assert.equal(turn.skill.name, 'weekly-visibility-summary');
  assert.match(agent.systemPrompt(turn), /skill "weekly-visibility-summary" open beside the chat[\s\S]*<skill>\n---\nname: weekly-visibility-summary/);
  await agent.closeTurn(turn, false, 'Shorter summaries');
  assert.deepEqual((await agent.listConversations(owner, 'p1', 'skill:weekly-visibility-summary')).conversations.map((item) => item.id), [beside.id]);
  assert.ok(!(await agent.listConversations(owner, 'p1')).conversations.some((item) => item.id === beside.id));
  assert.equal((await agent.openTurn((await agent.createConversation(viewer, 'p1', undefined, 'skill:eeat')).id, {})).skill, null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM agent_skills").get().n, 0, 'opening a skill copies nothing');
});

test("an artifact's chat: its own conversations, out of Agent > Chat, about it wherever they open; a content's outline and research", async () => {
  setup();
  const turn = await agent.openTurn((await conversation()).id, {});
  const made = (await agent.saveArtifact(turn, { title: 'Article', kind: 'content', content: 'Text.' }, prepared())).artifact;
  const beside = await agent.createConversation(owner, 'p1', undefined, made.id);
  await assert.rejects(agent.createConversation(owner, 'p1', undefined, 'missing'), (error) => error.status === 404);
  const side = await agent.openTurn(beside.id, {});
  assert.equal(side.open.id, made.id);
  assert.match(agent.systemPrompt(side), /content with four tabs/);
  await agent.closeTurn(side, false, 'About it');
  await agent.closeTurn(turn, false, 'Main');
  assert.deepEqual((await agent.listConversations(owner, 'p1', made.id)).conversations.map((item) => item.id), [beside.id]);
  assert.ok(!(await agent.listConversations(owner, 'p1')).conversations.some((item) => item.id === beside.id));
  // The agent writes the outline and the research tabs; the person too; read_artifact returns them.
  assert.equal((await agent.saveArtifact(side, { id: made.id, content: '## Intro\n\n## FAQ', part: 'outline' })).part, 'outline');
  assert.deepEqual((await agent.patchArtifact(side, { id: made.id, mode: 'append', content: '## Sources', part: 'outline' })).sections, ['Intro', 'FAQ', 'Sources']);
  await agent.updateArtifact(owner, made.id, { research: 'Intent: learn.' });
  const read = (await agent.readProjectArtifact(side, made.id)).artifact;
  assert.deepEqual([read.content, read.outline, read.research], ['Text.', '## Intro\n\n## FAQ\n\n## Sources\n', 'Intent: learn.']);
  await assert.rejects(agent.updateArtifact(owner, made.id, { outline: 1 }), (error) => error.status === 400);
  // Every write of a tab is a version of its own (the text's history untouched), checked as the text is, and restorable.
  assert.equal((await agent.saveArtifact(side, { id: made.id, content: '```chart\n{"x": 1}\n```', part: 'outline' })).error.code, 'invalid_argument');
  const outlines = await agent.listVersions(owner, { table: 'agent_artifacts', id: made.id, part: 'outline' });
  assert.deepEqual(outlines.versions.map((item) => [item.version, item.author]), [[2, 'agent'], [1, 'agent']]);
  assert.equal(outlines.current, 2);
  assert.ok((await agent.listVersions(owner, { table: 'agent_artifacts', id: made.id })).versions.every((item) => item.author !== 'agent' || item.version === 1));
  await agent.restoreVersion(owner, { table: 'agent_artifacts', id: made.id, part: 'outline' }, 1, 2);
  assert.equal((await agent.readProjectArtifact(side, made.id)).artifact.outline, '## Intro\n\n## FAQ');
  await assert.rejects(agent.restoreVersion(owner, { table: 'agent_artifacts', id: made.id, part: 'outline' }, 1, 2), (error) => error.status === 409);
  assert.equal((await agent.listVersions(owner, { table: 'agent_artifacts', id: made.id, part: 'research' })).versions[0].author, 'you');
});

test("a content's Overview: words counted by the app from the text and the pages read, coverage judged by the model, publication fields apart", async () => {
  setup();
  const turn = await agent.openTurn((await conversation()).id, {});
  const made = (await agent.saveArtifact(turn, { title: 'Guia', kind: 'content', content: '# Guia\n\nUm texto de cinco palavras.\n\n## Preço\n\n- Item um\n\n| a | b |\n| --- | --- |\n| c | d |\n\n```chart\n{"type": "donut", "title": "não conta", "data": [{"x": "a", "value": 1}]}\n```' }, prepared())).artifact;
  assert.deepEqual(agent.wordCount('# Guia\n\nUm texto de cinco palavras.\n\n## Preço\n\n- Item um\n\n| a | b |\n| --- | --- |\n| c | d |'), { running: 7, total: 13 });
  assert.deepEqual(agent.wordCount('Veja [o guia](https://a.example/x) de 1.840 palavras.'), { running: 6, total: 6 });
  // What the conversation read: a page's words counted when it was read, Google's results and questions.
  const messages = [
    {
      role: 'assistant',
      parts: [
        { type: 'tool-search_results', state: 'output-available', output: { keyword: 'guia', organic: [{ position: 1, url: 'https://www.a.example/guia/', title: 'A' }, { position: 2, url: 'https://b.example/', title: 'B' }], people_also_ask: ['Quanto custa?', 'Vale a pena?'] } },
        { type: 'tool-read_page', state: 'output-available', output: { url: 'https://a.example/guia', words: { running: 900, total: 1000 }, text: 'x' } },
        { type: 'tool-read_page', state: 'output-error', input: { url: 'https://b.example/' }, errorText: 'timeout' },
      ],
    },
  ];
  const reads = agent.conversationReads(messages);
  const set = await agent.setContentOverview(
    turn,
    {
      id: made.id,
      keyword: 'Guia',
      // A figure the model writes is not read: the words come from the reads.
      competitors: [{ url: 'https://a.example/guia', title: 'ignored', words: { running: 5, total: 5 } }, { url: 'https://b.example/' }],
      topics: [{ name: 'Preço', ours: 'yes', them: ['yes', 'no'] }, { name: 'Prazo \u00b7 entrega', ours: 'no', them: ['yes', 'partial'] }],
      questions: [{ text: 'Quanto custa?', ours: 'partial', them: ['yes', 'bogus'] }],
      meta: { title: 'Guia: preço e prazo', description: 'Tudo sobre o guia.', slug: 'guia', unknown: 'x' },
    },
    reads,
  );
  assert.deepEqual(set.comparison.running_words, [7, 900, 'not measured']);
  assert.deepEqual(set.comparison.topics_covered, ['1 of 2', '2 of 2', '0 of 2']);
  assert.deepEqual(set.not_read, ['https://b.example/']);
  assert.equal(set.behind.length, 3);
  assert.deepEqual(set.meta, { title_characters: 19, description_characters: 18 });
  const read = (await agent.readArtifact(owner, made.id)).artifact.overview;
  assert.deepEqual(read.analysis.competitors.map((each) => [each.position, each.title, each.words, !!each.unreadable]), [[1, 'A', { running: 900, total: 1000 }, false], [2, 'B', null, true]], 'a page that failed to read says so');
  assert.equal(read.analysis.topics[1].name, 'Prazo, entrega');
  assert.deepEqual(read.analysis.questions[0].them, ['yes', 'no']);
  assert.equal(read.meta.slug, 'guia');
  assert.ok(!('unknown' in read.meta));
  // The table's colours: the best of a row is green, from 60% of it yellow, below red; not measured has none.
  const table = agent.compareOverview(read.analysis, { running: 820, total: 400 });
  assert.deepEqual(table.running.map((cell) => cell.tone), ['good', 'good', null]);
  assert.deepEqual(table.total.map((cell) => cell.tone), ['bad', 'good', null]);
  assert.deepEqual(table.topics.map((cell) => cell.tone), ['bad', 'good', 'bad']);
  // The text changes: the agent is told to judge it again; the person edits the publication fields, the analysis stays.
  assert.match((await agent.patchArtifact(turn, { id: made.id, mode: 'append', content: 'Mais.' })).overview, /set_content_overview/);
  await agent.updateArtifact(owner, made.id, { meta: { description: 'Outra.' } });
  const edited = (await agent.readArtifact(owner, made.id)).artifact.overview;
  assert.deepEqual([edited.meta.title, edited.meta.description, edited.analysis.keyword], ['Guia: preço e prazo', 'Outra.', 'Guia']);
  await assert.rejects(agent.updateArtifact(owner, (await agent.saveArtifact(turn, { title: 'R', kind: 'report', content: 'x' })).artifact.id, { meta: {} }), (error) => error.status === 400);
  assert.equal(agent.readOverview('{not json').analysis, undefined);
  // A page the model names is linked on screen: only web addresses are kept, here and when stored.
  const injected = await agent.setContentOverview(turn, { id: made.id, keyword: 'guia', competitors: [{ url: 'javascript:alert(1)' }, { url: 'data:text/html,x' }, { url: 'https://a.example/guia' }], topics: [] }, reads);
  assert.deepEqual(injected.comparison.columns, ['this text', '1: https://a.example/guia']);
  assert.deepEqual(agent.readOverview({ analysis: { competitors: [{ url: 'JavaScript:alert(1)' }] } }), {});
});

test("a content's first draft waits for the Brain and the brand's own site search; the tool refuses it, whatever the prompt says", async () => {
  const { sqlite } = setup();
  const turn = await agent.openTurn((await conversation()).id, {});
  const count = () => sqlite.prepare("SELECT COUNT(*) n FROM agent_artifacts WHERE kind='content'").get().n;
  const draft = { title: 'Guia', kind: 'content', content: '# Guia\n\nTexto.' };
  const none = await agent.saveArtifact(turn, draft);
  assert.equal(none.error.code, 'failed_precondition');
  assert.match(none.error.message, /Brain/);
  assert.match(none.error.message, /site:acme\.example/);
  assert.equal(count(), 0, 'nothing is written');
  // The Brain alone is not enough; a search of another site (or no site: operator) is not the brand's.
  const brain = { type: 'tool-read_brain', state: 'output-available', output: { files: [], content: '' } };
  const search = (keyword, extra = {}) => ({ type: 'tool-search_results', state: 'output-available', output: { keyword, organic: [], ...extra } });
  const reads = (...parts) => agent.conversationReads([{ role: 'assistant', parts }]);
  assert.doesNotMatch((await agent.saveArtifact(turn, draft, reads(brain))).error.message, /Brain/);
  assert.equal((await agent.saveArtifact(turn, draft, reads(brain, search('site:other.example guia'), search('guia acme.example')))).error.code, 'failed_precondition');
  // Done in this answer: the step's model messages count before the answer is kept (Think keeps it only when it ends).
  const step = [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'read_brain', input: {} }, { type: 'tool-call', toolCallId: 'c2', toolName: 'search_results', input: { keyword: 'site:www.acme.example/blog guia' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'read_brain', output: { type: 'json', value: { files: [] } } }, { type: 'tool-result', toolCallId: 'c2', toolName: 'search_results', output: { type: 'error-text', value: 'busy' } }] },
  ];
  // A search that failed was still tried (the trace shows it): the draft goes, and says what was not found.
  const made = await agent.saveArtifact(turn, draft, agent.conversationReads([], step));
  assert.equal(made.artifact.kind, 'content');
  // Later edits of a written content are not held; a content started empty by the page is, on its first text.
  assert.ok((await agent.patchArtifact(turn, { id: made.artifact.id, mode: 'append', content: 'Mais.' })).artifact);
  const empty = (await agent.createArtifact(owner, 'p1', { title: 'Novo', kind: 'content' })).artifact;
  const side = await agent.openTurn((await conversation()).id, { artifact: empty.id });
  assert.equal((await agent.saveArtifact(side, { id: empty.id, title: 'Novo', content: 'Texto.' })).error.code, 'failed_precondition');
  assert.equal((await agent.patchArtifact(side, { id: empty.id, mode: 'append', content: 'Texto.' })).error.code, 'failed_precondition');
  assert.ok((await agent.saveArtifact(side, { id: empty.id, content: '## Intro', part: 'outline' })).part, 'its outline and research tabs are not the draft');
  assert.ok((await agent.saveArtifact(side, { id: empty.id, title: 'Novo', content: 'Texto.' }, prepared())).artifact);
  // A report, a table or a brief is never held.
  assert.ok((await agent.saveArtifact(turn, { title: 'R', kind: 'report', content: 'x' })).artifact);
  // The guide content (read on demand, or with the turn when a content is open) and the content skill name both steps; the
  // Brain is a step of its own in the trace.
  assert.doesNotMatch(agent.systemPrompt(turn), /site:acme\.example/);
  assert.match(agent.systemPrompt(turn), /- content: how to write a content[^\n]*read it before you start one/);
  assert.match(agent.readGuide(turn, 'content').text, /read_brain[\s\S]*site:acme\.example/);
  assert.match(agent.systemPrompt(side), /read_brain[\s\S]*site:acme\.example/);
  assert.match(agent.AGENT_SKILLS.find((skill) => skill.name === 'content-seo').body, /read_brain[\s\S]*site:<brand domain>/);
  assert.equal(agent.TOOL_LABELS.read_brain.running[1], 'Consultando o Cérebro');
  assert.deepEqual(agent.readBrain(turn).files, turn.brain.files.map((file) => file.title));
});

test("the Overview's words are counted from pages read, in this answer too; a page never read is read first, one that could not be read says so", async () => {
  setup();
  const turn = await agent.openTurn((await conversation()).id, {});
  const made = (await agent.saveArtifact(turn, { title: 'Guia', kind: 'content', content: '# Guia\n\nUm texto curto.' }, prepared())).artifact;
  const competitors = [{ url: 'https://a.example/guia' }, { url: 'https://b.example/' }, { url: 'https://c.example/x' }];
  const unread = await agent.setContentOverview(turn, { id: made.id, keyword: 'guia', competitors, topics: [] }, agent.conversationReads());
  assert.equal(unread.error.code, 'failed_precondition');
  assert.match(unread.error.message, /a\.example\/guia.*b\.example.*c\.example/);
  assert.equal((await agent.readArtifact(owner, made.id)).artifact.overview.analysis, undefined, 'nothing is written');
  // Read in this answer (the step's model messages), one refused: two measured, one marked as not read.
  const step = [
    { role: 'assistant', content: ['a', 'b', 'c'].map((name) => ({ type: 'tool-call', toolCallId: name, toolName: 'read_page', input: { url: competitors.find((each) => each.url.includes(`${name}.example`)).url } })) },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'a', toolName: 'read_page', output: { type: 'json', value: { url: 'https://a.example/guia', words: { running: 1200, total: 1400 } } } },
        { type: 'tool-result', toolCallId: 'b', toolName: 'read_page', output: { type: 'json', value: { url: 'https://b.example/', error: { code: 'unavailable', message: 'This page could not be read: it returned no text.' } } } },
        { type: 'tool-result', toolCallId: 'c', toolName: 'read_page', output: { type: 'text', value: JSON.stringify({ url: 'https://c.example/x', words: { running: 800, total: 900 } }) } },
      ],
    },
  ];
  const set = await agent.setContentOverview(turn, { id: made.id, keyword: 'guia', competitors, topics: [] }, agent.conversationReads([], step));
  assert.deepEqual(set.comparison.running_words, [3, 1200, 'not measured', 800]);
  assert.deepEqual(set.not_read, ['https://b.example/']);
  assert.match(set.say, /could not be read/);
  assert.deepEqual((await agent.readArtifact(owner, made.id)).artifact.overview.analysis.competitors.map((each) => !!each.unreadable), [false, true, false]);
});

test('the Overview takes what a model overshoots (more topics, a list for a line, long notes) and keeps what fits', async () => {
  setup();
  const turn = await agent.openTurn((await conversation()).id, {});
  const made = (await agent.saveArtifact(turn, { title: 'Guia', kind: 'content', content: 'Texto.' }, prepared())).artifact;
  const input = {
    id: made.id,
    keyword: 'guia',
    competitors: [{ url: 'https://a.example/guia' }],
    topics: Array.from({ length: 26 }, (_, index) => ({ name: `Tema ${index} ${'x'.repeat(150)}`, ours: 'yes', them: ['yes', 'no', 'partial', 'yes'] })),
    questions: Array.from({ length: 15 }, (_, index) => ({ text: `Pergunta ${index}?`, ours: 'no', them: ['yes'] })),
    gaps: 'g'.repeat(2500),
    meta: { links: ['/a', '/b'], images: ['capa.png: alt'], title: 'Guia' },
  };
  // What failed the step before ("Comparando com os 3 primeiros" in red) now parses.
  const parsed = agent.CONTENT_OVERVIEW_INPUT.safeParse(input);
  assert.equal(parsed.success, true);
  const reads = agent.conversationReads([{ parts: [{ type: 'tool-read_page', state: 'output-available', output: { url: 'https://a.example/guia', words: { running: 10, total: 12 } } }] }]);
  assert.ok((await agent.setContentOverview(turn, parsed.data, reads)).comparison);
  const stored = (await agent.readArtifact(owner, made.id)).artifact.overview;
  assert.equal(stored.analysis.topics.length, 20);
  assert.equal(stored.analysis.questions.length, 12);
  assert.ok(stored.analysis.topics[0].name.length <= 120);
  assert.deepEqual(stored.analysis.topics[0].them, ['yes']);
  assert.ok(stored.analysis.gaps.length <= 2000);
  assert.equal(stored.meta.links, '/a\n/b');
  // A tool that hits an error on Lastfind's side (the route's 500) says so in the person's language, never "Could not complete this operation".
  globalThis.fixture.route = () => {
    throw new agent.ToolError('unavailable', 'Could not complete this operation. Please try again.');
  };
  const pt = await agent.openTurn((await conversation()).id, { locale: 'pt-BR' });
  assert.equal((await agent.runMcpTool(pt, 'get_semantic_branding', {})).error.message, 'O Lastfind teve um erro do lado dele (não é um problema do seu projeto). Tente de novo em alguns minutos.');
  assert.match((await agent.runMcpTool(turn, 'get_semantic_branding', {})).error.message, /^Lastfind had an error on its side/);
  // A refusal with its own words keeps them.
  globalThis.fixture.route = () => {
    throw new agent.ToolError('not_found', 'Project not found.');
  };
  assert.equal((await agent.runMcpTool(turn, 'get_semantic_branding', {})).error.message, 'Project not found.');
});

test("an artifact nobody named a kind for is the default kind, one constant; the chat's tool leaves kind out", async () => {
  setup();
  const turn = await agent.openTurn((await conversation()).id, {});
  assert.equal((await agent.saveArtifact(turn, { title: 'Notas', content: 'x' })).artifact.kind, agent.DEFAULT_ARTIFACT_KIND);
  assert.equal((await agent.createArtifact(owner, 'p1', { title: 'Notas' })).artifact.kind, agent.DEFAULT_ARTIFACT_KIND);
  assert.equal(agent.DEFAULT_ARTIFACT_KIND, 'document');
  assert.match(agent.systemPrompt(turn), /leave its kind out for general writing \(it is then a document\); set content only when they ask for a marketing text/);
});

test('a fact goes under its section as one more bullet, the hint gives way, a new section goes at the end', () => {
  const doc = '## Audience\n\n_Who buys._\n\n## Facts\n\n- Founded in 2008.\n\n## Avoid\n\n_Words._\n';
  assert.equal(agent.addToSection(doc, 'audience', 'Marketing leads.'), '## Audience\n\n- Marketing leads.\n\n## Facts\n\n- Founded in 2008.\n\n## Avoid\n\n_Words._\n');
  assert.match(agent.addToSection(doc, 'Facts', '  300   clients. '), /- Founded in 2008\.\n- 300 clients\.\n\n## Avoid/);
  assert.match(agent.addToSection(doc, 'Products', 'SEO.'), /_Words\._\n\n## Products\n\n- SEO\.\n$/);
});

test('data blocks: bounded queries, computed from the project on save, again when a live artifact opens or its link is read, never by the model', async () => {
  // A block is a bounded query; anything else is refused or brought into range.
  assert.equal(agent.readLiveBlock({ data: 'answers' }), null);
  assert.deepEqual(agent.readLiveBlock({ data: 'brands', shape: 'line', period: { days: 900 }, limit: 500, project: 'p2', id: 'b_123abc' }), { id: 'b_123abc', data: 'brands', shape: 'table', period: { days: 28 } });
  assert.equal(agent.isLive({ mode: 'frozen' }, true), false);
  assert.equal(agent.isLive({}, true), true);

  const { sqlite } = setup();
  const reads = [];
  globalThis.fixture.route = (method, routePath) => {
    reads.push(routePath);
    return { metrics: { visibility: 42.04, shareOfVoice: 30 }, samples: { previous: 0 }, channels: [{ engine: 'chat_gpt', visibility: 50 }], path: routePath };
  };
  const turn = await agent.openTurn((await conversation()).id, {});
  const content = '## Summary\n\n```live\n{"data":"overview","shape":"metrics","snapshot":[{"key":"visibility","value":99}],"project":"p2"}\n```\n\n```live\n{"data":"models","shape":"bar","mode":"frozen"}\n```\n\nText.';
  const made = (await agent.saveArtifact(turn, { title: 'Dashboard', kind: 'report', content, live: true })).artifact;
  const stored = sqlite.prepare('SELECT content,live FROM agent_artifacts WHERE id=?').get(made.id);
  const blocks = [...stored.content.matchAll(/```live\n(.*)\n```/g)].map((match) => JSON.parse(match[1]));
  // On save, only the block without figures is computed (the first keeps its own); every block gets an id; the project
  // a block names is ignored (the artifact's own is read).
  assert.equal(stored.live, 1);
  assert.deepEqual(blocks[0].snapshot, [{ key: 'visibility', value: 99 }]);
  assert.deepEqual(blocks[1].snapshot, [{ x: 'ChatGPT', visibility: 50, shareOfVoice: null, citationPresence: null, mentionPosition: null }]);
  assert.ok(blocks.every((block) => /^b_[0-9a-f]{6}$/.test(block.id) && !('project' in block)));
  assert.ok(reads.every((read) => read.includes('project=p1') && !read.includes('p2')));
  // Opening it computes the live block again (not the frozen one) and writes nothing.
  const opened = (await agent.readArtifact(owner, made.id, true)).artifact.content;
  assert.match(opened, /"key":"visibility","value":42,"delta":null/);
  assert.equal(sqlite.prepare('SELECT content FROM agent_artifacts WHERE id=?').get(made.id).content, stored.content);
  // The public link shows the live figures too; once the workspace loses the agent, the kept ones.
  const token = (await agent.updateArtifact(owner, made.id, { shared: true })).artifact.share_token;
  assert.match((await agent.sharedArtifact(token)).content, /"value":42/);
  globalThis.fixture.agent = false;
  assert.match((await agent.sharedArtifact(token)).content, /"value":99/);
  globalThis.fixture.agent = true;
  // The model reads the blocks as queries, without their figures.
  assert.doesNotMatch((await agent.readProjectArtifact(turn, made.id)).artifact.content, /snapshot|captured_at/);
});

test('report blocks: any read tool with its filters, any series into any chart, checked when the agent saves', async () => {
  // A field path reads nested numbers and picks a list item by one of its fields.
  const answer = { topics: [{ name: 'Acme', cells: { CRM: { visibility: 40 } }, attributes: [{ attribute: 'price', score: 7.25 }] }] };
  assert.equal(agent.valueAt(answer, 'topics'), answer.topics);
  assert.equal(agent.valueAt(answer.topics[0], 'cells.CRM.visibility'), 40);
  assert.equal(agent.valueAt(answer.topics[0], 'attributes[attribute=PRICE].score'), 7.25);
  // Long rows become one series per value of `by`; AI models are named as the screens name them.
  const long = agent.reportRows({ cells: [{ attribute: 'Price', brand: 'Acme', score: 7 }, { attribute: 'Price', brand: 'Rival', score: 5 }, { attribute: 'Speed', brand: 'Acme', score: 9 }] }, { tool: 'get_semantic_branding', rows: 'cells', x: 'attribute', by: 'brand', series: [{ key: 'score', label: 'Score' }] });
  assert.deepEqual(long, [{ x: 'Price', Acme: 7, Rival: 5 }, { x: 'Speed', Acme: 9 }]);
  assert.deepEqual(agent.reportRows({ engines: [{ engine: 'chat_gpt', withProducts: 3 }] }, { tool: 'get_products', rows: 'engines', x: 'engine', series: [{ key: 'withProducts', label: 'Answers' }] }), [{ x: 'ChatGPT', Answers: 3 }]);
  assert.throws(() => agent.reportRows(answer, { tool: 'compare_brands', rows: 'brands', x: 'name', series: [{ key: 'v', label: 'V' }] }), /not a list.*its lists: topics/);
  assert.throws(() => agent.reportRows(answer, { tool: 'compare_brands', rows: 'topics', x: 'name', series: [{ key: 'v', label: 'V' }] }), /no number at v.*fields: name, cells, attributes/);
  // A chart over its rows follows the chart rules: a line over days, otherwise bars.
  assert.equal(agent.liveChart({ shape: 'line' }, [{ x: 'Acme', V: 1 }], 'T').type, 'bar');
  assert.deepEqual(agent.liveChart({ shape: 'donut' }, [{ x: 'Acme', V: 60 }, { x: 'Rival', V: 40 }], 'T').data, [{ x: 'Acme', value: 60 }, { x: 'Rival', value: 40 }]);
  // Bounded: a read tool of the list only, its project and period the block's, 1 to 8 series.
  assert.equal(agent.readLiveBlock({ data: 'report', tool: 'get_response', x: 'name', series: [{ key: 'v', label: 'V' }] }), null);
  assert.equal(agent.readLiveBlock({ data: 'report', tool: 'compare_brands', x: 'name', series: [] }), null);
  assert.deepEqual(agent.readLiveBlock({ data: 'report', tool: 'compare_brands', args: { project: 'p2', days: 7, engines: ['gemini'] }, x: 'name', series: [{ key: 'visibility', label: 'Visibility' }], id: 'b_123abc' }), {
    id: 'b_123abc', data: 'report', shape: 'bar', period: { days: 28 }, tool: 'compare_brands', args: { engines: ['gemini'] }, x: 'name', series: [{ key: 'visibility', label: 'Visibility' }],
  });

  const { sqlite } = setup();
  const reads = [];
  globalThis.fixture.route = (method, routePath) => {
    reads.push(routePath);
    return { platforms: [{ name: 'Acme', visibility: 42.04, shareOfVoice: 30 }, { name: 'Rival', visibility: 20, shareOfVoice: null }], topics: [] };
  };
  const turn = await agent.openTurn((await conversation()).id, {});
  const block = { data: 'report', tool: 'compare_brands', args: { engines: ['gemini'], topic: 'CRM' }, period: { days: 7 }, rows: 'platforms', x: 'name', series: [{ key: 'visibility', label: 'Visibility' }, { key: 'shareOfVoice', label: 'Share of voice' }], unit: '%' };
  const made = (await agent.saveArtifact(turn, { title: 'Brands', kind: 'report', content: `\`\`\`live\n${JSON.stringify(block)}\n\`\`\`` })).artifact;
  const stored = JSON.parse(/```live\n(.*)\n```/.exec(sqlite.prepare('SELECT content FROM agent_artifacts WHERE id=?').get(made.id).content)[1]);
  assert.deepEqual(stored.snapshot, [{ x: 'Acme', Visibility: 42, 'Share of voice': 30 }, { x: 'Rival', Visibility: 20, 'Share of voice': null }]);
  const query = new URL(reads[0], 'https://app.test').searchParams;
  assert.deepEqual([query.get('view'), query.get('project'), query.get('days'), query.get('engine'), query.getAll('topic')], ['competitors', 'p1', '7', 'gemini', ['CRM']]);

  // What Lastfind cannot draw comes back to the model, and nothing is saved.
  const count = () => sqlite.prepare('SELECT COUNT(*) n FROM agent_artifacts').get().n;
  const before = count();
  const refused = async (content) => (await agent.saveArtifact(turn, { title: 'Bad', kind: 'report', content })).error;
  assert.match((await refused(`\`\`\`live\n${JSON.stringify({ ...block, rows: 'brands' })}\n\`\`\``)).message, /Nothing was saved.*not a list.*its lists: platforms, topics/);
  assert.match((await refused(`\`\`\`live\n${JSON.stringify({ ...block, args: { engines: ['nope'] } })}\n\`\`\``)).message, /args of compare_brands: engines/);
  assert.match((await refused(`\`\`\`live\n${JSON.stringify({ ...block, shape: 'donut', rows: 'platforms', series: [{ key: 'visibility', label: 'V' }], limit: 20 })}\n\`\`\`\n\n\`\`\`chart\n{"type":"pie"}\n\`\`\``)).message, /block 2 \(chart\) cannot be drawn/);
  assert.match((await refused('```metrics\n[]\n```')).message, /block 1 \(metrics\)/);
  assert.equal(count(), before);
  // The same check on a section change.
  assert.equal((await agent.patchArtifact(turn, { id: made.id, mode: 'append', content: '```live\n{"data":"report","tool":"get_products","x":"name","series":[{"key":"answers","label":"Answers"}],"rows":"stores"}\n```' })).error.code, 'invalid_argument');
});

test('a live connection needs a fresh ticket for that very conversation, carried by a cookie for its path only', async () => {
  setup();
  const chat = await conversation();
  const { ticket, expires } = await agent.agentTicket(owner, chat.id);
  const [at, nonce] = ticket.split('.');
  assert.deepEqual(await agent.agentTicketValid(chat.id, ticket), { nonce, expires });
  assert.equal(Number(at), expires);
  assert.equal(await agent.agentTicketValid((await conversation()).id, ticket), null);
  assert.equal(await agent.agentTicketValid(chat.id, `${ticket.slice(0, -2)}xx`), null);
  assert.equal(await agent.agentTicketValid(chat.id, ticket.replace(nonce, 'A'.repeat(22))), null, 'the nonce is signed');
  assert.equal(await agent.agentTicketValid(chat.id, `${Date.now() - 1}.${ticket.split('.').slice(1).join('.')}`), null);
  assert.equal(await agent.agentTicketValid(chat.id, null), null);
  // Each ticket has its own nonce (the agent spends it on the first connection).
  assert.notEqual((await agent.agentTicket(owner, chat.id)).ticket.split('.')[1], nonce);
  // The cookie: HttpOnly, this conversation's live path only, gone in two minutes; read back from a request.
  const cookie = agent.agentTicketCookie(chat.id, ticket);
  assert.equal(cookie, `lf_agent_live=${ticket}; Path=/agent-live/${chat.id}; HttpOnly; Secure; SameSite=Strict; Max-Age=120`);
  assert.equal(agent.agentTicketOf(new Request('https://app.example.test/agent-live/x', { headers: { Cookie: `a=1; lf_agent_live=${ticket}; b=2` } })), ticket);
  assert.equal(agent.agentTicketOf(new Request('https://app.example.test/agent-live/x?ticket=x')), null, 'never from the URL');
  // Someone else's conversation gets no ticket.
  await assert.rejects(agent.agentTicket(member, chat.id), (error) => error.status === 404);
});

test('a new conversation comes with its first ticket and wakes its agent, in two round trips of the database at most', async () => {
  setup();
  const woken = [];
  globalThis.fixture.agentStub = (id) => (woken.push(id), {});
  // Each D1 call counts; calls that overlap are one round trip (what a far database makes the person wait for).
  const real = globalThis.fixture.db;
  let inflight = 0, trips = 0;
  const slow = (work) => async (...args) => { if (inflight++ === 0) trips++; await new Promise((done) => setTimeout(done, 5)); try { return await work(...args); } finally { inflight--; } };
  const wrap = (statement) => ({ bind: (...values) => wrap(statement.bind(...values)), all: slow(() => statement.all()), first: slow(() => statement.first()), run: slow(() => statement.run()) });
  globalThis.fixture.db = { prepare: (sql) => wrap(real.prepare(sql)), batch: slow((statements) => real.batch(statements)) };
  const id = crypto.randomUUID();
  const created = await agent.createLiveConversation(owner, 'p1', id);
  globalThis.fixture.db = real;
  assert.equal(created.id, id);
  assert.ok(await agent.agentTicketValid(id, created.ticket), 'its ticket opens the connection, no other request');
  assert.equal(created.expires, Number(created.ticket.split('.')[0]));
  assert.ok(trips <= 2, `${trips} round trips`);
  await Promise.all(globalThis.fixture.pending);
  assert.deepEqual(woken, [id], 'its agent wakes meanwhile');
  // Someone else's id, or an account without the agent, gets nothing.
  await assert.rejects(agent.createLiveConversation(member, 'p1', id), (error) => error.status === 404);
  setup({ agentOn: false });
  await assert.rejects(agent.createLiveConversation(owner, 'p1', crypto.randomUUID()), (error) => error.status === 403);
});

test('a conversation opens in one request, its id may be the page\'s, and the list shows which ones still answer', async () => {
  const { sqlite } = setup();
  const transcript = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'How is my visibility?' }] }];
  globalThis.fixture.agentStub = () => ({ transcript: async () => transcript });
  // The page chose the id: asking again returns the same conversation; someone else's id reads as not found.
  const id = crypto.randomUUID();
  const chat = await agent.createConversation(owner, 'p1', id);
  assert.equal(chat.id, id);
  assert.equal((await agent.createConversation(owner, 'p1', id)).id, id);
  await assert.rejects(agent.createConversation(member, 'p1', id), (error) => error.status === 404);
  assert.notEqual((await agent.createConversation(owner, 'p1', 'not-an-id')).id, 'not-an-id');

  await agent.rateAnswer(owner, id, 'm2', 1);
  const opened = await agent.openConversation(owner, id);
  assert.ok(await agent.agentTicketValid(id, opened.ticket));
  assert.equal(opened.expires, Number(opened.ticket.split('.')[0]));
  assert.deepEqual(opened.messages, transcript);
  assert.deepEqual(opened.ratings, { m2: 1 });
  await assert.rejects(agent.openConversation(member, id), (error) => error.status === 404);

  // Its first question names it once the turn gets through, so the list shows it answering; then it is done.
  assert.deepEqual((await agent.listConversations(owner, 'p1')).conversations, []);
  const turn = await agent.openTurn(id, {}, 'How is my visibility?');
  const [listed] = (await agent.listConversations(owner, 'p1')).conversations;
  assert.deepEqual([listed.title, listed.running], ['How is my visibility?', true]);
  await agent.closeTurn(turn, false, 'How is my visibility?');
  assert.equal((await agent.listConversations(owner, 'p1')).conversations[0].running, undefined);
  // A row an eviction left running long ago is not an answer under way.
  sqlite.prepare(`INSERT INTO agent_turns(id,workspace_id,project_id,conversation_id,model,status,reserved_usd,started_at) VALUES('old','owner-1','p1',?,'m','running',0.02,?)`).run(id, new Date(Date.now() - 3_600_000).toISOString());
  assert.equal((await agent.listConversations(owner, 'p1')).conversations[0].running, undefined);
});

test("a decision reaches the conversation's agent; one on nothing waiting is refused", async () => {
  setup();
  const chat = await conversation();
  await agent.decideChange(owner, chat.id, 'actpause_1', true);
  assert.deepEqual(globalThis.fixture.decisions, [{ id: chat.id, execution: 'actpause_1', approve: true }]);
  await assert.rejects(agent.decideChange(owner, chat.id, 'unknown', false), (error) => error.status === 409);
  await assert.rejects(agent.decideChange(owner, chat.id, 'bad id!', true), (error) => error.status === 400);
  await assert.rejects(agent.decideChange(member, chat.id, 'actpause_1', true), (error) => error.status === 404);
});

test('the author rates an answer by its id, takes it back, and nobody else can', async () => {
  setup();
  const chat = await conversation();
  await agent.rateAnswer(owner, chat.id, 'msg-1', 1);
  assert.deepEqual((await agent.readConversation(owner, chat.id)).ratings, { 'msg-1': 1 });
  await agent.rateAnswer(owner, chat.id, 'msg-1', 0);
  assert.deepEqual((await agent.readConversation(owner, chat.id)).ratings, {});
  await assert.rejects(agent.rateAnswer(owner, chat.id, 'msg-1', 5), (error) => error.status === 400);
  await assert.rejects(agent.rateAnswer(owner, chat.id, 'bad id!', 1), (error) => error.status === 400);
  await assert.rejects(agent.rateAnswer(viewer, chat.id, 'msg-1', 1), (error) => error.status === 404);
});

test('search data: the worst case is held first, the reported cost counts, and the supplier is never named', async () => {
  setup();
  const turn = await agent.openTurn((await conversation()).id, {});
  const current = async () => turn;
  const sent = [];
  const send = async (pathname, payload) => (sent.push({ pathname, payload }), [{ status_code: 20000, cost: 0.0025, result: [{ items: [{ type: 'organic', rank_group: 1, title: 'A', url: 'https://a.example/', domain: 'a.example', description: 'DataForSEO snippet' }, { type: 'people_also_ask', items: [{ title: 'Why?' }] }] }] }]);
  const result = await agent.paidRead(current, 0.006, 'serp/google/organic/live/advanced', (each) => ({ keyword: 'séries', location_code: each.project.location_code }), (first) => first, send);
  assert.equal(sent[0].payload[0].location_code, 2076);
  assert.equal(result.items.length, 2);
  assert.equal(turn.spent, 0.0025);

  // A reply that never came may have been billed: it counts at the reserve and is not sent again.
  const lost = await agent.paidRead(current, 0.01, 'x', {}, (first) => first, async () => {
    const error = new Error('timeout');
    error.ambiguous = true;
    throw error;
  });
  assert.equal(lost.error.code, 'unavailable');
  assert.equal(Math.round(turn.spent * 10000) / 10000, 0.0125);
  // A refusal says so without naming anyone; a kind of data the account lacks is "not available here".
  const refused = await agent.paidRead(current, 0.001, 'x', {}, (first) => first, async () => [{ status_code: 40501, status_message: 'DataForSEO: invalid field', cost: 0 }]);
  assert.doesNotMatch(refused.error.message, /data\s*for\s*seo/i);
  assert.equal((await agent.paidRead(current, 0.001, 'x', {}, (first) => first, async () => [{ status_code: 40204, cost: 0 }])).error.message, 'This kind of search data is not available in this installation.');
  // Past the turn's own limit, nothing is sent.
  const before = sent.length;
  assert.equal((await agent.paidRead(current, 5, 'x', {}, (first) => first, send)).error.code, 'limit');
  assert.equal(sent.length, before);
  // Without the account, the tool says the installation has no search data.
  assert.equal((await agent.paidRead(current, 0.001, 'x', {}, (first) => first, null)).error.code, 'unavailable');
});

test('read_page keeps pages per workspace: the same workspace reads again free and dated, another workspace never sees it', async () => {
  setup({ settings: { DATAFORSEO_LOGIN: 'login', DATAFORSEO_PASSWORD: 'password' } });
  const turn = await agent.openTurn((await conversation()).id, {});
  const tools = agent.agentDataTools(async () => turn);
  const originalFetch = globalThis.fetch;
  const paid = [];
  globalThis.fetch = async (url) => {
    paid.push(String(url));
    const page = { header: { primary_content: [{ text: 'Guia de SEO' }] }, main_topic: [{ h_title: 'Passo a passo', level: 2, primary_content: [{ text: 'Texto do guia.' }] }] };
    return Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.005, result: [{ items: [{ page_content: page }] }] }] });
  };
  try {
    const first = await tools.read_page.execute({ url: 'https://guia.example/seo' }, {});
    assert.equal(paid.length, 1);
    assert.match(first.text, /Passo a passo/u);
    assert.equal(first.read_at, undefined, 'read now, paid');
    // The same workspace: from its store, free, with the date it was read (the fragment does not make another page).
    const spent = turn.spent;
    const again = await tools.read_page.execute({ url: 'https://guia.example/seo#top' }, {});
    assert.equal(paid.length, 1, 'not paid again');
    assert.equal(turn.spent, spent);
    assert.equal(again.text, first.text);
    assert.equal(again.read_at, new Date().toISOString().slice(0, 10));
    // Another workspace never learns that this one read the page, nor when: it pays and gets no date.
    const other = { ...turn, actor: { ...turn.actor, workspaceId: 'another-workspace' } };
    const theirs = await agent.agentDataTools(async () => other).read_page.execute({ url: 'https://guia.example/seo' }, {});
    assert.equal(theirs.read_at, undefined, 'no hit across workspaces');
    assert.equal(paid.length, 2);
    // Kept in the workspace search data store for the page time to live; nothing in the account-shared page store.
    const sqlite = globalThis.fixture.sqlite;
    assert.equal(sqlite.prepare("SELECT ROUND(julianday(expires_at)-julianday(read_at)) days FROM search_data WHERE path LIKE 'on_page/%' LIMIT 1").get().days, 30);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM search_data WHERE path LIKE 'on_page/%'").get().n, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM source_pages WHERE url='https://guia.example/seo'").get().n, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('read_page never serves a page from the store shared by accounts (what another account cited, and when)', async () => {
  setup({ settings: { DATAFORSEO_LOGIN: 'login', DATAFORSEO_PASSWORD: 'password' } });
  const turn = await agent.openTurn((await conversation()).id, {});
  const sqlite = globalThis.fixture.sqlite;
  const key = createHash('sha256').update('page:https://citada.example/x').digest('hex');
  sqlite.prepare("INSERT INTO source_pages(url_key,url,status,origin,content_json,fetched_at,expires_at) VALUES(?,'https://citada.example/x','ok','fetch',?,?,?)").run(key, JSON.stringify({ lang: 'pt', title: 'T', text: 'Texto de outra conta.', links: [] }), '2026-01-02T00:00:00.000Z', new Date(Date.now() + 86_400_000).toISOString());
  const originalFetch = globalThis.fetch;
  let paid = 0;
  globalThis.fetch = async () => (paid++, Response.json({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.005, result: [{ items: [{ page_content: { header: { primary_content: [{ text: 'Lido agora.' }] } } }] }] }] }));
  try {
    const read = await agent.agentDataTools(async () => turn).read_page.execute({ url: 'https://citada.example/x' }, {});
    assert.equal(paid, 1);
    assert.equal(read.read_at, undefined);
    assert.match(read.text, /Lido agora/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('search data: the same public request is answered from the workspace store, free and dated; volumes come from the keyword overview', async () => {
  setup({ settings: { DATAFORSEO_LOGIN: 'login', DATAFORSEO_PASSWORD: 'password' } });
  const turn = await agent.openTurn((await conversation()).id, {});
  const tools = agent.agentDataTools(async () => turn);
  const originalFetch = globalThis.fetch;
  const paid = [];
  const replies = {
    'serp/google/organic/live/advanced': () => ({ status_code: 20000, cost: 0.002, result: [{ items: [{ type: 'organic', rank_group: 1, title: 'A', url: 'https://a.example/', domain: 'a.example', description: 'x' }] }] }),
    'dataforseo_labs/google/keyword_overview/live': () => ({ status_code: 20000, cost: 0.01224, result: [{ items: [{ keyword: 'seo guia', keyword_info: { search_volume: 1300, cpc: 1.234, competition: 0.4, competition_level: 'MEDIUM', monthly_searches: [{ year: 2026, month: 10, search_volume: 1200 }] } }] }] }),
    'keywords_data/google_ads/search_volume/live': () => ({ status_code: 20000, cost: 0.09, result: [{ keyword: 'seo guia', search_volume: 1300, cpc: 1.2, competition: 'MEDIUM', monthly_searches: [] }] }),
  };
  let overviewStatus = 20000;
  globalThis.fetch = async (url, init) => {
    const pathname = String(url).replace('https://api.dataforseo.com/v3/', '');
    paid.push({ pathname, payload: JSON.parse(init.body)[0] });
    const task = replies[pathname]();
    if (pathname.includes('keyword_overview') && overviewStatus !== 20000) Object.assign(task, { status_code: overviewStatus, cost: 0, result: null });
    return Response.json({ status_code: 20000, tasks: [task] });
  };
  try {
    const first = await tools.search_results.execute({ keyword: 'guia seo' }, {});
    assert.equal(first.read_at, undefined, 'read now, paid');
    const spent = turn.spent;
    const again = await tools.search_results.execute({ keyword: 'guia seo' }, {});
    assert.equal(paid.length, 1, 'the same request is not paid again');
    assert.equal(turn.spent, spent);
    assert.deepEqual(again.organic, first.organic);
    assert.equal(again.read_at, new Date().toISOString().slice(0, 10));
    // Another country is another request.
    await tools.search_results.execute({ keyword: 'guia seo', country: 'US' }, {});
    assert.equal(paid.length, 2);
    // Another workspace never gets a hit from this one's store (a free, dated answer would tell it what this one searched): it pays.
    const other = { ...turn, actor: { ...turn.actor, workspaceId: 'another-workspace' } };
    const otherTools = agent.agentDataTools(async () => other);
    const theirs = await otherTools.search_results.execute({ keyword: 'guia seo' }, {});
    assert.equal(theirs.read_at, undefined, 'read now, paid: no hit across workspaces');
    assert.equal(paid.length, 3);
    // And the first workspace's own hit is still its own.
    assert.equal((await tools.search_results.execute({ keyword: 'guia seo' }, {})).read_at, new Date().toISOString().slice(0, 10));
    assert.equal(paid.length, 3);
    // Kept per workspace and request (a digest): a day for Google results; no project, account or conversation in the value.
    const sqlite = globalThis.fixture.sqlite;
    assert.deepEqual(sqlite.prepare('PRAGMA table_info(search_data)').all().map((column) => column.name).sort(), ['expires_at', 'path', 'read_at', 'request_key', 'result_json']);
    const row = sqlite.prepare("SELECT ROUND((julianday(expires_at)-julianday(read_at))*24) hours,result_json FROM search_data WHERE path LIKE 'serp/%' LIMIT 1").get();
    assert.equal(row.hours, 24);
    assert.doesNotMatch(row.result_json, new RegExp(`${turn.projectId}|owner-1`));

    // Volumes: the keyword overview, its reserve priced per keyword; a keyword without data has no volume (never 0).
    const volumes = await tools.keyword_volume.execute({ keywords: ['SEO guia ', 'seo guia', 'termo raro'] }, {});
    const sent = paid.at(-1);
    assert.equal(sent.pathname, 'dataforseo_labs/google/keyword_overview/live');
    assert.deepEqual(sent.payload.keywords, ['seo guia', 'termo raro']);
    assert.deepEqual(volumes.keywords, [
      { keyword: 'seo guia', volume: 1300, cpc: 1.23, competition: 'MEDIUM', months: [{ month: '2026-10', volume: 1200 }] },
      { keyword: 'termo raro', volume: null, cpc: null, competition: null, months: [] },
    ]);
    // The same list in another order or case is the same request: kept 30 days.
    const count = paid.length;
    assert.equal((await tools.keyword_volume.execute({ keywords: ['termo raro', 'Seo Guia'] }, {})).read_at, new Date().toISOString().slice(0, 10));
    assert.equal(paid.length, count);
    assert.equal(sqlite.prepare("SELECT ROUND(julianday(expires_at)-julianday(read_at)) days FROM search_data WHERE path LIKE '%keyword_overview%'").get().days, 30);
    // A market the overview refuses falls back to the ads planner's volumes.
    overviewStatus = 40501;
    const fallback = await tools.keyword_volume.execute({ keywords: ['outro termo'] }, {});
    assert.deepEqual(paid.slice(-2).map((call) => call.pathname), ['dataforseo_labs/google/keyword_overview/live', 'keywords_data/google_ads/search_volume/live']);
    assert.equal(fallback.keywords[0].competition, 'MEDIUM');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the search data tools and the skills never name the supplier, a vendor or a separator Lastfind avoids', () => {
  const tools = agent.agentDataTools(async () => ({}));
  assert.deepEqual(Object.keys(tools).sort(), ['backlinks', 'competing_domains', 'keyword_ideas', 'keyword_volume', 'page_audit', 'ranked_keywords', 'read_page', 'search_results']);
  for (const [name, item] of Object.entries(tools)) {
    assert.doesNotMatch(`${name} ${item.description}`, /data\s*for\s*seo|semrush|ahrefs|similarweb|\bapi\b/i, name);
    assert.ok(agent.TOOL_LABELS[name], `${name} has a label`);
  }
  const skills = agent.AGENT_SKILLS;
  assert.ok(skills.length >= 10, `${skills.length} skills`);
  for (const skill of skills) {
    assert.match(skill.name, /^[a-z0-9-]+$/);
    assert.ok(skill.description.length > 20 && skill.description.length <= 400, skill.name);
    assert.ok(['MIT', 'AGPL-3.0-only'].includes(skill.license), skill.name);
    for (const text of [skill.body, ...skill.resources.map((resource) => resource.content)]) {
      assert.doesNotMatch(text, /data\s*for\s*seo|web companion|obsidian|\bnode tools\//i, skill.name);
      assert.doesNotMatch(text, /\u00b7/, `${skill.name} has a middle dot`);
    }
  }
  // A skill's references travel with it.
  assert.ok(skills.find((skill) => skill.name === 'seo-analysis').resources.some((resource) => resource.path.startsWith('references/')));
});

test("the screen reads the agent's messages: questions with files, steps, waiting changes, declines and one answer per question", () => {
  const messages = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Crie o prompt' }, { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AAAA' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'tool-get_overview', toolCallId: 't1', state: 'output-available', input: {}, output: { metrics: {} } },
        { type: 'tool-create_prompts', toolCallId: 't2', state: 'output-available', input: { prompts: [{ text: 'x' }] }, output: { status: 'paused', executionId: 'actpause_1', action: 'create_prompts' } },
        { type: 'text', text: 'Aguardando aprovação.' },
      ],
    },
  ];
  const [question, answer] = messages.map(agent.viewOf);
  assert.deepEqual(question, { id: 'u1', role: 'user', text: 'Crie o prompt', files: [{ url: 'data:image/png;base64,AAAA', mediaType: 'image/png' }] });
  assert.deepEqual(answer.tools.map((step) => [step.name, step.state]), [['get_overview', 'done']]);
  assert.deepEqual(answer.pending, [{ id: 'actpause_1', name: 'create_prompts', args: { prompts: [{ text: 'x' }] } }]);

  const declined = agent.viewOf({ id: 'a2', role: 'assistant', parts: [{ type: 'tool-create_prompts', toolCallId: 't2', state: 'output-available', output: { status: 'rejected', executionId: 'actpause_1', reason: 'The person declined this change.' } }] });
  assert.deepEqual(declined.tools.map((step) => step.state), ['declined']);
  const written = agent.viewOf({ id: 'a3', role: 'assistant', metadata: { stopped: 'spend' }, parts: [{ type: 'tool-create_artifact', toolCallId: 't3', state: 'output-available', output: { artifact: { id: 'art-1', title: 'R', kind: 'report', updated_at: 'x' } } }, { type: 'text', text: 'Pronto.' }] });
  assert.equal(written.artifacts[0].id, 'art-1');
  assert.equal(written.stopped, 'spend');
  // The approved change continues the same answer.
  const merged = agent.oneAnswerPerQuestion([question, declined, written]);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].id, 'a3');
  assert.deepEqual(merged[1].tools.map((step) => step.name), ['create_prompts', 'create_artifact']);
  assert.equal(agent.parkedExecution({ status: 'rejected', executionId: 'x' }), null);
  assert.equal(agent.userQuestion(messages), 'Crie o prompt');
});

test("a step's summary and detail come from what it asked and found, short, in plain words, never naming the supplier", () => {
  const pt = (en, ptText) => ptText;
  const en = (text) => text;
  const [question, answer] = [
    { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Escreva' }] },
    {
      id: 'a',
      role: 'assistant',
      parts: [
        { type: 'tool-read_page', toolCallId: 'r', state: 'output-available', input: { url: 'https://www.a.example/guia/' }, output: { url: 'https://www.a.example/guia/', words: { running: 1700, total: 1840 }, text: '# Guia\n\nTexto.\n\n## Preço' } },
        { type: 'tool-search_results', toolCallId: 's', state: 'output-available', input: { keyword: 'guia' }, output: { organic: [{ position: 1, title: 'A', url: 'https://a.example/', domain: 'a.example' }], people_also_ask: ['Quanto custa?'] } },
        { type: 'tool-read_page', toolCallId: 'e', state: 'output-error', input: { url: 'https://b.example/' }, output: { error: { message: 'DataForSEO refused it' } } },
        { type: 'tool-get_overview', toolCallId: 'g', state: 'input-available', input: { project: 'p1', days: 28 } },
      ],
    },
  ].map(agent.viewOf);
  assert.equal(question.role, 'user');
  const [page, search, failed, running] = answer.tools;
  assert.equal(agent.stepSummary(page, pt, 'pt-BR'), 'a.example/guia, 1.840 palavras');
  assert.equal(agent.stepSummary(search, en, 'en'), '“guia”, 1 result, 1 question');
  assert.doesNotMatch(agent.stepSummary(failed, en, 'en'), /data\s*for\s*seo/i);
  assert.equal(running.state, 'running');
  assert.equal(agent.stepSummary(running, en, 'en'), 'Last 28 days');
  assert.ok(agent.stepSummary({ name: 'remember', state: 'done', input: { text: 'x'.repeat(500) } }, en, 'en').length <= agent.STEP_SUMMARY_MAX);
  const detail = agent.stepDetail(page, pt, 'pt-BR');
  assert.deepEqual(detail.facts.map((fact) => fact.value), ['a.example/guia', '1.700', '1.840']);
  assert.deepEqual(detail.lists[0].items.map((item) => item.text), ['Guia', 'Preço']);
  assert.equal(agent.stepDetail(search, en, 'en').lists[0].items[0].href, 'https://a.example/');
});

test('charts and key figures are read from the answer; an invalid block stays as written and one still arriving waits', () => {
  const { splitBlocks, readChart, tidy } = agent;
  const chart = { type: 'bar', title: 'By AI model', unit: '%', series: [{ key: 'v', label: 'Visibility' }], data: [{ x: 'ChatGPT', v: 92.5 }, { x: 'Gemini', v: '88' }] };
  const text = ['Intro', '```chart', JSON.stringify(chart), '```', '```metrics', '[{"label":"Visibility","value":"87.5%","delta":"+3 pp"}]', '```', '```chart', '{not json}', '```', '```chart', '{"type":'].join('\n');
  assert.deepEqual(splitBlocks(text).map((block) => block.kind), ['markdown', 'chart', 'metrics', 'markdown', 'pending']);
  // A value written as a string is not a number: not measured.
  assert.deepEqual(readChart(chart).data[1], { x: 'Gemini', v: null });
  // A line over things that are not days reads as bars; a donut needs no series.
  assert.equal(readChart({ ...chart, type: 'line' }).type, 'bar');
  assert.equal(readChart({ type: 'donut', data: [{ x: 'Editorial', value: 55 }] }).series[0].key, 'value');
  assert.equal(readChart({ type: 'pie', data: [{ x: 'a', value: 1 }] }), null);
  assert.equal(tidy('# Netflix | Report\n| a | b |\nx \u00b7 y'), '# Netflix: Report\n| a | b |\nx, y');
});

test('the agent migrations are the same SQL in both editions', () => {
  // The public snapshot has no Cloud edition to compare with.
  const cloud = path.join(root, 'apps', 'cloud', 'drizzle');
  if (!existsSync(cloud)) return;
  for (const [selfhost, cloudName] of [['0049_agent.sql', '0051_agent.sql'], ['0050_agent_ceiling.sql', '0052_agent_ceiling.sql'], ['0051_agent_feedback.sql', '0053_agent_feedback.sql'], ['0052_agent_live.sql', '0054_agent_live.sql'], ['0053_agent_artifact_editing.sql', '0055_agent_artifact_editing.sql'], ['0055_agent_contents_brain.sql', '0057_agent_contents_brain.sql'], ['0058_agent_artifact_parts.sql', '0060_agent_artifact_parts.sql'], ['0061_agent_content_overview.sql', '0063_agent_content_overview.sql'], ['0062_agent_skills_memory.sql', '0064_agent_skills_memory.sql'], ['0070_agent_skill_lifecycle.sql', '0072_agent_skill_lifecycle.sql'], ['0073_agent_artifact_document.sql', '0078_agent_artifact_document.sql']])
    assert.equal(readFileSync(path.join(root, 'apps/selfhost/drizzle', selfhost), 'utf8'), readFileSync(path.join(cloud, cloudName), 'utf8'), selfhost);
});

test('the document kind: the rebuilt table keeps every artifact of every kind, Brain and Memory files, their columns and indexes', () => {
  const dir = path.join(root, 'apps/selfhost/drizzle');
  const names = readdirSync(dir).filter((n) => n.endsWith('.sql')).sort();
  const at = names.indexOf('0073_agent_artifact_document.sql');
  assert.ok(at > 0);
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of names.slice(0, at)) sqlite.exec(readFileSync(path.join(dir, name), 'utf8'));
  const columns = 'id,owner_id,project_id,conversation_id,title,kind,content,share_token,created_at,updated_at,deleted_at,version,live,updated_by,brain,outline,research,overview,memory';
  const rows = [
    ['a-report', 'o1', 'p1', 'c1', 'Report', 'report', '# R', 'share-1', '2026-10-01', '2026-10-02', null, 3, 1, 'agent', 0, '', '', '', 0],
    ['a-table', 'o1', 'p1', null, 'Table', 'table', '| a |', null, '2026-10-01', '2026-10-03', null, 1, 1, 'o1', 0, '', '', '', 0],
    ['a-brief', 'o1', 'p1', 'c2', 'Brief', 'brief', 'Brief.', null, '2026-10-01', '2026-10-04', '2026-10-05', 2, 0, null, 0, '', '', '', 0],
    ['a-content', 'o1', 'p1', 'c3', 'Article', 'content', 'Text.', 'share-2', '2026-10-01', '2026-10-06', null, 7, 0, 'agent', 0, '## Outline', '## Research', '{"analysis":true}', 0],
    ['a-brain', 'o1', 'p1', null, 'Audience', 'brief', '## Audience', null, '2026-10-01', '2026-10-07', null, 1, 0, 'o1', 1, '', '', '', 0],
    ['a-memory', 'o1', 'p1', null, 'Memory', 'brief', '- a fact', null, '2026-10-01', '2026-10-08', null, 4, 0, 'agent', 1, '', '', '', 1],
    ['a-memory-old', 'o1', 'p1', null, 'Memory', 'brief', '- old', null, '2026-10-01', '2026-10-08', '2026-10-09', 1, 0, null, 1, '', '', '', 1],
  ];
  const insert = sqlite.prepare(`INSERT INTO agent_artifacts(${columns}) VALUES(${columns.split(',').map(() => '?').join(',')})`);
  for (const row of rows) insert.run(...row);
  const read = () => sqlite.prepare(`SELECT ${columns} FROM agent_artifacts ORDER BY id`).all().map((row) => ({ ...row }));
  const before = read();
  assert.throws(() => insert.run('a-doc', 'o1', 'p1', null, 'Notes', 'document', 'x', null, 'd', 'd', null, 1, 0, null, 0, '', '', '', 0), /CHECK/);
  const indexes = () => sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='agent_artifacts' AND sql IS NOT NULL ORDER BY name").all().map((row) => ({ ...row }));
  const indexesBefore = indexes();
  const migration = readFileSync(path.join(dir, names[at]), 'utf8');
  sqlite.exec(migration);
  assert.deepEqual(read(), before);
  assert.deepEqual(indexes(), indexesBefore);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  // The new kind is accepted; anything else and the old rules still are refused.
  insert.run('a-doc', 'o1', 'p1', null, 'Notes', 'document', 'x', null, 'd', 'd', null, 1, 0, null, 0, '', '', '', 0);
  assert.throws(() => insert.run('a-bad', 'o1', 'p1', null, 'x', 'memo', 'x', null, 'd', 'd', null, 1, 0, null, 0, '', '', '', 0), /CHECK/);
  assert.throws(() => insert.run('a-share', 'o1', 'p2', null, 'x', 'document', 'x', 'share-1', 'd', 'd', null, 1, 0, null, 0, '', '', '', 0), /UNIQUE/);
  assert.throws(() => insert.run('a-memory-2', 'o1', 'p1', null, 'Memory', 'brief', 'x', null, 'd', 'd', null, 1, 0, null, 1, '', '', '', 1), /UNIQUE/);
  // Defaults of the columns added over time still apply.
  sqlite.prepare("INSERT INTO agent_artifacts(id,owner_id,project_id,title,kind,content,created_at,updated_at) VALUES('a-min','o1','p1','x','document','','d','d')").run();
  assert.deepEqual({ ...sqlite.prepare("SELECT version,live,brain,memory,outline,research,overview FROM agent_artifacts WHERE id='a-min'").get() }, { version: 1, live: 0, brain: 0, memory: 0, outline: '', research: '', overview: '' });
  // The rest of the sequence still applies on top.
  for (const name of names.slice(at + 1)) sqlite.exec(readFileSync(path.join(dir, name), 'utf8'));
  sqlite.close();
});

/** A ZIP as Office writes one (deflated entries); the reader does not check CRCs, so they stay 0. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(text));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

test('an attached file reaches the agent as its text: Word, Excel, PowerPoint and plain text; binary stays out', async () => {
  const docx = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Título &amp; resumo</w:t></w:r></w:p><w:p><w:r><w:t>Linha</w:t><w:tab/><w:t>dois</w:t></w:r></w:p></w:body></w:document>' });
  assert.equal(await agent.documentText(docx), 'Título & resumo\nLinha\tdois');
  const xlsx = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Palavras" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>keyword</t></si><si><t>volume</t></si><si><r><t>geo </t></r><r><t>ai</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"/><c r="C2"><v>1200</v></c></row></sheetData></worksheet>',
  });
  assert.equal(await agent.documentText(xlsx), '# Palavras\nkeyword\tvolume\ngeo ai\t\t1200');
  const pptx = zip({ 'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>Fim</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Começo</a:t></a:r></a:p></p:sld>' });
  assert.equal(await agent.documentText(pptx), '# Slide 1\nComeço\n\n# Slide 2\nFim');
  // A ZIP of something else, and bytes that are not a ZIP.
  assert.equal(await agent.documentText(zip({ 'photo.jpg': 'x' })), null);
  assert.equal(await agent.documentText(new TextEncoder().encode('a,b')), null);
  assert.equal(agent.plainText(new TextEncoder().encode('palavra,volume\nseo,10')), 'palavra,volume\nseo,10');
  assert.equal(agent.plainText(Uint8Array.from([0x61, 0xe7, 0xe3, 0x6f])), 'ação');
  assert.equal(agent.plainText(Uint8Array.from([0x89, 0x50, 0x00, 0x47])), null);

  // The model reads images and PDFs as they are, a text file as text under its name, and nothing else.
  const text = agent.textFile('notas.txt', 'Olá, mundo');
  const long = agent.textFile('grande.csv', 'x'.repeat(150_000));
  const [message] = agent.readableFiles([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Leia' },
        { type: 'file', mediaType: 'image/jpeg', data: { type: 'url', url: new URL('data:image/jpeg;base64,AAAA') } },
        { type: 'file', mediaType: 'application/pdf', filename: 'r.pdf', data: { type: 'url', url: new URL('data:application/pdf;base64,AAAA') } },
        { type: 'file', mediaType: 'text/plain', filename: 'notas.txt', data: { type: 'url', url: new URL(text.url) } },
        { type: 'file', mediaType: 'text/plain', filename: 'grande.csv', data: { type: 'url', url: new URL(long.url) } },
        { type: 'file', mediaType: 'application/zip', filename: 'a.zip', data: { type: 'url', url: new URL('data:application/zip;base64,AAAA') } },
      ],
    },
  ]);
  assert.deepEqual(message.content.map((part) => part.mediaType ?? part.text.split('\n')[0]), ['Leia', 'image/jpeg', 'application/pdf', 'Attached file "notas.txt":', 'Attached file "grande.csv":']);
  assert.equal(message.content[3].text, 'Attached file "notas.txt":\n\nOlá, mundo');
  assert.match(message.content[4].text, /only its first 100000 characters were attached\.\]$/);
});

