import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// v12: the mentions of a common-word brand the text could not settle go to the decision model by the exact
// question, bounded by a lifetime total.
// Fixtures only: the provider is a function in this file; nothing paid is called.
const root = fileURLToPath(new URL('../../../', import.meta.url));
function d1(sqlite, statements = []) {
  const prepare = (sql, params = []) => (statements.push(sql), {
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
  './env': 'export const db=()=>globalThis.mentionFixture.db;export const now=()=>new Date().toISOString();export const setting=(name)=>globalThis.mentionFixture.settings?.[name]??"";',
  './decisions-api': 'export const postDecisions=async(payload)=>globalThis.mentionFixture.decisions(payload);export const postChat=async(payload)=>globalThis.mentionFixture.chat(payload);',
  './http': 'export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}',
  './workspace': "export async function ownedProject(id,owner){return globalThis.mentionFixture.db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=?').bind(id,owner).first();}",
  './project-store': 'export const getProjectStore=async()=>({initialized:1,generation:1});',
  './project-store-read': 'export const projectReadDatabase=async()=>globalThis.mentionFixture.store;export const storedCopy=async()=>({value:null,storedAt:0,keep(){}});',
  './project-store-transport': 'export const projectStoreRpc=async(message)=>globalThis.mentionFixture.rpc(message);',
  './capabilities': 'export const researchAllProjects=false;',
  './brand-decision-events': 'export const loadDecisionEvents=async()=>[];export const decisionEventsStatement=()=>globalThis.mentionFixture.db.prepare("SELECT 1 x WHERE 0");export const decisionEventsFrom=()=>[];export const withoutDecided=async(_,items)=>items;',
  './reports': 'export const parseReportFilter=()=>({});',
  './competitor-analysis': 'export const syncCountedBrands=async()=>{};export const competitorAnalysisStatus=async()=>({status:"complete",suggestions:[]});',
};
const bundle = await build({
  absWorkingDir: root,
  entryPoints: [root + 'packages/core/lib/server/brand-mention-checks.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'workers-shim' }));
        plugin.onLoad({ filter: /.*/, namespace: 'workers-shim' }, () => ({ contents: 'export const waitUntil=()=>{};export const env={};', loader: 'js' }));
        plugin.onResolve({ filter: /^\.\/[a-z-]+$/ }, (args) => (args.path in stubs ? { path: args.path, namespace: 'fixture' } : undefined));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
        plugin.onResolve({ filter: /^@\// }, (args) => ({ path: root + 'packages/core/' + args.path.slice(2) + (args.path.endsWith('.mjs') ? '' : '.ts') }));
      },
    },
  ],
});
const checks = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const { brandMentions, CANARY_CATEGORIES } = await import('../lib/brand-mention-check.ts');

const own = { name: 'Conversion', domain: 'conversion.com.br', aliases: ['Agência Conversion'] };
// The fixture's answers: a CRO answer (the word), the agency with its domain, a lone capitalized name in two answers with
// the same text (one question), and an Apple-like product name.
const answers = {
  cro: 'A taxa de conversion média é 2%.',
  agency: 'Para SEO, a Conversion (conversion.com.br) é uma das agências mais citadas.',
  lone: 'Para isso, a Conversion pode ajudar a medir resultados.',
  'lone-copy': 'Para isso, a Conversion pode ajudar a medir resultados.',
  aim: 'Empresas como a **AIM Conversion Experts** fazem testes A/B.',
};

function setup(edition, { otherProject = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const dir = root + `apps/${edition}/drizzle/`;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(dir + name, 'utf8'));
  const stamp = new Date().toISOString();
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('owner','owner@test.example','Owner',?)").run(stamp);
  const project = sqlite.prepare("INSERT INTO projects(id,workspace_id,name,domain,category,aliases_json,competitors_json,language_code,location_code,daily_enabled,created_at) VALUES(?,'owner',?,?,?,?,'[]','pt',2076,0,?)");
  project.run('project', 'Conversion', 'conversion.com.br', 'Agência de SEO', JSON.stringify(own.aliases), stamp);
  if (otherProject) project.run('other', 'Pet Shop', 'petshop.example', 'Ração para cães', '[]', stamp);
  // The project store's questions, as ProjectStore.overlayMentions writes them (the active slot).
  const store = new DatabaseSync(':memory:');
  store.exec(`CREATE TABLE mention_asks (run_id TEXT NOT NULL,brand TEXT NOT NULL,slot TEXT NOT NULL,request_json TEXT NOT NULL,counted INTEGER,decided_config TEXT,PRIMARY KEY(run_id,brand,slot));
    CREATE TABLE store_meta (key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE runs (id TEXT PRIMARY KEY,answer TEXT,sources_json TEXT,prompt_text TEXT)`);
  for (const [id, answer] of Object.entries(answers)) store.prepare("INSERT INTO runs(id,answer,sources_json,prompt_text) VALUES(?,?,'[]','agências de SEO')").run(id, answer);
  store.prepare("INSERT INTO store_meta(key,value) VALUES('mention_common',?)").run(JSON.stringify({ rev: { names: ['conversion'], terms: [], counters: { conversion: { named: 5, lower: 1, inTerm: 1 } } } }));
  const counted = {};
  for (const [id, answer] of Object.entries(answers)) {
    const [result] = brandMentions(answer, [own], new Set(['conversion']), [], new Set(), 'agências de SEO');
    if (typeof result === 'object') store.prepare("INSERT INTO mention_asks(run_id,brand,slot,request_json) VALUES(?,?,'active',?)").run(id, own.name, JSON.stringify(result.request));
    else counted[id] = result;
  }
  const calls = [];
  const chats = [];
  const statements = [];
  const fixture = {
    db: d1(sqlite, statements),
    store: d1(store),
    settings: { OPENROUTER_API_KEY: 'fixture' },
    rpc: async (message) => {
      assert.equal(message.action, 'mention-verdicts');
      assert.ok(message.verdicts.length <= 100);
      for (const [runId, brand, slot, request, verdict, config] of message.verdicts)
        store.prepare('UPDATE mention_asks SET counted=?,decided_config=? WHERE run_id=? AND brand=? AND slot=? AND request_json=?').run(Number(verdict), config, runId, brand, slot, request);
      return { applied: message.verdicts.length };
    },
    // Every question "same_business" with 0.97 (sure: no tie-breaker), except a canary (a fake domain), which the model rejects.
    // The own brand's second question (q<i>c) agrees.
    answer: (payload, id) =>
      id.endsWith('c')
        ? { type: 'choice', choice: 'yes', probabilities: { yes: 0.9, no: 0.1 } }
        : JSON.stringify(payload.state[id].card.domains).includes('conversion.com.br')
          ? { type: 'choice', choice: 'same_business', probabilities: { same_business: 0.97, unclear: 0.03 } }
          : { type: 'choice', choice: 'other_entity', probabilities: { other_entity: 0.95, same_business: 0.05 } },
    // The one search for same-named businesses (a chat model with web search): one elsewhere, and the brand's own site,
    // which the card never keeps. The reader (a chat model, no search) is unsure unless a test says otherwise.
    homonyms: [
      { name: 'Conversion', domain: 'conversion.com', country: 'United Kingdom', what: 'A CRO and experimentation agency.' },
      { name: 'Conversion', domain: 'www.conversion.com.br', country: 'Brazil', what: 'The brand itself.' },
    ],
    reader: () => ({ entity: 'unclear', quote: '' }),
    chat: async (payload) => {
      chats.push(payload);
      const content = JSON.stringify(payload.plugins ? { homonyms: fixture.homonyms } : fixture.reader(payload));
      return { ok: true, status: 200, json: async () => ({ model: payload.model, usage: { cost: 0.001 }, choices: [{ message: { content } }] }) };
    },
    decisions: async (payload) => {
      calls.push(payload);
      return { ok: true, status: 200, json: async () => ({ model: payload.model, usage: { cost: 0.0001 }, answers: Object.fromEntries(Object.keys(payload.questions).map((id) => [id, fixture.answer(payload, id)])) }) };
    },
  };
  globalThis.mentionFixture = fixture;
  return { sqlite, store, calls, chats, counted, fixture, statements };
}
const budget = () => ({ left: 100, deadline: Date.now() + 60_000 });
const rows = (store) => store.prepare('SELECT run_id,counted FROM mention_asks ORDER BY run_id').all().map((row) => [row.run_id, row.counted]);
const cleanup = ({ sqlite, store }) => {
  sqlite.close();
  store.close();
  delete globalThis.mentionFixture;
};

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(root + `apps/${name}/drizzle`))) {
  test(`mention checks: the text settles the word and the domain; each distinct question is asked once, with a monitor canary (${edition})`, async () => {
    const setupState = setup(edition);
    const { sqlite, store, calls, counted } = setupState;
    try {
      assert.deepEqual(counted, { cro: false, agency: true });
      // Two distinct questions of the own brand ("lone" and its copy are one), each a request of its own, and one canary
      // request of its own in a fixed synthetic category.
      assert.equal(await checks.checkMentions('project', 'owner', budget()), 3);
      assert.equal(calls.length, 3);
      assert.equal(calls[0].model, 'liquid/d1-ultra');
      assert.deepEqual(calls.map((call) => Object.keys(call.questions).length), [2, 2, 1], 'the own brand asked alone, twice framed; the canary alone');
      const cards = calls.flatMap((call) => Object.values(call.state).map((q) => q.card));
      assert.equal(cards.length, 3);
      const canary = cards.find((card) => card.domains[0] !== 'conversion.com.br');
      assert.match(canary.domains[0], /^conversion[a-fx]{4}\.com$/u);
      assert.ok(CANARY_CATEGORIES.includes(canary.what));
      // The canary never reads another project: every statement on projects is about this one.
      assert.ok(setupState.statements.filter((sql) => /\bFROM projects\b/iu.test(sql)).every((sql) => /\bid=\?/u.test(sql) && !/id<>/u.test(sql)), 'no cross-project read');
      assert.ok(!JSON.stringify(calls).includes('Ração para cães'), "another project's category never reaches the model");
      assert.equal(canary.name, 'Conversion');
      assert.ok(calls.every((call) => Object.values(call.questions).every((question) => !question.instructions.includes('pode ajudar'))), 'evidence only in state');
      // The own brand's questions (m6): its same-named business found once, an option of its own; never its own site.
      assert.equal(setupState.chats.length, 1);
      assert.deepEqual(setupState.chats[0].plugins, [{ id: 'web' }]);
      const owned = calls.filter((call) => call.state.q0.card.domains[0] === 'conversion.com.br');
      assert.equal(owned.length, 2);
      for (const call of owned) {
        assert.deepEqual(call.state.q0.homonyms, [{ name: 'Conversion', domain: 'conversion.com', country: 'United Kingdom', what: 'A CRO and experimentation agency.' }]);
        assert.ok(call.questions.q0.instructions.startsWith('[m6]') && 'homonym_1' in call.questions.q0.criteria);
        assert.ok(!('homonyms' in call.state.q0.card));
      }
      const canaryCall = calls.find((call) => call.state.q0.card.domains[0] !== 'conversion.com.br');
      assert.ok(canaryCall.questions.q0.instructions.startsWith('[m5]') && !('homonyms' in canaryCall.state.q0), "the canary keeps the other brands' prompt");
      // Counted at p 0.97 for the brand's card; the canary's "no" changes nothing.
      assert.deepEqual(rows(store), [['aim', 1], ['lone', 1], ['lone-copy', 1]]);
      const verdicts = sqlite.prepare('SELECT run_id,brand_key,choice,counted,p_counted,canary FROM brand_mention_verdicts ORDER BY canary,run_id').all().map((row) => ({ ...row }));
      assert.equal(verdicts.length, 3);
      assert.deepEqual(verdicts.at(-1), { run_id: '', brand_key: 'conversion', choice: 'other_entity', counted: 0, p_counted: 0.05, canary: 1 });
      assert.ok(verdicts.slice(0, 2).every((row) => row.counted === 1 && row.p_counted === 0.97 && row.canary === 0));
      // The pending count Admin reads, and the window's counters.
      assert.deepEqual({ ...sqlite.prepare('SELECT pending,common_json FROM brand_mention_status').get() }, { pending: 0, common_json: JSON.stringify({ conversion: { named: 5, lower: 1, inTerm: 1 } }) });
      // A store rebuilt (or a pass redone) finds the questions open again: the kept verdicts go back without a request.
      store.exec('UPDATE mention_asks SET counted=NULL,decided_config=NULL');
      assert.equal(await checks.checkMentions('project', 'owner', budget()), 0);
      assert.equal(calls.length, 3);
      assert.deepEqual(rows(store), [['aim', 1], ['lone', 1], ['lone-copy', 1]]);
      // The own brand keeps every question it was asked (Admin audits them).
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM brand_mention_verdicts WHERE own=1 AND request_json IS NOT NULL').get().n, 2);
      // Another model is another question: the rows re-open and are asked again, the old verdict applied until then.
      setupState.fixture.settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ brand_mentions: 'liquid/d1-mega' });
      setupState.fixture.answer = (payload, id) => (id.endsWith('c') ? { type: 'choice', choice: 'no', probabilities: { no: 0.9, yes: 0.1 } } : { type: 'choice', choice: 'common_word', probabilities: { common_word: 0.9, same_business: 0.1 } });
      assert.equal(await checks.checkMentions('project', 'owner', budget()), 3);
      assert.equal(calls.at(-1).model, 'liquid/d1-mega');
      assert.deepEqual(rows(store), [['aim', 0], ['lone', 0], ['lone-copy', 0]]);
      const month = (await checks.mentionBudgets(['project'])).get('project');
      assert.equal(month.cap, 1, 'the default monthly budget');
      // Six requests at US$ 0.0001 and the one search for same-named businesses (US$ 0.001), in the same budget.
      assert.ok(Math.abs(month.spent - 0.0016) < 1e-9);
      assert.deepEqual([month.exhausted, month.alarm, month.pending], [false, false, 0]);
    } finally {
      cleanup(setupState);
    }
  });

  test(`mention checks: a free pass (a preview's imported verdicts) applies only kept verdicts: nothing asked or searched (${edition})`, async () => {
    const setupState = setup(edition);
    const { sqlite, store, calls } = setupState;
    try {
      // No verdict kept yet: nothing settled, no request, no search for same-named businesses, the questions stay open.
      assert.equal(await checks.checkMentions('project', 'owner', budget(), { free: true }), 0);
      assert.equal(calls.length, 0);
      assert.equal(setupState.chats.length, 0);
      assert.ok(rows(store).every(([, counted]) => counted === null));
      // Verdicts kept (here by a paid pass; in a preview, copied from production): the reopened questions take them for free.
      await checks.checkMentions('project', 'owner', budget());
      const asked = calls.length;
      store.exec('UPDATE mention_asks SET counted=NULL,decided_config=NULL');
      assert.equal(await checks.checkMentions('project', 'owner', budget(), { free: true }), 3);
      assert.equal(calls.length, asked);
      assert.deepEqual(rows(store), [['aim', 1], ['lone', 1], ['lone-copy', 1]]);
      assert.equal(sqlite.prepare('SELECT pending FROM brand_mention_status').get().pending, 0);
    } finally {
      cleanup(setupState);
    }
  });

  test(`mention checks: no fallback model, the project's monthly budget sums both contexts, stale v1 submissions are released (${edition})`, async () => {
    const state = setup(edition, { otherProject: false });
    const { sqlite, store, calls } = state;
    try {
      // A failing configured model is never retried on another one.
      state.fixture.settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ brand_mentions: 'liquid/d1-mega' });
      state.fixture.decisions = async (payload) => {
        calls.push(payload);
        return { ok: false, status: 503, json: async () => ({}) };
      };
      // Each question failed once: the step goes on past a failure, up to two, and nothing is retried on another model.
      assert.equal(await checks.checkMentions('project', 'owner', budget()), 2);
      assert.equal(calls.length, 2);
      assert.ok(calls.every((call) => call.model === 'liquid/d1-mega'));
      assert.deepEqual(rows(store), [['aim', null], ['lone', null], ['lone-copy', null]]);
      // Cooling down after their failure, the same questions are not sent again in the next step.
      assert.equal(await checks.checkMentions('project', 'owner', budget()), 0);
      assert.equal(calls.length, 2);
      sqlite.exec('DELETE FROM brand_research_jobs');
      // A v1 submission that never came back is released as unknown by the v2 step too.
      sqlite
        .prepare("INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,cost_usd,input_json,requested_at,started_at) VALUES('stale','owner','project','s','brand-mentions:v1','s','brand-mentions','liquid/d1-ultra','submitting',0.005,0,'{\"checks\":[]}',?,?)")
        .run('2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
      // This month the project's v1 checks already hold all but less than one reservation of its US$ 1 default.
      const thisMonth = new Date().toISOString();
      sqlite
        .prepare("INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,cost_usd,input_json,requested_at,completed_at) VALUES('old','owner','project','k','brand-mentions:v1','k','brand-mentions','liquid/d1-ultra','completed',0.997,0.997,'{\"checks\":[]}',?,?)")
        .run(thisMonth, thisMonth);
      state.fixture.decisions = async (payload) => {
        calls.push(payload);
        throw new Error('nothing may be sent past the total');
      };
      assert.equal(await checks.checkMentions('project', 'owner', budget()), 0);
      assert.equal(sqlite.prepare("SELECT status FROM brand_research_jobs WHERE id='stale'").get().status, 'unknown');
      const used = (await checks.mentionBudgets(['project'])).get('project');
      assert.deepEqual([used.exhausted, used.alarm, used.pending], [true, true, 3]);
      // A project setting raises it (NULL: unlimited): the same step asks again. Another project's spend never counts.
      sqlite.prepare("INSERT INTO brand_mention_settings(project_id,workspace_id,monthly_usd,updated_at,updated_by) VALUES('project','owner',NULL,?,'owner')").run(thisMonth);
      assert.equal((await checks.mentionBudgets(['project'])).get('project').cap, null);
      assert.equal((await checks.mentionBudgets(['project'])).get('project').exhausted, false);
      sqlite.exec("DELETE FROM brand_mention_settings");
      // Without a key nothing is asked either.
      sqlite.exec("DELETE FROM brand_research_jobs");
      state.fixture.settings = {};
      assert.equal(await checks.checkMentions('project', 'owner', budget()), 0);
      assert.equal(calls.length, 2);
      assert.equal(sqlite.prepare('SELECT pending FROM brand_mention_status').get().pending, 3);
      // An operator settles an own-brand verdict its tie-breaker left unclear (a count under 0.95 too): it becomes
      // "operator" and the project's questions re-open once.
      sqlite
        .prepare("INSERT INTO brand_mention_verdicts(project_id,check_key,run_id,brand_key,choice,counted,p_counted,canary,model,decided_at,own,request_json) VALUES('project',?,'lone','conversion','same_business',1,0.9,0,'liquid/d1-ultra',?,1,'{}')")
        .run('a'.repeat(64), thisMonth);
      assert.equal(await checks.resolveMentionVerdict('project', 'a'.repeat(64), true), false, 'only what the tie-breaker left unclear');
      sqlite
        .prepare("INSERT INTO brand_mention_verdicts(project_id,check_key,run_id,brand_key,choice,counted,p_counted,canary,model,decided_at,own,request_json,stage,parent_key) VALUES('project',?,'lone','conversion','unclear',0,0.6,0,'typesafe/jev-1.14',?,1,'{}','tiebreak',?)")
        .run('b'.repeat(64), thisMonth, 'a'.repeat(64));
      assert.equal(await checks.resolveMentionVerdict('project', 'a'.repeat(64), true), true);
      assert.equal(await checks.resolveMentionVerdict('project', 'a'.repeat(64), false), false, 'settled once');
      assert.deepEqual({ ...sqlite.prepare("SELECT choice,counted FROM brand_mention_verdicts WHERE check_key=?").get('a'.repeat(64)) }, { choice: 'operator', counted: 1 });
      assert.equal(sqlite.prepare('SELECT revision FROM brand_mention_status').get().revision, 1);
    } finally {
      cleanup(state);
    }
  });

  test(`mention checks: the own brand's unclear verdicts go to the tie-breaker, which reads the whole answer (${edition})`, async () => {
    const state = setup(edition, { otherProject: false });
    const { sqlite, store, calls } = state;
    try {
      // The two framings are unsure (p 0.5); the tie-breaker (its own instructions, "[m6t]") settles one way, then the other.
      let tiebreak = { same_business: 0.95, unclear: 0.05 };
      state.fixture.answer = (payload, id) =>
        payload.questions[id].instructions.startsWith('[m6t]')
          ? { type: 'choice', choice: Object.keys(tiebreak)[0], probabilities: tiebreak }
          : id.endsWith('c')
            ? { type: 'choice', choice: 'yes', probabilities: { yes: 0.5, no: 0.5 } }
            : { type: 'choice', choice: 'same_business', probabilities: { same_business: 0.5, unclear: 0.5 } };
      // The project's Brain: what it wrote about itself reaches the tie-breaker as the card's profile.
      sqlite.prepare("INSERT INTO agent_artifacts(id,workspace_id,project_id,title,kind,content,created_at,updated_at,brain) VALUES('b1','owner','project','Sobre','brief','Agência brasileira de SEO, GEO e Data PR em São Paulo.',?,?,1)").run(new Date().toISOString(), new Date().toISOString());
      // Two questions, two tie-breakers (one a question), and the canary.
      assert.equal(await checks.checkMentions('project', 'owner', budget()), 5);
      const breaks = calls.filter((call) => Object.values(call.questions).some((question) => question.instructions.startsWith('[m6t]')));
      assert.equal(breaks.length, 2);
      assert.equal(breaks[0].model, 'typesafe/jev-1.14', 'the tie-breaker default, never a fallback');
      assert.ok(breaks.every((call) => Object.keys(call.questions).length === 1));
      // It reads the whole answer, not only the excerpt, and what the rules saw.
      assert.ok(breaks.some((call) => call.state.q0.text.includes('fazem testes A/B')));
      assert.ok(breaks.every((call) => typeof call.state.q0.rules.occurrences === 'number'));
      assert.ok(breaks.every((call) => call.state.q0.card.profile === 'Sobre: Agência brasileira de SEO, GEO e Data PR em São Paulo.'));
      assert.ok(calls.filter((call) => !breaks.includes(call)).every((call) => Object.values(call.state).every((q) => !q.card.profile)), 'only the tie-breaker reads the profile');
      assert.deepEqual(rows(store), [['aim', 1], ['lone', 1], ['lone-copy', 1]]);
      const kept = sqlite.prepare("SELECT stage,choice,counted,parent_key IS NOT NULL parent FROM brand_mention_verdicts WHERE canary=0 ORDER BY stage,check_key").all().map((row) => ({ ...row }));
      assert.deepEqual(kept.map((row) => [row.stage, row.choice, row.counted, row.parent]), [['main', 'unclear', 0, 0], ['main', 'unclear', 0, 0], ['tiebreak', 'same_business', 1, 1], ['tiebreak', 'same_business', 1, 1]]);
      // Kept: a store rebuilt takes both verdicts back for free.
      store.exec('UPDATE mention_asks SET counted=NULL,decided_config=NULL');
      const before = calls.length;
      assert.equal(await checks.checkMentions('project', 'owner', budget()), 0);
      assert.equal(calls.length, before);
      assert.deepEqual(rows(store), [['aim', 1], ['lone', 1], ['lone-copy', 1]]);
      // Another tie-breaker model re-opens the own rows: still unsure after the whole answer, they go to the reader (a chat
      // model over the same window). Unsure too, they are not counted, and they are what Admin lists for an operator.
      state.fixture.settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ brand_mentions_tiebreak: 'openai/gpt-6-luna-decisions' });
      tiebreak = { unclear: 0.4, same_business: 0.6 };
      assert.equal(await checks.checkMentions('project', 'owner', budget()), 4);
      assert.deepEqual(rows(store), [['aim', 0], ['lone', 0], ['lone-copy', 0]]);
      assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM brand_mention_verdicts WHERE stage='tiebreak' AND choice='unclear' AND model='openai/gpt-6-luna-decisions'").get().n, 2);
      const read = state.chats.filter((chat) => !chat.plugins);
      assert.equal(read.length, 2);
      assert.ok(read.every((chat) => chat.model === 'openai/gpt-6-luna' && chat.temperature === 0 && JSON.parse(chat.messages[1].content).text.includes('⟦')));
      assert.ok(read.every((chat) => JSON.parse(chat.messages[1].content).card.profile.startsWith('Sobre:')), 'the reader reads the profile too');
      assert.deepEqual(sqlite.prepare('SELECT entity,counted,settled FROM brand_mention_readings ORDER BY run_id').all().map((row) => ({ ...row })), [
        { entity: 'unclear', counted: 0, settled: 0 },
        { entity: 'unclear', counted: 0, settled: 0 },
      ]);
      // An operator's decision settles one of them (the main row, by its key), once.
      const parent = sqlite.prepare('SELECT parent_key FROM brand_mention_readings ORDER BY run_id').get().parent_key;
      assert.equal(await checks.resolveMentionVerdict('project', parent, true), true);
      assert.equal(await checks.resolveMentionVerdict('project', parent, true), false, 'settled once');
      sqlite.prepare("UPDATE brand_mention_verdicts SET choice='unclear',counted=0 WHERE check_key=?").run(parent);
      // Another reader model: "card" counts only with its quote found in the text; "other" with its quote is not, settled.
      state.fixture.settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ brand_mentions_tiebreak: 'openai/gpt-6-luna-decisions', brand_mentions_reader: 'openai/gpt-6' });
      state.fixture.reader = (payload) =>
        JSON.parse(payload.messages[1].content).text.includes('A/B') ? { entity: 'other', quote: 'AIM Conversion Experts' } : { entity: 'card', quote: 'a Conversion pode ajudar' };
      await checks.checkMentions('project', 'owner', budget());
      assert.deepEqual(rows(store), [['aim', 0], ['lone', 1], ['lone-copy', 1]]);
      assert.deepEqual(sqlite.prepare("SELECT entity,counted,settled FROM brand_mention_readings WHERE model='openai/gpt-6' ORDER BY run_id").all().map((row) => ({ ...row })), [
        { entity: 'other', counted: 0, settled: 1 },
        { entity: 'card', counted: 1, settled: 1 },
      ]);
      state.fixture.settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ brand_mentions_tiebreak: 'openai/gpt-6-luna-decisions', brand_mentions_reader: 'openai/gpt-6-mini' });
      state.fixture.reader = () => ({ entity: 'card', quote: 'a quote the answer does not hold' });
      await checks.checkMentions('project', 'owner', budget());
      assert.deepEqual(rows(store), [['aim', 0], ['lone', 0], ['lone-copy', 0]], 'a quote not in the text never counts');
      // A decision model as the reader (9/11/2026, Admin): the same window as one closed question; its label probability decides, no quote.
      state.fixture.settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ brand_mentions_tiebreak: 'openai/gpt-6-luna-decisions', brand_mentions_reader: 'liquid/d1-ultra' });
      const answered = state.fixture.answer;
      state.fixture.answer = (payload, id) =>
        id !== 'entity' ? answered(payload, id)
          : payload.state.text.includes('A/B') ? { type: 'choice', choice: 'other', probabilities: { other: 0.9, card: 0.1 } } : { type: 'choice', choice: 'card', probabilities: { card: 0.92, unclear: 0.08 } };
      const sentBefore = calls.length;
      const chatsBefore = state.chats.length;
      await checks.checkMentions('project', 'owner', budget());
      assert.deepEqual(rows(store), [['aim', 0], ['lone', 1], ['lone-copy', 1]]);
      const decided = calls.slice(sentBefore).filter((call) => call.questions.entity);
      assert.equal(decided.length, 2);
      assert.ok(decided.every((call) => call.model === 'liquid/d1-ultra' && call.state.text.includes('⟦') && call.state.card.profile.startsWith('Sobre:')));
      assert.equal(state.chats.slice(chatsBefore).filter((chat) => !chat.plugins).length, 0, 'no chat reading');
      state.fixture.answer = answered;
      // A count under 0.95, even with both framings agreeing, is read again by the tie-breaker, which may say no.
      state.fixture.settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ brand_mentions: 'liquid/d1-mega' });
      tiebreak = { other_entity: 0.95, same_business: 0.05 };
      const agree = state.fixture.answer;
      state.fixture.answer = (payload, id) =>
        payload.questions[id].instructions.startsWith('[m6t]')
          ? agree(payload, id)
          : id.endsWith('c')
            ? { type: 'choice', choice: 'yes', probabilities: { yes: 0.9, no: 0.1 } }
            : { type: 'choice', choice: 'same_business', probabilities: { same_business: 0.85, unclear: 0.15 } };
      await checks.checkMentions('project', 'owner', budget());
      assert.deepEqual(rows(store), [['aim', 0], ['lone', 0], ['lone-copy', 0]]);
    } finally {
      cleanup(state);
    }
  });

  test(`mention checks: without a key nothing is asked or spent (${edition})`, async () => {
    const state = setup(edition, { otherProject: false });
    try {
      state.fixture.settings = {};
      assert.equal(await checks.checkMentions('project', 'owner', budget()), 0);
      assert.equal(state.calls.length, 0);
    } finally {
      cleanup(state);
    }
  });
  for (const [own, url] of [[false, 'https://lista.example/cro'], [true, 'https://ranking.example/seo']])
  test(`mention checks: what the tie-breaker leaves unclear is looked up on the cited pages first: ${own ? "the brand's own link counts" : "a same-named site's link does not"} (${edition})`, async () => {
    const state = setup(edition, { otherProject: false });
    const { sqlite, store, chats } = state;
    const originalFetch = globalThis.fetch;
    // Two cited listicles: one links the name to a same-named site, the other to the brand's own; a third has it unlinked.
    const page = (entry) => `<html lang="pt"><head><title>As melhores agências do Brasil</title></head><body><ol><li>${entry}</li></ol></body></html>`;
    const pages = {
      'https://lista.example/cro': page('<h2>3. Conversion</h2><p>Via: <a href="https://conversion.com/">Conversion</a> CRO, pesquisa de UX e personalização.</p>'),
      'https://ranking.example/seo': page('<h2>2. Conversion</h2><p>Site: <a href="https://www.conversion.com.br/">Conversion</a> SEO em São Paulo.</p>'),
      'https://guia.example/2026': page('<h2>6. Conversion — São Paulo</h2><p>Especialidade: e-commerce e CRO.</p>'),
    };
    const fetched = [];
    globalThis.fetch = async (url) => {
      const address = String(url);
      fetched.push(address);
      if (address.endsWith('/robots.txt')) return new Response(address.includes('guia') ? 'User-agent: *\nAllow: /' : '', { status: address.includes('guia') ? 200 : 404 });
      const html = pages[address];
      return html ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response('', { status: 404 });
    };
    try {
      const cite = (run, url) => store.prepare('UPDATE runs SET sources_json=? WHERE id=?').run(JSON.stringify([{ url, domain: new URL(url).hostname, title: 'Lista' }]), run);
      cite('lone', url);
      // A second answer cites the same page: read once, then taken from the store.
      cite('aim', url);
      // The framings and the tie-breaker are unsure: the cited pages decide before any reader is asked.
      state.fixture.answer = (payload, id) =>
        payload.questions[id].instructions.startsWith('[m6t]')
          ? { type: 'choice', choice: 'unclear', probabilities: { unclear: 0.5, same_business: 0.5 } }
          : id.endsWith('c')
            ? { type: 'choice', choice: 'yes', probabilities: { yes: 0.5, no: 0.5 } }
            : { type: 'choice', choice: 'same_business', probabilities: { same_business: 0.5, unclear: 0.5 } };
      await checks.checkMentions('project', 'owner', budget());
      const lone = own ? 1 : 0;
      assert.deepEqual(rows(store).filter(([run]) => run !== 'aim'), [['lone', lone], ['lone-copy', lone]]);
      // Only the answer without cited pages ("aim") went to the reader.
      assert.deepEqual(chats.filter((chat) => !chat.plugins).map((chat) => JSON.parse(chat.messages[1].content).text.includes('AIM')), [true]);
      assert.deepEqual(sqlite.prepare("SELECT run_id,entity,counted,settled,cost_usd,quote FROM brand_mention_readings WHERE model='cited-sources'").all().map((row) => ({ ...row })), [
        { run_id: 'lone', entity: own ? 'card' : 'homonym', counted: lone, settled: 1, cost_usd: 0, quote: `Cited pages link it to: ${own ? 'own conversion.com.br' : 'homonym conversion.com'}` },
      ]);
      // Every page is read once and kept for every project; a robots.txt too.
      const reads = fetched.length;
      store.exec('UPDATE mention_asks SET counted=NULL,decided_config=NULL');
      await checks.checkMentions('project', 'owner', budget());
      assert.deepEqual(rows(store).filter(([run]) => run !== 'aim'), [['lone', lone], ['lone-copy', lone]]);
      assert.equal(fetched.length, reads, 'kept: nothing fetched again');
      // The shared store: the page for 30 days (the default), its robots.txt for 7; the second pass used it, recorded.
      assert.deepEqual(sqlite.prepare("SELECT origin,status,ROUND(julianday(expires_at)-julianday(fetched_at)) days,title,language,final_url IS NOT NULL final,bytes>0 sized,length(content_sha256) hashed,uses FROM source_pages ORDER BY days DESC").all().map((row) => ({ ...row })), [
        { origin: 'fetch', status: 'ok', days: 30, title: 'As melhores agências do Brasil', language: 'pt', final: 1, sized: 1, hashed: 64, uses: 1 },
        { origin: 'fetch', status: 'ok', days: 7, title: null, language: null, final: 0, sized: null, hashed: null, uses: 0 },
      ]);
      assert.deepEqual(sqlite.prepare('SELECT purpose,project_id FROM source_page_uses').all().map((row) => ({ ...row })), [{ purpose: 'mentions', project_id: 'project' }]);
      // Settled by the pages: never in the operator list.
      assert.equal(await checks.resolveMentionVerdict('project', sqlite.prepare("SELECT parent_key FROM brand_mention_readings WHERE run_id='lone'").get().parent_key, true), true, 'an operator may still overrule');
    } finally {
      globalThis.fetch = originalFetch;
      cleanup(state);
    }
  });

  test(`mention checks: the reader's quoted "homonym" is final only when a second reader of another model agrees; a kept reading is confirmed for free (${edition})`, async () => {
    const state = setup(edition, { otherProject: false });
    const { sqlite, store, chats } = state;
    try {
      state.fixture.answer = (payload, id) =>
        payload.questions[id].instructions.startsWith('[m6t]')
          ? { type: 'choice', choice: 'unclear', probabilities: { unclear: 0.5, same_business: 0.5 } }
          : id.endsWith('c')
            ? { type: 'choice', choice: 'yes', probabilities: { yes: 0.5, no: 0.5 } }
            : { type: 'choice', choice: 'same_business', probabilities: { same_business: 0.5, unclear: 0.5 } };
      // The reader says "a same-named business" for both questions, each quote in the answer; the second reader agrees on
      // "aim" and says the card for "lone".
      state.fixture.reader = (payload) => {
        const aim = JSON.parse(payload.messages[1].content).text.includes('AIM');
        if (payload.model === 'anthropic/claude-haiku-5.5') return aim ? { entity: 'homonym', quote: 'testes A/B' } : { entity: 'card', quote: 'a Conversion pode ajudar' };
        return { entity: 'homonym', quote: aim ? 'fazem testes A/B' : 'a Conversion pode ajudar' };
      };
      const readings = () => sqlite.prepare('SELECT run_id,model,entity,counted,settled FROM brand_mention_readings ORDER BY run_id,model').all().map((row) => ({ ...row }));
      // As v13 ran (the second reader is the reader's own model, so no second reading): both wait for an operator.
      state.fixture.settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ brand_mentions_confirm: 'openai/gpt-6-luna' });
      await checks.checkMentions('project', 'owner', budget());
      assert.deepEqual(rows(store), [['aim', 0], ['lone', 0], ['lone-copy', 0]]);
      assert.deepEqual(readings(), [
        { run_id: 'aim', model: 'openai/gpt-6-luna', entity: 'homonym', counted: 0, settled: 0 },
        { run_id: 'lone', model: 'openai/gpt-6-luna', entity: 'homonym', counted: 0, settled: 0 },
      ]);
      assert.equal(chats.filter((chat) => !chat.plugins).length, 2);
      // v14 deployed: the own rows re-open, the reader's kept readings are reused for free, only the second reader is asked.
      delete state.fixture.settings.LASTFIND_CLASSIFIER_MODELS;
      await checks.checkMentions('project', 'owner', budget());
      const read = chats.filter((chat) => !chat.plugins);
      assert.deepEqual(read.map((chat) => chat.model), ['openai/gpt-6-luna', 'openai/gpt-6-luna', 'anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-5.5'], 'the reader is not asked again');
      assert.equal(read[2].messages[1].content, read.find((chat) => chat.messages[1].content.includes('AIM') === read[2].messages[1].content.includes('AIM')).messages[1].content, 'the same request');
      assert.deepEqual(readings(), [
        { run_id: 'aim', model: 'anthropic/claude-haiku-5.5', entity: 'homonym', counted: 0, settled: 1 },
        { run_id: 'aim', model: 'openai/gpt-6-luna', entity: 'homonym', counted: 0, settled: 0 },
        { run_id: 'lone', model: 'anthropic/claude-haiku-5.5', entity: 'card', counted: 0, settled: 0 },
        { run_id: 'lone', model: 'openai/gpt-6-luna', entity: 'homonym', counted: 0, settled: 0 },
      ]);
      assert.deepEqual(rows(store), [['aim', 0], ['lone', 0], ['lone-copy', 0]], 'never counted; "lone" stays for an operator');
      // Settled by both readers: out of the operator list; the disagreement stays in it. Nothing is asked again.
      const parent = (run) => sqlite.prepare('SELECT parent_key FROM brand_mention_readings WHERE run_id=?').get(run).parent_key;
      const listed = (run) => sqlite.prepare("SELECT COUNT(*) n FROM brand_mention_readings WHERE parent_key=? AND settled=1").get(parent(run)).n === 0;
      assert.deepEqual([listed('aim'), listed('lone')], [false, true]);
      store.exec('UPDATE mention_asks SET counted=NULL,decided_config=NULL');
      await checks.checkMentions('project', 'owner', budget());
      assert.equal(chats.filter((chat) => !chat.plugins).length, 4);
      assert.deepEqual(rows(store), [['aim', 0], ['lone', 0], ['lone-copy', 0]]);
    } finally {
      cleanup(state);
    }
  });

  test(`mention checks: an unlinked entry on a cited page reaches the reader as evidence; a page robots.txt forbids is not read (${edition})`, async () => {
    const state = setup(edition, { otherProject: false });
    const { store, chats, sqlite } = state;
    const originalFetch = globalThis.fetch;
    const fetched = [];
    globalThis.fetch = async (url) => {
      const address = String(url);
      fetched.push(address);
      if (address === 'https://fechado.example/robots.txt') return new Response('User-agent: *\nDisallow: /', { status: 200 });
      if (address.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (address === 'https://guia.example/2026')
        return new Response('<html lang="pt"><head><title>Ranking das agências do Brasil</title></head><body><h2>6. Conversion — São Paulo</h2><p>Especialidade: e-commerce e CRO.</p></body></html>', { headers: { 'content-type': 'text/html' } });
      return new Response('<html><body>Conversion</body></html>', { headers: { 'content-type': 'text/html' } });
    };
    try {
      store.prepare('UPDATE runs SET sources_json=? WHERE id IN (?,?)').run(JSON.stringify([{ url: 'https://guia.example/2026', domain: 'guia.example', title: '' }, { url: 'https://fechado.example/x', domain: 'fechado.example', title: '' }]), 'lone', 'aim');
      state.fixture.settings.SOURCE_PAGE_TTL_DAYS = '120';
      // A page the agent's reader stored (text, no links) is read again by Lastfind itself, for its links.
      const key = createHash('sha256').update('page:https://guia.example/2026').digest('hex');
      sqlite.prepare("INSERT INTO source_pages(url_key,url,status,origin,content_json,fetched_at,expires_at) VALUES(?,'https://guia.example/2026','ok','agent','{}',?,?)").run(key, new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString());
      state.fixture.answer = (payload, id) =>
        payload.questions[id].instructions.startsWith('[m6t]')
          ? { type: 'choice', choice: 'unclear', probabilities: { unclear: 0.5, same_business: 0.5 } }
          : id.endsWith('c')
            ? { type: 'choice', choice: 'yes', probabilities: { yes: 0.5, no: 0.5 } }
            : { type: 'choice', choice: 'same_business', probabilities: { same_business: 0.5, unclear: 0.5 } };
      state.fixture.reader = () => ({ entity: 'card', quote: 'a Conversion pode ajudar' });
      await checks.checkMentions('project', 'owner', budget());
      const read = chats.filter((chat) => !chat.plugins).map((chat) => JSON.parse(chat.messages[1].content));
      assert.equal(read.length, 2);
      const cited = read.find((input) => input.text.includes('pode ajudar')).cited_sources;
      assert.equal(cited.length, 1, 'the closed page adds nothing');
      assert.deepEqual([cited[0].link, cited[0].page_host, cited[0].page_language, cited[0].names_card_country], [null, 'guia.example', 'pt', true]);
      assert.ok(cited[0].untrusted_page_text.startsWith('<<<6. Conversion — São Paulo'), 'the page text only delimited, as untrusted evidence');
      assert.ok(!fetched.includes('https://fechado.example/x'), 'robots.txt is respected');
      assert.deepEqual({ ...sqlite.prepare("SELECT status,ROUND(julianday(expires_at)-julianday(fetched_at)) days FROM source_pages WHERE url='https://fechado.example/x'").get() }, { status: 'robots', days: 7 }, 'a page that could not be read: 7 days');
      assert.deepEqual({ ...sqlite.prepare("SELECT origin,ROUND(julianday(expires_at)-julianday(fetched_at)) days FROM source_pages WHERE url='https://guia.example/2026'").get() }, { origin: 'fetch', days: 90 }, 'read again for its links; SOURCE_PAGE_TTL_DAYS, at most 90');
      assert.ok(fetched.includes('https://guia.example/2026'));
      assert.deepEqual(rows(store), [['aim', 0], ['lone', 1], ['lone-copy', 1]], 'the reader decides, with its quote checked');
    } finally {
      globalThis.fetch = originalFetch;
      cleanup(state);
    }
  });

  test(`mention checks: cited pages are read only at public addresses, redirects checked again; a conflict goes to an operator; a page is marked failed before it is parsed (${edition})`, async () => {
    const state = setup(edition, { otherProject: false });
    const { store, sqlite, chats } = state;
    const originalFetch = globalThis.fetch;
    const fetched = [];
    const page = (href) => `<html lang="pt"><head><title>Lista</title></head><body><h2>1. Conversion</h2><p><a href="${href}">Conversion</a></p></body></html>`;
    globalThis.fetch = async (url, init) => {
      const address = String(url);
      fetched.push(address);
      assert.equal(init?.redirect, 'manual', 'redirects are followed by hand');
      if (address.endsWith('/robots.txt')) return new Response('', { status: 404 });
      // A redirect to the metadata service, one to another port, and a chain longer than three hops are never followed.
      if (address === 'https://salta.example/a') return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
      if (address === 'https://ponto.example/a') return new Response(null, { status: 302, headers: { location: 'http://localhost./admin' } });
      if (address === 'https://ponto.example/b') return new Response(null, { status: 302, headers: { location: 'http://0177.0.0.1/' } });
      if (address === 'https://porta.example/a') return new Response(null, { status: 301, headers: { location: 'https://porta.example:8443/a' } });
      if (address.startsWith('https://loop.example/')) return new Response(null, { status: 302, headers: { location: `https://loop.example/${Number(address.split('/').pop() || 0) + 1}` } });
      if (address === 'https://um.example/lista') return new Response(page('https://www.conversion.com.br/'), { headers: { 'content-type': 'text/html' } });
      if (address === 'https://dois.example/lista') return new Response(page('https://conversion.com/'), { headers: { 'content-type': 'text/html' } });
      return new Response('', { status: 404 });
    };
    // The order of what the page cache stores: failed first, then the digest.
    const statuses = [];
    const prepare = state.fixture.db.prepare;
    state.fixture.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (!/INSERT INTO source_pages/u.test(sql)) return statement;
      return { ...statement, bind: (...values) => (statuses.push([values[1], values[5]]), statement.bind(...values)) };
    };
    try {
      const cite = (run, urls) => store.prepare('UPDATE runs SET sources_json=? WHERE id=?').run(JSON.stringify(urls.map((url) => ({ url, domain: new URL(url).hostname, title: '' }))), run);
      cite('lone', ['https://um.example/lista', 'https://dois.example/lista', 'https://salta.example/a', 'https://porta.example/a', 'https://cinco.example/never-read']);
      cite('aim', ['https://loop.example/0', 'http://10.0.0.1/x', 'https://ponto.example/a', 'https://ponto.example/b']);
      state.fixture.answer = (payload, id) =>
        payload.questions[id].instructions.startsWith('[m6t]')
          ? { type: 'choice', choice: 'unclear', probabilities: { unclear: 0.5, same_business: 0.5 } }
          : id.endsWith('c')
            ? { type: 'choice', choice: 'yes', probabilities: { yes: 0.5, no: 0.5 } }
            : { type: 'choice', choice: 'same_business', probabilities: { same_business: 0.5, unclear: 0.5 } };
      await checks.checkMentions('project', 'owner', budget());
      assert.ok(!fetched.some((url) => /169\.254|:8443|10\.0\.0\.1|localhost|0177|127\.0/u.test(url)), fetched.join(' '));
      assert.ok(fetched.includes('https://ponto.example/a') && fetched.includes('https://ponto.example/b'), 'the redirect hops were checked, not followed');
      assert.ok(fetched.includes('https://loop.example/3') && !fetched.includes('https://loop.example/4'), 'at most three redirects');
      assert.ok(fetched.includes('https://salta.example/a') && fetched.includes('https://porta.example/a'));
      assert.ok(!fetched.includes('https://cinco.example/never-read'), 'four pages an answer at most');
      // Only four pages per answer: the first four cited. One links the name to the brand, another to a same-named site.
      assert.deepEqual(sqlite.prepare("SELECT entity,counted,settled,quote FROM brand_mention_readings WHERE model='cited-sources'").all().map((row) => ({ ...row })), [
        { entity: 'unclear', counted: 0, settled: 0, quote: 'Cited pages link it to: own conversion.com.br, homonym conversion.com' },
      ]);
      assert.deepEqual(rows(store).filter(([run]) => run !== 'aim'), [['lone', 0], ['lone-copy', 0]], 'not counted, for an operator');
      assert.equal(chats.filter((chat) => !chat.plugins && JSON.parse(chat.messages[1].content).text.includes('pode ajudar')).length, 0, 'no reader on a conflict');
      const parent = sqlite.prepare("SELECT parent_key FROM brand_mention_readings WHERE model='cited-sources'").get().parent_key;
      assert.equal(await checks.resolveMentionVerdict('project', parent, true), true, 'it is in the operator list');
      const page = statuses.filter(([url]) => url === 'https://um.example/lista').map(([, status]) => status);
      assert.deepEqual(page, ['failed', 'ok'], 'marked failed before parsing, then kept');
    } finally {
      globalThis.fetch = originalFetch;
      cleanup(state);
    }
  });

}
