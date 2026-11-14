// The Semantic Branding panel collection and its API, in both editions, on the real migrations of each edition (an in-memory SQLite
// with every migration applied) and the real edition policy (plans, budget ceilings). The provider (DataForSEO: the interface scrapers and
// the reading of an answer in prose) is a fake `fetch`: no paid call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const core = `${root}packages/core/`;

const BRANDS = [{ name: 'Netflix', domain: 'netflix.com' }, { name: 'Prime Video', domain: 'primevideo.com' }, { name: 'Disney+', domain: 'disneyplus.com' }];
const ATTRIBUTES = [{ id: 'value', name: 'Value for money' }, { id: 'films', name: 'Film selection' }, { id: 'series', name: 'Series and originals' }];
const ENGINES = ['chat_gpt', 'gemini', 'claude', 'perplexity', 'google_ai_mode', 'google_ai_overviews'];
const BASE = { chat_gpt: 70, gemini: 80, claude: 75, perplexity: 72, google_ai_mode: 65, google_ai_overviews: 60 };
// Since 8/11/2026 a round asks every AI the project monitors, once each, the way its daily collection does: ChatGPT and Gemini (LLM Scraper),
// AI Mode and AI Overviews (one search per group of at most five brands: one here) on the queue, Claude and Perplexity on the Live endpoint.
// The project here monitors all six AIs.
const INTERFACES = ENGINES;
// Perplexity answers Live; Claude goes through the Standard queue, as its daily collection (8/11/2026).
const LIVE = ['perplexity'];
const QUERIES = INTERFACES.length;
/** Notes of a round here: every interface but AI Overviews, which shows no AI block unless a test gives it one. */
const NOTES = (QUERIES - 1) * BRANDS.length * ATTRIBUTES.length;

function d1(sqlite) {
  const prepare = (sql, params = []) => ({
    sql, params,
    bind: (...values) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
  });
  return {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => /^\s*SELECT/i.test(statement.sql)
          ? { results: sqlite.prepare(statement.sql).all(...statement.params).map((row) => ({ ...row })), meta: { changes: 0 } }
          : { meta: { changes: sqlite.prepare(statement.sql).run(...statement.params).changes } });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

const extensions = ['.ts', '.tsx', '.mjs', '/index.ts'];
const fixtures = {
  env: `export const db=()=>globalThis.panel.control; export const now=()=>globalThis.panel.stamp;
    export const setting=(key)=>globalThis.panel.settings[key] ?? '';`,
  // Cloud policy loads its operators lazily; the collection never calls them.
  empty: `export {};`,
  http: `export class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }`,
  workspace: `import { ApiError } from './http';
    export async function ownedProject(id,userId){ const p=await globalThis.panel.control.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived=0').bind(id,userId).first(); if(!p) throw new ApiError(404,'Projeto não encontrado.'); return p; }`,
  semantic: `export const configurationStatement=(projectId)=>globalThis.panel.control.prepare('SELECT revision,configuration_json FROM semantic_configurations WHERE project_id=? ORDER BY revision DESC LIMIT 1').bind(projectId);
    export const configurationOf=(row)=>row ? { revision: row.revision, ...JSON.parse(row.configuration_json) } : { revision: 0, enabled: false, attributes: [] };
    export async function semanticConfiguration(projectId){ const row=await globalThis.panel.control.prepare('SELECT revision,configuration_json FROM semantic_configurations WHERE project_id=? ORDER BY revision DESC LIMIT 1').bind(projectId).first();
    return row ? { revision: row.revision, ...JSON.parse(row.configuration_json) } : { revision: 0, enabled: false, attributes: [] }; }`,
};
/** Set by `sixAis`: the bundle takes every AI as collected (SCRAPED_ENGINES is all of ENGINES). */
let allEngines = false;
async function load(edition, entry) {
  const result = await build({
    absWorkingDir: root, entryPoints: [`${core}${entry}`], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{
      name: 'panel-bindings',
      setup(plugin) {
        plugin.onResolve({ filter: /^(\.\/env|@\/lib\/server\/env)$/ }, () => ({ path: 'env', namespace: 'fixture' }));
        plugin.onResolve({ filter: /^\.\/(http|workspace|semantic)$/ }, (args) => (entry.includes('semantic-panel.ts') ? { path: args.path.slice(2), namespace: 'fixture' } : undefined));
        plugin.onResolve({ filter: /^(\.\/(conversion-.*|project-evaluations|evaluations-estimate|brand-reanalysis|notifications|leads)|@\/lib\/server\/(project-runners|operations|project-evaluations|source-classification))$/ }, () => ({ path: 'empty', namespace: 'fixture' }));
        plugin.onResolve({ filter: /^@edition\// }, (args) => ({ path: firstExisting(`${root}apps/${edition}/${args.path.slice(9)}`) }));
        plugin.onResolve({ filter: /^@\// }, (args) => ({ path: firstExisting(`${core}${args.path.slice(2)}`) }));
      },
    }, { name: 'all-engines', setup(plugin) {
      plugin.onLoad({ filter: /packages\/core\/lib\/engines\.ts$/ }, (args) => (allEngines
        ? { contents: readFileSync(args.path, 'utf8').replace(/export const SCRAPED_ENGINES = [^;]+;/, 'export const SCRAPED_ENGINES = ENGINES;'), loader: 'ts' }
        : undefined));
    } }, { name: 'fixtures', setup(plugin) { plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtures[args.path], loader: 'js', resolveDir: `${core}lib/server` })); } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}
const firstExisting = (base) => [base, ...extensions.map((extension) => base + extension)].find((path) => /\.(ts|tsx|mjs)$/.test(path) && existsSync(path)) ?? base;

function database(edition) {
  const sqlite = new DatabaseSync(':memory:');
  const directory = `${root}apps/${edition}/drizzle/`;
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(directory + file, 'utf8'));
  return sqlite;
}
// Most tests read weekly periods: the project chose weekly (since 3/11/2026 a project that never chose is daily).
function seed(sqlite, { competitors = BRANDS.slice(1), engines = ENGINES, enabled = true, unlimited = true, language = 'en', frequency = 'weekly' } = {}) {
  // `engines`: the AIs the project monitors (its engines_json), which Semantic Branding follows since 6/11/2026.
  sqlite.exec(`INSERT INTO accounts(id,email,name,created_at) VALUES('owner','o@test','Owner','2026-10-01T00:00:00.000Z'),('other','x@test','Other','2026-10-01T00:00:00.000Z')`);
  if (unlimited && sqlite.prepare('PRAGMA table_info(workspaces)').all().some((column) => column.name === 'plan_override')) sqlite.exec("UPDATE workspaces SET plan_override='unlimited' WHERE id='owner'");
  sqlite.prepare(`INSERT INTO projects(id,workspace_id,name,domain,competitors_json,category,engines_json,language_code,location_code,daily_enabled,created_at) VALUES('p','owner','Netflix','netflix.com',?,'streaming services',?,?,2840,1,'2026-10-01T00:00:00.000Z')`)
    .run(JSON.stringify(competitors), JSON.stringify(engines), language);
  engines.forEach((engine, at) => sqlite.prepare(`INSERT INTO prompts(id,project_id,text,engine,created_at) VALUES(?,?,?,?,'2026-10-01T00:00:00.000Z')`).run(`q${at}`, 'p', 'Best streaming?', engine));
  sqlite.prepare(`INSERT INTO semantic_configurations(project_id,workspace_id,revision,configuration_json,created_at) VALUES('p','owner',1,?,'2026-10-01T00:00:00.000Z')`)
    .run(JSON.stringify({ enabled, attributes: ATTRIBUTES }));
  if (frequency) sqlite.prepare("INSERT INTO semantic_panel_settings(project_id,workspace_id,frequency,updated_at) VALUES('p','owner',?,'2026-10-01T00:00:00.000Z')").run(frequency);
}

const reply = (engine, brands = [BRANDS[0], ...BRANDS.slice(1)]) => JSON.stringify({
  brands: brands.map((brand, b) => ({ brand: brand.name, attributes: ATTRIBUTES.map((attribute, a) => ({ id: attribute.id, score: BASE[engine] - b * 5 + a, justification: `${brand.name} is known for it.`, evidence: ['Won 3 Emmys in 2025.', 'Ranked first by JustWatch.'] })) })),
});
// The short form AI Mode is asked (10/11/2026): `[score, "fact"]` for each note.
const short = (engine) => JSON.stringify(Object.fromEntries(BRANDS.map((brand, b) => [brand.name, Object.fromEntries(ATTRIBUTES.map((attribute, a) => [attribute.id, [BASE[engine] - b * 5 + a, "Won 3 Emmys in 2025."]]))])));
/** Moves the clock the tick measures its budget with (Date.now), as a slow provider would. */
let skew = 0;
const realNow = Date.now;
Date.now = () => realNow() + skew;
const engineOf = (path) => (path.startsWith('serp/google/ai_mode') ? 'google_ai_mode' : path.startsWith('serp/google/organic') ? 'google_ai_overviews' : path.split('/')[1]);

/**
 * A fake DataForSEO (the interface scrapers and the reading of an answer in prose). `broken` engines are refused (40501, a fee), `lost`
 * engines never answer, `none` engines found no results, `slow` moves the clock by that many ms on every POST, `text` replaces an
 * interface's answer (ChatGPT and Gemini answer the full JSON, AI Mode the short one), AI Overviews shows no block unless `overview` (a
 * string is its prose), `reading` replaces the reply of the call that reads an answer in prose, `cost` is what that reading costs,
 * `postCost` what a scraper's task costs and `references` the sources of a Google AI block.
 */
function provider({ broken = [], lost = [], none = [], text = null, overview = false, reading = null, cost = 0.01, postCost = 0.004, liveCost = 0.004, slow = 0, references = null } = {}) {
  const calls = [];
  const task = (patch) => new Response(JSON.stringify({ status_code: 20000, tasks: [{ id: 'job', status_code: 20000, status_message: 'Ok.', cost: 0, result: null, ...patch }] }), { status: 200 });
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace('https://api.dataforseo.com/v3/', '');
    const engine = engineOf(path);
    calls.push({ engine, path, method: init.method, payload: init.body ? JSON.parse(init.body)[0] : undefined });
    if (lost.includes(engine)) throw new Error('socket hang up');
    if (init.method === 'POST') skew += slow;
    if (broken.includes(engine) && init.method === 'POST') return task({ status_code: 40501, status_message: 'Invalid Field.', cost: 0.001 });
    const live = (answer) => task({ cost, result: [{ money_spent: 0, model_name: `${engine}-model`, items: [{ type: 'message', sections: [{ type: 'text', text: answer }] }] }] });
    // Claude's and Perplexity's own answer to the panel question (the reading of a prose answer is the Haiku model).
    if (path.endsWith('/live') && JSON.parse(init.body)[0].model_name !== 'claude-haiku-4-5') {
      if (none.includes(engine)) return task({ status_code: 40102, status_message: 'No Search Results.', result: null });
      return task({ cost: liveCost, result: [{ money_spent: liveCost / 2, items: [{ type: 'message', sections: [{ type: 'text', text: typeof text === 'function' ? text(engine) : text ?? reply(engine) }] }] }] });
    }
    if (path.endsWith('/live')) return live((typeof reading === 'function' ? reading(JSON.parse(init.body)[0]) : reading) ?? (typeof text === 'string' ? text : reply('google_ai_overviews')));
    if (path.endsWith('/task_post')) return task({ id: `job-${engine}`, status_code: 20100, status_message: 'Task Created.', cost: postCost });
    // Claude's Standard task: the model's answer, what it spent replacing the advance (the post's cost).
    if (path.includes('/llm_responses/task_get/')) {
      if (none.includes(engine)) return task({ status_code: 40102, status_message: 'No Search Results.', result: null });
      return task({ id: `job-${engine}`, cost: 0, result: [{ money_spent: Math.min(postCost, 0.01), items: [{ type: 'message', sections: [{ type: 'text', text: typeof text === 'function' ? text(engine) : text ?? reply(engine) }] }] }] });
    }
    if (none.includes(engine)) return task({ status_code: 40102, status_message: 'No Search Results.', result: null });
    const answer = typeof text === 'function' ? text(engine) : text ?? (path.includes('/llm_scraper/') ? reply(engine) : short(engine));
    if (path.includes('/llm_scraper/')) return task({ id: `job-${engine}`, result: [{ markdown: answer, sources: [{ url: `https://example.com/${engine}`, title: engine }] }] });
    const items = engine === 'google_ai_overviews' && !overview ? [{ type: 'organic' }] : [{ type: 'ai_overview', markdown: engine === 'google_ai_overviews' && typeof overview === 'string' ? overview : answer, references }];
    return task({ id: `job-${engine}`, result: [{ items }] });
  };
  return calls;
}

/** One tick of the collection; scrapers on the queue are due again at once. */
async function pass(worker, panel, times = 1) {
  let worked = 0;
  for (let at = 0; at < times; at++) {
    panel.control.prepare("UPDATE semantic_panel_queries SET input_json=json_set(input_json,'$.nextPollAt',0) WHERE status='submitted'").run();
    worked += await worker.processSemanticPanels();
  }
  return worked;
}
const rows = (sqlite, sql, ...params) => sqlite.prepare(sql).all(...params).map((row) => ({ ...row }));

// The public repository carries the personal edition only; the commercial one is tested where it exists.
const editions = ['cloud', 'selfhost'].filter((edition) => existsSync(`${root}apps/${edition}/drizzle`));
const cloud = editions.includes('cloud');

for (const edition of editions) {
  async function setup(options, settings = {}, at = '2026-10-14T10:00:00.000Z') {
    const sqlite = database(edition);
    seed(sqlite, options);
    globalThis.panel = { control: d1(sqlite), stamp: at, settings: { DATAFORSEO_LOGIN: 'login', DATAFORSEO_PASSWORD: 'password', ...settings } };
    const worker = await load(edition, 'lib/server/semantic-panel-worker.ts');
    const api = await load(edition, 'lib/server/semantic-panel.ts');
    return { sqlite, worker, api, panel: globalThis.panel, move: (to) => { globalThis.panel.stamp = to; } };
  }

  // Claude and Perplexity are off in the whole app since 8/11/2026 (only scraped AIs, SCRAPED_ENGINES): the tests of a round over all
  // six AIs build the code as if they were on, to keep the dormant paths tested; the test below checks they are never asked.
  const sixAis = (title, run) => test(title, async () => { allEngines = true; try { await run(); } finally { allEngines = false; } });
  test(`${edition}: a project that still monitors Claude and Perplexity asks only the scraped AIs`, async () => {
    const { sqlite, worker, panel } = await setup({ frequency: null });
    const calls = provider();
    await pass(worker, panel, 4);
    assert.deepEqual(rows(sqlite, 'SELECT engine FROM semantic_panel_queries ORDER BY rowid').map((query) => query.engine), ['chat_gpt', 'gemini', 'google_ai_mode', 'google_ai_overviews']);
    assert.ok(calls.every((call) => !['claude', 'perplexity'].includes(call.engine)));
  });

  test(`${edition}: the stored answers read again add the notes an older reader missed, once, and change nothing else`, async () => {
    const { sqlite, worker, panel } = await setup();
    provider({ text: (engine) => (engine === 'gemini' ? reply(engine).replace(/"brand":"([^"]+)"/g, (_, name) => `"brand":"${name} (${BRANDS.find((brand) => brand.name === name).domain})"`) : engine === 'chat_gpt' ? reply(engine) : short(engine)) });
    await pass(worker, panel, 4);
    const total = rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_readings')[0].n;
    // As the older reader left them: Gemini's answer failed with no notes, ChatGPT's lost a note.
    sqlite.exec("DELETE FROM semantic_panel_readings WHERE engine='gemini'");
    sqlite.exec("UPDATE semantic_panel_queries SET status='failed',error='The answer has no readings in the format asked.' WHERE engine='gemini'");
    const chat = rows(sqlite, "SELECT id FROM semantic_panel_queries WHERE engine='chat_gpt'")[0].id;
    sqlite.prepare("DELETE FROM semantic_panel_readings WHERE query_id=? AND brand='Netflix' AND attribute='value'").run(chat);
    sqlite.exec("UPDATE semantic_panel_readings SET score=1 WHERE engine='google_ai_mode'");
    // 12/11/2026: a 0 a reader of an answer in prose stored (its "not covered"; the query keeps its readingKey) goes; a 0 of an answer the AI
    // scored itself (no readingKey) stays.
    // AI Mode's answer as if the reader read it (its query keeps the reading's key).
    const read = rows(sqlite, "SELECT n.query_id,n.brand,n.attribute FROM semantic_panel_readings n WHERE n.engine='google_ai_mode' LIMIT 1")[0];
    sqlite.prepare("UPDATE semantic_panel_queries SET input_json=json_set(input_json,'$.readingKey','k') WHERE id=?").run(read.query_id);
    sqlite.prepare('UPDATE semantic_panel_readings SET score=0 WHERE query_id=? AND brand=? AND attribute=?').run(read.query_id, read.brand, read.attribute);
    sqlite.prepare("UPDATE semantic_panel_readings SET score=0 WHERE query_id=? AND brand='Netflix' AND attribute<>'value'").run(chat);
    const scoredZeros = rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_readings WHERE score=0 AND query_id=?', chat)[0].n;
    assert.ok(scoredZeros > 0);
    // A pure model's answer of before 6/11/2026 without its notes: it no longer counts, so it is not read again.
    sqlite.prepare(`INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,response,requested_at)
      SELECT 'model',round_id,workspace_id,project_id,'claude','llm','anthropic/claude-sonnet-5.5','?','failed',0,0.01,?,requested_at FROM semantic_panel_queries LIMIT 1`).run(reply('chat_gpt'));
    const before = rows(sqlite, "SELECT id,status,error,cost_usd,reserved_usd FROM semantic_panel_queries WHERE engine<>'gemini' ORDER BY id");
    let page = { next: '' }, notes = 0, recovered = 0, pages = 0, cleared = 0;
    do { page = await worker.rereadPanelAnswers({ after: page.next, limit: 2 }); notes += page.notes; recovered += page.recovered; cleared += page.cleared; pages++; } while (page.next);
    assert.ok(pages > 1, 'read page by page');
    assert.equal(recovered, 1, "Gemini's answer is completed again");
    assert.equal(cleared, 1, "the reader's 0 is taken out, once");
    // No 0 is left on the read answer (this fixture's text is JSON, so the reread puts the real note back in its place).
    assert.ok(rows(sqlite, 'SELECT score FROM semantic_panel_readings WHERE query_id=? AND brand=? AND attribute=?', read.query_id, read.brand, read.attribute).every(({ score }) => score > 1));
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_readings WHERE score=0 AND query_id=?', chat)[0].n, scoredZeros, "an AI's own 0 stays");
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_readings')[0].n, total);
    assert.equal(notes, BRANDS.length * ATTRIBUTES.length + 2);
    assert.deepEqual(rows(sqlite, "SELECT status,error FROM semantic_panel_queries WHERE engine='gemini'"), [{ status: 'completed', error: null }]);
    assert.ok(rows(sqlite, "SELECT score FROM semantic_panel_readings WHERE engine='google_ai_mode' AND NOT (query_id=? AND brand=? AND attribute=?)", read.query_id, read.brand, read.attribute).every(({ score }) => score === 1), 'a note already kept is never rewritten');
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_readings WHERE query_id='model'")[0].n, 0);
    assert.deepEqual(rows(sqlite, "SELECT id,status,error,cost_usd,reserved_usd FROM semantic_panel_queries WHERE engine<>'gemini' ORDER BY id"), before, 'no other query, cost or reserve changes');
    // Idempotent: a second pass adds nothing.
    const again = await worker.rereadPanelAnswers({ limit: 200 });
    assert.deepEqual([again.notes, again.recovered, again.cleared, again.next], [0, 0, 0, null]);
  });

  sixAis(`${edition}: a round asks each monitored AI once as its collection does, the next round in the reverse order, keeps notes, reasons, sources and cost, and settles every reserve`, async () => {
    const { sqlite, worker, api, panel, move } = await setup({ frequency: null });
    const calls = provider();
    await pass(worker, panel, 4);
    const [round, ...extra] = rows(sqlite, 'SELECT * FROM semantic_panel_rounds');
    assert.equal(extra.length, 0);
    assert.deepEqual({ day: round.day, frequency: round.frequency, status: round.status, language: round.language_code }, { day: '2026-10-14', frequency: 'daily', status: 'done', language: 'en' });
    assert.deepEqual(JSON.parse(round.roster_json), { brands: BRANDS, attributes: ATTRIBUTES, category: 'streaming services' });
    const queries = rows(sqlite, 'SELECT * FROM semantic_panel_queries ORDER BY rowid');
    // Every AI the project monitors: the interfaces with their own search, Claude as the collection's pure model (no search), Perplexity's Sonar.
    const model = { claude: 'claude-sonnet-5', perplexity: 'sonar' };
    assert.deepEqual(queries.map((query) => [query.engine, query.method, query.web, query.model, query.run]), INTERFACES.map((engine) => [engine, 'scrape', 1, model[engine] ?? engine, 0]));
    const of = (engine) => queries.filter((query) => query.engine === engine);
    for (const engine of ['chat_gpt', 'gemini', 'claude', 'perplexity', 'google_ai_mode']) assert.ok(of(engine).every((query) => query.status === 'completed'), engine);
    assert.deepEqual([...JSON.parse(of('chat_gpt')[0].brand_order_json)].sort(), BRANDS.map((brand) => brand.name).sort());
    // Google shows no AI block for this search: the AI is absent, not failed, and has no zero.
    assert.ok(of('google_ai_overviews').every((query) => query.status === 'absent' && query.error === 'no_answer'));
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_readings')[0].n, NOTES);
    assert.ok(rows(sqlite, 'SELECT score FROM semantic_panel_readings').every(({ score }) => score >= 0 && score <= 100));
    assert.match(of('gemini')[0].question, /Score every brand on every attribute \(streaming services\)/);
    // ChatGPT gets the natural search (12/11/2026): asked the scoring task in JSON it searched but cited nothing.
    assert.match(of('chat_gpt')[0].question, / vs .* streaming services: Value for money, Film selection, Series and originals$/);
    // Settled: nothing stays reserved above what was paid; each interface costs its task (no answer here needed a reading).
    assert.ok(queries.every((query) => query.reserved_usd === query.cost_usd), JSON.stringify(queries.map((query) => [query.engine, query.reserved_usd, query.cost_usd])));
    // The AI Overviews search that showed no AI block gets its async part back (US$ 0.0006, providerResultCost).
    assert.equal(Number(queries.reduce((sum, query) => sum + query.cost_usd, 0).toFixed(6)), Number((QUERIES * 0.004 - 0.0006).toFixed(6)));
    // Every query once: the interfaces and Claude on the provider's queue, Perplexity Live, with the collection's request; nothing goes to OpenRouter.
    assert.ok(calls.every((call) => !call.path.startsWith('openrouter')));
    assert.equal(calls.filter((call) => call.path.endsWith('/task_post')).length, QUERIES - LIVE.length);
    assert.deepEqual(calls.filter((call) => call.path.endsWith('/live')).map((call) => [call.path, call.payload.model_name]),
      [['ai_optimization/perplexity/llm_responses/live', 'sonar']]);
    assert.deepEqual(calls.filter((call) => call.engine === 'claude' && call.method === 'POST').map((call) => [call.path, call.payload.model_name]), [['ai_optimization/claude/llm_responses/task_post', 'claude-sonnet-5']]);
    // The Gemini interface gets the whole question, ChatGPT the natural search; each decides when to search.
    const scraped = calls.find((call) => call.path === 'ai_optimization/gemini/llm_scraper/task_post');
    assert.ok(scraped.payload.keyword.includes('Rate how strongly') && scraped.payload.force_web_search === undefined);
    assert.ok(calls.filter((call) => call.path === 'ai_optimization/chat_gpt/llm_scraper/task_post').every((call) => !/Rate how strongly|JSON/.test(call.payload.keyword) && call.payload.force_web_search === undefined));
    assert.ok(calls.filter((call) => call.method === 'POST').every((call) => JSON.stringify(call.payload).includes('Prime Video') || JSON.stringify(call.payload).includes('Disney')));
    // Blind: nothing in what is sent says which brand is the client's.
    assert.ok(calls.filter((call) => call.method === 'POST').every((call) => !/your brand|client/i.test(JSON.stringify(call.payload))));
    // The next day's round asks each AI in the reverse order of its previous one (run 1); the one after, in a new shuffle (run 0).
    const order = (day) => Object.fromEntries(rows(sqlite, 'SELECT q.engine,q.run,q.brand_order_json FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id WHERE r.day=?', day)
      .map((query) => [query.engine, [query.run, JSON.parse(query.brand_order_json)]]));
    move('2026-10-15T10:00:00.000Z');
    await pass(worker, panel, 4);
    move('2026-10-16T10:00:00.000Z');
    await pass(worker, panel, 4);
    const [first, second, third] = ['2026-10-14', '2026-10-15', '2026-10-16'].map(order);
    assert.deepEqual(Object.keys(second).sort(), [...INTERFACES].sort());
    for (const [engine, [run, names]] of Object.entries(second)) {
      assert.deepEqual([first[engine][0], run, names], [0, 1, [...first[engine][1]].reverse()], engine);
      assert.equal(third[engine][0], 0, engine);
    }
    const thursday = await api.panelEvidence('p', 'owner', new URLSearchParams('brand=Netflix&period=2026-10-15'));
    assert.deepEqual(thursday.evidence.map((item) => [item.engine, item.date]), ['chat_gpt', 'gemini', 'claude', 'perplexity', 'google_ai_mode'].map((engine) => [engine, '2026-10-15']));
    // A reason stored with the reader's message label as its subject ("TEXT identifies…") reads without it.
    sqlite.prepare("UPDATE semantic_panel_readings SET reason='TEXT identifies Netflix as industry leader' WHERE brand='Netflix' AND round_id IN (SELECT id FROM semantic_panel_rounds WHERE day='2026-10-15')").run();
    const reasons = (await api.panelEvidence('p', 'owner', new URLSearchParams('brand=Netflix&period=2026-10-15'))).evidence.flatMap((item) => item.readings.map((reading) => reading.reason));
    assert.ok(reasons.length && reasons.every((reason) => reason === 'Identifies Netflix as industry leader'), JSON.stringify(reasons.slice(0, 3)));
  });

  sixAis(`${edition}: a retried or concurrent tick does not ask twice, and a lost reply is never sent again`, async () => {
    const { sqlite, worker, panel } = await setup();
    const calls = provider({ lost: ['gemini'] });
    await Promise.all([worker.processSemanticPanels(), worker.processSemanticPanels()]);
    await pass(worker, panel, 4);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 1);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_queries')[0].n, QUERIES);
    const lost = rows(sqlite, "SELECT * FROM semantic_panel_queries WHERE engine='gemini'");
    assert.equal(lost.length, 1);
    assert.ok(lost.every((query) => query.status === 'unknown' && /not sent again/.test(query.error)));
    assert.ok(lost.every((query) => query.reserved_usd > 0.02), 'the lost reply stays reserved: it may have been billed');
    assert.equal(calls.filter((call) => call.engine === 'gemini').length, 1);
    assert.equal(calls.filter((call) => call.method === 'POST').length, QUERIES);
    // Later ticks of the same period change nothing and call nothing.
    const before = calls.length;
    await pass(worker, panel, 3);
    assert.equal(calls.length, before);
    assert.equal(rows(sqlite, 'SELECT status FROM semantic_panel_rounds')[0].status, 'done');
  });

  sixAis(`${edition}: an AI that fails or answers outside the format leaves its notes absent, never a zero`, async () => {
    const { sqlite, worker, panel } = await setup();
    provider({ broken: ['gemini'] });
    await pass(worker, panel, 4);
    const failed = rows(sqlite, "SELECT * FROM semantic_panel_queries WHERE engine='gemini'");
    assert.ok(failed.length && failed.every((query) => query.status === 'failed' && /task 40501 Invalid Field/.test(query.error)));
    // Refused at once: its fee is what it cost, and nothing more is held.
    assert.ok(failed.every((query) => query.cost_usd === 0.001 && query.reserved_usd === 0.001));
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_readings WHERE engine='gemini'")[0].n, 0);
    assert.equal(rows(sqlite, 'SELECT COUNT(DISTINCT engine) n FROM semantic_panel_readings')[0].n, 4);
  });

  sixAis(`${edition}: answers outside the format, notes outside 0-100 and unknown brands or attributes are absent`, async () => {
    const { sqlite, worker, panel } = await setup();
    provider({ text: 'I cannot rate brands.' });
    await pass(worker, panel, 4);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_readings')[0].n, 0);
    // An interface's prose is read by one call, which finds no notes in it either; each such AI is asked again, at most twice more.
    const queries = rows(sqlite, "SELECT * FROM semantic_panel_queries WHERE engine<>'google_ai_overviews'");
    assert.ok(queries.every((query) => query.status === 'failed' && /has no notes/.test(query.error) && query.response === 'I cannot rate brands.'));
    assert.equal(new Set(queries.map((query) => query.engine)).size, QUERIES - 1);
    assert.ok(queries.length > QUERIES - 1);
    assert.ok([...new Set(queries.map((query) => query.engine))].every((engine) => queries.filter((query) => query.engine === engine).length <= worker.PANEL_ATTEMPTS));

    const second = await setup();
    provider({ text: JSON.stringify({ brands: [{ brand: 'Netflix', attributes: [{ id: 'value', score: 101 }, { id: 'films', score: -3 }, { id: 'ghost', score: 50 }, { id: 'series', score: 'high' }] }, { brand: 'Nobody', attributes: [{ id: 'value', score: 50 }] }, { brand: 'Disney+', attributes: [{ id: 'value', score: 40, reason: 'ok' }] }] }) });
    await pass(second.worker, second.panel, 4);
    assert.deepEqual(rows(second.sqlite, 'SELECT DISTINCT brand,attribute,score FROM semantic_panel_readings'), [{ brand: 'Disney+', attribute: 'value', score: 40 }]);
  });

  sixAis(`${edition}: the spend cap of the round decides which AIs are asked, and too few means nothing is paid`, async () => {
    const tight = await setup({}, { SEMANTIC_PANEL_ROUND_CAP_USD: '0.001' });
    const calls = provider();
    await pass(tight.worker, tight.panel, 2);
    assert.equal(calls.length, 0);
    const [round] = rows(tight.sqlite, 'SELECT * FROM semantic_panel_rounds');
    assert.equal(round.status, 'done');
    const queries = rows(tight.sqlite, 'SELECT status,error,reserved_usd FROM semantic_panel_queries');
    assert.equal(queries.length, QUERIES);
    assert.ok(queries.every((query) => query.status === 'cancelled' && query.reserved_usd === 0 && /minimum|cap/.test(query.error)));
    assert.equal(rows(tight.sqlite, 'SELECT COUNT(*) n FROM semantic_panel_readings')[0].n, 0);

    // Room for part of the round (each interface reserves about US$ 0.17, its task and three readings): the AIs that fit are asked, the rest is not.
    const some = await setup({}, { SEMANTIC_PANEL_ROUND_CAP_USD: '0.35' });
    const asked = provider();
    await pass(some.worker, some.panel, 3);
    const all = rows(some.sqlite, 'SELECT model,run,status,error,cost_usd FROM semantic_panel_queries');
    const sent = all.filter((query) => query.status !== 'cancelled');
    assert.equal(sent.length, 2);
    assert.ok(all.filter((query) => query.status === 'cancelled').every((query) => /spend cap of the round/.test(query.error)));
    assert.equal(asked.filter((call) => call.method === 'POST').length, sent.length);
  });

  test(`${edition}: the budget of the project stops a round that would pass it, and says so`, async () => {
    const { sqlite, worker, panel, move, api } = await setup();
    // The project's monthly budget (Settings > Monitoring > Budget) replaced Semantic Branding's own US$ 30 a month.
    sqlite.prepare("INSERT INTO project_budgets(project_id,workspace_id,monthly_usd,updated_at,updated_by) SELECT id,workspace_id,5,'2026-10-01','test' FROM projects").run();
    const calls = provider();
    await pass(worker, panel, 4);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 1);
    // The next weekly period of the same month: what the first round spent plus this one's reserve (about US$ 0.20) would pass US$ 5.
    sqlite.exec("UPDATE semantic_panel_queries SET reserved_usd=4.95,cost_usd=4.95 WHERE engine='chat_gpt'");
    move('2026-10-21T10:00:00.000Z');
    const before = calls.length;
    await pass(worker, panel, 2);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 1);
    assert.equal(calls.length, before);
    // The refusal is kept where health, Admin and Settings read it.
    assert.deepEqual(JSON.parse(rows(sqlite, "SELECT value FROM system_state WHERE key LIKE 'budget_blocked:%'")[0].value).reason, 'project_budget');
    // The report says which limit stopped the next round (the page says where to raise it), beside the notes it already has.
    const held = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.deepEqual([held.status, held.blocked], ['ready', { reason: 'project_budget' }]);
    // The budget is monthly: next month it can ask again, and the report no longer says it is stopped.
    move('2026-11-04T10:00:00.000Z');
    await pass(worker, panel, 3);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 2);
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams())).blocked, null);
  });

  test(`${edition}: an admin deletes the history: the next tick asks again today; spend, configuration and other projects stay`, async () => {
    const { sqlite, worker, api, panel } = await setup();
    provider();
    await pass(worker, panel, 4);
    const [old] = rows(sqlite, "SELECT id FROM semantic_panel_rounds WHERE project_id='p'");
    // Another project's round, an older month of this one, a query still waiting and the tick's marks.
    sqlite.exec(`INSERT INTO projects(id,workspace_id,name,domain,competitors_json,category,language_code,location_code,daily_enabled,created_at) VALUES('q','owner','Other','other.com','[]','x','en',2840,1,'2026-10-01T00:00:00.000Z');
      INSERT INTO semantic_panel_rounds(id,workspace_id,project_id,day,frequency,period_start,config_revision,language_code,location_code,roster_json,status,created_at) VALUES
        ('other','owner','q','2026-10-14','weekly','2026-10-12',1,'en',2840,'{}','done','2026-10-14T00:00:00.000Z'),
        ('september','owner','p','2026-09-10','weekly','2026-09-07',1,'en',2840,'{}','done','2026-09-10T00:00:00.000Z');
      INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,requested_at,started_at) VALUES
        ('oq','other','owner','q','claude','llm','m','?','completed',0,0.2,'2026-10-14T00:00:00.000Z','2026-10-14T00:00:00.000Z'),
        ('sq','september','owner','p','claude','llm','m','?','completed',0,0.2,'2026-09-10T00:00:00.000Z','2026-09-10T00:00:00.000Z');
      INSERT INTO semantic_panel_readings(query_id,round_id,project_id,engine,brand,attribute,score) VALUES('oq','other','q','claude','Other','value',70);
      INSERT OR REPLACE INTO system_state(key,value) VALUES('semantic_panel_attempt:p','x'),('semantic_panel_skip:p','y'),('semantic_panel_attempt:q','z');`);
    sqlite.exec(`UPDATE semantic_panel_queries SET status='pending',reserved_usd=0.5,cost_usd=0 WHERE id=(SELECT id FROM semantic_panel_queries WHERE round_id='${old.id}' AND engine='google_ai_overviews' LIMIT 1)`);
    const spend = () => rows(sqlite, "SELECT ROUND(SUM(MAX(cost_usd,reserved_usd)),6) usd FROM semantic_panel_queries WHERE project_id='p' AND started_at>='2026-10-01' AND status NOT IN ('cancelled','pending')")[0].usd;
    const before = spend();
    const other = () => [rows(sqlite, "SELECT * FROM semantic_panel_rounds WHERE project_id='q'"), rows(sqlite, "SELECT * FROM semantic_panel_queries WHERE project_id='q'"), rows(sqlite, "SELECT * FROM semantic_panel_readings WHERE project_id='q'")];
    const untouched = other();
    const configuration = rows(sqlite, "SELECT * FROM semantic_configurations WHERE project_id='p'");

    await worker.resetPanelHistory('p');
    // Notes, answers and the older month are gone; this month's spend stays on a retired round, emptied, that no report reads.
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_readings WHERE project_id='p'")[0].n, 0);
    assert.deepEqual(rows(sqlite, "SELECT id,day,roster_json FROM semantic_panel_rounds WHERE project_id='p'"), [{ id: old.id, day: worker.RETIRED_DAY, roster_json: '{"brands":[],"attributes":[],"category":""}' }]);
    assert.equal(spend(), before);
    assert.deepEqual(rows(sqlite, "SELECT DISTINCT question,response,sources_json FROM semantic_panel_queries WHERE project_id='p'"), [{ question: '', response: null, sources_json: '[]' }]);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries WHERE project_id='p' AND status='pending'")[0].n, 0);
    assert.deepEqual(rows(sqlite, "SELECT key FROM system_state WHERE key LIKE 'semantic_panel_%' ORDER BY key").map((row) => row.key), ['semantic_panel_attempt:q']);
    assert.deepEqual([other(), rows(sqlite, "SELECT * FROM semantic_configurations WHERE project_id='p'")], [untouched, configuration]);
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams())).waiting.reason, 'scheduled');

    // The next tick opens a fresh round the same day, and the report reads it.
    await pass(worker, panel, 4);
    const fresh = rows(sqlite, `SELECT id,day FROM semantic_panel_rounds WHERE project_id='p' AND day<>'${worker.RETIRED_DAY}'`);
    assert.deepEqual(fresh.map((round) => round.day), ['2026-10-14']);
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams())).round.id, fresh[0].id);
    assert.deepEqual(other(), untouched);
  });

  test(`${edition}: the operator prunes the rounds of before the anchored scale: old and mixed rounds go, new ones and the rest stay; a dry run only counts; twice changes nothing (9/11/2026)`, async () => {
    const { sqlite, worker, api, panel, move } = await setup({ frequency: 'daily', engines: ['chat_gpt', 'gemini'] }, {}, '2026-10-12T10:00:00.000Z');
    provider();
    for (const day of ['2026-10-12', '2026-10-13', '2026-10-14']) { move(`${day}T10:00:00.000Z`); await pass(worker, panel, 4); }
    const [old, mixed, fresh] = rows(sqlite, "SELECT id,day FROM semantic_panel_rounds WHERE project_id='p' ORDER BY day");
    assert.deepEqual([old.day, mixed.day, fresh.day], ['2026-10-12', '2026-10-13', '2026-10-14']);
    // Before the anchored scale a settled query kept no `scale`: the whole first round, and one AI of the second (a mixed round).
    sqlite.prepare("UPDATE semantic_panel_queries SET input_json='{}' WHERE round_id=?").run(old.id);
    sqlite.prepare(`UPDATE semantic_panel_queries SET input_json='{"taskId":"job"}' WHERE round_id=? AND engine='chat_gpt'`).run(mixed.id);
    // Project o: old rounds only, in September (no spend this month): one with notes, one whose AIs all failed. Project n: the new scale only
    // (a round with notes, one whose AI failed on it, one still in flight) and a round an earlier history deletion retired.
    const roster = JSON.stringify({ brands: [{ name: 'New', domain: 'new.com' }], attributes: ATTRIBUTES, category: 'x' });
    sqlite.exec(`INSERT INTO projects(id,workspace_id,name,domain,competitors_json,category,language_code,location_code,daily_enabled,created_at) VALUES
        ('o','owner','Old','old.com','[]','x','en',2840,1,'2026-09-01T00:00:00.000Z'),('n','owner','New','new.com','[]','x','en',2840,1,'2026-09-01T00:00:00.000Z');
      INSERT INTO semantic_panel_rounds(id,workspace_id,project_id,day,frequency,period_start,config_revision,language_code,location_code,roster_json,status,created_at) VALUES
        ('o1','owner','o','2026-09-10','daily','2026-09-10',1,'en',2840,'{}','done','2026-09-10T00:00:00.000Z'),
        ('o2','owner','o','2026-09-11','daily','2026-09-11',1,'en',2840,'{}','done','2026-09-11T00:00:00.000Z'),
        ('n1','owner','n','2026-10-12','daily','2026-10-12',1,'en',2840,'${roster}','done','2026-10-12T00:00:00.000Z'),
        ('n2','owner','n','2026-10-13','daily','2026-10-13',1,'en',2840,'${roster}','done','2026-10-13T00:00:00.000Z'),
        ('n3','owner','n','2026-10-14','daily','2026-10-14',1,'en',2840,'${roster}','running','2026-10-14T00:00:00.000Z'),
        ('n4','owner','n','${worker.RETIRED_DAY}','daily','2026-10-01~deleted~n4',1,'en',2840,'{}','done','2026-10-01T00:00:00.000Z');
      INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,input_json,requested_at,started_at) VALUES
        ('o1q','o1','owner','o','chat_gpt','scrape','chat_gpt','?','completed',0.004,0.004,'{}','2026-09-10T00:00:00.000Z','2026-09-10T00:00:00.000Z'),
        ('o2q','o2','owner','o','chat_gpt','scrape','chat_gpt','?','failed',0.004,0.004,'{"taskId":"job"}','2026-09-11T00:00:00.000Z','2026-09-11T00:00:00.000Z'),
        ('n1q','n1','owner','n','chat_gpt','scrape','chat_gpt','?','completed',0.004,0.004,'{"scale":4}','2026-10-12T00:00:00.000Z','2026-10-12T00:00:00.000Z'),
        ('n2q','n2','owner','n','chat_gpt','scrape','chat_gpt','?','failed',0.004,0.004,'{"scale":4}','2026-10-13T00:00:00.000Z','2026-10-13T00:00:00.000Z'),
        ('n3q','n3','owner','n','chat_gpt','scrape','chat_gpt','?','submitted',0.2,0.004,'{"taskId":"job"}','2026-10-14T00:00:00.000Z','2026-10-14T00:00:00.000Z'),
        ('n4q','n4','owner','n','chat_gpt','scrape','chat_gpt','','completed',0.004,0.004,'{}','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
      INSERT INTO semantic_panel_readings(query_id,round_id,project_id,engine,brand,attribute,score) VALUES
        ('o1q','o1','o','chat_gpt','Old','value',80),('n1q','n1','n','chat_gpt','New','value',55);`);
    const stored = (where, ...params) => ['semantic_panel_rounds', 'semantic_panel_queries', 'semantic_panel_readings']
      .map((table) => rows(sqlite, `SELECT * FROM ${table} WHERE ${table === 'semantic_panel_rounds' ? 'id' : 'round_id'} IN (SELECT id FROM semantic_panel_rounds WHERE ${where}) ORDER BY rowid`, ...params));
    const everything = () => stored('1=1');
    const spend = () => rows(sqlite, "SELECT ROUND(SUM(MAX(cost_usd,reserved_usd)),6) usd FROM semantic_panel_queries WHERE project_id='p'")[0].usd;
    const count = (sql, ...params) => rows(sqlite, sql, ...params)[0].n;
    const queries = count('SELECT COUNT(*) n FROM semantic_panel_queries WHERE round_id IN (?,?)', old.id, mixed.id);
    const readings = count('SELECT COUNT(*) n FROM semantic_panel_readings WHERE round_id IN (?,?)', old.id, mixed.id);
    assert.ok(queries >= 4 && readings > 0);
    const before = everything();
    const kept = { fresh: stored('id=?', fresh.id), n: stored("project_id='n'") };
    const paid = spend();
    // p's two old rounds spent this month: their queries stay as the ledger, emptied, on retired rounds. o's go entirely.
    const expected = [
      { projectId: 'o', rounds: { deleted: 2, retired: 0 }, queries: { deleted: 2, emptied: 0 }, readings: { deleted: 1 } },
      { projectId: 'p', rounds: { deleted: 0, retired: 2 }, queries: { deleted: 0, emptied: queries }, readings: { deleted: readings } },
    ];

    // The dry run (the default) counts and changes nothing.
    assert.deepEqual(await worker.prunePanelRounds(), { dryRun: true, all: false, projects: expected });
    assert.deepEqual(everything(), before);
    assert.deepEqual((await worker.prunePanelRounds({ projectId: 'o' })).projects, [expected[0]]);

    assert.deepEqual(await worker.prunePanelRounds({ dryRun: false }), { dryRun: false, all: false, projects: expected });
    assert.deepEqual(rows(sqlite, "SELECT id,day FROM semantic_panel_rounds WHERE project_id='p' ORDER BY created_at").map((row) => row.day), [worker.RETIRED_DAY, worker.RETIRED_DAY, '2026-10-14']);
    assert.equal(count('SELECT COUNT(*) n FROM semantic_panel_readings WHERE round_id IN (?,?)', old.id, mixed.id), 0);
    assert.deepEqual(rows(sqlite, 'SELECT DISTINCT question,response,input_json FROM semantic_panel_queries WHERE round_id IN (?,?)', old.id, mixed.id), [{ question: '', response: null, input_json: '{}' }]);
    assert.equal(spend(), paid, "this month's spend stays counted");
    assert.equal(count("SELECT COUNT(*) n FROM semantic_panel_rounds WHERE project_id='o'") + count("SELECT COUNT(*) n FROM semantic_panel_queries WHERE project_id='o'") + count("SELECT COUNT(*) n FROM semantic_panel_readings WHERE project_id='o'"), 0);
    assert.deepEqual({ fresh: stored('id=?', fresh.id), n: stored("project_id='n'") }, kept, 'the new scale and the retired round are untouched');
    // The report, its periods and evolution, read only the new round.
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.deepEqual([report.round.id, report.periods], [fresh.id, ['2026-10-14']]);

    // Twice: nothing left to prune, nothing changes; the scheduler opens no extra round today.
    const after = everything();
    assert.deepEqual(await worker.prunePanelRounds({ dryRun: false }), { dryRun: false, all: false, projects: [] });
    assert.deepEqual(everything(), after);
    await pass(worker, panel, 2);
    assert.equal(count(`SELECT COUNT(*) n FROM semantic_panel_rounds WHERE project_id='p' AND day<>'${worker.RETIRED_DAY}'`), 1);
  });

  test(`${edition}: a project with only rounds of before the anchored scale is left waiting for its next round, never zeros; that round stays (9/11/2026)`, async () => {
    const { sqlite, worker, api, panel } = await setup({ frequency: 'daily', engines: ['chat_gpt', 'gemini'] });
    provider();
    await pass(worker, panel, 4);
    sqlite.exec("UPDATE semantic_panel_queries SET input_json='{}'");
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams())).status, 'ready');
    const { projects: [pruned] } = await worker.prunePanelRounds({ projectId: 'p', dryRun: false });
    assert.equal(pruned.rounds.retired, 1);
    const waiting = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.deepEqual([waiting.status, waiting.waiting.reason, waiting.scores, waiting.periods], ['waiting', 'scheduled', [], []]);
    // The next tick asks again today, on the anchored scale, and the prune leaves that round alone.
    await pass(worker, panel, 4);
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams())).status, 'ready');
    assert.deepEqual(await worker.prunePanelRounds(), { dryRun: true, all: false, projects: [] });
  });

  test(`${edition}: a round with no AI to show says whether the header's AI filter hides them (13/11/2026)`, async () => {
    const { sqlite, worker, api, panel } = await setup({ frequency: 'daily', engines: ['chat_gpt', 'gemini'] });
    provider();
    await pass(worker, panel, 4);
    const report = (query) => api.panelReport('p', 'owner', new URLSearchParams(query));
    const all = await report('');
    assert.ok(all.round.queries.length > 0);
    assert.equal(all.round.filtered, false);
    // A filter on an AI this round did not ask hides every AI: said as the filter's doing.
    const other = await report('engine=google_ai_mode');
    assert.deepEqual([other.round.queries, other.round.filtered], [[], true]);
    // No filter, and still no AI to show (the project no longer monitors the AIs this round asked): not the filter's doing.
    sqlite.exec(`UPDATE projects SET engines_json='["google_ai_mode"]' WHERE id='p'`);
    const none = await report('');
    assert.deepEqual([none.round.queries, none.round.filtered], [[], false]);
  });

  test(`${edition}: with all, the operator zeroes Semantic Branding: every round of the project goes, this month's spend stays counted, and the next round starts again (10/11/2026)`, async () => {
    const { sqlite, worker, api, panel, move } = await setup({ frequency: 'daily', engines: ['chat_gpt', 'gemini'] }, {}, '2026-10-13T10:00:00.000Z');
    provider();
    for (const day of ['2026-10-13', '2026-10-14']) { move(`${day}T10:00:00.000Z`); await pass(worker, panel, 4); }
    // Both rounds on the current scale: the default prune keeps them.
    assert.deepEqual(await worker.prunePanelRounds({ projectId: 'p' }), { dryRun: true, all: false, projects: [] });
    const spend = () => rows(sqlite, "SELECT ROUND(SUM(MAX(cost_usd,reserved_usd)),6) usd FROM semantic_panel_queries WHERE project_id='p'")[0].usd;
    const paid = spend();
    const counts = (table) => rows(sqlite, `SELECT COUNT(*) n FROM ${table} WHERE project_id='p'`)[0].n;
    const before = ['semantic_panel_rounds', 'semantic_panel_queries', 'semantic_panel_readings'].map(counts);
    const expected = [{ projectId: 'p', rounds: { deleted: 0, retired: 2 }, queries: { deleted: 0, emptied: before[1] }, readings: { deleted: before[2] } }];
    // A dry run by default: counts, changes nothing; another project is not named.
    assert.deepEqual(await worker.prunePanelRounds({ projectId: 'p', all: true }), { dryRun: true, all: true, projects: expected });
    assert.deepEqual(['semantic_panel_rounds', 'semantic_panel_queries', 'semantic_panel_readings'].map(counts), before);
    assert.deepEqual(await worker.prunePanelRounds({ projectId: 'p', all: true, dryRun: false }), { dryRun: false, all: true, projects: expected });
    assert.equal(counts('semantic_panel_readings'), 0);
    assert.equal(spend(), paid, "this month's spend stays counted");
    const waiting = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.deepEqual([waiting.status, waiting.scores, waiting.periods], ['waiting', [], []]);
    // Idempotent; the next tick asks again today and the report is back.
    assert.deepEqual((await worker.prunePanelRounds({ all: true, dryRun: false })).projects, []);
    await pass(worker, panel, 4);
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams())).status, 'ready');
  });

  test(`${edition}: one round a period; a frequency changed in the middle of it follows the period it falls in`, async () => {
    const { sqlite, worker, api, panel, move } = await setup();
    provider();
    await pass(worker, panel, 3);
    const rounds = () => rows(sqlite, 'SELECT day,frequency,period_start FROM semantic_panel_rounds ORDER BY day');
    assert.deepEqual(rounds(), [{ day: '2026-10-14', frequency: 'weekly', period_start: '2026-10-12' }]);
    // Same week, other day: weekly is still due once a week.
    move('2026-10-15T10:00:00.000Z');
    await pass(worker, panel, 2);
    assert.equal(rounds().length, 1);
    // Switched to daily on Thursday: that day has no round yet, so one is asked; a second pass the same day asks nothing.
    await api.savePanelFrequency('p', 'owner', 'daily');
    await pass(worker, panel, 3);
    assert.deepEqual(rounds().map((round) => [round.day, round.frequency]), [['2026-10-14', 'weekly'], ['2026-10-15', 'daily']]);
    await pass(worker, panel, 2);
    assert.equal(rounds().length, 2);
    // Back to weekly on Friday: Monday's round already covers the week.
    move('2026-10-16T10:00:00.000Z');
    await api.savePanelFrequency('p', 'owner', 'weekly');
    await pass(worker, panel, 2);
    assert.equal(rounds().length, 2);
    // Monthly in the same month: the first round of the month covers it.
    await api.savePanelFrequency('p', 'owner', 'monthly');
    await pass(worker, panel, 2);
    assert.equal(rounds().length, 2);
    move('2026-11-02T10:00:00.000Z');
    await pass(worker, panel, 3);
    assert.deepEqual(rounds().at(-1), { day: '2026-11-02', frequency: 'monthly', period_start: '2026-11-01' });
  });

  test(`${edition}: a project with monitoring paused, Semantic Branding off, or no AI to ask is not collected`, async () => {
    const calls = provider();
    // Without the DataForSEO password no AI can be asked, and a project that monitors no AI has none to ask.
    for (const [options, change, settings] of [[{ enabled: false }, ''], [{}, "UPDATE projects SET daily_enabled=0 WHERE id='p'"], [{}, '', { DATAFORSEO_PASSWORD: '' }], [{ engines: [] }, '']]) {
      const { sqlite, worker, panel } = await setup(options, settings);
      if (change) sqlite.exec(change);
      await pass(worker, panel, 2);
      assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 0, JSON.stringify(options) + change);
    }
    assert.equal(calls.length, 0);
    // Turned off after the round opened but before it was sent: nothing is asked or paid, and the reserve is released.
    const { sqlite, worker } = await setup();
    sqlite.exec(`INSERT INTO semantic_panel_rounds(id,workspace_id,project_id,day,frequency,period_start,config_revision,language_code,location_code,roster_json,status,created_at) VALUES('r','owner','p','2026-10-14','weekly','2026-10-12',1,'en',2840,'{"brands":[],"attributes":[],"category":""}','running','2026-10-14T00:00:00.000Z');
      INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,requested_at) VALUES('q','r','owner','p','claude','llm','m','?','pending',0.17,'2026-10-14T00:00:00.000Z')`);
    sqlite.exec("UPDATE projects SET daily_enabled=0 WHERE id='p'");
    await worker.processSemanticPanels();
    assert.deepEqual(rows(sqlite, "SELECT status,reserved_usd FROM semantic_panel_queries WHERE id='q'"), [{ status: 'cancelled', reserved_usd: 0 }]);
    assert.equal(rows(sqlite, "SELECT status FROM semantic_panel_rounds WHERE id='r'")[0].status, 'done');
    assert.equal(calls.length, 0);
  });

  sixAis(`${edition}: the report scores each brand per period with margin, confidence and change, and only the owner reads or changes it`, async () => {
    const { sqlite, worker, api, panel, move } = await setup();
    provider();
    await pass(worker, panel, 4);
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.equal(report.status, 'ready');
    assert.equal(report.frequency, 'weekly');
    assert.deepEqual(report.periods, ['2026-10-12']);
    assert.equal(report.period, '2026-10-12');
    const answering = ['chat_gpt', 'gemini', 'claude', 'perplexity', 'google_ai_mode'];
    assert.deepEqual(report.answered, answering);
    const netflix = report.scores.find((score) => score.name === 'Netflix');
    // 5 AIs; each attribute is the mean over the AIs of BASE + attribute index.
    const mean = (offset) => answering.reduce((sum, engine) => sum + BASE[engine] + offset, 0) / answering.length;
    assert.equal(netflix.units, 5);
    assert.equal(netflix.reliable, true);
    assert.ok(Math.abs(netflix.score - (mean(0) + mean(1) + mean(2)) / 3) < 1e-9);
    assert.ok(netflix.margin > 0);
    assert.equal(netflix.change, null);
    assert.equal(report.scores.find((score) => score.name === 'Disney+').score < netflix.score, true);
    // The AIs of the round, and why one gave no notes: Overviews showed no AI block. The provider's own message is for admins only.
    assert.deepEqual(report.round.queries.filter((query) => !query.readings).map((query) => [query.engine, query.status, query.error]), [['google_ai_overviews', 'absent', null]]);
    assert.ok(report.round.costUsd > 0);
    // The ChatGPT and Gemini interfaces cited one page each.
    assert.deepEqual(report.sources.map((source) => [source.domain, source.answers]), [['example.com', 2]]);
    assert.equal(report.round.queries.length, QUERIES);
    // Score by AI: one column per AI the project monitors.
    assert.deepEqual(report.byAssistant.columns.map((column) => column.engine), INTERFACES);
    assert.deepEqual(report.byAssistant.brands, BRANDS.map((brand) => brand.name));
    assert.equal(report.byAssistant.columns[0].scores[0], BASE.chat_gpt + 1);
    assert.equal(report.byAssistant.columns[0].readings, BRANDS.length * ATTRIBUTES.length);
    // Every AI the project monitors is asked (8/11/2026): none is left out; no brand is new.
    assert.deepEqual(report.left, []);
    assert.deepEqual(report.added, []);
    const overviews = report.byAssistant.columns.at(-1);
    assert.deepEqual([overviews.status, overviews.readings, overviews.scores], ['absent', 0, [null, null, null]]);
    // The report carries no admin diagnostics (the product screen shows clean metrics); Admin reads them in panelDiagnostics.
    assert.equal(report.orderEffect, undefined);
    assert.deepEqual([report.round.queries.at(-1).error, report.byAssistant.columns.at(-1).error], [null, null]);
    const { rounds } = await api.panelDiagnostics();
    assert.deepEqual(rounds.map((round) => [round.projectId, round.day]), [['p', report.round.day]]);
    // One round has one order: the order effect waits for the next round, which reverses it. Overviews showed no AI block, in its own words.
    assert.deepEqual(rounds[0].orderEffect, { points: null, pairs: 0 });
    assert.deepEqual(rounds[0].failures, [{ engine: 'google_ai_overviews', web: 1, method: 'scrape', model: 'google_ai_overviews', status: 'absent', error: 'no_answer' }]);

    // The header's AI filter: one AI shows its mean without a margin. The web search mode is gone (every answer counted searched): an
    // old link's `web` changes nothing.
    const one = await api.panelReport('p', 'owner', new URLSearchParams('engine=chat_gpt'));
    const oneNetflix = one.scores.find((score) => score.name === 'Netflix');
    assert.deepEqual([one.minUnits, one.answered, oneNetflix.score, oneNetflix.margin], [1, ['chat_gpt'], BASE.chat_gpt + 1, null]);
    assert.deepEqual(one.byAssistant.columns.map((column) => column.engine), ['chat_gpt']);
    assert.deepEqual((await api.panelReport('p', 'owner', new URLSearchParams('web=without'))).answered, answering);
    await assert.rejects(api.panelReport('p', 'owner', new URLSearchParams('engine=bard')), { status: 400 });

    // Only the brands the project lists today: one dropped after the round is no longer shown. An AI the round did not ask keeps its
    // columns, which say so (`cancelled`), never a column left out.
    sqlite.exec(`UPDATE projects SET competitors_json='${JSON.stringify(BRANDS.slice(1, 2))}' WHERE id='p'`);
    sqlite.exec("DELETE FROM semantic_panel_readings WHERE engine='gemini'; DELETE FROM semantic_panel_queries WHERE engine='gemini'");
    const listed = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.deepEqual([listed.scores.map((score) => score.name), listed.byAssistant.brands, listed.association.brands.map((brand) => brand.name)],
      [['Netflix', 'Prime Video'], ['Netflix', 'Prime Video'], ['Netflix', 'Prime Video']]);
    const gemini = listed.byAssistant.columns.find((column) => column.engine === 'gemini');
    assert.deepEqual([gemini.status, gemini.readings, gemini.scores], ['cancelled', 0, [null, null]]);
    // Every brand the project lists is on the report, under its name today. A renamed brand keeps its notes (the old name is one
    // of its variations); one added after the round is listed without notes, never a zero, and enters the next collection (`added`).
    sqlite.exec(`UPDATE projects SET competitors_json='${JSON.stringify([{ name: 'Prime', domain: 'primevideo.com', aliases: ['Prime Video'] }, BRANDS[2], { name: 'Max', domain: 'max.com' }])}' WHERE id='p'`);
    const renamed = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.deepEqual(renamed.association.brands.map((brand) => brand.name), ['Netflix', 'Prime', 'Disney+', 'Max']);
    assert.equal(renamed.scores.find((score) => score.name === 'Prime').score, listed.scores.find((score) => score.name === 'Prime Video').score);
    assert.equal(renamed.scores.find((score) => score.name === 'Max').score, null);
    assert.ok(renamed.association.cells.filter((cell) => cell.brand === 'Max').every((cell) => cell.observedScore === null));
    assert.deepEqual(renamed.added, ['Max']);
    assert.ok((await api.panelEvidence('p', 'owner', new URLSearchParams('brand=Prime'))).evidence.length > 0);
    assert.deepEqual((await api.panelEvidence('p', 'owner', new URLSearchParams('brand=Max'))).evidence, []);
    await assert.rejects(api.panelEvidence('p', 'owner', new URLSearchParams('brand=Prime Video')), { status: 400 });
    sqlite.exec(`UPDATE projects SET competitors_json='${JSON.stringify(BRANDS.slice(1))}' WHERE id='p'`);

    // The next week the same notes: the change is inside the margin.
    move('2026-10-21T10:00:00.000Z');
    await pass(worker, panel, 4);
    const next = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.deepEqual(next.periods, ['2026-10-12', '2026-10-19']);
    assert.equal(next.period, '2026-10-19');
    assert.equal(next.scores.find((score) => score.name === 'Netflix').change.significant, false);
    assert.equal(next.trend.length, 2);
    // The second round reversed the order of the first: every AI gave the same notes in both orders here, so the effect is zero.
    const [both] = (await api.panelDiagnostics()).rounds;
    assert.equal(both.orderEffect.points, 0);
    assert.ok(both.orderEffect.pairs > 0);
    // No change markers on the chart (6/11/2026): the report no longer says where the way of asking changed.
    assert.equal('marks' in next, false);
    const pinned = await api.panelReport('p', 'owner', new URLSearchParams('period=2026-10-12'));
    assert.equal(pinned.period, '2026-10-12');
    assert.equal(pinned.scores.find((score) => score.name === 'Netflix').change, null);
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams('periods=1'))).periods.length, 1);
    await assert.rejects(api.panelReport('p', 'owner', new URLSearchParams('period=2020-01-01')), { status: 400 });
    // The same rounds drawn by month: both weeks are one period, and the latest round of it stands.
    await api.savePanelFrequency('p', 'owner', 'monthly');
    const monthly = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.deepEqual(monthly.periods, ['2026-10-01']);
    assert.equal(monthly.round.day, '2026-10-21');

    await assert.rejects(api.panelReport('p', 'other', new URLSearchParams()), { status: 404 });
    await assert.rejects(api.savePanelFrequency('p', 'other', 'daily'), { status: 404 });
    await assert.rejects(api.savePanelFrequency('p', 'owner', 'hourly'), { status: 400 });
    assert.equal(rows(sqlite, "SELECT frequency FROM semantic_panel_settings WHERE project_id='p'")[0].frequency, 'monthly');
  });

  test(`${edition}: the report follows the date range of the page header, and says why it is empty`, async () => {
    const { sqlite, worker, api, panel, move } = await setup();
    provider();
    await pass(worker, panel, 4);
    move('2026-10-21T10:00:00.000Z');
    await pass(worker, panel, 4);
    // Only the weeks that start inside the range count; the period before the first one still gives its change.
    const week = await api.panelReport('p', 'owner', new URLSearchParams('start=2026-10-19&end=2026-10-25'));
    assert.deepEqual([week.status, week.periods, week.period], ['ready', ['2026-10-19'], '2026-10-19']);
    assert.equal(week.scores.find((score) => score.name === 'Netflix').change.significant, false);
    const first = await api.panelReport('p', 'owner', new URLSearchParams('start=2026-10-12&end=2026-10-18'));
    assert.deepEqual([first.periods, first.period, first.scores.find((score) => score.name === 'Netflix').change], [['2026-10-12'], '2026-10-12', null]);
    // A range before any collection is not "no data yet": the history exists and the report points at it.
    const before = await api.panelReport('p', 'owner', new URLSearchParams('start=2026-09-01&end=2026-09-30'));
    assert.deepEqual([before.status, before.latestPeriod, before.scores, before.periods], ['outside', '2026-10-19', [], []]);
    await assert.rejects(api.panelReport('p', 'owner', new URLSearchParams('start=2026-09-01')), { status: 400 });
    await assert.rejects(api.panelReport('p', 'owner', new URLSearchParams('days=400')), { status: 400 });
    // Turned off, the history stays but the report says it is off.
    sqlite.prepare("INSERT INTO semantic_configurations(project_id,workspace_id,revision,configuration_json,created_at) VALUES('p','owner',2,?,'2026-10-22T00:00:00.000Z')").run(JSON.stringify({ enabled: false, attributes: [] }));
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams('start=2026-09-01&end=2026-09-30'))).status, 'disabled');
  });

  test(`${edition}: a week or month cut by the header range is drawn from the rounds inside it, never from one collected after it`, async () => {
    const { worker, api, panel, move } = await setup({}, {}, '2026-10-10T10:00:00.000Z');
    provider();
    await api.savePanelFrequency('p', 'owner', 'daily');
    for (const day of ['2026-10-10', '2026-10-17', '2026-10-18']) {
      move(`${day}T10:00:00.000Z`);
      await pass(worker, panel, 4);
    }
    const days = async (range, frequency) => {
      await api.savePanelFrequency('p', 'owner', frequency);
      const report = await api.panelReport('p', 'owner', new URLSearchParams(range));
      const evidence = report.round ? await api.panelEvidence('p', 'owner', new URLSearchParams(`${range}&period=${report.period}&brand=Netflix`)) : null;
      return [report.status, report.round?.day ?? null, evidence?.evidence[0]?.date ?? null];
    };
    assert.deepEqual(await days('start=2026-10-17&end=2026-10-17', 'weekly'), ['ready', '2026-10-17', '2026-10-17']);
    assert.deepEqual(await days('start=2026-10-12&end=2026-10-18', 'weekly'), ['ready', '2026-10-18', '2026-10-18']);
    assert.deepEqual(await days('start=2026-10-12&end=2026-10-16', 'weekly'), ['outside', null, null]);
    assert.deepEqual(await days('start=2026-10-01&end=2026-10-12', 'monthly'), ['ready', '2026-10-10', '2026-10-10']);
    assert.deepEqual(await days('start=2026-10-11&end=2026-10-17', 'monthly'), ['ready', '2026-10-17', '2026-10-17']);
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams('start=2026-10-12&end=2026-10-16'))).latestPeriod, '2026-10-01');
    // Without a range the latest round of the period still stands for it.
    assert.deepEqual(await days('', 'weekly'), ['ready', '2026-10-18', '2026-10-18']);
  });

  test(`${edition}: two AIs give a score with a wide margin at low confidence (no minimum of three), and the report says how many answered`, async () => {
    const { worker, api, panel } = await setup();
    provider({ broken: ['gemini', 'claude', 'perplexity'] });
    await pass(worker, panel, 4);
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.equal(report.answered.length, 2);
    const netflix = report.scores.find((score) => score.name === 'Netflix');
    assert.deepEqual([netflix.score, netflix.units, netflix.confidence, report.minUnits], [68.5, 2, 'low', 1]);
    assert.ok(netflix.margin > 0);
  });

  test(`${edition}: two AIs answering different attributes are counted as two respondents`, async () => {
    const { worker, api, panel } = await setup();
    provider({ broken: ['gemini', 'claude', 'perplexity'], text: (engine) => JSON.stringify({ brands: BRANDS.map((brand) => ({ brand: brand.name, attributes: [{ id: engine === 'chat_gpt' ? 'value' : 'films', score: 80, reason: 'The response only scored this attribute.', evidence: ['Won 3 Emmys in 2025.'] }] })) }) });
    await pass(worker, panel, 4);
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    const netflix = report.scores.find((score) => score.name === 'Netflix');
    // Each attribute has its one AI's note, so both count and the score's units are the fewest behind an attribute.
    assert.deepEqual([report.answered.length, netflix.score, netflix.units], [2, 80, 1]);
  });

  sixAis(`${edition}: before the first notes the report says what it waits for`, async () => {
    const waiting = async (options, settings) => {
      const { sqlite, worker, api, panel } = await setup(options, settings);
      return { sqlite, worker, api, panel, report: await api.panelReport('p', 'owner', new URLSearchParams()) };
    };
    // Scheduled: the first query runs at the next tick, and the report names its day.
    const scheduled = await waiting();
    assert.deepEqual([scheduled.report.status, scheduled.report.waiting.reason, scheduled.report.waiting.firstQueryDay, scheduled.report.collecting], ['waiting', 'scheduled', '2026-10-14', true]);
    assert.deepEqual([scheduled.report.scores, scheduled.report.trend, scheduled.report.association], [[], [], null]);
    // A round whose AIs all failed gives no notes: the report says so, with the day.
    provider({ lost: ENGINES });
    await pass(scheduled.worker, scheduled.panel, 2);
    assert.equal((await scheduled.api.panelReport('p', 'owner', new URLSearchParams())).waiting.reason, 'no-notes');
    // Since 8/11/2026 the AIs are all those the project monitors (one is enough), Claude and Perplexity included.
    const few = await waiting({ engines: ['chat_gpt', 'claude'], language: 'pt' });
    assert.deepEqual([few.report.waiting.reason, few.report.waiting.engines, few.report.waiting.left, few.report.waiting.minEngines], ['scheduled', ['chat_gpt', 'claude'], [], 1]);
    // Gemini's interface answers in Portuguese too (7/11/2026): a Portuguese project that monitors only Gemini is asked on it.
    const gemini = await waiting({ engines: ['gemini'], language: 'pt' });
    assert.deepEqual([gemini.report.waiting.reason, gemini.report.waiting.engines, gemini.report.waiting.left], ['scheduled', ['gemini'], []]);
    const apis = await waiting({ engines: ['claude', 'perplexity'] });
    assert.deepEqual([apis.report.waiting.reason, apis.report.waiting.engines, apis.report.waiting.left], ['scheduled', ['claude', 'perplexity'], []]);
    const none = await waiting({ engines: [] });
    assert.deepEqual([none.report.waiting.reason, none.report.waiting.engines], ['few-engines', []]);
    // Without the search data key (the personal edition without keys): it never collects, and the report says so.
    const silent = await waiting({}, { DATAFORSEO_PASSWORD: '' });
    assert.deepEqual([silent.report.waiting.reason, silent.report.collecting], ['not-collecting', false]);
    assert.deepEqual(await silent.api.panelSettings('p', 'owner'), { frequency: 'weekly', fixed: false, collecting: false });
    await assert.rejects(silent.api.panelSettings('p', 'other'), { status: 404 });
    // The brake for all projects has no room for the first round: the report waits for that limit, never for the scheduler.
    const braked = await waiting();
    braked.sqlite.prepare("INSERT INTO system_state(key,value) VALUES('platform_limits','{\"monthUsd\":0}')").run();
    await pass(braked.worker, braked.panel, 2);
    const stopped = await braked.api.panelReport('p', 'owner', new URLSearchParams());
    assert.deepEqual([stopped.status, stopped.waiting.reason, stopped.blocked], ['waiting', 'blocked', { reason: 'platform' }]);
    // Switched off: no waiting reason, the project is simply not in Semantic Branding.
    const off = await waiting({ enabled: false });
    assert.deepEqual([off.report.status, off.report.waiting], ['disabled', null]);
  });

  sixAis(`${edition}: the evidence is what each AI answered: question, method, model, notes with reason, sources and the clean answer`, async () => {
    const { sqlite, worker, api, panel } = await setup();
    provider();
    await pass(worker, panel, 4);
    const { evidence, nextCursor, period } = await api.panelEvidence('p', 'owner', new URLSearchParams('brand=Netflix&attribute=value'));
    assert.equal(period, '2026-10-12');
    // One item per answer, every answer of the round in one page.
    assert.equal(nextCursor, null);
    assert.deepEqual(evidence.map((item) => `${item.engine}:${item.method}`), ['chat_gpt:scrape', 'gemini:scrape', 'claude:scrape', 'perplexity:scrape', 'google_ai_mode:scrape']);
    // Claude's answer is the collection's pure model, stored under the model it asked.
    assert.deepEqual([evidence[2].model, evidence[2].readings.map((note) => note.score)], ['claude-sonnet-5', [75]]);
    const chat = evidence[0];
    assert.equal(chat.model, 'chat_gpt');
    // The question as a person reads it: the brands and attributes stay, the ids and the output format go.
    assert.doesNotMatch(chat.question, /ROSTER|value =|JSON/);
    assert.match(evidence[1].question, /Brands: .*Netflix \(netflix.com\)/);
    assert.ok(chat.question.includes('Netflix') && / vs .* streaming services: /.test(chat.question), chat.question);
    assert.deepEqual(chat.readings, [{ attribute: 'value', score: 70, reason: 'Netflix is known for it.', evidence: ['Won 3 Emmys in 2025.', 'Ranked first by JustWatch.'] }]);
    assert.deepEqual(chat.sources.map((source) => source.domain), ['example.com']);
    assert.match(chat.answer, /^Netflix\n {2}Value for money: 70 — Netflix is known for it\. “Won 3 Emmys in 2025\.” “Ranked first by JustWatch\.”/);
    assert.deepEqual(evidence.find((item) => item.engine === 'google_ai_mode').readings.map((note) => note.score), [65]);
    const paged = await api.panelEvidence('p', 'owner', new URLSearchParams('brand=Netflix&engine=gemini'));
    assert.deepEqual(paged.evidence.map((item) => item.engine), ['gemini']);
    assert.equal(paged.evidence[0].readings.length, ATTRIBUTES.length);
    // A model the panel asked itself before 6/11/2026 stays readable, after the counted answer of that AI, and counts in no score.
    const scoreBefore = (await api.panelReport('p', 'owner', new URLSearchParams())).scores.find((score) => score.name === 'Netflix').score;
    sqlite.prepare(`INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,response,requested_at,web)
      SELECT 'model',round_id,workspace_id,project_id,'claude','llm','anthropic/claude-sonnet-5.5','?','completed',0,0.01,'{}',requested_at,0 FROM semantic_panel_queries LIMIT 1`).run();
    sqlite.exec("INSERT INTO semantic_panel_readings(query_id,round_id,project_id,engine,brand,attribute,score) SELECT 'model',round_id,project_id,'claude','Netflix','value',5 FROM semantic_panel_queries WHERE id='model'");
    const kept = await api.panelEvidence('p', 'owner', new URLSearchParams('brand=Netflix&attribute=value'));
    assert.deepEqual(kept.evidence.map((item) => `${item.engine}:${item.method}`), ['chat_gpt:scrape', 'gemini:scrape', 'claude:scrape', 'claude:llm', 'perplexity:scrape', 'google_ai_mode:scrape']);
    const after = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.equal(after.scores.find((score) => score.name === 'Netflix').score, scoreBefore);
    assert.deepEqual([after.answered, after.byAssistant.columns.map((column) => column.engine)], [['chat_gpt', 'gemini', 'claude', 'perplexity', 'google_ai_mode'], INTERFACES]);
    await assert.rejects(api.panelEvidence('p', 'owner', new URLSearchParams()), { status: 400 });
    await assert.rejects(api.panelEvidence('p', 'owner', new URLSearchParams('brand=Hulu')), { status: 400 });
    await assert.rejects(api.panelEvidence('p', 'other', new URLSearchParams('brand=Netflix')), { status: 404 });
  });

  sixAis(`${edition}: a Portuguese project asks Gemini's interface in Brazilian Portuguese (pt-BR), the code its scraper takes`, async () => {
    const { sqlite, worker, api, panel } = await setup({ language: 'pt' });
    const calls = provider();
    await pass(worker, panel, 4);
    assert.deepEqual(rows(sqlite, 'SELECT engine FROM semantic_panel_queries ORDER BY rowid').map((query) => query.engine), INTERFACES);
    const posted = Object.fromEntries(calls.filter((call) => call.path.endsWith('/task_post') && !call.path.includes('/llm_responses/')).map((call) => [call.engine, call.payload.language_code]));
    assert.deepEqual(posted, { chat_gpt: 'pt', gemini: 'pt-BR', google_ai_mode: 'pt-BR', google_ai_overviews: 'pt' });
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.deepEqual(report.byAssistant.columns.map((column) => column.engine), INTERFACES);
    assert.deepEqual(report.left, []);
    // Claude and Perplexity are told the language too (the collection's messages).
    const live = Object.fromEntries(calls.filter((call) => /\/llm_responses\/(live|task_post)$/.test(call.path) && call.payload.model_name !== 'claude-haiku-4-5').map((call) => [call.engine, call.payload.system_message]));
    assert.equal(live.claude, 'Responda em português.');
    assert.equal(live.perplexity, 'Responda em português.');
  });

  sixAis(`${edition}: the report and its evidence read D1 in two round trips`, async () => {
    const { worker, api, panel } = await setup();
    provider();
    await pass(worker, panel, 3);
    // Every D1 call costs ~150-250 ms in production: the project, configuration, frequency and rounds go in one batch, the readings
    // and answers of the round shown in a second (before: seven calls in five trips, and five for the evidence).
    // Cloud reads the workspace's plan beside the first batch, at the same time (its AIs, 8/11/2026).
    const base = panel.control;
    let trips = 0;
    const counted = (bound) => ({ ...bound, bind: (...values) => counted(bound.bind(...values)), all: () => (trips++, bound.all()), first: () => (trips++, bound.first()), run: () => (trips++, bound.run()) });
    panel.control = { ...base, prepare: (sql) => counted(base.prepare(sql)), batch: (statements) => (trips++, base.batch(statements)) };
    try {
      const report = await api.panelReport('p', 'owner', new URLSearchParams());
      assert.equal(trips, edition === 'cloud' ? 3 : 2);
      assert.equal(report.scores.length, BRANDS.length);
      trips = 0;
      // One item per answer, the whole round in one page.
      assert.equal((await api.panelEvidence('p', 'owner', new URLSearchParams('brand=Netflix'))).evidence.length, QUERIES - 1);
      assert.equal(trips, 2);
    } finally {
      panel.control = base;
    }
  });

  test(`${edition}: a project outside Semantic Branding keeps today's behavior: no round, an empty report`, async () => {
    const { sqlite, worker, api, panel } = await setup({ enabled: false });
    const calls = provider();
    await pass(worker, panel, 2);
    assert.equal(calls.length, 0);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 0);
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.equal(report.status, 'disabled');
    assert.deepEqual([report.periods, report.scores, report.sources], [[], [], []]);
    assert.equal((await api.panelEvidence('p', 'owner', new URLSearchParams('brand=Netflix'))).evidence.length, 0);
  });

  test(`${edition}: the collection can be switched off and needs the provider credentials`, async () => {
    const off = await setup({}, { SEMANTIC_PANEL_ENABLED: 'false' });
    const calls = provider();
    assert.equal(await off.worker.processSemanticPanels(), 0);
    const bare = await setup({}, { DATAFORSEO_LOGIN: '', DATAFORSEO_PASSWORD: '' });
    assert.equal(await bare.worker.processSemanticPanels(), 0);
    assert.equal(rows(bare.sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 0);
    assert.equal(calls.length, 0);
  });

  sixAis(`${edition}: a query that costs more than its reserve is counted in full; the round goes on while it stays within its cap`, async () => {
    const { sqlite, worker, panel } = await setup();
    const calls = provider({ postCost: 1.5, liveCost: 1.5 });
    await pass(worker, panel, 3);
    // Every task costs more than its reserve here; the round stays within its US$ 5 cap after its first query, so it asks on.
    assert.equal(calls.filter((call) => call.method === 'POST').length, QUERIES);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries WHERE status='cancelled'")[0].n, 0);
    assert.equal(Number(rows(sqlite, 'SELECT SUM(MAX(cost_usd,reserved_usd)) spent FROM semantic_panel_queries')[0].spent.toFixed(6)), Number((QUERIES * 1.5 - 0.0006).toFixed(6)));
  });

  sixAis(`${edition}: a query whose real cost takes its round past the cap stops the rest of it`, async () => {
    const { sqlite, worker, panel } = await setup();
    const calls = provider({ postCost: 7 });
    await pass(worker, panel, 3);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    const [first, ...others] = rows(sqlite, 'SELECT * FROM semantic_panel_queries ORDER BY rowid');
    assert.deepEqual([first.engine, first.model, first.web, first.run, first.status, first.cost_usd, first.reserved_usd], ['chat_gpt', 'chat_gpt', 1, 0, 'completed', 7, 7]);
    assert.equal(others.length, QUERIES - 1);
    for (const query of others) {
      assert.deepEqual([query.status, query.reserved_usd], ['cancelled', 0], query.engine);
      assert.match(query.error, /pass its spend cap/);
    }
    assert.equal(rows(sqlite, 'SELECT status FROM semantic_panel_rounds')[0].status, 'done');
    // The real cost is what the ceilings see, not the estimate.
    assert.equal(rows(sqlite, 'SELECT SUM(MAX(cost_usd,reserved_usd)) spent FROM semantic_panel_queries')[0].spent, 7);
  });

  sixAis(`${edition}: a tick sends only while its time budget lasts; a round takes several ticks and asks each AI once`, async () => {
    const { sqlite, worker, panel } = await setup();
    const calls = provider({ slow: 61_000 });
    const posts = () => calls.filter((call) => call.method === 'POST').length;
    skew = 0;
    await pass(worker, panel);
    // The round's first query alone took past the 60 s budget: no new send in this tick.
    assert.equal(posts(), 1);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries WHERE status='pending'")[0].n, QUERIES - 1);
    await pass(worker, panel, 10);
    skew = 0;
    assert.equal(posts(), QUERIES);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 1);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries WHERE status IN ('pending','submitting','submitted')")[0].n, 0);
    assert.equal(rows(sqlite, 'SELECT status FROM semantic_panel_rounds')[0].status, 'done');
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_readings')[0].n, NOTES);
  });

  sixAis(`${edition}: the rounds of several projects are sent side by side, up to six queries at a time once each round's first one settled`, async () => {
    const { sqlite, worker, panel } = await setup();
    sqlite.prepare(`INSERT INTO projects(id,workspace_id,name,domain,competitors_json,category,engines_json,language_code,location_code,daily_enabled,created_at) VALUES('p2','owner','Hulu','hulu.com',?,'streaming services',?,'en',2840,1,'2026-10-01T00:00:00.000Z')`)
      .run(JSON.stringify(BRANDS.slice(1)), JSON.stringify(ENGINES));
    ENGINES.forEach((engine, at) => sqlite.prepare(`INSERT INTO prompts(id,project_id,text,engine,created_at) VALUES(?,?,?,?,'2026-10-01T00:00:00.000Z')`).run(`h${at}`, 'p2', 'Best streaming?', engine));
    sqlite.prepare(`INSERT INTO semantic_configurations(project_id,workspace_id,revision,configuration_json,created_at) VALUES('p2','owner',1,?,'2026-10-01T00:00:00.000Z')`)
      .run(JSON.stringify({ enabled: true, attributes: ATTRIBUTES }));
    // Every AI scores Hulu too: an answer that left a brand of its question out would be asked again (13/11/2026).
    const calls = provider({ text: (engine) => reply(engine, [...BRANDS, { name: 'Hulu', domain: 'hulu.com' }]) });
    const answer = globalThis.fetch;
    const flight = { all: 0, most: 0, p: 0, p2: 0, mostOfARound: 0 };
    globalThis.fetch = async (url, init) => {
      if (init.method !== 'POST') return answer(url, init);
      const round = init.body.includes('Hulu') ? 'p2' : 'p';
      flight.most = Math.max(flight.most, ++flight.all);
      flight.mostOfARound = Math.max(flight.mostOfARound, ++flight[round]);
      await new Promise((done) => setImmediate(done));
      flight.all--;
      flight[round]--;
      return answer(url, init);
    };
    const first = [];
    const watch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (init.method === 'POST' && first.length < 2) first.push(flight.all);
      return watch(url, init);
    };
    await pass(worker, panel, 3);
    assert.deepEqual(first, [0, 1], "each round's first query leaves alone, the two rounds side by side");
    assert.equal(flight.most, 6, "then six queries are in flight, the invocation's connections (one per round)");
    assert.equal(flight.mostOfARound, QUERIES - 1, 'a round no longer waits for each answer before the next query');
    assert.equal(calls.filter((call) => call.method === 'POST').length, 2 * QUERIES, 'each AI asked once per round');
    assert.deepEqual(rows(sqlite, 'SELECT project_id,status FROM semantic_panel_rounds ORDER BY project_id'), [{ project_id: 'p', status: 'done' }, { project_id: 'p2', status: 'done' }]);
  });

  sixAis(`${edition}: with the project runners (Cloud) the tick opens the rounds and each project's queries go in a step of its own`, async () => {
    const { sqlite, worker, panel } = await setup();
    sqlite.prepare(`INSERT INTO projects(id,workspace_id,name,domain,competitors_json,category,engines_json,language_code,location_code,daily_enabled,created_at) VALUES('p2','owner','Hulu','hulu.com',?,'streaming services',?,'en',2840,1,'2026-10-01T00:00:00.000Z')`)
      .run(JSON.stringify(BRANDS.slice(1)), JSON.stringify(ENGINES));
    sqlite.prepare(`INSERT INTO semantic_configurations(project_id,workspace_id,revision,configuration_json,created_at) VALUES('p2','owner',1,?,'2026-10-01T00:00:00.000Z')`)
      .run(JSON.stringify({ enabled: true, attributes: ATTRIBUTES }));
    const calls = provider();
    const posts = () => calls.filter((call) => call.method === 'POST').length;
    const handed = [];
    assert.equal(await worker.processSemanticPanels(async (projects) => (handed.push(...projects), projects.length)), 2);
    assert.deepEqual(handed.sort(), ['p', 'p2']);
    assert.equal(posts(), 0, 'the tick only opens the rounds and hands them over');
    // A step sends its project's whole round (four minutes of six lanes), then reads the posted scrapers once they are due.
    assert.equal(await worker.semanticPanelStep('p'), QUERIES);
    assert.equal(posts(), QUERIES);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries WHERE project_id='p2' AND status='pending'")[0].n, QUERIES, "another project's queries wait for its own runner");
    panel.control.prepare("UPDATE semantic_panel_queries SET input_json=json_set(input_json,'$.nextPollAt',0) WHERE status='submitted'").run();
    // Claude and Perplexity answered Live in the first step; the scrapers' tasks are read in the next.
    assert.equal(await worker.semanticPanelStep('p'), QUERIES - LIVE.length, "the scrapers' tasks are read");
    assert.equal(await worker.semanticPanelStep('p'), 0, 'nothing left: the runner stops');
    assert.equal(rows(sqlite, "SELECT status FROM semantic_panel_rounds WHERE project_id='p'")[0].status, 'done');
    // Without the binding the runners answer null and the tick moves the queries itself.
    await worker.processSemanticPanels(async () => null);
    assert.ok(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries WHERE project_id='p2' AND status='pending'")[0].n < QUERIES);
  });

  sixAis(`${edition}: a new project's first round opens at once (openFirstRound, sendFirstRound), that project's only, and its first queries leave`, async () => {
    const { sqlite, worker } = await setup();
    sqlite.prepare(`INSERT INTO projects(id,workspace_id,name,domain,competitors_json,category,engines_json,language_code,location_code,daily_enabled,created_at) VALUES('p2','owner','Hulu','hulu.com',?,'streaming services',?,'en',2840,1,'2026-10-01T00:00:00.000Z')`)
      .run(JSON.stringify(BRANDS.slice(1)), JSON.stringify(ENGINES));
    sqlite.prepare(`INSERT INTO semantic_configurations(project_id,workspace_id,revision,configuration_json,created_at) VALUES('p2','owner',1,?,'2026-10-01T00:00:00.000Z')`)
      .run(JSON.stringify({ enabled: true, attributes: ATTRIBUTES }));
    const calls = provider();
    await worker.openFirstRound('p2');
    await worker.sendFirstRound('p2');
    assert.deepEqual(rows(sqlite, 'SELECT project_id FROM semantic_panel_rounds'), [{ project_id: 'p2' }], 'only the new project, not the tick\'s whole line');
    assert.ok(calls.some((call) => call.method === 'POST'), 'its first queries are sent, not left for the next tick');
  });

  sixAis(`${edition}: switched off, nothing new is opened or sent, but the waiting reserve is released and what was posted is still read`, async () => {
    const { sqlite, worker, panel, move } = await setup();
    const calls = provider();
    await worker.processSemanticPanels();
    // A tick reads a whole round per lane: the four interfaces and Claude (Standard queue) were posted.
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries WHERE status='submitted'")[0].n, 5);
    // A second round (of an earlier month) with one query waiting and one stuck in a send.
    sqlite.exec(`INSERT INTO semantic_panel_rounds(id,workspace_id,project_id,day,frequency,period_start,config_revision,language_code,location_code,roster_json,status,created_at)
      VALUES('r2','owner','p','2026-09-15','monthly','2026-09-01',1,'en',2840,'{}','running','2026-10-14T10:00:00.000Z');
      INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,requested_at)
      VALUES('wait','r2','owner','p','claude','llm','m','?','pending',0.17,'2026-10-14T10:00:00.000Z');
      INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,requested_at,started_at)
      VALUES('stuck','r2','owner','p','gemini','llm','m','?','submitting',0.17,'2026-10-14T10:00:00.000Z','2026-10-14T10:00:00.000Z')`);
    panel.settings.SEMANTIC_PANEL_ENABLED = 'false';
    move('2026-10-14T10:30:00.000Z');
    const before = calls.filter((call) => call.method === 'POST').length;
    await pass(worker, panel, 2);
    const status = Object.fromEntries(rows(sqlite, 'SELECT id,status,reserved_usd FROM semantic_panel_queries').map((query) => [query.id, query]));
    assert.deepEqual([status.wait.status, status.wait.reserved_usd], ['cancelled', 0]);
    assert.deepEqual([status.stuck.status, status.stuck.reserved_usd], ['unknown', 0.17]);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries WHERE status IN ('pending','submitting','submitted')")[0].n, 0);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries WHERE engine IN ('google_ai_mode','google_ai_overviews') AND status IN ('completed','absent')")[0].n, 2);
    assert.deepEqual(rows(sqlite, 'SELECT status FROM semantic_panel_rounds'), [{ status: 'done' }, { status: 'done' }]);
    // Next week, still off: no new round, no call.
    move('2026-10-21T10:00:00.000Z');
    await pass(worker, panel, 2);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 2);
    assert.equal(calls.filter((call) => call.method === 'POST').length, before);
  });

  test(`${edition}: AI Overviews gets a natural search and its notes are read from the overview's text`, async () => {
    const { sqlite, worker, panel } = await setup();
    const calls = provider({ overview: 'Netflix leads on series and originals, Prime Video has good value for money, Disney+ has a smaller film selection.' });
    await pass(worker, panel, 4);
    const posts = calls.filter((call) => call.method === 'POST');
    // The search is what a person types, not the scoring task Google answers with nothing; the next round reverses the order of the
    // brands, so the project's brand does not always lead the search.
    const searches = posts.filter((call) => call.engine === 'google_ai_overviews' && call.path.endsWith('/task_post')).map((call) => decodeURIComponent(call.payload.keyword));
    assert.equal(searches.length, 1);
    const [head] = searches.map((search) => search.split(' streaming services: ')[0].split(' vs '));
    assert.deepEqual([...head].sort(), BRANDS.map((brand) => brand.name).sort());
    assert.ok(searches.every((search) => search.endsWith(' streaming services: Value for money, Film selection, Series and originals')));
    assert.ok(searches.every((search) => !/Score|JSON/.test(search)));
    // Notes come from one LLM call over each overview's text, without web search.
    const read = posts.filter((call) => JSON.stringify(call.payload).includes('"TEXT ') && call.payload.message_chain.at(-1).message.includes('Disney+ has a smaller'));
    assert.equal(read.length, 1);
    assert.equal(read[0].path, 'ai_optimization/claude/llm_responses/live');
    assert.equal(read[0].payload.web_search, undefined);
    assert.match(read[0].payload.message_chain.at(-1).message, /^TEXT .*Disney\+ has a smaller film selection/);
    assert.ok(read[0].payload.message_chain.length <= 10 && read[0].payload.message_chain.every((part) => part.message.length <= 500));
    // AI Mode gets the same natural search (12/11/2026), never the scoring task.
    assert.doesNotMatch(decodeURIComponent(posts.find((call) => call.engine === 'google_ai_mode').payload.keyword), /Score|JSON/);
    const query = rows(sqlite, "SELECT * FROM semantic_panel_queries WHERE engine='google_ai_overviews' AND run=0")[0];
    assert.equal(query.status, 'completed', query.error);
    assert.match(query.response, /Netflix leads on series/);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_readings WHERE engine='google_ai_overviews'")[0].n, BRANDS.length * ATTRIBUTES.length);
    // The reading call is paid inside the query's reserve, and it is all settled.
    assert.equal(query.cost_usd, 0.004 + 0.01);
    assert.equal(query.reserved_usd, query.cost_usd);
  });

  test(`${edition}: AI Mode gets the natural search, not the scoring task: its answer in prose is read and the sources it cites are kept (12/11/2026)`, async () => {
    // Asked the JSON scoring task, AI Mode answered a code block without searching: no reason, no source, in every project.
    const { sqlite, worker, panel } = await setup();
    const prose = 'Netflix: the leader in series and originals, with Stranger Things. Prime Video: best value for money, included with Prime. Disney+: a smaller film selection.';
    const calls = provider({ text: (engine) => (engine === 'google_ai_mode' ? prose : reply(engine)), references: [{ url: 'https://www.example.com/streaming-compared', title: 'Streaming compared' }] });
    await pass(worker, panel, 4);
    const posts = calls.filter((call) => call.method === 'POST');
    const searches = posts.filter((call) => call.engine === 'google_ai_mode').map((call) => decodeURIComponent(call.payload.keyword));
    assert.equal(searches.length, 1);
    assert.deepEqual(searches[0].split(' streaming services: ')[0].split(' vs ').sort(), BRANDS.map((brand) => brand.name).sort());
    assert.match(searches[0], / streaming services: Value for money, Film selection, Series and originals$/);
    assert.equal(posts.find((call) => call.engine === 'google_ai_mode').payload.language_code, 'en');
    // Its notes are read from the whole answer, like an AI Overview's.
    const read = posts.filter((call) => JSON.stringify(call.payload).includes('"TEXT ') && call.payload.message_chain.at(-1).message.includes('Stranger Things'));
    assert.equal(read.length, 1);
    const [query] = rows(sqlite, "SELECT * FROM semantic_panel_queries WHERE engine='google_ai_mode'");
    assert.equal(query.status, 'completed', query.error);
    assert.equal(query.response, prose);
    assert.deepEqual(JSON.parse(query.sources_json).map((source) => source.domain), ['example.com']);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_readings WHERE engine='google_ai_mode'")[0].n, BRANDS.length * ATTRIBUTES.length);
    assert.equal(query.cost_usd, 0.004 + 0.01);
  });

  test(`${edition}: ChatGPT gets the natural search, not the scoring task: its answer in prose is read and the sources it cites are kept (12/11/2026)`, async () => {
    // Asked the JSON scoring task, ChatGPT searched (its search results came back) but cited nothing: no source in any project.
    const { sqlite, worker, panel } = await setup();
    const prose = 'Netflix: the leader in series and originals, with Stranger Things. Prime Video: best value for money. Disney+: a smaller film selection.';
    const calls = provider({ text: (engine) => (engine === 'chat_gpt' ? prose : reply(engine)) });
    await pass(worker, panel, 4);
    const posts = calls.filter((call) => call.method === 'POST' && call.engine === 'chat_gpt');
    assert.equal(posts.length, 1);
    const search = decodeURIComponent(posts[0].payload.keyword);
    assert.deepEqual(search.split(' streaming services: ')[0].split(' vs ').sort(), BRANDS.map((brand) => brand.name).sort());
    assert.doesNotMatch(search, /Rate how strongly|JSON/);
    // Its notes are read from the whole answer; the pages it cites are the answer's sources.
    const read = calls.filter((call) => call.method === 'POST' && JSON.stringify(call.payload).includes('"TEXT ') && call.payload.message_chain.at(-1).message.includes('Stranger Things'));
    assert.equal(read.length, 1);
    const [query] = rows(sqlite, "SELECT * FROM semantic_panel_queries WHERE engine='chat_gpt'");
    assert.equal(query.status, 'completed', query.error);
    assert.equal(query.response, prose);
    assert.deepEqual(JSON.parse(query.sources_json).map((source) => source.domain), ['example.com']);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_readings WHERE engine='chat_gpt'")[0].n, BRANDS.length * ATTRIBUTES.length);
    assert.equal(query.cost_usd, 0.004 + 0.01);
  });

  test(`${edition}: by default (model key or not) an answer in prose is read by the provider's reader, not a decision model (8/11/2026)`, async () => {
    const { sqlite, worker, panel } = await setup({}, { OPENROUTER_API_KEY: 'key' });
    const calls = provider({ overview: 'Netflix leads on series and originals, Prime Video has good value for money, Disney+ has a smaller film selection.' });
    const dataForSeo = globalThis.fetch;
    const decisions = [];
    globalThis.fetch = async (url, init) => (String(url).startsWith('https://openrouter.ai/') ? (decisions.push(url), new Response('{}', { status: 500 })) : dataForSeo(url, init));
    await pass(worker, panel, 4);
    assert.equal(decisions.length, 0);
    assert.equal(calls.filter((call) => call.method === 'POST' && JSON.stringify(call.payload).includes('"TEXT ')).length, 1);
    assert.equal(rows(sqlite, "SELECT status FROM semantic_panel_queries WHERE engine='google_ai_overviews' AND run=0")[0].status, 'completed');
  });

  test(`${edition}: with a decision model chosen for the reading, an answer in prose is read in ONE call, its cost in the query (8/11/2026)`, async () => {
    const { sqlite, worker, panel } = await setup({}, { OPENROUTER_API_KEY: 'key', LASTFIND_CLASSIFIER_MODELS: '{"semantic_reader":"liquid/d1-ultra"}' });
    const overview = `${'Netflix leads on series and originals, Prime Video has good value for money [x](https://example.com/page). '.repeat(80)}Disney+ has a smaller film selection.`;
    const calls = provider({ overview });
    const dataForSeo = globalThis.fetch;
    const asked = [];
    const answer = (payload) => Object.fromEntries(Object.keys(payload.questions).map((id) => [id, { type: 'choice', choice: 'fully', probabilities: { absent: 0.1, weak: 0, well: 0.1, fully: 0.6, excellence: 0.2 } }]));
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://openrouter.ai/')) return dataForSeo(url, init);
      const payload = JSON.parse(init.body);
      asked.push({ url: String(url), payload });
      return Response.json({ model: payload.model, answers: answer(payload), usage: { cost: 0.0007 } });
    };
    await pass(worker, panel, 4);
    // No provider reading and no chat model: one Decisions call with a closed question per brand and attribute.
    assert.equal(calls.filter((call) => call.method === 'POST' && JSON.stringify(call.payload).includes('"TEXT ')).length, 0);
    assert.deepEqual(asked.map((call) => [call.url, call.payload.model]), [['https://openrouter.ai/api/alpha/decisions', 'liquid/d1-ultra']]);
    assert.equal(Object.keys(asked[0].payload.questions).length, BRANDS.length * ATTRIBUTES.length);
    assert.ok(asked[0].payload.state.text.endsWith('Disney+ has a smaller film selection.') && !asked[0].payload.state.text.includes('https://'));
    const query = rows(sqlite, "SELECT * FROM semantic_panel_queries WHERE engine='google_ai_overviews' AND run=0")[0];
    assert.equal(query.status, 'completed', query.error);
    // The expected note of the labels, 81, is kept: the label is the judgment of the text, so no evidence cap for the decision model (13/11/2026;
    // from 10/11 its missing quote put every note at 59 or below).
    assert.deepEqual([...new Set(rows(sqlite, "SELECT score FROM semantic_panel_readings WHERE engine='google_ai_overviews'").map((row) => row.score))], [81]);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_readings WHERE engine='google_ai_overviews'")[0].n, BRANDS.length * ATTRIBUTES.length);
    assert.equal(Number(query.cost_usd.toFixed(6)), 0.0047);
    assert.equal(query.reserved_usd, query.cost_usd);
    // The model configured for the function is the one asked; a reply with every pair absent leaves the answer kept and failed, its cost counted.
    const again = await setup({}, { OPENROUTER_API_KEY: 'key', LASTFIND_CLASSIFIER_MODELS: '{"semantic_reader":"typesafe/jev-1.14"}' });
    provider({ overview });
    const next = globalThis.fetch;
    asked.length = 0;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith('https://openrouter.ai/')) return next(url, init);
      const payload = JSON.parse(init.body);
      asked.push({ url: String(url), payload });
      return Response.json({ model: payload.model, answers: Object.fromEntries(Object.keys(payload.questions).map((id) => [id, { type: 'choice', choice: 'absent' }])), usage: { cost: 0.0001 } });
    };
    await pass(again.worker, again.panel, 4);
    // (A failed ask is asked again in the round: each reading goes to the configured model.)
    assert.ok(asked.length >= 1 && asked.every((call) => call.payload.model === 'typesafe/jev-1.14'));
    const failed = rows(again.sqlite, "SELECT status,cost_usd,response FROM semantic_panel_queries WHERE engine='google_ai_overviews' AND run=0 ORDER BY rowid")[0];
    assert.deepEqual([failed.status, Number(failed.cost_usd.toFixed(6)), !!failed.response], ['failed', 0.0041, true]);
    assert.equal(rows(again.sqlite, "SELECT COUNT(*) n FROM semantic_panel_readings WHERE engine='google_ai_overviews'")[0].n, 0, 'absent, never a zero');
  });

  test(`${edition}: the notes of a new round are anchored as they are recorded, the AI's own score kept; an answer recorded before keeps its numbers (9/11/2026)`, async () => {
    const { sqlite, worker } = await setup({ engines: ['chat_gpt', 'gemini'] });
    // ChatGPT puts two brands at 90+ on value and one at 85 with no fact; Gemini answers as usual.
    const anchored = JSON.stringify({ brands: BRANDS.map((brand, b) => ({ brand: brand.name, attributes: [{ id: 'value', band: 'x', score: [95, 93, 85][b], reason: 'Known for it.', evidence: b === 2 ? [] : ['Won 3 Emmys in 2025.'] }] })) });
    provider({ text: (engine) => (engine === 'chat_gpt' ? anchored : reply(engine)) });
    await pass(worker, globalThis.panel, 4);
    const chat = rows(sqlite, "SELECT id,response,input_json FROM semantic_panel_queries WHERE engine='chat_gpt'")[0];
    const scores = () => rows(sqlite, 'SELECT brand,score FROM semantic_panel_readings WHERE query_id=? ORDER BY score DESC', chat.id).map((row) => [row.brand, row.score]);
    assert.deepEqual(scores(), [['Netflix', 95], ['Prime Video', 89], ['Disney+', 59]]);
    // The AI's own scores: in its stored answer, and the capped ones in the query's input.
    assert.deepEqual(JSON.parse(chat.input_json), { scale: 4, raw: [['Prime Video', 'value', 93], ['Disney+', 'value', 85]] });
    assert.match(chat.response, /"score":93/);
    // An answer recorded before the anchored scale (no `scale`), read again: its notes come back as the AI gave them.
    sqlite.prepare("UPDATE semantic_panel_queries SET input_json='{}' WHERE id=?").run(chat.id);
    sqlite.prepare('DELETE FROM semantic_panel_readings WHERE query_id=?').run(chat.id);
    await worker.rereadPanelAnswers({ limit: 200 });
    assert.deepEqual(scores(), [['Netflix', 95], ['Prime Video', 93], ['Disney+', 85]], 'past periods keep their numbers');
    // One recorded with an anchored scale (2 or the current 3) is read again with the current anchors.
    for (const scale of [2, 3]) {
      sqlite.prepare("UPDATE semantic_panel_queries SET input_json=json_object('scale',?) WHERE id=?").run(scale, chat.id);
      sqlite.prepare('DELETE FROM semantic_panel_readings WHERE query_id=?').run(chat.id);
      await worker.rereadPanelAnswers({ limit: 200 });
      assert.deepEqual(scores(), [['Netflix', 95], ['Prime Video', 89], ['Disney+', 59]]);
    }
  });

  test(`${edition}: the same AI Overview text is read once per project; another day with the same text reuses its notes for free, another text is read (9/11/2026)`, async () => {
    const { sqlite, worker, panel, move } = await setup({ frequency: 'daily' });
    const text = 'Netflix leads on series and originals, Prime Video has good value for money, Disney+ has a smaller film selection.';
    const readsOf = (calls) => calls.filter((call) => call.method === 'POST' && JSON.stringify(call.payload).includes('"TEXT ')).length;
    const overviewOf = (day) => rows(sqlite, "SELECT q.id,q.status,q.cost_usd,q.input_json FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id WHERE q.engine='google_ai_overviews' AND r.day=?", day)[0];
    const notesOf = (query) => rows(sqlite, 'SELECT brand,attribute,score,reason,evidence FROM semantic_panel_readings WHERE query_id=? ORDER BY brand,attribute', query.id);
    const calls = provider({ overview: text });
    await pass(worker, panel, 4);
    assert.equal(readsOf(calls), 1);
    const first = overviewOf('2026-10-14');
    assert.equal(first.status, 'completed');
    assert.match(JSON.parse(first.input_json).readingKey, /^[0-9a-f]{64}$/);
    // The next day Google shows the same text (other links): no paid reading, the same notes, only the search's cost.
    move('2026-10-15T10:00:00.000Z');
    const again = provider({ overview: `${text}[[1]](https://example.com/other)` });
    await pass(worker, panel, 4);
    assert.equal(readsOf(again), 0);
    const second = overviewOf('2026-10-15');
    assert.deepEqual([second.status, second.cost_usd, JSON.parse(second.input_json).cached], ['completed', 0.004, true]);
    assert.equal(JSON.parse(second.input_json).readingKey, JSON.parse(first.input_json).readingKey);
    assert.deepEqual(notesOf(second), notesOf(first));
    // Another text is read (and paid).
    move('2026-10-16T10:00:00.000Z');
    const other = provider({ overview: 'Disney+ now leads on films; Netflix still leads on series.' });
    await pass(worker, panel, 4);
    assert.equal(readsOf(other), 1);
    // Per project: a reading another project kept is not this project's (tenant data, never shared).
    sqlite.exec(`INSERT INTO projects(id,workspace_id,name,domain,competitors_json,category,engines_json,language_code,location_code,daily_enabled,archived,created_at)
      SELECT 'elsewhere',workspace_id,name,domain,competitors_json,category,engines_json,language_code,location_code,0,1,created_at FROM projects WHERE id='p'`);
    sqlite.exec("UPDATE semantic_panel_queries SET project_id='elsewhere' WHERE engine='google_ai_overviews'");
    move('2026-10-17T10:00:00.000Z');
    const elsewhere = provider({ overview: text });
    await pass(worker, panel, 4);
    assert.equal(readsOf(elsewhere), 1);
  });

  test(`${edition}: AI Overviews asks one search per group of at most five brands, each read whole, so every brand has its notes (8/11/2026)`, async () => {
    // Seven brands: until 8/11/2026 one search named the first five and the other two never had an AI Overviews note.
    const competitors = ['Hulu', 'Max', 'Apple TV+', 'Peacock', 'Paramount+', 'Pluto TV'].map((name) => ({ name, domain: `${name.toLowerCase().replace(/\W/g, '')}.com` }));
    const roster = [BRANDS[0], ...competitors];
    const { sqlite, worker, api, panel } = await setup({ competitors });
    // Each reading scores the brands of its own roster messages, from the text.
    const reading = (payload) => {
      const named = roster.filter((brand) => payload.message_chain.some((part) => part.message.startsWith('ROSTER') && part.message.includes(`${brand.name} (`)));
      return reply('google_ai_overviews', named);
    };
    const calls = provider({ overview: `${'A long overview with a section per attribute and links [x](https://example.com/page). '.repeat(100)}`, reading });
    await pass(worker, panel, 4);
    const overviews = rows(sqlite, "SELECT model,run,status,brand_order_json FROM semantic_panel_queries WHERE engine='google_ai_overviews' ORDER BY model");
    assert.deepEqual(overviews.map((query) => [query.model, query.status]), [['google_ai_overviews', 'completed'], ['google_ai_overviews:2', 'completed']]);
    const groups = overviews.map((query) => JSON.parse(query.brand_order_json));
    assert.deepEqual(groups.map((group) => group.length), [4, 3]);
    assert.deepEqual(groups.flat().sort(), roster.map((brand) => brand.name).sort());
    // The searches name their group only, with every attribute.
    const searches = calls.filter((call) => call.engine === 'google_ai_overviews' && call.path.endsWith('/task_post')).map((call) => decodeURIComponent(call.payload.keyword));
    assert.deepEqual(searches.map((search) => search.split(' streaming services: ')[0].split(' vs ').length).sort(), [3, 4]);
    // The whole overview is read (about 7,500 characters clean of links: two readings each), each reading within the provider's limits.
    const reads = calls.filter((call) => call.method === 'POST' && JSON.stringify(call.payload).includes('"TEXT '));
    assert.ok(reads.length > 2 && reads.every((call) => call.payload.message_chain.length <= 10), JSON.stringify(reads.map((call) => call.payload.message_chain.length)));
    assert.ok(reads.every((call) => !JSON.stringify(call.payload).includes('https://example.com')));
    // Every brand has an AI Overviews score.
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    const column = report.byAssistant.columns.find((item) => item.engine === 'google_ai_overviews');
    assert.equal(column.readings, roster.length * ATTRIBUTES.length);
    assert.ok(column.scores.every((score) => typeof score === 'number'), JSON.stringify(column.scores));
    assert.equal(report.round.queries.filter((query) => query.engine === 'google_ai_overviews').length, 1);
  });

  test(`${edition}: an AI the project enables after its round is asked in the next round (nothing filters it out)`, async () => {
    const { sqlite, worker, panel, move } = await setup({ engines: ['chat_gpt', 'google_ai_mode'], language: 'pt', frequency: 'daily' });
    provider();
    await pass(worker, panel, 3);
    assert.deepEqual(rows(sqlite, 'SELECT DISTINCT engine FROM semantic_panel_queries ORDER BY engine').map((row) => row.engine), ['chat_gpt', 'google_ai_mode']);
    // Gemini enabled on the project the same day (07/11/2026, Conversion): today's round is done, tomorrow's asks it, in pt-BR.
    sqlite.prepare("UPDATE projects SET engines_json=? WHERE id='p'").run(JSON.stringify(['chat_gpt', 'gemini', 'google_ai_mode']));
    await pass(worker, panel, 2);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries WHERE engine='gemini'")[0].n, 0);
    move('2026-10-15T10:00:00.000Z');
    const calls = provider();
    await pass(worker, panel, 3);
    assert.deepEqual(rows(sqlite, "SELECT q.status FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id WHERE q.engine='gemini' AND r.day='2026-10-15'"), [{ status: 'completed' }]);
    assert.equal(calls.find((call) => call.engine === 'gemini' && call.path.endsWith('/task_post')).payload.language_code, 'pt-BR');
  });

  sixAis(`${edition}: a failed ask is asked again in the same round, at most twice more, and a retry that answers fills the AI (8/11/2026)`, async () => {
    const { sqlite, worker, api, panel, move } = await setup({ frequency: 'daily' });
    // Claude answers in prose with no score twice (it said it would not guess), then scores: the third ask fills its column.
    let claudeAsks = 0;
    const refusal = 'Não tenho dados verificáveis sobre essas marcas; não vou apresentar números.';
    const calls = provider({ overview: 'Netflix leads.', text: (engine) => (engine === 'claude' ? (++claudeAsks <= 2 ? refusal : reply('claude')) : engine === 'chat_gpt' || engine === 'gemini' ? reply(engine) : short(engine)), reading: 'No pair is covered.' });
    await pass(worker, panel, 6);
    const asks = rows(sqlite, "SELECT model,status,error FROM semantic_panel_queries WHERE engine='claude' ORDER BY requested_at,rowid");
    assert.deepEqual(asks.map((query) => [query.model, query.status]), [['claude-sonnet-5', 'failed'], ['claude-sonnet-5#2', 'failed'], ['claude-sonnet-5#3', 'completed']]);
    // Each retry is the collection's request with the model asked, never its suffix.
    assert.deepEqual(calls.filter((call) => call.engine === 'claude' && call.payload?.model_name !== 'claude-haiku-4-5' && call.path.endsWith('/task_post')).map((call) => call.payload.model_name), ['claude-sonnet-5', 'claude-sonnet-5', 'claude-sonnet-5']);
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.ok(report.answered.includes('claude'));
    assert.deepEqual(report.round.queries.find((query) => query.engine === 'claude').model, 'claude-sonnet-5');
    // Admin sees one cell for Claude, and no failure: its retry answered.
    const { rounds } = await api.panelDiagnostics();
    assert.equal(rounds[0].failures.some((failure) => failure.engine === 'claude'), false);
    // Capped: an AI that keeps failing is asked three times in all, then left (absent, never a zero).
    claudeAsks = -100;
    move('2026-10-15T10:00:00.000Z');
    await pass(worker, panel, 8);
    const next = rows(sqlite, "SELECT q.status FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id WHERE q.engine='claude' AND r.day='2026-10-15'");
    assert.deepEqual(next.map((query) => query.status), ['failed', 'failed', 'failed']);
    // A failure a retry cannot change (the collection switched off) and a lost reply are not asked again.
    const day15 = "round_id=(SELECT id FROM semantic_panel_rounds WHERE day='2026-10-15')";
    sqlite.exec(`DELETE FROM semantic_panel_queries WHERE engine='claude' AND model<>'claude-sonnet-5' AND ${day15}`);
    sqlite.exec(`UPDATE semantic_panel_queries SET error='Semantic Branding collection is switched off; the answer was not read.' WHERE engine='claude' AND ${day15}`);
    const before = rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries")[0].n;
    await pass(worker, panel, 2);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_queries")[0].n, before);
    // The operator's round now also asks a failed AI again (the scheduler's retry, in the same call).
    sqlite.exec(`UPDATE semantic_panel_queries SET error='The answer has no notes for these attributes.' WHERE engine='claude' AND ${day15}`);
    claudeAsks = 10;
    // Within what the call may reserve: a cap below a retry's reserve asks nothing again.
    const claudeRows = () => rows(sqlite, `SELECT COUNT(*) n FROM semantic_panel_queries WHERE engine='claude' AND ${day15}`)[0].n;
    const held = claudeRows();
    await worker.panelRoundNow('p', 0.01);
    assert.equal(claudeRows(), held);
    const now = await worker.panelRoundNow('p', 2);
    // Claude on the Standard queue: the retry is posted now and read by the next ticks.
    assert.ok(now.queries.some((row) => row.engine === 'claude' && ['completed', 'submitted'].includes(row.status)));
    await pass(worker, panel, 2);
    assert.ok(rows(sqlite, "SELECT q.status FROM semantic_panel_queries q JOIN semantic_panel_rounds r ON r.id=q.round_id WHERE q.engine='claude' AND r.day='2026-10-15'").some((query) => query.status === 'completed'));
  });

  test(`${edition}: an AI asked to score whose answer came back cut (the first brand only) is asked again, and the next answer fills the other brands (13/11/2026)`, async () => {
    const { sqlite, worker, api, panel } = await setup({ frequency: 'daily' });
    // The shape of Gemini's answer for Netflix on 12/11/2026: the JSON of the first brand's first notes, cut (4 notes of 36).
    let geminiAsks = 0;
    const cut = (engine) => reply(engine).slice(0, reply(engine).indexOf('"brand":"Prime Video"') - 3);
    provider({ overview: 'Netflix leads.', text: (engine) => (engine === 'gemini' ? (++geminiAsks === 1 ? cut(engine) : reply(engine)) : engine === 'chat_gpt' ? reply(engine) : short(engine)), reading: 'No pair is covered.' });
    await pass(worker, panel, 6);
    const asks = rows(sqlite, "SELECT model,status,input_json FROM semantic_panel_queries WHERE engine='gemini' ORDER BY requested_at,rowid");
    assert.deepEqual(asks.map((query) => [query.model, query.status, JSON.parse(query.input_json).incomplete ?? false]), [['gemini', 'completed', true], ['gemini#2', 'completed', false]]);
    // The cut answer's notes are kept, and the second answer gives every brand its notes in Gemini.
    const notes = rows(sqlite, "SELECT brand,COUNT(*) n FROM semantic_panel_readings WHERE engine='gemini' GROUP BY brand ORDER BY brand");
    assert.deepEqual(notes, [{ brand: 'Disney+', n: 3 }, { brand: 'Netflix', n: 6 }, { brand: 'Prime Video', n: 3 }]);
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.ok(report.byAssistant.columns.find((column) => column.engine === 'gemini').scores.every((score) => score !== null));
  });

  sixAis(`${edition}: the operator's round now adds to the period's round the AIs it lacks, within its cap, once (backfill)`, async () => {
    const { sqlite, worker, api, panel } = await setup({ frequency: 'daily' });
    provider();
    await pass(worker, panel, 3);
    // As production's round of 7/11/2026 stands: Claude and Perplexity were never asked, and AI Overviews read a few notes, too few for a
    // brand's score (one note here).
    const round = rows(sqlite, 'SELECT id FROM semantic_panel_rounds')[0].id;
    sqlite.exec("DELETE FROM semantic_panel_readings WHERE engine IN ('claude','perplexity'); DELETE FROM semantic_panel_queries WHERE engine IN ('claude','perplexity')");
    sqlite.exec(`UPDATE semantic_panel_queries SET status='completed',response='Netflix leads.' WHERE engine='google_ai_overviews';
      INSERT INTO semantic_panel_readings(query_id,round_id,project_id,engine,brand,attribute,score) SELECT id,round_id,project_id,engine,'Netflix','value',70 FROM semantic_panel_queries WHERE engine='google_ai_overviews'`);
    sqlite.exec(`UPDATE semantic_panel_queries SET requested_at='${rows(sqlite, 'SELECT created_at FROM semantic_panel_rounds')[0].created_at}'`);
    await assert.rejects(worker.panelRoundNow('p', 0), /maxUsd/);
    await assert.rejects(worker.panelRoundNow('p', 50), /maxUsd/);
    await assert.rejects(worker.panelRoundNow('nope', 1), /not collecting/);
    const calls = provider({ overview: 'Netflix leads on series and originals, Prime Video has good value for money, Disney+ has a smaller film selection.' });
    const first = await worker.panelRoundNow('p', 2);
    assert.equal(first.round, '2026-10-14');
    assert.deepEqual([...first.added].sort(), ['claude', 'google_ai_overviews', 'perplexity']);
    // Same round, no second round; the round's own AI Overviews query keeps its row, the new one takes the other run.
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 1);
    assert.deepEqual(rows(sqlite, "SELECT status FROM semantic_panel_queries WHERE engine='google_ai_overviews' ORDER BY requested_at").map((row) => row.status)[0], 'completed');
    // Moved at once: Claude and Perplexity answered Live, the overview is polled by the next call (or the scheduler).
    panel.control.prepare("UPDATE semantic_panel_queries SET input_json=json_set(input_json,'$.nextPollAt',0) WHERE status='submitted'").run();
    const second = await worker.panelRoundNow('p', 2);
    assert.deepEqual([second.added, second.inFlight], [[], 0]);
    const posts = calls.filter((call) => call.method === 'POST' && !JSON.stringify(call.payload).includes('"TEXT ')).length;
    // Idempotent: a third call asks nothing.
    const third = await worker.panelRoundNow('p', 2);
    assert.deepEqual([third.added, third.moved], [[], 0]);
    assert.equal(calls.filter((call) => call.method === 'POST' && !JSON.stringify(call.payload).includes('"TEXT ')).length, posts);
    assert.equal(posts, 3);
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.deepEqual(report.answered, ['chat_gpt', 'gemini', 'claude', 'perplexity', 'google_ai_mode', 'google_ai_overviews']);
    assert.equal(rows(sqlite, 'SELECT status FROM semantic_panel_rounds WHERE id=?', round)[0].status, 'done');
    // Every reserve settled.
    assert.ok(rows(sqlite, 'SELECT reserved_usd,cost_usd FROM semantic_panel_queries').every((query) => query.reserved_usd === query.cost_usd));
    // A cap below one AI's reserve asks nothing (an empty period opens a round as the scheduler would; here one exists).
    sqlite.exec("DELETE FROM semantic_panel_readings WHERE engine='claude'; UPDATE semantic_panel_queries SET requested_at=(SELECT created_at FROM semantic_panel_rounds) WHERE engine='claude'");
    const tight = await worker.panelRoundNow('p', 0.01);
    assert.deepEqual(tight.added, []);
  });

  test(`${edition}: the operator redoes the period's round (8/11/2026, the score rubric changed): a new round, shown once it has readings, the old one kept`, async () => {
    const { sqlite, worker, api, panel, move } = await setup({ frequency: 'daily' });
    // AI Overviews shows a block here, so every AI of the round gives its notes and a plain call has nothing to add.
    provider({ overview: 'Netflix leads.' });
    await pass(worker, panel, 3);
    const [first] = rows(sqlite, 'SELECT id,period_start FROM semantic_panel_rounds');
    const stored = () => ({
      round: rows(sqlite, 'SELECT * FROM semantic_panel_rounds WHERE id=?', first.id),
      queries: rows(sqlite, 'SELECT * FROM semantic_panel_queries WHERE round_id=? ORDER BY id', first.id),
      readings: rows(sqlite, 'SELECT * FROM semantic_panel_readings WHERE round_id=? ORDER BY rowid', first.id),
    });
    const before = stored();
    assert.ok(before.readings.length > 0);
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams())).round.id, first.id);
    // Without `redo` nothing changes: the period's round is settled, no second round.
    const plain = await worker.panelRoundNow('p', 2);
    assert.deepEqual([plain.added, plain.inFlight], [[], 0]);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 1);
    // Later the same day: the redo opens a fresh round in the same period, every AI asked again.
    move('2026-10-14T12:00:00.000Z');
    const calls = provider({ overview: 'Netflix leads.' });
    const redo = await worker.panelRoundNow('p', 2, true);
    const rounds = rows(sqlite, 'SELECT id,day,period_start FROM semantic_panel_rounds ORDER BY created_at');
    assert.equal(rounds.length, 2);
    assert.equal(rounds[1].day, '2026-10-14');
    assert.equal(rounds[1].period_start, `2026-10-14~redo~${rounds[1].id}`);
    assert.equal(redo.round, '2026-10-14');
    assert.deepEqual([...redo.added].sort(), ['chat_gpt', 'gemini', 'google_ai_mode', 'google_ai_overviews']);
    // Until the new round has readings (its scrapers are still being polled) the report keeps the old one.
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_readings WHERE round_id=?', rounds[1].id)[0].n, 0);
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams())).round.id, first.id);
    // A second redo while the new round is in flight is refused: no third round.
    assert.ok(redo.inFlight > 0);
    await assert.rejects(worker.panelRoundNow('p', 2, true), /in flight/);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 2);
    // Calls without `redo` move the new round until it settles; they add nothing to it.
    let next;
    for (let at = 0; at < 4 && (!next || next.inFlight); at++) {
      panel.control.prepare("UPDATE semantic_panel_queries SET input_json=json_set(input_json,'$.nextPollAt',0) WHERE status='submitted'").run();
      next = await worker.panelRoundNow('p', 2);
      assert.deepEqual(next.added, []);
    }
    assert.equal(next.inFlight, 0);
    assert.ok(calls.some((call) => call.method === 'POST'));
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.equal(report.round.id, rounds[1].id);
    assert.ok(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_readings WHERE round_id=?', rounds[1].id)[0].n > 0);
    // The old round's rows are untouched.
    assert.deepEqual(stored(), before);
    // The scheduler opens nothing more in the period.
    await pass(worker, panel, 2);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 2);
  });

  test(`${edition}: an AI Overview whose text gives no notes is a failed reading with the overview kept, never a zero`, async () => {
    const { sqlite, worker, panel } = await setup();
    provider({ overview: 'Netflix is a streaming service.', reading: 'No pair is covered.' });
    await pass(worker, panel, 4);
    const query = rows(sqlite, "SELECT * FROM semantic_panel_queries WHERE engine='google_ai_overviews' AND run=0")[0];
    assert.equal(query.status, 'failed');
    assert.match(query.error, /no notes/);
    assert.equal(query.response, 'Netflix is a streaming service.');
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_readings WHERE engine='google_ai_overviews'")[0].n, 0);
  });

  // The reading of an AI Overview is a paid POST of its own; it is claimed before it goes out and never repeated.
  const readsOf = (calls) => calls.filter((call) => call.method === 'POST' && JSON.stringify(call.payload).includes('"TEXT '));
  // The round's overview.
  const overviewQuery = (sqlite) => rows(sqlite, "SELECT * FROM semantic_panel_queries WHERE engine='google_ai_overviews' AND run=0")[0];

  test(`${edition}: a paid reading whose settlement is lost is not sent again; the query ends unknown at its reserve`, async () => {
    const { sqlite, worker, panel } = await setup();
    const calls = provider({ overview: 'Netflix leads on series and originals.' });
    await pass(worker, panel);
    const batch = panel.control.batch;
    const overview = overviewQuery(sqlite).id;
    panel.control.batch = async (statements) => {
      if (statements.some((statement) => /^\s*UPDATE semantic_panel_queries SET status/.test(statement.sql) && statement.params.includes(overview))) throw new Error('lost settlement');
      return batch(statements);
    };
    await assert.rejects(pass(worker, panel), /lost settlement/);
    panel.control.batch = batch;
    // The claim is on the query: the next poll settles it as unknown instead of paying again (one reading per overview).
    await pass(worker, panel);
    assert.equal(readsOf(calls).length, 1);
    for (const query of rows(sqlite, "SELECT * FROM semantic_panel_queries WHERE engine='google_ai_overviews'")) {
      assert.equal(query.status, 'unknown');
      assert.ok(query.cost_usd >= 0.004 + 0.01 && query.reserved_usd >= query.cost_usd);
    }
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_readings WHERE engine='google_ai_overviews'")[0].n, 0);
  });

  test(`${edition}: two polls of the same overview pay for one reading`, async () => {
    const { sqlite, worker, panel } = await setup();
    const calls = provider({ overview: 'Netflix leads on series and originals.' });
    await pass(worker, panel);
    panel.control.prepare("UPDATE semantic_panel_queries SET input_json=json_set(input_json,'$.nextPollAt',0) WHERE status='submitted'").run();
    await Promise.all([worker.processSemanticPanels(), worker.processSemanticPanels()]);
    // One reading per overview, never two for the same one.
    assert.equal(readsOf(calls).length, 1);
    assert.deepEqual(rows(sqlite, "SELECT status FROM semantic_panel_queries WHERE engine='google_ai_overviews'").map((query) => query.status), ['completed']);
  });

  test(`${edition}: with collection switched off a posted overview is kept but not read`, async () => {
    const { sqlite, worker, panel } = await setup();
    const calls = provider({ overview: 'Netflix leads on series and originals.' });
    await pass(worker, panel);
    panel.settings.SEMANTIC_PANEL_ENABLED = 'false';
    await pass(worker, panel);
    assert.equal(readsOf(calls).length, 0);
    const query = overviewQuery(sqlite);
    assert.equal(query.status, 'failed');
    assert.match(query.error, /switched off/);
    assert.match(query.response, /Netflix leads on series/);
    assert.equal(query.reserved_usd, 0.004);
  });

  test(`${edition}: a query posted before the reading existed, with the scraper's reserve only, is not read`, async () => {
    const { sqlite, worker, panel } = await setup();
    const calls = provider({ overview: 'Netflix leads on series and originals.' });
    await pass(worker, panel);
    sqlite.exec("UPDATE semantic_panel_queries SET reserved_usd=0.02 WHERE engine='google_ai_overviews'");
    await pass(worker, panel);
    assert.equal(readsOf(calls).length, 0);
    const query = overviewQuery(sqlite);
    assert.equal(query.status, 'failed');
    assert.match(query.error, /did not reserve/);
    assert.match(query.response, /Netflix leads on series/);
  });

  test(`${edition}: the pilot counts the reading of an AI Overview as a paid call of its own`, async () => {
    const { runPanel } = await load(edition, 'lib/semantic-panel-provider.ts');
    const sent = [];
    const send = async (path) => {
      sent.push(path);
      if (path.endsWith('/task_post')) return [{ id: 'job', status_code: 20100, cost: 0.004 }];
      if (path.endsWith('/live')) return [{ status_code: 20000, cost: 0.01, result: [{ money_spent: 0, model_name: 'm', items: [{ type: 'message', sections: [{ type: 'text', text: reply('google_ai_overviews') }] }] }] }];
      return [{ status_code: 20000, cost: 0, result: [{ items: [{ type: 'ai_overview', markdown: 'Netflix leads on series.' }] }] }];
    };
    const run = await runPanel({ send, maxUsd: 1, roster: { brands: BRANDS, attributes: ATTRIBUTES, category: 'streaming services' }, engines: ['google_ai_overviews'], pollMs: 0 });
    // Two runs (reversed orders), each a search and its reading.
    assert.equal(sent.filter((path) => path.endsWith('/live')).length, 2);
    assert.equal(run.meta.calls, 4);
    assert.equal(run.meta.spentUsd, 0.028);
    assert.equal(run.observations.length, 2 * BRANDS.length * ATTRIBUTES.length);
  });

  test(`${edition}: Google finding no results leaves the AI absent, never failed or zero`, async () => {
    const { sqlite, worker, panel } = await setup();
    provider({ none: ['google_ai_mode'] });
    await pass(worker, panel, 4);
    const queries = rows(sqlite, "SELECT status,error,cost_usd FROM semantic_panel_queries WHERE engine='google_ai_mode'");
    assert.deepEqual(queries, [{ status: 'absent', error: 'no_answer', cost_usd: 0.004 }]);
    assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_readings WHERE engine='google_ai_mode'")[0].n, 0);
  });

  test(`${edition}: the report says disabled whenever Semantic Branding is off, with the old rounds kept`, async () => {
    const { sqlite, worker, api, panel } = await setup();
    provider();
    await pass(worker, panel, 4);
    assert.equal((await api.panelReport('p', 'owner', new URLSearchParams())).status, 'ready');
    sqlite.prepare("INSERT INTO semantic_configurations(project_id,workspace_id,revision,configuration_json,created_at) VALUES('p','owner',2,?,'2026-10-15T00:00:00.000Z')").run(JSON.stringify({ enabled: false, attributes: ATTRIBUTES }));
    const report = await api.panelReport('p', 'owner', new URLSearchParams());
    assert.equal(report.status, 'disabled');
    assert.equal(report.periods.length, 1);
  });

  test(`${edition}: money is dated by when a query was sent, not by when its round opened`, async () => {
    // The one spend rule of every guard (lib/platform-spend.ts).
    const spend = await load(edition, 'lib/platform-spend.ts');
    const sqlite = database(edition);
    sqlite.exec(`INSERT INTO accounts(id,email,name,created_at) VALUES('owner','o@test','Owner','2026-10-01T00:00:00.000Z');
      INSERT INTO projects(id,workspace_id,name,domain,created_at) VALUES('p','owner','N','n.com','2026-10-01T00:00:00.000Z');
      INSERT INTO semantic_panel_rounds(id,workspace_id,project_id,day,frequency,period_start,config_revision,language_code,location_code,roster_json,status,created_at) VALUES('r','owner','p','2026-01-01','daily','2026-01-01',1,'en',2840,'{}','done','2026-01-01T00:00:00.000Z')`);
    const spent = (since) => sqlite.prepare(`SELECT ${spend.platformSpendSql('k.s')} n FROM (SELECT ? AS s) k`).get(since.toISOString()).n;
    const start = new Date(realNow());
    start.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const add = (id, engine, requested, started) => sqlite.prepare("INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,requested_at,started_at) VALUES(?,'r','owner','p',?,'llm','m','?','completed',1,1,?,?)").run(id, engine, requested.toISOString(), started?.toISOString() ?? null);
    // Opened just before midnight / the turn of the month, sent just after: it weighs on the day and month it was sent in.
    add('a', 'claude', new Date(start.getTime() - 60_000), new Date(start.getTime() + 1_000));
    add('b', 'gemini', new Date(monthStart.getTime() - 60_000), new Date(monthStart.getTime() + 1_000));
    // On the first day of a month the two turns are the same midnight: both weigh on today.
    assert.equal(spent(start), start.getTime() === monthStart.getTime() ? 2 : 1);
    assert.equal(spent(monthStart), 2);
    // Never sent (cancelled before the send) and opened last month: no weight.
    add('c', 'perplexity', new Date(monthStart.getTime() - 60_000), null);
    assert.equal(spent(monthStart), 2);
  });
}

test('cloud: the account ceilings count the panel; a free account is asked on ChatGPT, monthly', { skip: !cloud }, async () => {
  const full = database('cloud');
  seed(full);
  globalThis.panel = { control: d1(full), stamp: '2026-10-14T10:00:00.000Z', settings: { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p' } };
  const worker = await load('cloud', 'lib/server/semantic-panel-worker.ts');
  // US$ 1.999,99 already spent this month by earlier panel queries: the round's reserve passes the US$ 2.000 ceiling.
  full.exec(`INSERT INTO semantic_panel_rounds(id,workspace_id,project_id,day,frequency,period_start,config_revision,language_code,location_code,roster_json,status,created_at) VALUES('old','owner','p','2026-10-02','daily','2026-10-02',1,'en',2840,'{}','done','2026-10-02T00:00:00.000Z');
    INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,requested_at) VALUES('spent','old','owner','p','claude','llm','m','?','completed',1999.99,1999.99,'2026-10-02T00:00:00.000Z')`);
  // The same spend in the real clock's month too: the account's credit period follows today, not the fixed stamp.
  full.prepare("INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,requested_at) VALUES('spent-now','old','owner','p','gemini','llm','m','?','completed',1999.99,1999.99,?)").run(new Date(realNow()).toISOString());
  const calls = provider();
  await worker.processSemanticPanels();
  assert.equal(rows(full, "SELECT COUNT(*) n FROM semantic_panel_rounds WHERE id<>'old'")[0].n, 0);
  assert.equal(calls.length, 0);
  full.exec("DELETE FROM semantic_panel_queries WHERE id IN ('spent','spent-now')");
  await worker.processSemanticPanels();
  assert.equal(rows(full, "SELECT COUNT(*) n FROM semantic_panel_rounds WHERE id<>'old'")[0].n, 1);

  // A free account is asked on ChatGPT's interface only (one AI is enough), once a month whatever the project chose.
  const free = database('cloud');
  seed(free, { unlimited: false });
  globalThis.panel = { control: d1(free), stamp: '2026-10-14T10:00:00.000Z', settings: { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p' } };
  provider();
  const freeWorker = await load('cloud', 'lib/server/semantic-panel-worker.ts');
  await freeWorker.processSemanticPanels();
  assert.deepEqual(rows(free, 'SELECT frequency,period_start FROM semantic_panel_rounds'), [{ frequency: 'monthly', period_start: '2026-10-01' }]);
  assert.deepEqual(rows(free, 'SELECT DISTINCT engine FROM semantic_panel_queries').map((row) => row.engine), ['chat_gpt']);
  assert.deepEqual(rows(free, 'SELECT method,model FROM semantic_panel_queries').map((row) => `${row.method}:${row.model}`), ['scrape:chat_gpt']);
  assert.equal(rows(free, "SELECT frequency FROM semantic_panel_settings WHERE project_id='p'")[0].frequency, 'monthly', 'stored, so the report reads it');
  // A week later, same month: nothing new; the next month: one more round.
  globalThis.panel.stamp = '2026-10-21T10:00:00.000Z';
  await freeWorker.processSemanticPanels();
  assert.equal(rows(free, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 1);
  // The operator's redo is neither held by the plan's one round a month nor counted in it: the scheduler still opens next month's round.
  globalThis.panel.settings.SEMANTIC_PANEL_ENABLED = 'true';
  free.exec("UPDATE semantic_panel_queries SET status='completed',cost_usd=reserved_usd");
  const redo = await freeWorker.panelRoundNow('p', 2, true);
  assert.deepEqual(redo.added, ['chat_gpt']);
  assert.deepEqual(rows(free, 'SELECT period_start FROM semantic_panel_rounds ORDER BY created_at').map((row) => row.period_start.split('~')[0]), ['2026-10-01', '2026-10-01']);
  free.exec("UPDATE semantic_panel_queries SET status='completed',cost_usd=reserved_usd");
  globalThis.panel.stamp = '2026-11-02T10:00:00.000Z';
  await freeWorker.processSemanticPanels();
  assert.equal(rows(free, 'SELECT COUNT(*) n FROM semantic_panel_rounds')[0].n, 3);
});

test('selfhost: runs with the installer\'s own credentials and no account ceiling', async () => {
  const sqlite = database('selfhost');
  seed(sqlite);
  globalThis.panel = { control: d1(sqlite), stamp: '2026-10-14T10:00:00.000Z', settings: { DATAFORSEO_LOGIN: 'installer', DATAFORSEO_PASSWORD: 'secret' } };
  const worker = await load('selfhost', 'lib/server/semantic-panel-worker.ts');
  sqlite.exec(`INSERT INTO semantic_panel_rounds(id,workspace_id,project_id,day,frequency,period_start,config_revision,language_code,location_code,roster_json,status,created_at) VALUES('old','owner','p','2026-10-02','daily','2026-10-02',1,'en',2840,'{}','done','2026-10-02T00:00:00.000Z');
    INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,cost_usd,requested_at) VALUES('spent','old','owner','p','claude','llm','m','?','completed',1999.99,1999.99,'2026-10-02T00:00:00.000Z');
    INSERT INTO project_budgets(project_id,workspace_id,monthly_usd,updated_at,updated_by) VALUES('p','owner',NULL,'2026-10-01','owner')`);
  // US$ 1.999,99 spent: the installation has no platform brake by default, and its owner set no budget for this project.
  const calls = provider();
  const authorization = new Set();
  const fetchWithCredentials = globalThis.fetch;
  globalThis.fetch = async (url, init) => { authorization.add(init.headers.Authorization); return fetchWithCredentials(url, init); };
  await pass(worker, globalThis.panel, 4);
  assert.deepEqual([...authorization], [`Basic ${Buffer.from('installer:secret').toString('base64')}`]);
  assert.equal(rows(sqlite, "SELECT COUNT(*) n FROM semantic_panel_rounds WHERE id<>'old'")[0].n, 1);
  assert.ok(calls.length >= QUERIES);
});
