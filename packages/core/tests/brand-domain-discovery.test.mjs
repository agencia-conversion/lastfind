// Domain discovery for discovered brands, on both editions' migrations. No paid call is ever made:
// DataForSEO and OpenRouter are fixtures that count what they would have been asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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
  'cloudflare:workers': 'export const waitUntil=()=>{};',
  './env': 'export const db=()=>globalThis.fx.db;export const now=()=>new Date().toISOString();export const appOrigin=()=>"";export const workerVersion=()=>undefined;export const setting=(key)=>globalThis.fx.settings[key]??"";',
  './http': `export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
export function textField(value,label,min=1,max=100){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw new ApiError(400,label+': use entre '+min+' e '+max+' caracteres.');return value.trim();}`,
  './workspace': `export async function ownedProject(id,owner){const p=await globalThis.fx.db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived=0').bind(id,owner).first();if(!p){const e=new Error('Projeto não encontrado.');e.status=404;throw e;}return p;}
export function projectFromRow(p){return{id:String(p.id),name:String(p.name),domain:String(p.domain),aliases:JSON.parse(String(p.aliases_json||'[]')),additional_domains:JSON.parse(String(p.additional_domains_json||'[]')),competitors:JSON.parse(String(p.competitors_json)),location_code:Number(p.location_code),language_code:String(p.language_code),category:typeof p.category==='string'?p.category:'',audience:''};}`,
  './competitor-analysis': `export const syncCountedBrands=async()=>{};export const COMPETITOR_ANALYSIS_DAYS=90;
export const competitorAnalysisStatus=async()=>({status:globalThis.fx.status,processed:20,total:20,truncated:false,needsEnsure:false,publicationPending:false,error:null,suggestions:globalThis.fx.suggestions});
export const ensureCompetitorAnalysis=async()=>{};`,
  './project-store-read': 'export const projectReadDatabase=async()=>globalThis.fx.db;export const storedCopy=async()=>({value:null,storedAt:0,keep(){}});',
  './dataforseo': `export class ProviderError extends Error{constructor(message,code,ambiguous=false){super(message);this.code=code;this.ambiguous=ambiguous;}}
globalThis.fxProviderError=ProviderError;
export async function provider(engine,path,payload){const fx=globalThis.fx;fx.searches.push({engine,path,payload});return fx.search(payload);}`,
  './brand-research': 'export const researchBudgetCondition=(reserve,project)=>globalThis.fx.budget(reserve,project);',
  // The project's budget is the guard above; a refusal is recorded for health and Settings.
  './capabilities': "export const planCountCondition=()=>({sql:'1=1',params:[]});",
  './spend-guards': 'export const dollarBlock=async()=>globalThis.fx.block??null;export const recordBlocked=async(...args)=>{(globalThis.fx.blocked??=[]).push(args);};',
  // The site reads are free fetches of the brands' home pages: a fixture answers them (no network), or nothing is read.
  './raw-responses': 'export const rawResponsesBucket=()=>undefined;',
  './favicon': 'export const probeSite=async(host)=>globalThis.fx.site?globalThis.fx.site(host):null;',
  // The model roles are tested on their own; here every discovered brand is a competitor.
  './brand-roles': `export const withModelRoles=async(_project,suggestions)=>suggestions;
export const roleDecisionsStatements=()=>[0,1].map(()=>globalThis.fx.db.prepare('SELECT 1 WHERE 0'));export const rolesFrom=()=>new Map();`,
};
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents:
      "export * as decisions from './packages/core/lib/server/brand-decisions.ts';export * as discovery from './packages/core/lib/server/brand-domain-discovery.ts';export * as lookups from './packages/core/lib/server/brand-domain-lookups.ts';export * as spendRule from './packages/core/lib/platform-spend.ts';",
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
        plugin.onResolve({ filter: /^(\.\/(env|http|workspace|competitor-analysis|project-store-read|dataforseo|brand-research|brand-roles|raw-responses|favicon|spend-guards|capabilities)|cloudflare:workers)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
        plugin.onResolve({ filter: /^@\// }, (args) => ({
          path: root + 'packages/core/' + args.path.slice(2) + (args.path.endsWith('.mjs') ? '' : '.ts'),
        }));
      },
    },
  ],
});
const { decisions, discovery, lookups, spendRule } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const user = { id: 'owner', email: 'owner@test.example', name: 'Owner' };
const answers = {
  'run-Pluto': 'Pluto is a streaming service with live channels.',
  'run-Hulu': 'Hulu is a streaming service. Sign up at https://www.hulu.com/welcome today.',
  'run-Tubi': 'Tubi is a free streaming service.',
  'run-Roku': 'Roku is a streaming platform.',
  'run-Sling': 'Sling is a live TV service. Compare sling.com with sling.tv.',
  'run-Max': 'Max is a streaming service.',
};
const suggestion = (name, domain = null) => ({
  name,
  domain,
  score: 0.9,
  answerCount: 10,
  evidence: [{ runId: `run-${name}`, excerpt: `${name} excerpt`, createdAt: '2026-10-16T00:00:00.000Z' }],
});
const organic = (domains) => [{ items: domains.map((domain, index) => ({ type: 'organic', rank_group: index + 1, domain, title: `${domain} title` })) }];
const task = (result, cost = 0.002) => [{ id: 't', status_code: 20000, status_message: 'Ok.', cost, result }];
const choice = (pick = 'c0', confidence = 0.95, cost = 0.0004) =>
  new Response(JSON.stringify({ model: 'liquid/d1-ultra', answers: { domain: { type: 'choice', choice: pick, confidence } }, usage: { cost } }), { status: 200 });

function setup(edition) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = root + `apps/${edition}/drizzle/`;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(dir + name, 'utf8'));
  sqlite.exec('ALTER TABLE runs ADD COLUMN answer TEXT; ALTER TABLE runs ADD COLUMN response_available INTEGER DEFAULT 1; ALTER TABLE runs ADD COLUMN sources_json TEXT; ALTER TABLE runs ADD COLUMN consulted_sources_json TEXT;');
  const stamp = new Date().toISOString();
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('owner','owner@test.example','Owner',?),('other','other@test.example','Other',?)").run(stamp, stamp);
  sqlite
    .prepare(
      "INSERT INTO projects(id,workspace_id,name,domain,competitors_json,language_code,location_code,category,daily_enabled,created_at) VALUES('project','owner','Netflix','netflix.com',?,'en',2840,'streaming',0,?)",
    )
    .run(JSON.stringify([{ name: 'Max', domain: 'max.com' }]), stamp);
  sqlite.prepare("INSERT INTO prompts(id,unit_id,project_id,text,engine,next_run_at,created_at) VALUES('p','p','project','Best streaming?','chat_gpt',?,?)").run(stamp, stamp);
  for (const [id, answer] of Object.entries(answers))
    sqlite
      .prepare(
        `INSERT INTO runs(id,workspace_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,status,callback_token,cost,created_at,budget_credits,answer,response_available,sources_json)
         VALUES(?,'owner','project','p',?,'Best streaming?','chat_gpt','[]',2840,'en','complete','fixture',0,?,0,?,1,'[]')`,
      )
      .run(id, `key-${id}`, stamp, answer);
  globalThis.fx = {
    db: d1(sqlite),
    status: 'complete',
    settings: { BRAND_DOMAIN_MAX_USD: '1', DATAFORSEO_LOGIN: 'login', DATAFORSEO_PASSWORD: 'secret', OPENROUTER_API_KEY: 'key' },
    suggestions: [suggestion('Pluto'), suggestion('Hulu'), suggestion('Tubi', 'tubitv.com'), suggestion('Roku'), suggestion('Sling'), suggestion('Max')],
    searches: [],
    decisionsAsked: [],
    // Domain must look like the brand: a generic SERP of plutotv.com for every query
    // would be filtered out and skip the Decisions call, so the fixture follows the keyword.
    search: async (payload) => {
      const brand = String(payload[0]?.keyword ?? 'brand')
        .split(/\s+/)[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
      const site = brand === 'pluto' ? 'plutotv.com' : `${brand}.com`;
      return task(organic([site, 'wikipedia.org']));
    },
    decide: async () => choice(),
    budget: () => ({ sql: '1=1', params: [] }),
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
    const request = JSON.parse(init.body);
    globalThis.fx.decisionsAsked.push(request);
    return globalThis.fx.decide(request);
  };
  return sqlite;
}
const discover = () => discovery.discoverBrandDomains('project', 'owner');
const overview = () => decisions.brandsOverview('project', 'owner', { fresh: true });
const rowOf = (view, name) => view.rows.find((row) => row.name === name);
const stored = (sqlite, name) => sqlite.prepare('SELECT * FROM brand_domain_lookups WHERE brand_name=?').get(name);

for (const edition of ['selfhost', 'cloud'].filter((name) => existsSync(root + `apps/${name}/drizzle`))) {
  test(`brand domains: the scheduler backfill runs only once authorized, then never repeats a brand (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      sqlite.prepare("UPDATE project_stores SET initialized=1 WHERE project_id='project'").run();
      assert.equal(await discovery.processBrandDomains(), 0);
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM brand_domain_lookups').get().n, 0);
      sqlite
        .prepare("INSERT INTO system_state(key,value) VALUES('brand_question_roles',?)")
        .run(JSON.stringify({ status: 'enabled', ceilingUsd: 3, enabledAt: '2000-01-01T00:00:00.000Z' }));
      assert.ok((await discovery.processBrandDomains()) > 0);
      const tried = sqlite.prepare('SELECT COUNT(*) n FROM brand_domain_lookups').get().n;
      assert.ok(tried > 0);
      // The memory: a brand already searched is never searched again; later visits only do what is left.
      for (let visit = 0; visit < 3; visit++) {
        sqlite.prepare("UPDATE system_state SET value='2000-01-01T00:00:00.000Z' WHERE key LIKE 'brand-domains-checked:%'").run();
        await discovery.processBrandDomains();
      }
      const keywords = globalThis.fx.searches.map((payload) => JSON.stringify(payload));
      assert.equal(new Set(keywords).size, keywords.length);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: a brand that already has a domain never reaches a provider (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      // The user corrected Roku's domain, rejected Sling with its domain, and Max is monitored.
      await decisions.decideBrand('project', user, { action: 'domain', name: 'Roku', domain: 'roku.com' });
      await decisions.decideBrand('project', user, { action: 'reject', name: 'Sling', domain: 'sling.com' });
      globalThis.fx.suggestions = globalThis.fx.suggestions.filter((item) => ['Roku', 'Sling', 'Max', 'Tubi'].includes(item.name));
      const result = await discover();
      assert.equal(result.processed, 0);
      assert.equal(result.pending, 0);
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM brand_domain_lookups').get().n, 0);
      assert.equal(globalThis.fx.searches.length + globalThis.fx.decisionsAsked.length, 0);
      const view = await overview();
      assert.deepEqual(['Roku', 'Sling', 'Tubi'].map((name) => rowOf(view, name).domainSource), ['user', 'user', 'answers']);
      assert.equal(view.domainDiscovery.pending, 0);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: a guessed domain is still searched, and the search replaces it (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      // The analysis paired Pluto with google.com (a page that mentioned both): not shown as domain/favicon.
      globalThis.fx.suggestions = [suggestion('Pluto', 'google.com'), suggestion('Tubi', 'tubitv.com')];
      let view = await overview();
      assert.deepEqual(
        [rowOf(view, 'Pluto').domain, rowOf(view, 'Pluto').domainSuggested, rowOf(view, 'Pluto').review, rowOf(view, 'Pluto').domainReview, rowOf(view, 'Tubi').review],
        // Nothing to pick yet: the initial, not a question to the user.
        [null, false, false, false, false],
      );
      assert.equal(view.domainDiscovery.pending, 1);
      await discover();
      assert.equal(globalThis.fx.searches.length, 1, 'only the guess is searched, never the confident domain');
      view = await overview();
      assert.deepEqual([rowOf(view, 'Pluto').domain, rowOf(view, 'Pluto').domainSource, rowOf(view, 'Pluto').review], ['plutotv.com', 'search', false]);
      assert.equal(view.domainDiscovery.pending, 0);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: the answers decide for free when they name one exact site (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Hulu')];
      sqlite.prepare("UPDATE runs SET sources_json=? WHERE id='run-Hulu'").run(JSON.stringify([{ url: 'https://www.hulu.com/watch', domain: 'hulu.com', title: 'Hulu' }]));
      const result = await discover();
      assert.equal(result.processed, 1);
      assert.equal(globalThis.fx.searches.length + globalThis.fx.decisionsAsked.length, 0, 'the free step makes no paid call');
      const row = rowOf(await overview(), 'Hulu');
      assert.deepEqual([row.domain, row.domainSource, row.domainConfidence, row.review, row.domainSuggested], ['hulu.com', 'answers', 'high', false, true]);
      assert.equal((await overview()).domainDiscovery.pending, 0);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: Google and the model run once per brand and country, and the cache stops a second search (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      let view = await overview();
      assert.equal(view.domainDiscovery.pending, 1);
      assert.equal(view.domainDiscovery.paid, true);
      const result = await discover();
      assert.equal(result.pending, 0);
      assert.equal(globalThis.fx.searches.length, 1);
      assert.deepEqual(globalThis.fx.searches[0].payload, [{ keyword: 'Pluto streaming', location_code: 2840, language_code: 'en', depth: 10 }]);
      assert.equal(globalThis.fx.searches[0].path, 'live/regular');
      assert.equal(globalThis.fx.decisionsAsked.length, 1);
      assert.equal(globalThis.fx.decisionsAsked[0].model, 'liquid/d1-ultra');
      assert.equal(globalThis.fx.decisionsAsked[0].state.country, 'United States');
      const row = rowOf(await overview(), 'Pluto');
      // wikipedia.org is a reference host: never offered as a candidate for another brand.
      assert.deepEqual([row.domain, row.domainSource, row.domainConfidence, row.review, row.domainCandidates], ['plutotv.com', 'search', 'high', false, []]);
      const lookup = stored(sqlite, 'Pluto');
      assert.equal(lookup.search_status, 'done');
      assert.deepEqual([lookup.search_reserved_usd, lookup.decision_reserved_usd, lookup.decision_status, lookup.paid_project_id], [0, 0, null, 'project']);
      assert.ok(Math.abs(lookup.search_cost_usd + lookup.decision_cost_usd - 0.0024) < 1e-9);
      // Asking again, from this or another request, repeats nothing.
      await discover();
      await discover();
      assert.equal(globalThis.fx.searches.length, 1);
      assert.equal(globalThis.fx.decisionsAsked.length, 1);
      // Another account holds no lookup until it discovers the brand itself (then it reuses the search, test below).
      assert.equal((await lookups.loadDomainLookups('other', 2840, ['pluto'])).size, 0);
      assert.equal((await lookups.loadDomainLookups('owner', 2840, ['pluto'])).size, 1);
      view = await overview();
      assert.equal(view.domainDiscovery.pending, 0);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: another account's same search is reused for free; the decision stays its own (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      await discover();
      assert.equal(globalThis.fx.searches.length, 1);
      const stamp = new Date().toISOString();
      const other = (id, category, language = 'en') =>
        sqlite
          .prepare("INSERT INTO projects(id,workspace_id,name,domain,competitors_json,language_code,location_code,category,daily_enabled,created_at) VALUES(?,'other','Other','other.example','[]',?,2840,?,0,?)")
          .run(id, language, category, stamp);
      // Same brand, category, country and language in another account: the search is not paid again.
      other('other-1', 'Streaming');
      await discovery.discoverBrandDomains('other-1', 'other');
      assert.equal(globalThis.fx.searches.length, 1, 'searched once for the platform');
      assert.equal(globalThis.fx.decisionsAsked.length, 2, 'each account decides with its own answers');
      const copied = sqlite.prepare("SELECT * FROM brand_domain_lookups WHERE workspace_id='other'").get();
      assert.deepEqual([copied.search_status, copied.search_cost_usd, copied.search_reserved_usd, copied.paid_project_id, copied.domain, copied.decision_project_id], ['done', 0, 0, null, 'plutotv.com', 'other-1']);
      assert.equal(copied.search_json, stored(sqlite, 'Pluto').search_json);
      // What the account's screens read of a lookup is the domain, its confidence, origin and candidates: no date or cost of the
      // search, so a reused search never tells one account that another looked the brand up.
      assert.deepEqual(Object.keys(lookups.lookupView(copied)).sort(), ['candidates', 'confidence', 'domain', 'source']);
      // Nothing counts against the project that reused it but its own decision.
      assert.ok(Math.abs((await lookups.projectDomainSpend('other-1', '2000-01-01T00:00:00.000Z')) - 0.0004) < 1e-9);
      // Another category or language is another search.
      other('other-2', 'pet food');
      sqlite.prepare("DELETE FROM brand_domain_lookups WHERE workspace_id='other'").run();
      await discovery.discoverBrandDomains('other-2', 'other');
      assert.equal(globalThis.fx.searches.length, 2);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: a brand named by one answer stays on the free step until a second one names it (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [{ ...suggestion('Pluto'), answerCount: 1 }];
      await discover();
      assert.equal(globalThis.fx.searches.length, 0);
      assert.equal((await overview()).domainDiscovery.pending, 0);
      globalThis.fx.suggestions = [{ ...suggestion('Pluto'), answerCount: 2 }];
      assert.equal((await overview()).domainDiscovery.pending, 1);
      await discover();
      assert.equal(globalThis.fx.searches.length, 1);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: an empty search is cached too, and costs no decision (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      globalThis.fx.search = async () => task([{ items: [] }]);
      await discover();
      assert.equal(globalThis.fx.searches.length, 1);
      assert.equal(globalThis.fx.decisionsAsked.length, 0);
      const row = rowOf(await overview(), 'Pluto');
      assert.deepEqual([row.domain, row.review, row.domainReview], [null, false, false]);
      await discover();
      assert.equal(globalThis.fx.searches.length, 1);
      assert.equal(stored(sqlite, 'Pluto').model, 'none');
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: several exact sites, an unsure model and "none of them" all go to review with candidates (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Sling'), suggestion('Pluto')];
      globalThis.fx.search = async (payload) => task(organic(payload[0].keyword.startsWith('Sling') ? ['sling.com', 'sling.tv'] : ['plutotv.com']));
      let asked = 0;
      globalThis.fx.decide = async () => (asked++ ? choice('none', 0.9) : choice('c0', 0.4));
      await discover();
      const view = await overview();
      const sling = rowOf(view, 'Sling');
      const pluto = rowOf(view, 'Pluto');
      // Pluto is decided first: the model picks a site but is unsure. Sling's answers name sling.com and sling.tv
      // (two different top levels, so the free step cannot choose) and the model says none of them is the brand.
      assert.deepEqual([pluto.domain, pluto.domainConfidence, pluto.review], ['plutotv.com', 'low', true]);
      assert.deepEqual([sling.domain, sling.review, sling.domainCandidates], [null, true, ['sling.com', 'sling.tv']]);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: the monthly ceiling per project is respected (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto'), suggestion('Hulu2'), suggestion('Tubi2')];
      for (const name of ['Hulu2', 'Tubi2']) sqlite.prepare("INSERT INTO runs(id,workspace_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,status,callback_token,cost,created_at,budget_credits,answer,response_available,sources_json) VALUES(?,'owner','project','p',?,'q','chat_gpt','[]',2840,'en','complete','f',0,?,0,?,1,'[]')").run(`run-${name}`, `k-${name}`, new Date().toISOString(), `${name} is a service.`);
      // One brand's worst case is US$ 0.023; this ceiling fits the first one and not a second.
      globalThis.fx.settings.BRAND_DOMAIN_MAX_USD = '0.025';
      const result = await discover();
      assert.equal(globalThis.fx.searches.length, 1);
      assert.equal(result.pending, 0, 'the capped brands are not pending: the screen must not retry them forever');
      const view = await overview();
      assert.equal(view.domainDiscovery.capped, true);
      assert.equal(view.domainDiscovery.pending, 0);
      assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM brand_domain_lookups WHERE search_status IS NULL").get().n, 2);
      // Another project's spend is not this project's.
      globalThis.fx.settings.BRAND_DOMAIN_MAX_USD = '1';
      assert.equal((await overview()).domainDiscovery.pending, 2);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: the account ceilings shared with collection stop the paid steps (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      globalThis.fx.budget = () => ({ sql: '1=0', params: [] });
      await discover();
      assert.equal(globalThis.fx.searches.length, 0);
      assert.equal(stored(sqlite, 'Pluto').search_status, null);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: a search that may have been billed is never sent again (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      const ProviderError = globalThis.fxProviderError;
      globalThis.fx.search = async () => {
        throw new ProviderError('timeout', 0, true);
      };
      await discover();
      await discover();
      await discover();
      assert.equal(globalThis.fx.searches.length, 1);
      const lookup = stored(sqlite, 'Pluto');
      assert.equal(lookup.search_status, 'unknown');
      assert.deepEqual([lookup.search_reserved_usd, lookup.decision_reserved_usd], [0.003, 0], 'the reserve stays as spent for the month');
      assert.equal((await overview()).domainDiscovery.pending, 0);
      assert.equal(await lookups.projectDomainSpend('project', '2000-01-01T00:00:00.000Z'), 0.003);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: a failure that cannot have been billed is retried a bounded number of times (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      const ProviderError = globalThis.fxProviderError;
      globalThis.fx.search = async () => {
        throw new ProviderError('DataForSEO HTTP 401', 401, false);
      };
      for (let round = 0; round < 6; round++) await discover();
      assert.equal(globalThis.fx.searches.length, 3);
      const lookup = stored(sqlite, 'Pluto');
      assert.deepEqual([lookup.search_status, lookup.search_attempts, lookup.search_reserved_usd + lookup.decision_reserved_usd], [null, 3, 0]);
      assert.equal((await overview()).domainDiscovery.pending, 0);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: a model failure keeps the paid search and never resends a possibly billed decision (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      let calls = 0;
      globalThis.fx.decide = async () => {
        calls++;
        if (calls === 1) return new Response('{}', { status: 400 });
        throw new Error('socket closed');
      };
      await discover();
      let lookup = stored(sqlite, 'Pluto');
      assert.deepEqual([lookup.search_status, lookup.model, lookup.decision_attempts, lookup.decision_reserved_usd, lookup.decision_status], ['done', null, 1, 0, null]);
      // The next request retries only the decision (no new search); the lost reply is then final.
      await discover();
      await discover();
      assert.equal(globalThis.fx.searches.length, 1);
      assert.equal(calls, 2);
      lookup = stored(sqlite, 'Pluto');
      assert.equal(lookup.decision_attempts, 3);
      assert.deepEqual([lookup.decision_reserved_usd, lookup.decision_status], [0.02, 'unknown']);
      assert.equal((await overview()).domainDiscovery.pending, 0);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: the user's decision always wins and is never written by discovery (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      await discover();
      assert.equal(rowOf(await overview(), 'Pluto').domain, 'plutotv.com');
      const events = () => sqlite.prepare('SELECT COUNT(*) n FROM brand_decision_events').get().n;
      assert.equal(events(), 0, 'discovery records no decision');
      await decisions.decideBrand('project', user, { action: 'domain', name: 'Pluto', domain: 'pluto.tv' });
      const row = rowOf(await overview(), 'Pluto');
      assert.deepEqual([row.domain, row.domainSource, row.domainConfidence, row.review, row.domainSuggested], ['pluto.tv', 'user', null, false, false]);
      assert.equal(stored(sqlite, 'Pluto').domain, 'plutotv.com', 'the stored result is kept as it was');
      await discover();
      assert.equal(events(), 1);
      assert.equal(globalThis.fx.searches.length, 1);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: without a ceiling or credentials only the free step runs, with no error (${edition})`, async () => {
    for (const settings of [{ BRAND_DOMAIN_MAX_USD: '' }, { OPENROUTER_API_KEY: '' }, { DATAFORSEO_LOGIN: '' }]) {
      const sqlite = setup(edition);
      try {
        Object.assign(globalThis.fx.settings, settings);
        globalThis.fx.suggestions = [suggestion('Pluto'), suggestion('Hulu')];
        sqlite.prepare("UPDATE runs SET sources_json=? WHERE id='run-Hulu'").run(JSON.stringify([{ url: 'https://hulu.com/', domain: 'hulu.com', title: 'x' }]));
        const view = await overview();
        assert.equal(view.domainDiscovery.paid, false);
        assert.equal(view.domainDiscovery.pending, 2);
        const result = await discover();
        assert.deepEqual([result.processed, result.pending, result.paid], [2, 0, false]);
        assert.equal(globalThis.fx.searches.length + globalThis.fx.decisionsAsked.length, 0);
        const after = await overview();
        assert.equal(rowOf(after, 'Hulu').domain, 'hulu.com');
        assert.deepEqual([rowOf(after, 'Pluto').domain, rowOf(after, 'Pluto').review], [null, false]);
      } finally {
        sqlite.close();
      }
    }
  });

  test(`brand domains: nothing is spent while the analysis is not complete, and another owner cannot start it (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      globalThis.fx.status = 'running';
      assert.equal((await discover()).processed, 0);
      assert.equal((await overview()).domainDiscovery.pending, 0);
      globalThis.fx.status = 'complete';
      await assert.rejects(discovery.discoverBrandDomains('project', 'other'), /não encontrado/);
      assert.equal(globalThis.fx.searches.length, 0);
    } finally {
      sqlite.close();
    }
  });

  // The spend every ceiling reads. `held` is the sum the project's meter, and both shared account meters, must show.
  const held = (sqlite) => ({
    month: sqlite.prepare(`SELECT ${spendRule.platformSpendSql('k.s')} AS n FROM (SELECT ? AS s) k`).get(`${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`).n,
    day: sqlite.prepare(`SELECT ${spendRule.platformSpendSql('k.s')} AS n FROM (SELECT ? AS s) k`).get(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`).n,
  });
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
  const meters = async (sqlite, projectId, expected, label) => {
    near(await lookups.projectDomainSpend(projectId, '2000-01-01T00:00:00.000Z'), expected, `${label} (project)`);
    near(held(sqlite).month, expected, `${label} (month)`);
    near(held(sqlite).day, expected, `${label} (day)`);
  };

  test(`brand domains: two requests at once send the paid decision only once and record its cost (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      let open, entered;
      const gate = new Promise((resolve) => (open = resolve));
      const started = new Promise((resolve) => (entered = resolve));
      globalThis.fx.decide = async () => {
        entered();
        await gate;
        return choice();
      };
      const first = discover();
      await started;
      const second = discover();
      await new Promise((resolve) => setTimeout(resolve, 50));
      open();
      await Promise.all([first, second]);
      assert.equal(globalThis.fx.searches.length, 1);
      assert.equal(globalThis.fx.decisionsAsked.length, 1);
      const lookup = stored(sqlite, 'Pluto');
      assert.deepEqual([lookup.decision_attempts, lookup.decision_status, lookup.model], [1, null, 'liquid/d1-ultra']);
      await meters(sqlite, 'project', 0.0024, 'settled');
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: a decision interrupted after it was sent is held, counted and never resent (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      // The process dies while the model call is out: the reply never comes back.
      globalThis.fx.decide = () => new Promise(() => {});
      discover();
      for (let wait = 0; wait < 50 && !globalThis.fx.decisionsAsked.length; wait++) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(globalThis.fx.decisionsAsked.length, 1);
      assert.equal(stored(sqlite, 'Pluto').decision_status, 'submitting');
      globalThis.fx.decide = async () => choice();
      assert.equal((await discover()).processed, 0);
      assert.equal((await overview()).domainDiscovery.pending, 0, 'a decision in flight is not owed again');
      assert.equal(globalThis.fx.decisionsAsked.length, 1);
      // The search cost plus the decision's whole reserve stay on the meters, whatever the month.
      await meters(sqlite, 'project', 0.022, 'in flight');
      sqlite.prepare("UPDATE brand_domain_lookups SET spent_at='2000-01-01T00:00:00.000Z'").run();
      near(held(sqlite).month, 0.022, 'a decision in flight is still counted after the month turned');
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: another project's paid step is charged to it, not to the project that made the free cache (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto'), suggestion('Roku')];
      // Project A (free step only: no ceiling yet) fills the account's cache for both brands.
      globalThis.fx.settings.BRAND_DOMAIN_MAX_USD = '';
      await discover();
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM brand_domain_lookups WHERE project_id=?').get('project').n, 2);
      sqlite
        .prepare("INSERT INTO projects(id,workspace_id,name,domain,competitors_json,language_code,location_code,category,daily_enabled,created_at) VALUES('second','owner','Netflix 2','netflix.com','[]','en',2840,'streaming',0,?)")
        .run(new Date().toISOString());
      // Project B pays, with a ceiling that fits one brand's worst case (US$ 0.023) and not two.
      globalThis.fx.settings.BRAND_DOMAIN_MAX_USD = '0.025';
      const askB = () => discovery.discoverBrandDomains('second', 'owner');
      await Promise.all([askB(), askB()]);
      assert.equal(globalThis.fx.searches.length, 1, 'two requests at once still fit one brand');
      near(await lookups.projectDomainSpend('second', '2000-01-01T00:00:00.000Z'), 0.0024, 'B pays');
      near(await lookups.projectDomainSpend('project', '2000-01-01T00:00:00.000Z'), 0, 'A pays nothing');
      assert.ok(held(sqlite).month <= 0.025);
      const paid = sqlite.prepare('SELECT project_id,paid_project_id FROM brand_domain_lookups WHERE search_status IS NOT NULL').get();
      assert.deepEqual({ ...paid }, { project_id: 'project', paid_project_id: 'second' }, 'the creator is kept as history');
      // The ceiling is per project: A, with its own ceiling, still gets the other brand searched.
      await discover();
      assert.equal(globalThis.fx.searches.length, 2);
      near(await lookups.projectDomainSpend('project', '2000-01-01T00:00:00.000Z'), 0.0024, 'A pays its own');
      near(await lookups.projectDomainSpend('second', '2000-01-01T00:00:00.000Z'), 0.0024, 'B unchanged');
      // The decision of a search B paid for is never finished by, nor billed to, another project.
      const view = await discovery.discoverBrandDomains('second', 'owner');
      assert.equal(view.pending, 0);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: a decision surely not billed is finished by another active project when the payer is gone (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      sqlite
        .prepare("INSERT INTO projects(id,workspace_id,name,domain,competitors_json,language_code,location_code,category,daily_enabled,created_at) VALUES('second','owner','Netflix 2','netflix.com','[]','en',2840,'streaming',0,?)")
        .run(new Date().toISOString());
      // A pays the search; the model answers 429 (never billed), then A is archived.
      globalThis.fx.decide = async () => new Response('{}', { status: 429, headers: { 'retry-after': '0.001' } });
      await discover();
      let lookup = stored(sqlite, 'Pluto');
      assert.deepEqual([lookup.search_status, lookup.model, lookup.decision_status, lookup.decision_reserved_usd], ['done', null, null, 0]);
      sqlite.prepare("UPDATE projects SET archived=1 WHERE id='project'").run();
      globalThis.fx.decide = async () => choice();
      const askB = () => discovery.discoverBrandDomains('second', 'owner');
      // B pays the decision under its own ceiling: one that cannot hold the decision's reserve leaves it alone.
      globalThis.fx.settings.BRAND_DOMAIN_MAX_USD = '0.01';
      assert.equal((await askB()).processed, 0);
      globalThis.fx.settings.BRAND_DOMAIN_MAX_USD = '1';
      const [first, second] = await Promise.all([askB(), askB()]);
      assert.equal(first.processed + second.processed, 1, 'two requests at once still decide once');
      assert.equal(globalThis.fx.searches.length, 1, 'the search is not repeated');
      lookup = stored(sqlite, 'Pluto');
      assert.deepEqual([lookup.domain, lookup.paid_project_id, lookup.decision_project_id, lookup.decision_attempts], ['plutotv.com', 'project', 'second', 2]);
      near(await lookups.projectDomainSpend('project', '2000-01-01T00:00:00.000Z'), 0.002, 'A keeps what the search cost');
      near(await lookups.projectDomainSpend('second', '2000-01-01T00:00:00.000Z'), 0.0004, 'B pays the decision');
      assert.equal((await askB()).pending, 0);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: an unpriced step keeps its reserve through the next step and every ceiling (${edition})`, async () => {
    // [label, search, model reply, expected held] — a reply without a cost holds the step's own reserve.
    const cases = [
      ['empty search, no cost', () => task([{ items: [] }], null), null, 0.003],
      ['empty search, with cost', () => task([{ items: [] }], 0.002), null, 0.002],
      ['search without cost, model with cost', () => task(organic(['plutotv.com']), null), () => choice('c0', 0.95, 0.0004), 0.0034],
      ['search with cost, model without cost', () => task(organic(['plutotv.com'])), () => choice('c0', 0.95, null), 0.022],
      ['neither reports a cost', () => task(organic(['plutotv.com']), null), () => choice('c0', 0.95, null), 0.023],
    ];
    for (const [label, search, decide, expected] of cases) {
      const sqlite = setup(edition);
      try {
        globalThis.fx.suggestions = [suggestion('Pluto')];
        globalThis.fx.search = async () => search();
        if (decide) globalThis.fx.decide = async () => decide();
        await discover();
        await meters(sqlite, 'project', expected, label);
        await discover();
        await meters(sqlite, 'project', expected, `${label}, asked again`);
      } finally {
        sqlite.close();
      }
    }
  });

  test(`brand domains: a failed decision holds nothing it can be sure was not billed, and the model's two outcomes settle the meters (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('Pluto')];
      globalThis.fx.decide = async () => new Response('{}', { status: 400 });
      await discover();
      await meters(sqlite, 'project', 0.002, 'rejected before billing');
      globalThis.fx.decide = async () => {
        throw new Error('socket closed');
      };
      await discover();
      await meters(sqlite, 'project', 0.022, 'lost reply keeps the decision reserve');
      await discover();
      assert.equal(globalThis.fx.decisionsAsked.length, 2);
    } finally {
      sqlite.close();
    }
  });
  // What was stored before the rule that a domain must look like the brand.
  test(`brand domains: the backfill clears rejected domains, settles what the wider rule allows and re-decides once, without a new search (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.suggestions = [suggestion('DuckTales'), suggestion('True Crime'), suggestion('Amazon Prime'), suggestion('Hulu')];
      sqlite
        .prepare("INSERT INTO runs(id,workspace_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,status,callback_token,cost,created_at,budget_credits,answer,response_available,sources_json) VALUES('run-Amazon Prime','owner','project','p','key-ap','q','chat_gpt','[]',2840,'en','complete','fixture',0,?,0,'Amazon Prime streams on primevideo.com.',1,'[]')")
        .run(new Date().toISOString());
      const keys = Object.fromEntries((await overview()).rows.map((row) => [row.name, row.key]));
      const insert = sqlite.prepare(
        `INSERT INTO brand_domain_lookups(workspace_id,brand_key,location_code,project_id,brand_name,candidates_json,domain,confidence,source,requested_at,decided_at,search_status,search_json,search_attempts,search_cost_usd,decision_attempts,decision_cost_usd,model,paid_project_id)
         VALUES('owner',?,2840,'project',?,?,?,?,?,'2026-10-01T00:00:00.000Z',?,?,?,?,?,?,?,?,?)`,
      );
      const serp = JSON.stringify([{ domain: 'ducktales.com', title: 'DuckTales', rank: 1 }, { domain: 'google.com', title: 'Google', rank: 2 }]);
      // Decided over google.com before the rule; paid once.
      insert.run(keys.DuckTales, 'DuckTales', '[]', 'google.com', 0.9, 'search', '2026-10-01', 'done', serp, 1, 0.002, 1, 0.0004, 'liquid/d1-ultra', 'project');
      // A partial answers guess on the project's own site, never searched.
      insert.run(keys['True Crime'], 'True Crime', '[{"domain":"netflix.com"}]', 'netflix.com', 0.5, 'answers', '2026-10-01', null, null, 0, 0, 0, 0, null, null);
      // Searched, nothing offered, so "none"; the wider rule now sees primevideo.com in the answers.
      insert.run(keys['Amazon Prime'], 'Amazon Prime', '[]', null, null, null, null, 'done', '[]', 1, 0.002, 0, 0, 'none', 'project');
      // Fine as it is.
      insert.run(keys.Hulu, 'Hulu', '[{"domain":"hulu.com"}]', 'hulu.com', 0.9, 'answers', '2026-10-01', null, null, 0, 0, 0, 0, null, null);
      const snapshot = () => JSON.stringify(sqlite.prepare('SELECT * FROM brand_domain_lookups ORDER BY brand_key').all());
      const before = snapshot();

      const dry = await discovery.backfillBrandDomains('project', 'owner', false);
      assert.equal(snapshot(), before, 'the dry-run writes nothing');
      assert.deepEqual(
        [dry.discovered, dry.withoutDomain, dry.rejected, dry.freePicks, dry.reopened, dry.owed.search, dry.owed.decide],
        [4, 3, 2, 1, 1, 1, 1],
      );
      assert.equal(dry.estimatedUsd, 0.0028, 'one search + decision, one decision');
      assert.equal(dry.worstCaseUsd, 0.043);
      assert.equal(globalThis.fx.searches.length + globalThis.fx.decisionsAsked.length, 0);

      const real = await discovery.backfillBrandDomains('project', 'owner', true);
      assert.deepEqual([real.rejected, real.freePicks, real.reopened], [2, 1, 1]);
      const duck = stored(sqlite, 'DuckTales');
      assert.deepEqual([duck.domain, duck.confidence, duck.source, duck.model, duck.decision_attempts, duck.search_cost_usd, duck.decision_cost_usd], [null, null, null, null, 0, 0.002, 0.0004]);
      assert.equal(stored(sqlite, 'True Crime').domain, null);
      const prime = stored(sqlite, 'Amazon Prime');
      assert.deepEqual([prime.domain, prime.source], ['primevideo.com', 'answers']);
      assert.equal(stored(sqlite, 'Hulu').domain, 'hulu.com');
      assert.equal(globalThis.fx.searches.length + globalThis.fx.decisionsAsked.length, 0, 'the backfill itself never calls a provider');

      // The owed paid steps run through the normal discovery: True Crime is searched, DuckTales is only re-decided.
      await discover();
      assert.equal(globalThis.fx.searches.length, 1);
      assert.equal(globalThis.fx.searches[0].payload[0].keyword, 'True Crime streaming');
      assert.equal(globalThis.fx.decisionsAsked.length, 2);
      assert.equal(stored(sqlite, 'DuckTales').domain, 'ducktales.com');
      assert.equal(stored(sqlite, 'DuckTales').search_attempts, 1, 'no second search for DuckTales');
      assert.ok(!globalThis.fx.decisionsAsked.some((request) => JSON.stringify(request).includes('google.com')), 'a rejected domain is never offered again');

      // Idempotent: a second run changes nothing and asks nothing.
      const settled = snapshot();
      const again = await discovery.backfillBrandDomains('project', 'owner', true);
      assert.deepEqual([again.rejected, again.freePicks, again.reopened], [0, 0, 0]);
      await discover();
      assert.equal(snapshot(), settled);
      assert.equal(globalThis.fx.searches.length, 1);
      assert.equal(globalThis.fx.decisionsAsked.length, 2);
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: the backfill respects the ceiling and never touches a user's domain (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      await decisions.decideBrand('project', user, { action: 'domain', name: 'Roku', domain: 'roku.com' });
      globalThis.fx.suggestions = [suggestion('Roku'), suggestion('Pluto')];
      const keys = Object.fromEntries((await overview()).rows.map((row) => [row.name, row.key]));
      sqlite
        .prepare("INSERT INTO brand_domain_lookups(workspace_id,brand_key,location_code,project_id,brand_name,domain,confidence,source,requested_at) VALUES('owner',?,2840,'project','Pluto','google.com',0.5,'answers','2026-10-01T00:00:00.000Z')")
        .run(keys.Pluto);
      globalThis.fx.settings.BRAND_DOMAIN_MAX_USD = '0.001';
      const result = await discovery.backfillBrandDomains('project', 'owner', true);
      assert.deepEqual([result.discovered, result.rejected, result.paid, result.capped], [2, 1, true, true]);
      assert.deepEqual([result.owed.search, result.estimatedUsd], [0, 0], 'under the ceiling nothing paid is owed');
      assert.equal(stored(sqlite, 'Pluto').domain, null);
      await discover();
      assert.equal(globalThis.fx.searches.length + globalThis.fx.decisionsAsked.length, 0);
      assert.equal(rowOf(await overview(), 'Roku').domain, 'roku.com');
    } finally {
      sqlite.close();
    }
  });

  test(`brand domains: free reads of the brands' sites confirm, doubt or find a domain, once each, and the person still decides (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      globalThis.fx.settings = {};
      const pages = {
        'tubitv.com': { reachable: true, host: 'tubitv.com', title: 'Tubi: Watch Free Movies &amp; TV', siteName: null },
        'roku.com': { reachable: false, host: 'roku.com', title: null, siteName: null },
        'hulu.com': { reachable: true, host: 'hulu.com', title: null, siteName: 'Hulu' },
        // The name as a .com that does not say it is the brand gives no domain.
        'sling.com': { reachable: true, host: 'sling.com', title: 'Live TV, anywhere', siteName: null },
        // The name as a .com that leads to the brand's site, which names it: the guess, to confirm.
        'pluto.com': { reachable: true, host: 'plutotv.com', title: 'Pluto TV: Watch Free TV', siteName: null },
      };
      const asked = [];
      globalThis.fx.site = async (host) => {
        asked.push(host);
        return { host, site: pages[host] ?? { reachable: false, host, title: null, siteName: null }, icon: false };
      };
      globalThis.fx.suggestions = [suggestion('Tubi', 'tubitv.com'), suggestion('Roku', 'roku.com'), suggestion('Hulu'), suggestion('Sling'), suggestion('Pluto')];
      assert.equal((await overview()).domainDiscovery.sites, 5);
      for (let call = 0; call < 5 && (await overview()).domainDiscovery.sites; call++) await discover();
      assert.deepEqual([...asked].sort(), Object.keys(pages).sort(), 'every site read once');
      const view = await overview();
      const facts = (name) => {
        const row = rowOf(view, name);
        return [row.domain, row.domainSource, row.domainConfidence, row.domainSite, row.domainReview];
      };
      assert.deepEqual(facts('Tubi'), ['tubitv.com', 'answers', 'high', 'confirmed', false]);
      assert.deepEqual(facts('Roku'), ['roku.com', 'answers', 'low', 'unreachable', true]);
      assert.deepEqual(facts('Hulu'), ['hulu.com', 'answers', 'high', 'confirmed', false]);
      assert.deepEqual(facts('Sling'), [null, null, null, null, true]);
      assert.deepEqual(facts('Pluto'), ['plutotv.com', 'site', 'low', 'confirmed', true]);
      assert.equal(view.domainDiscovery.sites, 0);
      assert.equal(globalThis.fx.searches.length + globalThis.fx.decisionsAsked.length, 0, 'no paid call');
      await discover();
      assert.equal(asked.length, 5, 'a recent read is not repeated');
      // The person's domain wins over any read.
      await decisions.decideBrand('project', user, { action: 'domain', name: 'Roku', domain: 'roku.com' });
      const roku = rowOf(await overview(), 'Roku');
      assert.deepEqual([roku.domainSource, roku.domainSite, roku.domainReview], ['user', null, false]);
    } finally {
      sqlite.close();
    }
  });
}

for (const edition of ['selfhost', 'cloud'].filter((name) => existsSync(root + `apps/${name}/drizzle`))) {
  test(`brand domains: decision roots settle a lone named site without the model, and a decision over public facts is shared across accounts (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      const pages = { 'plutotv.com': { reachable: true, host: 'plutotv.com', title: 'Pluto TV: Watch Free TV', siteName: null } };
      globalThis.fx.site = async (host) => ({ host, site: pages[host] ?? { reachable: false, host, title: null, siteName: null }, icon: false });
      // Pluto: one candidate (wikipedia.org does not look like it) whose home page names it: no question to the model.
      globalThis.fx.suggestions = [suggestion('Pluto')];
      await discover();
      let pluto = stored(sqlite, 'Pluto');
      assert.deepEqual([pluto.domain, pluto.confidence, pluto.source, pluto.model, pluto.decision_reserved_usd], ['plutotv.com', 0.9, 'search', 'rules', 0]);
      assert.equal(globalThis.fx.decisionsAsked.length, 0);
      // Roku: two candidates from the search alone, so the model decides, and the decision is keyed for sharing.
      globalThis.fx.search = async () => task(organic(['roku.com', 'rokuchannel.com']));
      globalThis.fx.suggestions = [suggestion('Roku')];
      await discover();
      assert.equal(globalThis.fx.decisionsAsked.length, 1);
      const roku = stored(sqlite, 'Roku');
      assert.equal(roku.domain, 'roku.com');
      assert.ok(roku.decision_key);
      // Sling: its answers name its sites, so the decision weighed this account's answers and is never shared.
      globalThis.fx.search = async () => task(organic(['sling.com', 'slingtv.com']));
      globalThis.fx.suggestions = [suggestion('Sling')];
      await discover();
      assert.equal(globalThis.fx.decisionsAsked.length, 2);
      assert.equal(stored(sqlite, 'Sling').decision_key, null);
      // Another account, same brand, category, country and language: the search and the decision are reused, free, dated today.
      const before = new Date().toISOString();
      sqlite
        .prepare("INSERT INTO projects(id,workspace_id,name,domain,competitors_json,language_code,location_code,category,daily_enabled,created_at) VALUES('theirs','other','Other','other.example','[]','en',2840,'streaming',0,?)")
        .run(before);
      globalThis.fx.search = async () => task(organic(['roku.com', 'rokuchannel.com']));
      globalThis.fx.suggestions = [suggestion('Roku')];
      const searches = globalThis.fx.searches.length;
      await discovery.discoverBrandDomains('theirs', 'other');
      const theirs = sqlite.prepare("SELECT * FROM brand_domain_lookups WHERE workspace_id='other' AND brand_key='roku'").get();
      assert.deepEqual([theirs.domain, theirs.decision_cost_usd, theirs.search_cost_usd, theirs.decision_key], ['roku.com', 0, 0, roku.decision_key]);
      assert.ok(theirs.decided_at >= before, 'dated by this account, never by the first lookup');
      assert.equal(globalThis.fx.decisionsAsked.length, 2, 'no new decision');
      assert.equal(globalThis.fx.searches.length, searches, 'no new search');
      // A different category is another decision.
      sqlite.prepare("UPDATE projects SET category='hardware' WHERE id='theirs'").run();
      sqlite.prepare("DELETE FROM brand_domain_lookups WHERE workspace_id='other'").run();
      await discovery.discoverBrandDomains('theirs', 'other');
      assert.equal(globalThis.fx.decisionsAsked.length, 3);
      pluto = stored(sqlite, 'Pluto');
      assert.equal(pluto.model, 'rules');
    } finally {
      sqlite.close();
    }
  });
}
