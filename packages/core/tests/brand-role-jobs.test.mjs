import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The decision model's verdicts on discovered names are bought by a job, never while a page loads.
// Fixtures only: the provider is a function in this file; nothing paid is called.
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
  './env': 'export const db=()=>globalThis.roleFixture.db;export const now=()=>new Date().toISOString();export const setting=(name)=>globalThis.roleFixture.settings?.[name]??"";',
  './decisions-api': 'export const postDecisions=async(payload)=>globalThis.roleFixture.decisions(payload);',
  './http': 'export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}',
  './workspace': `export async function ownedProject(id,owner){const p=await globalThis.roleFixture.db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived=0').bind(id,owner).first();if(!p)throw new Error('Project not found.');return p;}
`,
  './competitor-analysis': 'export const syncCountedBrands=async()=>{};export const competitorAnalysisStatus=async()=>{globalThis.roleFixture.statusReads++;return {status:"complete",publicationPending:false,suggestions:globalThis.roleFixture.suggestions};};',
  './capabilities': 'export const researchAllProjects=false;export const platformLimitDefaults={monthUsd:2000,dayUsd:64};',
  './project-store-read': 'export const projectReadDatabase=async()=>globalThis.roleFixture.db;export const storedCopy=async()=>({value:null,storedAt:0,keep(){}});',
  './brand-decision-events': 'export const loadDecisionEvents=async()=>[];export const decisionEventsStatement=()=>globalThis.roleFixture.db.prepare("SELECT 1 x WHERE 0");export const decisionEventsFrom=()=>[];export const withoutDecided=async(_,items)=>items;',
  './reports': 'export const parseReportFilter=()=>({});',
  './brand-mention-checks': 'export const checkMentions=async()=>0;',
};
// Two bundles with different text are two modules: two isolates sharing one database.
async function isolate(tag, entry = 'packages/core/lib/server/brand-role-jobs.ts') {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: [root + entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    footer: { js: `// isolate ${tag}` },
    plugins: [
      {
        name: 'fixtures',
        setup(plugin) {
          plugin.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'workers-shim' }));
          plugin.onLoad({ filter: /.*/, namespace: 'workers-shim' }, () => ({ contents: 'export const waitUntil=()=>{};export const env={};', loader: 'js' }));
          plugin.onResolve({ filter: /^\.\/(env|http|workspace|competitor-analysis|decisions-api|capabilities|project-store-read|brand-decision-events|reports|brand-mention-checks)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
          plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
          plugin.onResolve({ filter: /^@\// }, (args) => ({ path: root + 'packages/core/' + args.path.slice(2) + (args.path.endsWith('.mjs') ? '' : '.ts') }));
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}
const first = await isolate('a');
const second = await isolate('b');

const suggestion = (name) => ({ name, domain: null, score: 0.9, answerCount: 3, evidence: [{ runId: `run-${name}`, excerpt: `${name} excerpt`, createdAt: '2026-10-16T00:00:00.000Z' }] });
const context = { brands: ['Netflix', 'Hulu'], category: 'streaming' };
// The public export has no cloud edition: single-edition tests run on the one that is here.
const anyEdition = ['cloud', 'selfhost'].find((name) => existsSync(root + `apps/${name}/drizzle`));
function setup(edition, names = ['Roku', 'Adobe', 'Tubi']) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = root + `apps/${edition}/drizzle/`;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(dir + name, 'utf8'));
  const stamp = new Date().toISOString();
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('owner','owner@test.example','Owner',?)").run(stamp);
  sqlite
    .prepare("INSERT INTO projects(id,workspace_id,name,domain,category,competitors_json,language_code,location_code,daily_enabled,created_at) VALUES('project','owner','Netflix','netflix.com','streaming',?,'en',2840,0,?)")
    .run(JSON.stringify([{ name: 'Hulu', domain: 'hulu.com' }]), stamp);
  sqlite.prepare("UPDATE project_stores SET initialized=1 WHERE project_id='project'").run();
  const calls = [];
  globalThis.roleFixture = {
    db: d1(sqlite),
    settings: { OPENROUTER_API_KEY: 'fixture' },
    suggestions: names.map(suggestion),
    statusReads: 0,
    calls,
    decisions: async (payload) => {
      calls.push(payload);
      return answer(payload, (name) => ({ Adobe: 'client', Tubi: 'ambiguous' })[name] ?? 'competitor');
    },
  };
  return { sqlite, calls };
}
const answer = (payload, choose, cost = 0.0004) => ({
  ok: true,
  status: 200,
  json: async () => ({
    model: payload.model,
    usage: { cost },
    answers: Object.fromEntries(payload.state.identities.map((identity) => [identity.id, { type: 'choice', choice: choose(identity.name) }])),
  }),
});
const classify = (module = first, suggestions = globalThis.roleFixture.suggestions) => module.classifyBrandRoles('project', 'owner', context, suggestions);
const jobs = (sqlite) => sqlite.prepare("SELECT status,cost_usd,reserved_usd,model FROM brand_research_jobs WHERE context_key LIKE 'brand-roles:%' ORDER BY requested_at,rowid").all();
const decisions = (sqlite) => sqlite.prepare('SELECT brand_key,role,cost_usd FROM brand_role_decisions ORDER BY brand_key').all();
const age = (sqlite) => sqlite.prepare("UPDATE brand_research_jobs SET completed_at='2000-01-01T00:00:00.000Z'").run();

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(root + `apps/${name}/drizzle`))) {
  test(`brand role jobs: one request for the names without an answer, kept with its cost, never asked again (${edition})`, async () => {
    const { sqlite, calls } = setup(edition);
    try {
      assert.equal(await classify(), 'answered');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].model, 'liquid/d1-ultra');
      assert.deepEqual(calls[0].state.identities.map((identity) => identity.name), ['Roku', 'Adobe', 'Tubi']);
      assert.deepEqual(decisions(sqlite).map((row) => [row.brand_key, row.role]), [['adobe', 'client'], ['roku', 'competitor'], ['tubi', 'ambiguous']]);
      assert.ok(decisions(sqlite).every((row) => row.cost_usd === 0.0004 / 3));
      assert.deepEqual(jobs(sqlite).map((job) => [job.status, job.cost_usd, job.reserved_usd]), [['completed', 0.0004, 0.0004]]);
      // Nothing left to ask: no request, no row.
      assert.equal(await classify(), 'nothing');
      // A new name is asked alone, in its own request.
      globalThis.roleFixture.suggestions.push(suggestion('Canva'));
      assert.equal(await classify(), 'answered');
      assert.deepEqual(calls[1].state.identities.map((identity) => identity.name), ['Canva']);
      assert.equal(jobs(sqlite).length, 2);
    } finally {
      sqlite.close();
      delete globalThis.roleFixture;
    }
  });
}

test('brand role jobs: two isolates asking at once pay once', async () => {
  const { sqlite, calls } = setup(anyEdition);
  try {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      await gate;
      return answer(payload, () => 'competitor');
    };
    const one = classify(first);
    // The first isolate's call is in flight (its claim is saved) before the second asks: otherwise, on a busy machine,
    // the second could claim first and wait on the gate this test only opens after it.
    while (!calls.length) await new Promise((resolve) => setTimeout(resolve, 1));
    const two = classify(second);
    // The claim is a row in the shared database: the second isolate finds the names in flight and asks nothing.
    assert.ok(['held', 'nothing'].includes(await two));
    release();
    assert.equal(await one, 'answered');
    assert.equal(calls.length, 1);
    assert.equal(jobs(sqlite).length, 1);
    // A repeated tick, in either isolate, finds the answers.
    assert.equal(await classify(second), 'nothing');
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('brand role jobs: a refusal (429) costs nothing, cools down in the database and is retried later', async () => {
  const { sqlite, calls } = setup(anyEdition);
  try {
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      return { ok: false, status: 429, json: async () => ({}) };
    };
    assert.equal(await classify(), 'failed');
    assert.deepEqual(jobs(sqlite).map((job) => [job.status, job.cost_usd, job.reserved_usd]), [['failed', 0, 0]]);
    assert.equal(decisions(sqlite).length, 0);
    // Another isolate, a restart or the next tick does not call again while it cools down.
    assert.equal(await classify(second), 'held');
    assert.equal(calls.length, 1);
    age(sqlite);
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      return answer(payload, () => 'competitor');
    };
    assert.equal(await classify(second), 'answered');
    assert.equal(calls.length, 2);
    assert.equal(decisions(sqlite).length, 3);
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('brand role jobs: a call whose cost is unknown keeps its reservation and is never resent', async () => {
  const { sqlite, calls } = setup(anyEdition);
  try {
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      throw new Error('The operation was aborted due to timeout');
    };
    assert.equal(await classify(), 'failed');
    assert.deepEqual(jobs(sqlite).map((job) => [job.status, job.cost_usd, job.reserved_usd]), [['unknown', 0, 0.005]]);
    age(sqlite);
    // The same names, even long after: they are in an uncertain request, so there is nothing to ask.
    assert.equal(await classify(), 'nothing');
    assert.equal(await classify(second), 'nothing');
    assert.equal(calls.length, 1);
    assert.equal(decisions(sqlite).length, 0);
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('brand role jobs: the configured model falls back to the previous engine when it fails (5xx) and the answer is kept under the model that gave it', async () => {
  const { sqlite, calls } = setup(anyEdition);
  try {
    globalThis.roleFixture.settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ brand_roles: 'vendor/new-model' });
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      if (payload.model === 'vendor/new-model') return { ok: false, status: 500, json: async () => ({}) };
      return answer(payload, () => 'competitor');
    };
    assert.equal(await classify(), 'answered');
    assert.deepEqual(calls.map((call) => call.model), ['vendor/new-model', 'liquid/d1-ultra']);
    // Kept under the model that answered and the criteria it answered (v4).
    assert.deepEqual(sqlite.prepare('SELECT DISTINCT model FROM brand_role_decisions').all().map((row) => row.model), ['liquid/d1-ultra@v4']);
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('brand role jobs: a timeout or a rate limit on the configured model is not resent to the fallback', async () => {
  for (const failure of [() => { throw new Error('The operation was aborted due to timeout'); }, () => ({ ok: false, status: 429, json: async () => ({}) })]) {
    const { sqlite, calls } = setup(anyEdition);
    try {
      globalThis.roleFixture.settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ brand_roles: 'vendor/new-model' });
      globalThis.roleFixture.decisions = async (payload) => {
        calls.push(payload);
        return failure();
      };
      assert.equal(await classify(), 'failed');
      assert.deepEqual(calls.map((call) => call.model), ['vendor/new-model']);
    } finally {
      sqlite.close();
      delete globalThis.roleFixture;
    }
  }
});

test('brand role jobs: names of a call that may have been billed are not sent again in the next batch', async () => {
  const { sqlite, calls } = setup(anyEdition, ['Roku', 'Adobe']);
  try {
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      throw new Error('The operation was aborted due to timeout');
    };
    assert.equal(await classify(), 'failed');
    assert.equal(jobs(sqlite)[0].status, 'unknown');
    // A later analysis finds Canva: the new batch carries Canva alone; Roku and Adobe wait in review, unpaid twice.
    globalThis.roleFixture.suggestions.push(suggestion('Canva'));
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      return answer(payload, () => 'competitor');
    };
    assert.equal(await classify(second), 'answered');
    assert.deepEqual(calls[1].state.identities.map((identity) => identity.name), ['Canva']);
    assert.deepEqual(decisions(sqlite).map((row) => row.brand_key), ['canva']);
    // Only the uncertain names left: nothing to ask.
    globalThis.roleFixture.suggestions = globalThis.roleFixture.suggestions.filter((item) => item.name !== 'Canva');
    assert.equal(await classify(), 'nothing');
    assert.equal(calls.length, 2);
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('brand role jobs: overlapping batches do not repeat a name that is still in flight', async () => {
  const { sqlite, calls } = setup(anyEdition, ['Roku', 'Adobe']);
  try {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      if (calls.length === 1) await gate;
      return answer(payload, () => 'competitor');
    };
    const one = classify(first);
    while (!calls.length) await new Promise((resolve) => setTimeout(resolve, 5));
    const next = [...globalThis.roleFixture.suggestions, suggestion('Canva')];
    assert.equal(await classify(second, next), 'answered');
    assert.deepEqual(calls[1].state.identities.map((identity) => identity.name), ['Canva']);
    release();
    assert.equal(await one, 'answered');
    assert.deepEqual(decisions(sqlite).map((row) => row.brand_key), ['adobe', 'canva', 'roku']);
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('brand role jobs: at most 20 names per request, the rest in later requests, and never without a key or inside the budget caps', async () => {
  const names = Array.from({ length: 45 }, (_, index) => `Brand${String(index).padStart(2, '0')}`);
  const { sqlite, calls } = setup(anyEdition, names);
  try {
    globalThis.roleFixture.settings = {};
    assert.equal(await classify(), 'skipped');
    assert.equal(calls.length, 0);
    assert.equal(jobs(sqlite).length, 0);
    globalThis.roleFixture.settings = { OPENROUTER_API_KEY: 'fixture' };
    // A budget that is already spent: no row, no call.
    sqlite
      .prepare("INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at) VALUES('spent','owner','project','k','source-types:x','k','jev','m','unknown',2000,'{}',?)")
      .run(new Date().toISOString());
    assert.equal(await classify(), 'held');
    assert.equal(calls.length, 0);
    sqlite.prepare("DELETE FROM brand_research_jobs WHERE id='spent'").run();
    assert.equal(await classify(), 'answered');
    assert.equal(await classify(), 'answered');
    assert.equal(await classify(), 'answered');
    assert.equal(await classify(), 'nothing');
    // The requests run side by side (ROLE_CONCURRENCY): which one is answered first varies, so the sizes are compared sorted.
    assert.deepEqual(calls.map((call) => call.state.identities.length).sort((a, b) => b - a), [20, 20, 5]);
    assert.equal(decisions(sqlite).length, 45);
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('brand role jobs: the scheduler step visits a project once, then waits', async () => {
  const { sqlite, calls } = setup(anyEdition);
  try {
    assert.equal(await first.processBrandRoles(), 1);
    assert.equal(calls.length, 1);
    assert.equal(globalThis.roleFixture.statusReads, 1);
    // Looked at a moment ago: not visited again by this or another isolate.
    assert.equal(await second.processBrandRoles(), 0);
    assert.equal(globalThis.roleFixture.statusReads, 1);
    // An answer that never came back is uncertain, not pending.
    sqlite.prepare("UPDATE brand_research_jobs SET status='submitting',started_at='2000-01-01T00:00:00.000Z',completed_at=NULL,reserved_usd=0.005").run();
    sqlite.prepare("DELETE FROM brand_role_decisions").run();
    sqlite.prepare("UPDATE system_state SET value='2000-01-01T00:00:00.000Z' WHERE key LIKE 'brand-roles-checked:%'").run();
    assert.equal(await first.processBrandRoles(), 0);
    assert.equal(jobs(sqlite)[0].status, 'unknown');
    assert.equal(calls.length, 1);
    // Without a key the scheduler does nothing at all.
    globalThis.roleFixture.settings = {};
    sqlite.prepare("UPDATE system_state SET value='2000-01-01T00:00:00.000Z' WHERE key LIKE 'brand-roles-checked:%'").run();
    assert.equal(await first.processBrandRoles(), 0);
    assert.equal(globalThis.roleFixture.statusReads, 2);
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('brand role jobs: one tick sends request after request while they are answered, and a 402 stops it', async () => {
  const names = Array.from({ length: 45 }, (_, index) => `Brand${String(index).padStart(2, '0')}`);
  const { sqlite, calls } = setup(anyEdition, names);
  try {
    assert.equal(await first.processBrandRoles(), 3);
    // Side by side too (ROLE_CONCURRENCY): compared sorted, as above.
    assert.deepEqual(calls.map((call) => call.state.identities.length).sort((a, b) => b - a), [20, 20, 5]);
    assert.equal(decisions(sqlite).length, 45);
    // Credits exhausted: the first request fails, costs nothing, and the tick asks nothing more.
    globalThis.roleFixture.suggestions.push(...['Late01', 'Late02'].map(suggestion));
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      return { ok: false, status: 402, json: async () => ({ error: { message: 'Insufficient credits' } }) };
    };
    sqlite.prepare("UPDATE system_state SET value='2000-01-01T00:00:00.000Z' WHERE key LIKE 'brand-roles-checked:%'").run();
    assert.equal(await first.processBrandRoles(), 1);
    assert.equal(calls.length, 4);
    assert.equal(jobs(sqlite).at(-1).status, 'failed');
    assert.equal(jobs(sqlite).at(-1).cost_usd, 0);
    assert.equal(decisions(sqlite).length, 45, 'the names wait in review');
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

// Per-question roles. The fixture's project store is the same database, with the answer columns of the store.
function questionSetup(edition = anyEdition) {
  const fixture = setup(edition, []);
  fixture.sqlite.exec('ALTER TABLE runs ADD COLUMN answer TEXT; ALTER TABLE runs ADD COLUMN response_available INTEGER DEFAULT 1;');
  const stamp = new Date().toISOString();
  fixture.sqlite.prepare("INSERT INTO prompts(id,unit_id,project_id,text,engine,next_run_at,created_at) VALUES('p1','p1','project','Q','chat_gpt',?,?)").run(stamp, stamp);
  fixture.answer = (id, question, answer, at = new Date().toISOString()) =>
    fixture.sqlite
      .prepare(`INSERT INTO runs(id,workspace_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,status,callback_token,cost,created_at,budget_credits,answer,response_available)
      VALUES(?,'owner','project','p1',?,?,'chat_gpt','[]',2840,'en','complete','fixture',0,?,0,?,1)`)
      .run(id, id, question, at, answer);
  fixture.authorize = (ceilingUsd = 3) =>
    fixture.sqlite
      .prepare("INSERT INTO system_state(key,value) VALUES('brand_question_roles',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify({ status: 'enabled', ceilingUsd, enabledAt: '2000-01-01T00:00:00.000Z' }));
  fixture.tick = () => fixture.sqlite.prepare("UPDATE system_state SET value='2000-01-01T00:00:00.000Z' WHERE key LIKE 'brand-roles-checked:%'").run();
  fixture.roles = () => fixture.sqlite.prepare('SELECT question,brand_key,role FROM brand_question_roles ORDER BY question,brand_key').all().map((row) => [row.question, row.brand_key, row.role]);
  return fixture;
}
const listAnswer = (...names) => names.map((name) => `- **${name}**: agency.`).join('\n');

test('brand roles per question: nothing per question until authorized, then one request per question with the question, never asked again', async () => {
  const { sqlite, calls, answer, authorize, tick, roles } = questionSetup();
  try {
    answer('a1', 'Which agencies build accessible sites?', listAnswer('Alavanca Digital', 'EqualWeb', 'Hulu'), '2026-10-20T00:00:00.000Z');
    answer('a2', 'Which SEO agencies handle large sites?', listAnswer('Alavanca Digital', 'Cadastra'), '2026-10-21T00:00:00.000Z');
    // Not authorized: the per-name classifier runs (no suggestions here), nothing per question.
    assert.equal(await first.processBrandRoles(), 0);
    assert.deepEqual(roles(), []);
    authorize();
    tick();
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      return answerFor(payload);
    };
    const answerFor = (payload) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          model: payload.model,
          usage: { cost: 0.0004 },
          answers: Object.fromEntries(
            payload.state.identities.map((identity) => [
              identity.id,
              { type: 'choice', choice: identity.name === 'Alavanca Digital' && /accessible/.test(payload.state.question) ? 'competitor' : identity.name === 'EqualWeb' ? 'supplier' : 'competitor' },
            ]),
          ),
        }),
      });
    assert.equal(await first.processBrandRoles(), 2);
    // One request per question, the question in the state and in each instruction; tracked brands (Hulu) are not asked.
    assert.deepEqual(calls.map((call) => call.state.question).sort(), ['Which SEO agencies handle large sites?', 'Which agencies build accessible sites?']);
    assert.ok(calls.every((call) => Object.values(call.questions).every((question) => question.instructions.includes(call.state.question))));
    assert.deepEqual(roles(), [
      ['Which SEO agencies handle large sites?', 'alavanca digital', 'competitor'],
      ['Which SEO agencies handle large sites?', 'cadastra', 'competitor'],
      ['Which agencies build accessible sites?', 'alavanca digital', 'competitor'],
      ['Which agencies build accessible sites?', 'equalweb', 'supplier'],
    ]);
    // A new answer to a known question asks only its new name; the old answers are not read again.
    answer('a3', 'which  agencies build ACCESSIBLE sites?', listAnswer('EqualWeb', 'Bela Agência'), '2026-10-22T00:00:00.000Z');
    tick();
    assert.equal(await first.processBrandRoles(), 1);
    assert.deepEqual(calls.at(-1).state.identities.map((identity) => identity.name), ['Bela Agência']);
    tick();
    assert.equal(await first.processBrandRoles(), 0);
    assert.equal(calls.length, 3);
    // The project's role aggregates the questions, with the evidence; the answer's own question wins in its detail.
    const roleModule = await import('../lib/brand-roles.ts');
    assert.equal(roleModule.aggregateRole({ competitor: 1, supplier: 1 }), 'competitor');
    assert.equal(roleModule.aggregateRole({ competitor: 1, supplier: 2 }), 'supplier');
    assert.equal(roleModule.aggregateRole({ ambiguous: 3 }), 'ambiguous');
    assert.equal(await roleModule.questionKey('Which  agencies build ACCESSIBLE sites? '), await roleModule.questionKey('which agencies build accessible sites?'));
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('brand roles per question: questions go ROLE_CONCURRENCY at a time, across pages, each asked once', async () => {
  const { sqlite, calls, answer: insert, authorize } = questionSetup();
  try {
    // 60 answers to 30 questions (three pages): one request per question.
    const syllables = ['Ka', 'Lo', 'Mi', 'Nu', 'Pe', 'Ra', 'Su', 'Ti'];
    for (let index = 0; index < 60; index++)
      insert(`q${index}`, `Question ${String.fromCharCode(65 + (index % 30))}?`, listAnswer(`${syllables[index % 8]}${syllables[Math.floor(index / 8)].toLowerCase()} Agency`), new Date(Date.UTC(2026, 9, 20, 0, index)).toISOString());
    authorize();
    let open = 0;
    let peak = 0;
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      peak = Math.max(peak, ++open);
      await new Promise((resolve) => setTimeout(resolve, 10));
      open--;
      return answer(payload, () => 'competitor');
    };
    assert.equal(await first.processBrandRoles(), 30);
    assert.equal(peak, first.ROLE_CONCURRENCY);
    assert.equal(new Set(calls.map((call) => call.state.question)).size, 30);
    const asked = calls.flatMap((call) => call.state.identities).length;
    assert.ok(asked >= 50, `${asked} names asked`);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM brand_question_roles').get().n, asked);
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('brand roles per question: the authorized ceiling holds in the reservation, and a failure stops the project', async () => {
  const { sqlite, calls, answer, authorize, tick, roles } = questionSetup('selfhost');
  try {
    answer('a1', 'Question one?', listAnswer('Alpha Agency', 'Beta Agency'), '2026-10-20T00:00:00.000Z');
    answer('a2', 'Question two?', listAnswer('Gamma Agency'), '2026-10-21T00:00:00.000Z');
    // The ceiling is per project and month (8/11/2026): an earlier month's spend, and another project's, leave this one's untouched.
    const spentJob = sqlite.prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,cost_usd,input_json,requested_at)
      VALUES(?,'owner',?,?,'brand-roles:q1',?,'brand-roles','m','completed',0,1,'{}',?)`);
    sqlite.prepare("INSERT INTO projects(id,workspace_id,name,domain,created_at) VALUES('other-project','owner','Other','other.example',?)").run(new Date().toISOString());
    spentJob.run('old', 'project', 'old', 'old', '2000-02-01T00:00:00.000Z');
    spentJob.run('other', 'other-project', 'other', 'other', `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`);
    // Room for one reservation only (US$ 0.005 each; the first settles at US$ 0.0004): one request, then the ceiling holds the second.
    authorize(0.005);
    assert.equal(await first.processBrandRoles(), 1);
    assert.equal(calls.length, 1);
    assert.equal(roles().length, calls[0].state.identities.length);
    // A 402 costs nothing, is kept failed, and the names wait.
    authorize(3);
    tick();
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      return { ok: false, status: 402, json: async () => ({}) };
    };
    assert.equal(await first.processBrandRoles(), 1);
    assert.equal(jobs(sqlite).at(-1).status, 'failed');
    assert.equal(jobs(sqlite).at(-1).cost_usd, 0);
    assert.equal(roles().length, calls[0].state.identities.length);
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('brand roles per question: a listed name met only in running text still gets the per-name verdict, a structured one waits for its question', async () => {
  const { sqlite, calls, answer, authorize, tick, roles } = questionSetup();
  try {
    answer('a1', 'Which agencies?', `Synthetic preview answer. Alternatives include Zenith Cloud.\n${listAnswer('Alpha Agency')}`, '2026-10-20T00:00:00.000Z');
    // The analysis lists all three; only "Alternatives" was never the head of an item (score 0.5).
    globalThis.roleFixture.suggestions = [{ ...suggestion('Alternatives'), score: 0.5 }, { ...suggestion('Zenith Cloud'), score: 1 }, { ...suggestion('Late Agency'), score: 1 }];
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      return roleAnswer(payload);
    };
    const roleAnswer = (payload) => ({
      ok: true,
      status: 200,
      json: async () => ({
        model: payload.model,
        usage: { cost: 0.0004 },
        answers: Object.fromEntries(payload.state.identities.map((identity) => [identity.id, { type: 'choice', choice: identity.name === 'Alternatives' ? 'mention' : 'competitor' }])),
      }),
    });
    authorize();
    tick();
    assert.equal(await first.processBrandRoles(), 2);
    const [perQuestion, perName] = [calls.filter((call) => call.state.question), calls.filter((call) => !call.state.question)];
    assert.deepEqual(perQuestion.flatMap((call) => call.state.identities.map((identity) => identity.name)).sort(), ['Alpha Agency', 'Zenith Cloud']);
    assert.deepEqual(roles().map((row) => row[1]), ['alpha agency', 'zenith cloud']);
    // "Late Agency" is structured: its question asks it, not the per-name request.
    assert.deepEqual(perName.flatMap((call) => call.state.identities.map((identity) => identity.name)), ['Alternatives']);
    assert.deepEqual(decisions(sqlite).map((row) => [row.brand_key, row.role]), [['alternatives', 'mention']]);
    tick();
    assert.equal(await first.processBrandRoles(), 0);
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('a name the model finds to be no brand at all leaves the list and stays out; a family stays while one of its names is a brand', async () => {
  const { sqlite, calls } = setup(anyEdition, ['Roku', 'Severance', 'Taylor', 'Rank']);
  const server = await isolate('roles', 'packages/core/lib/server/brand-roles.ts');
  try {
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      return answer(payload, (name) => ({ Severance: 'not_brand', Taylor: 'not_brand', Rank: 'not_brand' })[name] ?? 'competitor');
    };
    assert.equal(await classify(), 'answered');
    // The verdict is kept like any other (the CHECK of both tables admits it).
    assert.deepEqual(decisions(sqlite).map((row) => [row.brand_key, row.role]), [['rank', 'not_brand'], ['roku', 'competitor'], ['severance', 'not_brand'], ['taylor', 'not_brand']]);
    sqlite.prepare("INSERT INTO brand_question_roles(project_id,question_key,brand_key,model,role,question,cost_usd,decided_at) VALUES('project','q','rank certo','liquid/d1-ultra','competitor','Which agency?',0,'2026-10-20T00:00:00.000Z')").run();
    assert.equal(await classify(), 'nothing');
    // Severance is gone; the Taylor family (Taylor Swift folded in) is gone; Rank stays because "Rank Certo" is a competitor.
    const suggestions = [
      suggestion('Roku'),
      suggestion('Severance'),
      { ...suggestion('Taylor'), aliases: ['Taylor Swift'] },
      { ...suggestion('Rank'), aliases: ['Rank Certo'] },
    ];
    const listed = await server.withModelRoles('project', suggestions);
    assert.deepEqual(listed.map((item) => [item.name, item.ambiguous]), [['Roku', false], ['Rank', false]]);
    // A later analysis finds the same names again: the verdicts answer, nothing is asked.
    assert.equal(await classify(first, suggestions), 'nothing');
    // The project's role aggregates the questions; not_brand is a settled choice.
    const roleModule = await import('../lib/brand-roles.ts');
    assert.equal(roleModule.aggregateRole({ not_brand: 2, competitor: 1 }), 'not_brand');
    assert.equal(roleModule.aggregateRole({ not_brand: 1, competitor: 1 }), 'competitor');
    assert.equal(roleModule.aggregateRole({ not_brand: 1, ambiguous: 4 }), 'not_brand');
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

test('new criteria (v4): older verdicts count until each name is decided again; cut names are settled by rule, unasked', async () => {
  const { sqlite, calls } = setup(anyEdition, ['Roku', 'Microsoft', 'Wh', 'EarFun&']);
  const server = await isolate('criteria', 'packages/core/lib/server/brand-roles.ts');
  try {
    // Verdicts of the older criteria: the bare model, per name and per question.
    sqlite.prepare("INSERT INTO brand_role_decisions(project_id,brand_key,model,role,cost_usd,decided_at) VALUES('project','roku','liquid/d1-ultra','supplier',0,'2026-10-20T00:00:00.000Z'),('project','wh','liquid/d1-ultra','competitor',0,'2026-10-20T00:00:00.000Z')").run();
    sqlite.prepare("INSERT INTO brand_question_roles(project_id,question_key,brand_key,model,role,question,cost_usd,decided_at) VALUES('project','q','microsoft','liquid/d1-ultra','competitor','Which agency?',0,'2026-10-20T00:00:00.000Z')").run();
    const before = await server.decidedRoles('project');
    assert.deepEqual([before.get('roku'), before.get('microsoft'), before.get('wh')], ['supplier', 'competitor', 'competitor'], 'they count meanwhile');
    assert.equal((await server.decidedRoles('project', { current: true })).size, 0, 'but settle nothing to ask');
    globalThis.roleFixture.decisions = async (payload) => {
      calls.push(payload);
      return answer(payload, (name) => (name === 'Microsoft' ? 'supplier' : 'competitor'));
    };
    assert.equal(await classify(), 'answered');
    // Roku and Microsoft are asked again; the cut names are not sent and are settled as no brand, at no cost.
    assert.deepEqual(calls.at(-1).state.identities.map((identity) => identity.name), ['Roku', 'Microsoft']);
    assert.deepEqual(
      sqlite.prepare("SELECT brand_key,role FROM brand_role_decisions WHERE model='liquid/d1-ultra@v4' AND cost_usd=0 ORDER BY brand_key").all().map((row) => [row.brand_key, row.role]),
      [['earfun&', 'not_brand'], ['wh', 'not_brand']],
    );
    // The current verdict wins over every older one, the per-question one included.
    const after = await server.decidedRoles('project');
    assert.deepEqual([after.get('roku'), after.get('microsoft'), after.get('wh'), after.get('earfun&')], ['competitor', 'supplier', 'not_brand', 'not_brand']);
    // The Brands list never shows a cut name, whatever was decided before; an acronym ("LG") stays.
    const listed = await server.withModelRoles('project', [suggestion('Wh'), suggestion('LG'), suggestion('Roku')]);
    assert.deepEqual(listed.map((item) => item.name), ['LG', 'Roku']);
  } finally {
    sqlite.close();
    delete globalThis.roleFixture;
  }
});

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(root + `apps/${name}/drizzle`))) {
  test(`brand role jobs: a second project of the same workspace and category reuses competitor and no-brand verdicts, never another workspace's (${edition})`, async () => {
    const { sqlite, calls } = setup(edition, ['Roku', 'Adobe', 'Tubi', 'Wh']);
    try {
      const stamp = new Date().toISOString();
      sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('stranger','stranger@test.example','Stranger',?)").run(stamp);
      const project = (id, owner, category) =>
        sqlite
          .prepare("INSERT INTO projects(id,workspace_id,name,domain,category,competitors_json,language_code,location_code,daily_enabled,created_at) VALUES(?,?,'Max','max.com',?,'[]','en',2840,0,?)")
          .run(id, owner, category, stamp);
      project('sibling', 'owner', ' Streaming ');
      project('elsewhere', 'stranger', 'streaming');
      project('other-category', 'owner', 'music');
      assert.equal(await classify(), 'answered');
      assert.equal(calls.length, 1);
      const ask = (id, owner, category) => first.classifyBrandRoles(id, owner, { brands: ['Max'], category }, globalThis.roleFixture.suggestions);
      // The sibling: Roku (competitor) and the cut name (no brand) are reused; Adobe (a client of the first project's brands)
      // and Tubi (ambiguous) are asked.
      assert.equal(await ask('sibling', 'owner', ' Streaming '), 'answered');
      assert.deepEqual(calls[1].state.identities.map((identity) => identity.name), ['Adobe', 'Tubi']);
      const rows = (id) => sqlite.prepare('SELECT brand_key,role,cost_usd FROM brand_role_decisions WHERE project_id=? ORDER BY brand_key').all(id).map((row) => [row.brand_key, row.role, row.cost_usd]);
      assert.deepEqual(rows('sibling').filter(([key]) => key === 'roku' || key === 'wh'), [['roku', 'competitor', 0], ['wh', 'not_brand', 0]]);
      // Another workspace, or another category, asks for itself.
      assert.equal(await ask('elsewhere', 'stranger', 'streaming'), 'answered');
      assert.deepEqual(calls[2].state.identities.map((identity) => identity.name), ['Roku', 'Adobe', 'Tubi']);
      assert.equal(await ask('other-category', 'owner', 'music'), 'answered');
      assert.deepEqual(calls[3].state.identities.map((identity) => identity.name), ['Roku', 'Adobe', 'Tubi']);
    } finally {
      sqlite.close();
      delete globalThis.roleFixture;
    }
  });
}
