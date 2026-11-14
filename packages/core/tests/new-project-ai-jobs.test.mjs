import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The New project wizard's AI suggestions: each call is a workspace's `wizard_jobs` row, reserved before it is sent and settled at
// its cost; a model that fails gives the step an error, never template suggestions. Fixtures only: the model is a function in this
// file; nothing paid is called.
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
  return { prepare };
}
const stubs = {
  './env': 'export const db=()=>globalThis.wizardFixture.db;export const now=()=>new Date().toISOString();export const setting=(name)=>globalThis.wizardFixture.settings?.[name]??"";',
  './decisions-api': 'export const postDecisions=async()=>{throw new Error("no Decisions call here")};export const postChat=async(payload,timeoutMs,task)=>globalThis.wizardFixture.chat(payload,task);',
  './http': 'export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}',
  './favicon': 'export const faviconHost=(v)=>String(v).trim().toLowerCase()||null;export const readHome=async()=>globalThis.wizardFixture.home??null;',
  './classifier-models': 'export const classifierModels=(id,current)=>({model:globalThis.wizardFixture.model??current,fallback:null});',
  // The platform's brake: room for this many US$ (the real guard is ./spend-guards platformGuard, tested with the ledgers).
  './brand-research': 'export const researchBudgetCondition=(reserve)=>({sql:"?<=?",params:[reserve,globalThis.wizardFixture.platformRoom??1e9]});',
  './capabilities': 'export const agentBudgetCondition=()=>({sql:"1=1",params:[]});',
  './spend-guards': 'export const recordRefusal=async()=>{};',
};
const bundle = await build({
  absWorkingDir: root,
  entryPoints: [root + 'packages/core/lib/server/new-project-ai.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /^\.\/(env|decisions-api|http|favicon|classifier-models|brand-research|capabilities|spend-guards)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
        plugin.onResolve({ filter: /^@\// }, (args) => ({ path: root + 'packages/core/' + args.path.slice(2) + (args.path.endsWith('.mjs') ? '' : '.ts') }));
      },
    },
  ],
});
const wizard = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const answer = (content, cost = 0.004) => ({ ok: true, status: 200, json: async () => ({ usage: { cost }, choices: [{ message: { content: JSON.stringify(content) } }] }) });
const TOPICS = { topics: [{ name: 'Seguro de Vida', primaryKeyword: 'seguro de vida', promptSeed: null, intent: null, relevanceScore: 90, evidence: [] }] };

function setup(edition, chat) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = root + `apps/${edition}/drizzle/`;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(dir + name, 'utf8'));
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('owner','owner@test.example','Owner',?)").run(new Date().toISOString());
  const calls = [];
  globalThis.wizardFixture = {
    db: d1(sqlite),
    settings: { OPENROUTER_API_KEY: 'fixture' },
    home: '<html><body><h1>Seguros de vida</h1></body></html>',
    chat: async (payload, task) => {
      calls.push({ ...payload, task });
      return chat(payload);
    },
  };
  return { sqlite, calls, rows: () => sqlite.prepare('SELECT step,status,reserved_usd,cost_usd FROM wizard_jobs ORDER BY requested_at').all().map((row) => ({ ...row })) };
}
const { step, input } = wizard.wizardInput({ step: 'topics', brand: 'Acme', domain: 'acme.com.br', location: 2076, language: 'pt' });

// The editions present (the public export has the independent one only).
for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(`${root}apps/${name}/drizzle`))) {
  test(`${edition}: a suggestion is reserved before it is sent and settled at its cost, with the site read for the model`, async () => {
    const { calls, rows } = setup(edition, () => answer(TOPICS));
    assert.deepEqual(await wizard.suggestForWizard('owner', step, input), { topics: [{ name: 'Seguro de Vida', keyword: 'seguro de vida', seed: null }] });
    assert.equal(calls.length, 1);
    // Through the providers in Admin's order, as the wizard's own task (lib/model-providers.ts maps its model per provider).
    assert.equal(calls[0].task, 'project_wizard');
    assert.match(calls[0].messages[0].content, /<home>\n# Seguros de vida\n<\/home>/);
    assert.deepEqual(rows(), [{ step: 'topics', status: 'completed', reserved_usd: 0.004, cost_usd: 0.004 }]);
  });

  test(`${edition}: a model that fails or answers nothing usable is an error for the step, never template suggestions`, async () => {
    const { rows } = setup(edition, () => ({ ok: false, status: 503, json: async () => ({}) }));
    await assert.rejects(wizard.suggestForWizard('owner', step, input), (error) => error.status === 502 && error.message === wizard.UNAVAILABLE.topics);
    // A refusal carries no completion: nothing billed, the reserve released.
    assert.deepEqual(rows(), [{ step: 'topics', status: 'failed', reserved_usd: 0, cost_usd: 0 }]);
    const empty = setup(edition, () => answer({ topics: [] }, 0.002));
    await assert.rejects(wizard.suggestForWizard('owner', step, input), (error) => error.status === 502);
    // An answer that came back is paid even when unusable.
    assert.deepEqual(empty.rows(), [{ step: 'topics', status: 'failed', reserved_usd: 0.002, cost_usd: 0.002 }]);
    // No answer at all (a lost connection): uncertain, its reserve kept, never resent.
    const lost = setup(edition, () => Promise.reject(new Error('The operation timed out.')));
    await assert.rejects(wizard.suggestForWizard('owner', step, input), (error) => error.status === 502);
    const [row] = lost.rows();
    assert.equal(row.status, 'unknown');
    assert.ok(row.reserved_usd > 0);
    assert.equal(lost.calls.length, 1);
  });

  test(`${edition}: no call without the model key, past the platform's brake or past the workspace's month for the wizard`, async () => {
    const { calls, sqlite, rows } = setup(edition, () => answer(TOPICS));
    globalThis.wizardFixture.settings = {};
    await assert.rejects(wizard.suggestForWizard('owner', step, input), (error) => error.status === 503 && error.message === wizard.NO_MODEL_KEY);
    globalThis.wizardFixture.settings = { OPENROUTER_API_KEY: 'fixture' };
    globalThis.wizardFixture.platformRoom = 0;
    await assert.rejects(wizard.suggestForWizard('owner', step, input), (error) => error.status === 429 && error.message === wizard.SPENDING_LIMIT);
    delete globalThis.wizardFixture.platformRoom;
    sqlite.prepare("INSERT INTO wizard_jobs(id,workspace_id,step,model,status,reserved_usd,cost_usd,requested_at) VALUES('spent','owner','competitors','m','completed',2,2,?)").run(new Date().toISOString());
    await assert.rejects(wizard.suggestForWizard('owner', step, input), (error) => error.status === 429);
    assert.equal(calls.length, 0);
    assert.equal(rows().length, 1);
  });
}

test('the request is checked before anything is spent', () => {
  assert.throws(() => wizard.wizardInput({ step: 'everything', brand: 'Acme', domain: 'acme.com', location: 2840 }), /wizard step/);
  assert.throws(() => wizard.wizardInput({ step: 'topics', brand: 'A', domain: 'acme.com', location: 2840 }), /brand/);
  assert.throws(() => wizard.wizardInput({ step: 'topics', brand: 'Acme', domain: 'acme.com', location: 1 }), /market/);
  assert.throws(() => wizard.wizardInput({ step: 'prompts', brand: 'Acme', domain: 'acme.com', location: 2840, topics: [] }), /topics/);
  const { input: checked } = wizard.wizardInput({ step: 'prompts', brand: ' Acme ', domain: 'acme.com', location: 2840, language: 'xx', topics: [{ name: 'CRM', seed: 'Which CRM?' }, 'nonsense'] });
  assert.deepEqual(checked.topics, [{ name: 'CRM', keyword: null, seed: 'Which CRM?' }]);
  assert.equal(checked.language, 'en');
  assert.equal(checked.brand, 'Acme');
  // The quick pass is the competitors' only.
  assert.equal(wizard.wizardInput({ step: 'competitors', brand: 'Acme', domain: 'acme.com', location: 2840, quick: true }).input.quick, true);
  assert.equal(wizard.wizardInput({ step: 'topics', brand: 'Acme', domain: 'acme.com', location: 2840, quick: true }).input.quick, undefined);
  // Attributes take the competitors' names and sites.
  const sites = wizard.wizardInput({ step: 'attributes', brand: 'Acme', domain: 'acme.com', location: 2840, sites: [{ name: ' Beta ', domain: 'Beta.com' }, { name: 'B' }, 'nonsense'] }).input.sites;
  assert.deepEqual(sites, [{ name: 'Beta', domain: 'beta.com' }]);
});

test('the home page is read once for the steps asked together, and again after ten minutes', async () => {
  let reads = 0;
  const read = async () => (reads++, '<html><body><h1>Planos de saúde</h1></body></html>');
  const [first, second] = await Promise.all([wizard.wizardHome('cache.test', read, 0), wizard.wizardHome('cache.test', read, 1000)]);
  assert.equal(reads, 1);
  assert.equal(first, second);
  assert.match(first, /Planos de saúde/);
  await wizard.wizardHome('cache.test', read, 11 * 60_000);
  assert.equal(reads, 2);
  // A site that does not answer leaves the model with the brand, domain and market.
  assert.equal(await wizard.wizardHome('down.test', async () => { throw new Error('timeout'); }, 0), null);
});
