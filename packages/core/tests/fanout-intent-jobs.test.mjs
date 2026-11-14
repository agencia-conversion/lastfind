import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The search intents of a project's fan-out are bought by a background job, never while a page loads.
// Fixtures only: the model is a function in this file; nothing paid is called.
const root = fileURLToPath(new URL('../../../', import.meta.url));
function d1(sqlite) {
  const prepare = (sql, params = []) => ({
    sql,
    params,
    bind: (...values) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async () => sqlite.prepare(sql).get(...params) || null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
  });
  return {
    prepare,
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(({ sql, params }) => (/^\s*(SELECT|WITH)\b/i.test(sql) ? { results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) } : { meta: { changes: sqlite.prepare(sql).run(...params).changes } }));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
const stubs = {
  './env': 'export const db=()=>globalThis.intentFixture.db;export const now=()=>new Date().toISOString();export const setting=(name)=>globalThis.intentFixture.settings?.[name]??"";',
  './decisions-api': 'export const postDecisions=async()=>{throw new Error("no Decisions call here")};export const postChat=async(payload)=>globalThis.intentFixture.chat(payload);',
  './http': 'export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}',
  './workspace': `export async function ownedProject(id,owner){const p=await globalThis.intentFixture.db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived=0').bind(id,owner).first();if(!p)throw new Error('Project not found.');return p;}`,
  './classifier-models': 'export const classifierModels=(id,current)=>({model:globalThis.intentFixture.model??current,fallback:null});',
  './capabilities': 'export const researchAllProjects=false;',
  './project-store-read': 'export const projectReadDatabase=async()=>globalThis.intentFixture.store;export const storedCopy=async()=>({value:null,storedAt:0,keep(){}});',
  './competitor-analysis': 'export const syncCountedBrands=async()=>{};export const competitorAnalysisStatus=async()=>({status:"complete"});',
  './brand-decision-events': 'export const loadDecisionEvents=async()=>[];export const decisionEventsStatement=()=>globalThis.intentFixture.db.prepare("SELECT 1 x WHERE 0");export const decisionEventsFrom=()=>[];export const withoutDecided=async(_,items)=>items;',
  './reports': 'export const parseReportFilter=()=>({});',
  'cloudflare:workers': 'export const env={};export class DurableObject{};export const waitUntil=()=>{};',
};
const bundle = await build({
  absWorkingDir: root,
  entryPoints: [root + 'packages/core/lib/server/fanout-intents.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /^(\.\/(env|decisions-api|http|workspace|classifier-models|capabilities|project-store-read|reports|competitor-analysis|brand-decision-events)|cloudflare:workers)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
        plugin.onResolve({ filter: /^@\// }, (args) => ({ path: root + 'packages/core/' + args.path.slice(2) + (args.path.endsWith('.mjs') ? '' : '.ts') }));
      },
    },
  ],
});
const jobs = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

/** The model: every search about "price" goes to an intent about prices (created once, then reused), the rest fits none. */
function chat(payload, cost = 0.003) {
  const { intents, searches } = JSON.parse(payload.messages[1].content);
  const prices = intents.find((intent) => intent.name === 'Streaming prices');
  const created = !prices && searches.some((search) => /price/i.test(search.text));
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: payload.model,
      usage: { cost },
      choices: [
        {
          message: {
            content: JSON.stringify({
              new_intents: created ? [{ ref: 'n1', name: 'Streaming prices', description: 'Plans compared by price.', entities: [{ type: 'modifier', value: 'price' }] }] : [],
              assignments: searches.map((search) => ({ search: search.id, intent: /price/i.test(search.text) ? (prices?.id ?? 'n1') : null })),
            }),
          },
        },
      ],
    }),
  };
}

function setup(edition, searches) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = root + `apps/${edition}/drizzle/`;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(dir + name, 'utf8'));
  const stamp = new Date().toISOString();
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('owner','owner@test.example','Owner',?)").run(stamp);
  sqlite
    .prepare("INSERT INTO projects(id,workspace_id,name,domain,category,competitors_json,language_code,location_code,daily_enabled,created_at) VALUES('project','owner','Netflix','netflix.com','streaming','[]','en',2840,0,?)")
    .run(stamp);
  sqlite.prepare("UPDATE project_stores SET initialized=1 WHERE project_id='project'").run();
  // The project's store: only what the job reads of its answers.
  const store = new DatabaseSync(':memory:');
  store.exec("CREATE TABLE runs(id TEXT,project_id TEXT,workspace_id TEXT,status TEXT,response_available INTEGER,created_at TEXT,search_queries_json TEXT NOT NULL DEFAULT '[]',engine TEXT NOT NULL DEFAULT 'chat_gpt')");
  searches.forEach((list, index) =>
    store.prepare("INSERT INTO runs(id,project_id,workspace_id,status,response_available,created_at,search_queries_json) VALUES(?,'project','owner','complete',1,?,?)").run(`run-${index}`, stamp, JSON.stringify(list)),
  );
  const calls = [];
  globalThis.intentFixture = {
    db: d1(sqlite),
    store: d1(store),
    settings: { OPENROUTER_API_KEY: 'fixture' },
    calls,
    chat: async (payload) => {
      calls.push(payload);
      return chat(payload);
    },
  };
  return { sqlite, store, calls };
}
const intentRows = (sqlite) => sqlite.prepare('SELECT name,entities_json FROM fanout_intents ORDER BY name').all().map((row) => ({ ...row }));
const assigned = (sqlite) =>
  Object.fromEntries(sqlite.prepare('SELECT q.query_key k,i.name n FROM fanout_query_intents q LEFT JOIN fanout_intents i ON i.id=q.intent_id').all().map((row) => [row.k, row.n]));
const ledger = (sqlite) => sqlite.prepare("SELECT status,cost_usd,reserved_usd FROM brand_research_jobs WHERE context_key='fanout-intents:v1' ORDER BY requested_at,rowid").all().map((row) => ({ ...row }));

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(root + `apps/${name}/drizzle`))) {
  test(`fan-out intents: the searches without an intent are asked once, kept with the new intents, and never asked again (${edition})`, async () => {
    const { sqlite, calls } = setup(edition, [['Netflix price', 'netflix  PRICE', 'weather today'], ['HBO price', 'Netflix price'], []]);
    try {
      assert.equal(await jobs.classifyIntents('project', 'owner'), 1);
      assert.equal(calls.length, 1);
      // One request with the distinct searches, most frequent first; the model sees no intent yet.
      assert.deepEqual(JSON.parse(calls[0].messages[1].content), {
        intents: [],
        searches: [
          { id: 'q1', text: 'Netflix price' },
          { id: 'q2', text: 'HBO price' },
          { id: 'q3', text: 'weather today' },
        ],
      });
      assert.deepEqual(intentRows(sqlite), [{ name: 'Streaming prices', entities_json: '[{"type":"modifier","value":"price"}]' }]);
      assert.deepEqual(assigned(sqlite), { 'netflix price': 'Streaming prices', 'hbo price': 'Streaming prices', 'weather today': null });
      assert.deepEqual(ledger(sqlite), [{ status: 'completed', cost_usd: 0.003, reserved_usd: 0.003 }]);
      // The reports' revision of the project's intents moved.
      assert.ok(sqlite.prepare("SELECT value FROM system_state WHERE key='fanout-intents:project'").get());
      // Nothing left: no request.
      assert.equal(await jobs.classifyIntents('project', 'owner'), 0);
      assert.equal(calls.length, 1);
    } finally {
      sqlite.close();
      delete globalThis.intentFixture;
    }
  });
}

const anyEdition = ['cloud', 'selfhost'].find((name) => existsSync(root + `apps/${name}/drizzle`));

test('fan-out intents: a later request sees the intents created before and reuses them', async () => {
  const { sqlite, store, calls } = setup(anyEdition, [['Netflix price']]);
  try {
    assert.equal(await jobs.classifyIntents('project', 'owner'), 1);
    store.prepare("INSERT INTO runs(id,project_id,workspace_id,status,response_available,created_at,search_queries_json) VALUES('run-new','project','owner','complete',1,?,?)").run(new Date().toISOString(), JSON.stringify(['Disney price', 'anime']));
    assert.equal(await jobs.classifyIntents('project', 'owner'), 1);
    const second = JSON.parse(calls[1].messages[1].content);
    assert.deepEqual(second.intents, [{ id: 'i1', name: 'Streaming prices', description: 'Plans compared by price.' }]);
    assert.deepEqual(second.searches.map((search) => search.text), ['anime', 'Disney price']);
    assert.equal(intentRows(sqlite).length, 1, 'no second intent for the same need');
    assert.equal(assigned(sqlite)['disney price'], 'Streaming prices');
    const read = await jobs.projectIntents('project', 'fixture-revision');
    assert.deepEqual(read.intents.map((intent) => intent.name), ['Streaming prices']);
    assert.equal(new Map(read.assignments).get('anime'), '');
  } finally {
    sqlite.close();
    delete globalThis.intentFixture;
  }
});

test('fan-out intents: the monthly ceiling of the project holds the request, and a failed call keeps nothing but its row', async () => {
  const { sqlite, calls } = setup(anyEdition, [['Netflix price']]);
  try {
    // A month already spent up to the ceiling: nothing is reserved, nothing is asked.
    sqlite
      .prepare(
        "INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,cost_usd,input_json,requested_at) VALUES('spent','owner','project','old','fanout-intents:v1','old','fanout-intents','m','completed',2,2,'{\"keys\":[]}',?)",
      )
      .run(new Date().toISOString());
    assert.equal(await jobs.classifyIntents('project', 'owner'), 0);
    assert.equal(calls.length, 0);
    sqlite.prepare("DELETE FROM brand_research_jobs WHERE id='spent'").run();
    // A refusal before any work (HTTP 400: not billed) fails the job and writes no intent.
    globalThis.intentFixture.chat = async (payload) => (calls.push(payload), { ok: false, status: 400, json: async () => ({}) });
    assert.equal(await jobs.classifyIntents('project', 'owner'), 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(intentRows(sqlite), []);
    assert.deepEqual(assigned(sqlite), {});
    assert.equal(ledger(sqlite)[0].status, 'failed');
    // Within the retry wait the same request is not sent again.
    assert.equal(await jobs.classifyIntents('project', 'owner'), 0);
    assert.equal(calls.length, 1);
  } finally {
    sqlite.close();
    delete globalThis.intentFixture;
  }
});

test('fan-out intents: the scheduler step needs the key and looks at a project at most once an hour', async () => {
  const { sqlite, calls } = setup(anyEdition, [['Netflix price']]);
  try {
    globalThis.intentFixture.settings = {};
    assert.equal(await jobs.processFanoutIntents(), 0);
    assert.equal(calls.length, 0);
    globalThis.intentFixture.settings = { OPENROUTER_API_KEY: 'fixture' };
    assert.equal(await jobs.processFanoutIntents(), 1);
    assert.equal(await jobs.processFanoutIntents(), 0, 'looked at a moment ago');
    assert.equal(calls.length, 1);
  } finally {
    sqlite.close();
    delete globalThis.intentFixture;
  }
});

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(root + `apps/${name}/drizzle`))) {
  test(`fan-out intents: a search that differs from an assigned one only in word order, accents or stop words takes its intent without a call (${edition})`, async () => {
    const { sqlite, store, calls } = setup(edition, [['preço netflix', 'preço netflix', 'weather today']]);
    try {
      assert.equal(await jobs.classifyIntents('project', 'owner'), 1);
      assert.equal(calls.length, 1);
      const stamp = new Date().toISOString();
      // New searches: the same words reordered, without the accent or with stop words; one new need; two of a new key at once.
      store
        .prepare("INSERT INTO runs(id,project_id,workspace_id,status,response_available,created_at,search_queries_json) VALUES('run-new','project','owner','complete',1,?,?)")
        .run(stamp, JSON.stringify(['netflix preco', 'o preço da netflix', 'today the weather', 'hbo price', 'price of hbo']));
      assert.equal(await jobs.classifyIntents('project', 'owner'), 1);
      assert.equal(calls.length, 2);
      assert.deepEqual(JSON.parse(calls[1].messages[1].content).searches.map((search) => search.text), ['hbo price'], 'one search per new key; the others matched');
      const intents = assigned(sqlite);
      assert.equal(intents['netflix preco'], intents['preco netflix']);
      assert.equal(intents['o preco da netflix'], intents['preco netflix']);
      assert.equal(intents['today the weather'], null);
      // The waiting twin takes the new search's intent on the next step, again without a call.
      assert.equal(await jobs.classifyIntents('project', 'owner'), 0);
      assert.equal(calls.length, 2);
      assert.equal(assigned(sqlite)['price of hbo'], assigned(sqlite)['hbo price']);
      assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM fanout_query_intents WHERE model='tokens'").get().n, 4);
    } finally {
      sqlite.close();
      delete globalThis.intentFixture;
    }
  });
}
