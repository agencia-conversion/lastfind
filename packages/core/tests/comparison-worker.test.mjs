// Comparison's collection, reading and report, in both editions, on the real migrations of each edition (an in-memory SQLite with every
// migration applied) and the real edition policy (plans, budget ceilings). The search data provider and the reader's chat model are a fake
// `fetch`: no paid call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const core = `${root}packages/core/`;
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/comparison-answers.json', import.meta.url), 'utf8'));
const CLEAR = fixtures.cases.find((item) => item.name === 'scored with facts');
const CAPPED = JSON.parse(readFileSync(new URL('./fixtures/comparison-capped.json', import.meta.url), 'utf8'));

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

const fixtureModules = {
  env: `export const db=()=>globalThis.cmp.control; export const now=()=>globalThis.cmp.stamp; export const setting=(key)=>globalThis.cmp.settings[key] ?? '';
    export const workerSetting=setting; export const retryRead=(read)=>read(); export const workerVersion=()=>undefined; export const appOrigin=()=>'https://app.test';`,
  empty: `export {};`,
  http: `export class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }`,
  workspace: `import { ApiError } from './http';
    export async function ownedProject(id,userId){ const p=await globalThis.cmp.control.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived=0').bind(id,userId).first(); if(!p) throw new ApiError(404,'Project not found.'); return p; }`,
  favicon: `export async function readHome(){ return null; }`,
  workers: `export const env = {}; export const waitUntil = () => {};`,
};
const extensions = ['.ts', '.tsx', '.mjs', '/index.ts'];
const firstExisting = (base) => [base, ...extensions.map((extension) => base + extension)].find((path) => /\.(ts|tsx|mjs)$/.test(path) && existsSync(path)) ?? base;
async function load(edition, entry) {
  const result = await build({
    absWorkingDir: root, entryPoints: [`${core}${entry}`], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{
      name: 'bindings',
      setup(plugin) {
        plugin.onResolve({ filter: /^(\.\/env|@\/lib\/server\/env)$/ }, () => ({ path: 'env', namespace: 'fixture' }));
        plugin.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'workers', namespace: 'fixture' }));
        plugin.onResolve({ filter: /^\.\/(http|workspace|favicon)$/ }, (args) => ({ path: args.path.slice(2), namespace: 'fixture' }));
        plugin.onResolve({ filter: /^(\.\/(conversion-.*|project-evaluations|evaluations-estimate|brand-reanalysis|notifications|leads)|@\/lib\/server\/(project-runners|operations|project-evaluations|source-classification))$/ }, () => ({ path: 'empty', namespace: 'fixture' }));
        plugin.onResolve({ filter: /^@edition\// }, (args) => ({ path: firstExisting(`${root}apps/${edition}/${args.path.slice(9)}`) }));
        plugin.onResolve({ filter: /^@\// }, (args) => ({ path: firstExisting(`${core}${args.path.slice(2)}`) }));
      },
    }, { name: 'fixtures', setup(plugin) { plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtureModules[args.path], loader: 'js', resolveDir: `${core}lib/server` })); } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}

/** Every migration of the edition, or (`before`) only those up to the one named, the rest returned to apply later. */
function database(edition, before = null) {
  const sqlite = new DatabaseSync(':memory:');
  const directory = `${root}apps/${edition}/drizzle/`;
  const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  const cut = before ? files.findIndex((name) => name.includes(before)) : files.length;
  for (const file of files.slice(0, cut)) sqlite.exec(readFileSync(directory + file, 'utf8'));
  sqlite.rest = () => { for (const file of files.slice(cut)) sqlite.exec(readFileSync(directory + file, 'utf8')); };
  return sqlite;
}
const { roster } = fixtures;
const CONFIG = (products = 1) => ({
  attributes: [{ id: 'price', name: 'Price', description: '', group: 'Value' }, { id: 'results', name: 'Results', description: '', group: 'Outcome' }],
  products: Array.from({ length: products }, (_, at) => ({ id: at ? `product-${at}` : 'seo-consulting', name: at ? `Product ${at}` : 'SEO consulting', competitors: roster.options.filter((option) => option.name !== 'Acme Agency'), attributes: ['price', 'results'] })),
  personas: [{ id: 'owner', name: 'Small business owner', description: 'a small business owner with a tight budget' }],
});
function seed(sqlite, { plan = 'unlimited', engines = ['chat_gpt', 'gemini', 'google_ai_mode', 'google_ai_overviews'], interval = 24, products = 1 } = {}) {
  sqlite.exec(`INSERT INTO accounts(id,email,name,created_at) VALUES('owner','o@test','Owner','2026-10-01T00:00:00.000Z')`);
  // Before 0111 (Cloud) the account was the workspace: its plan, and its projects' owner_id.
  const ws = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='workspaces'").get() ? 'workspace_id' : 'owner_id';
  const plans = ws === 'workspace_id' ? 'workspaces' : 'accounts';
  if (plan && sqlite.prepare(`PRAGMA table_info(${plans})`).all().some((column) => column.name === 'plan_override')) sqlite.prepare(`UPDATE ${plans} SET plan_override=? WHERE id='owner'`).run(plan);
  sqlite.prepare(`INSERT INTO projects(id,${ws},name,domain,competitors_json,engines_json,language_code,location_code,daily_enabled,interval_hours,created_at) VALUES('p','owner','Acme Agency','acme.example',?,?,'en',2840,1,?,'2026-10-01T00:00:00.000Z')`)
    .run(JSON.stringify(roster.options.filter((option) => option.name !== 'Acme Agency')), JSON.stringify(engines), interval);
  sqlite.prepare(`INSERT INTO comparison_configurations(project_id,${ws},revision,configuration_json,created_at) VALUES('p','owner',1,?,'2026-10-01T00:00:00.000Z')`).run(JSON.stringify(CONFIG(products)));
}
const engineOf = (path) => (path.startsWith('serp/google/ai_mode') ? 'google_ai_mode' : path.startsWith('serp/google/organic') ? 'google_ai_overviews' : path.split('/')[1]);
/** The fake search data provider (queue: task_post, then task_get) and the fake reader (the scored fixture, by option name). */
function provider({ lost = [], reader = 'ok' } = {}) {
  const calls = [];
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const task = (patch) => reply({ status_code: 20000, tasks: [{ id: 'job', status_code: 20000, status_message: 'Ok.', cost: 0, result: null, ...patch }] });
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('openrouter.ai')) {
      const payload = JSON.parse(init.body);
      calls.push({ kind: 'reader', payload });
      if (reader === 'error') return reply({ error: { message: 'busy' } }, 503);
      return reply({ choices: [{ message: { content: reader === 'contradiction' ? fixtures.cases[1].reply : CLEAR.reply } }], usage: { cost: 0.001 } });
    }
    const path = href.replace('https://api.dataforseo.com/v3/', '');
    const engine = engineOf(path);
    calls.push({ kind: 'provider', engine, path, method: init.method, payload: init.body ? JSON.parse(init.body)[0] : undefined });
    if (lost.includes(engine)) throw new Error('socket hang up');
    if (path.endsWith('/task_post')) return task({ id: `job-${engine}`, status_code: 20100, status_message: 'Task Created.', cost: 0.002 });
    if (path.includes('/llm_scraper/')) return task({ id: `job-${engine}`, result: [{ markdown: CLEAR.answer, sources: [{ url: `https://example.com/${engine}`, title: engine }] }] });
    return task({ id: `job-${engine}`, result: [{ items: [{ type: 'ai_overview', markdown: CLEAR.answer }] }] });
  };
  return calls;
}
const rows = (sqlite, sql, ...params) => sqlite.prepare(sql).all(...params).map((row) => ({ ...row }));
async function pass(worker, sqlite, times = 1) {
  for (let at = 0; at < times; at++) {
    sqlite.exec("UPDATE comparison_runs SET input_json=json_set(input_json,'$.nextPollAt',0) WHERE status='submitted'");
    await worker.processComparisons();
  }
}

const editions = ['cloud', 'selfhost'].filter((edition) => existsSync(`${root}apps/${edition}/drizzle`));
for (const edition of editions) {
  async function setup(options = {}, settings = {}, at = '2026-11-12T10:00:00.000Z') {
    const sqlite = database(edition);
    seed(sqlite, options);
    globalThis.cmp = { control: d1(sqlite), stamp: at, settings: { DATAFORSEO_LOGIN: 'login', DATAFORSEO_PASSWORD: 'password', OPENROUTER_API_KEY: 'test-key', LLM_PROVIDER_ORDER: 'openrouter', ...settings } };
    const worker = await load(edition, 'lib/server/comparison-worker.ts');
    const api = await load(edition, 'lib/server/comparison.ts');
    return { sqlite, worker, api };
  }

  test(`${edition}: a period asks each product and persona of the AIs that take instructions, reads each answer and reports the win rate`, async () => {
    const { sqlite, worker, api } = await setup();
    const calls = provider();
    await pass(worker, sqlite, 3);
    const runs = rows(sqlite, 'SELECT engine,status,question,reading_json,cost_usd,reserved_usd,period_start FROM comparison_runs ORDER BY engine');
    // AI Overviews takes no instructions: never asked.
    assert.deepEqual(runs.map((run) => run.engine), ['chat_gpt', 'gemini', 'google_ai_mode']);
    assert.ok(runs.every((run) => run.status === 'completed' && run.reading_json && run.period_start === '2026-11-12'), JSON.stringify(runs));
    assert.match(runs[0].question, /^Which SEO consulting is best for a small business owner with a tight budget\? Options: .+ give each a score from 0 to 100/);
    assert.ok(calls.filter((call) => call.kind === 'reader').every((call) => call.payload.model === 'openai/gpt-6-luna' && call.payload.messages[0].content.includes('TEXT:')));
    // Settled at the provider's fee and the reading's cost, the reserve released.
    for (const run of runs) assert.deepEqual([Number(run.cost_usd.toFixed(4)), Number(run.reserved_usd.toFixed(4))], [0.003, 0.003]);
    assert.equal(calls.filter((call) => call.kind === 'reader').length, 3);
    assert.ok(calls.every((call) => call.engine !== 'google_ai_overviews'));
    // A second tick in the same period asks nothing again.
    const before = calls.length;
    await pass(worker, sqlite, 2);
    assert.equal(calls.length, before);
    const report = await api.comparisonReport('p', 'owner', new URLSearchParams({ days: '7' }));
    assert.equal(report.status, 'ready');
    assert.equal(report.answers, 3);
    assert.deepEqual([report.own.winRate, report.own.position, report.own.score], [1, 1, 80]);
    assert.deepEqual([report.discarded.total, report.days.map((row) => row.day)], [0, ['2026-11-12']]);
    assert.deepEqual(report.brands.map((row) => [row.brand, row.winRate]), [['Acme Agency', 1], ['Northwind Digital', 0], ['Blue Harbor', 0]]);
    assert.deepEqual(report.attributes.map((row) => [row.name, row.brands[0].brand, row.brands.find((brand) => brand.brand === 'Northwind Digital').winRate]), [['Price', 'Acme Agency', 0], ['Results', 'Acme Agency', 1]]);
    assert.deepEqual(report.products.map((row) => [row.name, row.winRate]), [['SEO consulting', 1]]);
    assert.deepEqual(report.left, [{ engine: 'google_ai_overviews', reason: 'instructions' }]);
    // Filters: one AI, and a product that has no answers (nothing, never a zero).
    const gemini = await api.comparisonReport('p', 'owner', new URLSearchParams({ days: '7', engine: 'gemini' }));
    assert.equal(gemini.answers, 1);
    const none = await api.comparisonReport('p', 'owner', new URLSearchParams({ days: '7', product: 'missing' }));
    assert.deepEqual([none.status, none.own.winRate, none.brands], ['waiting', null, []]);
    const { answers } = await api.comparisonAnswers('p', 'owner', new URLSearchParams({ days: '7', engine: 'chat_gpt' }));
    assert.deepEqual(answers.map((item) => [item.engine, item.product, item.reading.discarded, item.reading.scores.price['Acme Agency']]), [['chat_gpt', 'SEO consulting', null, { score: 85, fact: 'Monthly plans from US$ 900, no setup fee.' }]]);
    assert.ok(answers[0].answer.startsWith('## Price') && answers[0].id);
    // The spend counts in the project's ledger, module comparison.
    const { projectSpendSql } = await import(`${core}lib/platform-spend.ts`);
    const spent = sqlite.prepare(`SELECT ${projectSpendSql("'p'", "'2026-11-01T00:00:00.000Z'")} total`).get().total;
    assert.equal(Number(spent.toFixed(4)), 0.009);
  });

  test(`${edition}: a lost send is unknown at its reserve and never sent again; a reader error is tried again and costs nothing`, async () => {
    const { sqlite, worker } = await setup();
    let calls = provider({ lost: ['gemini'], reader: 'error' });
    await pass(worker, sqlite, 3);
    assert.deepEqual(rows(sqlite, "SELECT status,reserved_usd FROM comparison_runs WHERE engine='gemini'"), [{ status: 'unknown', reserved_usd: 0.04 }]);
    const unread = rows(sqlite, "SELECT reading_json,cost_usd,json_extract(input_json,'$.readAttempts') attempts FROM comparison_runs WHERE engine='chat_gpt'")[0];
    assert.equal(unread.reading_json, null);
    assert.equal(Number(unread.cost_usd.toFixed(4)), 0.002);
    assert.ok(unread.attempts >= 1);
    calls = provider();
    await pass(worker, sqlite, 1);
    assert.ok(rows(sqlite, "SELECT reading_json FROM comparison_runs WHERE engine='chat_gpt'")[0].reading_json);
    assert.ok(calls.every((call) => call.engine !== 'gemini'), 'the lost send is not repeated');
  });

  test(`${edition}: an answer whose order contradicts its scores is kept, counted as discarded and out of every figure`, async () => {
    const { sqlite, worker, api } = await setup();
    provider({ reader: 'contradiction' });
    await pass(worker, sqlite, 3);
    const report = await api.comparisonReport('p', 'owner', new URLSearchParams({ days: '7' }));
    assert.deepEqual([report.status, report.answers, report.discarded, report.brands], ['ready', 0, { total: 3, order: 3, evidence: 0, scores: 0 }, []]);
  });

  test(`${edition}: the rows asked the old way stay and no longer count; the period is asked again with scores, and a backfill keeps its cap`, async () => {
    const sqlite = database(edition, 'comparison_scores');
    seed(sqlite);
    sqlite.exec(`INSERT INTO comparison_runs(id,owner_id,project_id,day,period_start,product_id,persona_id,engine,question,roster_json,language_code,location_code,status,reading_json,requested_at)
      VALUES('old','owner','p','2026-11-12','2026-11-12','seo-consulting','owner','chat_gpt','Which is best?','${JSON.stringify(roster).replace(/'/g, "''")}','en',2840,'completed','{"overall":{"places":{},"winner":null},"attributes":{}}','2026-11-12T08:00:00.000Z')`);
    sqlite.exec(`INSERT INTO system_state(key,value) VALUES('comparison_done:p','2026-11-12:1')`);
    sqlite.rest();
    assert.deepEqual(rows(sqlite, 'SELECT id,method,status FROM comparison_runs'), [{ id: 'old', method: 1, status: 'completed' }]);
    globalThis.cmp = { control: d1(sqlite), stamp: '2026-11-12T10:00:00.000Z', settings: { DATAFORSEO_LOGIN: 'login', DATAFORSEO_PASSWORD: 'password', OPENROUTER_API_KEY: 'test-key', LLM_PROVIDER_ORDER: 'openrouter' } };
    const worker = await load(edition, 'lib/server/comparison-worker.ts');
    const api = await load(edition, 'lib/server/comparison.ts');
    provider();
    // A backfill above the ceiling is refused; one with room for two runs opens two (each reserves its worst case), idempotently.
    await assert.rejects(worker.comparisonRoundNow('p', 50), /round cap/);
    const first = await worker.comparisonRoundNow('p', 0.09);
    assert.equal(first.complete, false);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM comparison_runs WHERE method=2')[0].n, 2);
    await worker.comparisonRoundNow('p', 0.09);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM comparison_runs WHERE method=2')[0].n, 2);
    // More room opens the rest; the scheduler's next tick asks nothing again.
    const rest = await worker.comparisonRoundNow('p', 1);
    assert.equal(rest.complete, true);
    await pass(worker, sqlite, 3);
    assert.deepEqual(rows(sqlite, 'SELECT method,COUNT(*) n FROM comparison_runs GROUP BY method'), [{ method: 1, n: 1 }, { method: 2, n: 3 }]);
    const report = await api.comparisonReport('p', 'owner', new URLSearchParams({ days: '7' }));
    assert.equal(report.answers, 3);
  });

  test(`${edition}: comparison-reread anchors the stored readings again from their own cells, free, page by page and idempotently`, async () => {
    const { sqlite, worker, api } = await setup();
    const calls = provider();
    // Stored before the cap: the Netflix-shaped answer discarded for six high scores without a fact, three times, beside an order discard.
    const legacy = JSON.stringify(CAPPED.stored);
    const insert = sqlite.prepare(`INSERT INTO comparison_runs(id,workspace_id,project_id,day,period_start,product_id,persona_id,engine,method,question,roster_json,language_code,location_code,status,reading_json,requested_at)
      VALUES(?,'owner','p','2026-11-12','2026-11-12','family-streaming',?,?,2,'Which?',?,'en',2840,'completed',?,'2026-11-12T08:00:00.000Z')`);
    for (const [id, engine] of [['r1', 'chat_gpt'], ['r2', 'gemini'], ['r3', 'google_ai_mode']]) insert.run(id, 'parents', engine, JSON.stringify(CAPPED.roster), legacy);
    insert.run('r4', 'teens', 'chat_gpt', JSON.stringify(CAPPED.roster), JSON.stringify({ ...CAPPED.stored, discarded: 'order' }));
    const before = await api.comparisonReport('p', 'owner', new URLSearchParams({ days: '7' }), true);
    assert.deepEqual([before.answers, before.discarded, before.capped], [0, { total: 4, order: 1, evidence: 3, scores: 0 }, 0]);
    const pages = [];
    let page = { next: '' };
    do { page = await worker.rereadComparisons('p', page.next, 3); pages.push(page); } while (page.next);
    assert.deepEqual(pages.map(({ read, changed, discarded, capped, next }) => ({ read, changed, discarded, capped, next })), [
      { read: 3, changed: 3, discarded: { before: 3, after: 0 }, capped: 18, next: 'r3' },
      { read: 1, changed: 1, discarded: { before: 1, after: 1 }, capped: 6, next: null },
    ]);
    const after = await api.comparisonReport('p', 'owner', new URLSearchParams({ days: '7' }), true);
    assert.deepEqual([after.answers, after.discarded, after.capped], [3, { total: 1, order: 1, evidence: 0, scores: 0 }, 18]);
    assert.equal(after.attributes.find((row) => row.id === 'content-library').brands.find((row) => row.brand === 'Netflix').score, 59);
    // Anyone but a Lastfind admin gets no capped count.
    assert.equal((await api.comparisonReport('p', 'owner', new URLSearchParams({ days: '7' }))).capped, null);
    // Idempotent: a second pass reads every run and changes none.
    const stored = rows(sqlite, 'SELECT id,reading_json FROM comparison_runs ORDER BY id');
    const again = await worker.rereadComparisons('p', '', 200);
    assert.deepEqual([again.read, again.changed, again.discarded, again.capped, again.next], [4, 0, { before: 1, after: 1 }, 24, null]);
    assert.deepEqual(rows(sqlite, 'SELECT id,reading_json FROM comparison_runs ORDER BY id'), stored);
    assert.equal(calls.length, 0, 'no provider and no reader is asked');
  });

  test(`${edition}: no budget opens nothing and says why; monitoring paused asks nothing`, async () => {
    const { sqlite, worker } = await setup();
    sqlite.exec("INSERT INTO project_budgets(project_id,workspace_id,monthly_usd,updated_at,updated_by) VALUES('p','owner',0.01,'2026-11-01T00:00:00.000Z','owner')");
    provider();
    await pass(worker, sqlite);
    assert.equal(rows(sqlite, 'SELECT COUNT(*) n FROM comparison_runs')[0].n, 0);
    assert.equal(JSON.parse(rows(sqlite, "SELECT value FROM system_state WHERE key='budget_blocked:p'")[0].value).module, 'comparison');
    const paused = await setup();
    paused.sqlite.exec("UPDATE projects SET daily_enabled=0");
    const calls = provider();
    await pass(paused.worker, paused.sqlite, 2);
    assert.equal(calls.length, 0);
  });

  if (edition === 'cloud')
    test('cloud: the Free plan asks its one AI, weekly, and up to 3 products; a save above 3 is refused', async () => {
      const { sqlite, worker, api } = await setup({ plan: 'free', interval: 168, products: 4 });
      provider();
      await pass(worker, sqlite, 2);
      const runs = rows(sqlite, 'SELECT DISTINCT engine,period_start FROM comparison_runs');
      assert.deepEqual(runs, [{ engine: 'chat_gpt', period_start: '2026-11-09' }]);
      assert.equal(rows(sqlite, 'SELECT COUNT(DISTINCT product_id) n FROM comparison_runs')[0].n, 3);
      await assert.rejects(api.saveComparison('p', 'owner', CONFIG(4), 1), /up to 3 products/);
      const saved = await api.saveComparison('p', 'owner', CONFIG(3), 1);
      assert.deepEqual([saved.revision, saved.productLimit, saved.cadence, saved.engines], [2, 3, 'weekly', ['chat_gpt']]);
    });
}
