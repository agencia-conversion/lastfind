import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
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
        const results = statements.map(({ sql, params }) => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
const fixtureImports = {
  './env': `export const db=()=>globalThis.sourceFixture.db;export const now=()=>new Date().toISOString();export const setting=(key)=>globalThis.sourceFixture.settings[key]||'';`,
  './http': `export class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}`,
  './workspace': `export async function ownedProject(id,owner){const p=await globalThis.sourceFixture.db.prepare('SELECT * FROM projects WHERE id=? AND owner_id=? AND archived=0').bind(id,owner).first();if(!p)throw new Error('Project not found.');return p;}`,
  './project-store-read': 'export const projectReadDatabase=async()=>globalThis.sourceFixture.db;',
  './capabilities': 'export const researchAllProjects=true;',
  './competitor-analysis': `export const competitorAnalysisStatus=async()=>({status:'complete',needsEnsure:false,suggestions:[]});`,
  './reports': `export const parseReportFilter=(q)=>({engine:'all',cutoff:'2020-01-01T00:00:00.000Z',end:'2099-01-01T00:00:00.000Z'});
export const reportContext=async()=>({project:{id:'project'}});
export const sourcesReport=async(ctx,q,size=50)=>{const rows=globalThis.sourceFixture.sources[q.get('group')||'domain']||[];return {rows:rows.slice(0,size),hasMore:rows.length>size,available:0,complete:rows.length};};
export const citationTotal=async()=>globalThis.sourceFixture.citations;
export const sourceEntityReport=async()=>{throw new Error('not used');};`,
};
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents: `export * from './packages/core/lib/server/brand-research.ts'; export * from './packages/core/lib/server/source-types.ts';`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'source-fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /^\.\/(env|http|workspace|project-store-read|competitor-analysis|reports|capabilities)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtureImports[args.path], loader: 'js' }));
        plugin.onResolve({ filter: /^@\// }, (args) => ({
          path: root + 'packages/core/' + args.path.slice(2) + (args.path.endsWith('.mjs') ? '' : '.ts'),
        }));
      },
    },
  ],
});
const worker = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const row = (domain, responses, ownership = 'third-party') => ({ key: domain, domain, title: domain, responses, pages: 1, engines: ['chat_gpt'], mentions: 0, visibility: 0, ownership });
function setup({ provider = 'jev', enabled = 1, domains = [] } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(root + 'apps/selfhost/drizzle').filter((name) => name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(root + 'apps/selfhost/drizzle/' + name, 'utf8'));
  const stamp = new Date().toISOString();
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('owner','test@example.invalid','Test',?)").run(stamp);
  sqlite.prepare("INSERT INTO projects(id,owner_id,name,domain,category,daily_enabled,created_at) VALUES('project','owner','Acme','acme.example','software',0,?)").run(stamp);
  sqlite.prepare('INSERT INTO brand_research_configurations(project_id,owner_id,provider,enabled,revision,updated_at) VALUES(?,?,?,?,1,?)').run('project', 'owner', provider, enabled, stamp);
  const settings = { OPENROUTER_API_KEY: 'isolated-not-a-key', BRAND_RESEARCH_ENABLED: 'true', BRAND_RESEARCH_PROJECTS: 'project' };
  globalThis.sourceFixture = {
    db: d1(sqlite),
    settings,
    sources: { domain: [row('acme.example', 9, 'own'), row('rival.example', 8, 'competitor'), ...domains], url: [] },
    citations: 0,
  };
  return { sqlite, settings };
}
const decision = (questions, choices, cost = 0.001) => ({
  model: 'typesafe/jev-1.14',
  answers: Object.fromEntries(Object.keys(questions).map((id, index) => [id, { type: 'choice', choice: choices[index % choices.length] }])),
  usage: { cost },
});
function provider(choices = ['editorial']) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    calls.push({ url: String(url), payload });
    return new Response(JSON.stringify(decision(payload.questions, choices)), { status: 200 });
  };
  return calls;
}
const classify = (kind = 'domain') => worker.enqueueSourceTypes('project', 'owner', new URLSearchParams(), kind);

test('classifier state explains why new work cannot be queued while cached types stay readable', async () => {
  const { settings, sqlite } = setup({ enabled: 0 });
  assert.equal((await worker.sourceTypeClassifier('project', 'owner')).state, 'disabled');
  sqlite.prepare('UPDATE brand_research_configurations SET enabled=1').run();
  delete settings.OPENROUTER_API_KEY;
  assert.equal((await worker.sourceTypeClassifier('project', 'owner')).state, 'unconfigured');
  settings.OPENROUTER_API_KEY = 'isolated-not-a-key';
  settings.BRAND_RESEARCH_PROJECTS = 'other';
  assert.equal((await worker.sourceTypeClassifier('project', 'owner')).state, 'unavailable');
  settings.BRAND_RESEARCH_PROJECTS = 'project';
  const ready = await worker.sourceTypeClassifier('project', 'owner');
  assert.deepEqual([ready.state, ready.provider, ready.model], ['ready', 'jev', 'typesafe/jev-1.14']);
});

test('no key or disabled evaluator never reaches the provider', async () => {
  const { settings } = setup({ domains: [row('news.example', 3)] });
  const calls = provider();
  delete settings.OPENROUTER_API_KEY;
  await assert.rejects(classify(), /OpenRouter server key/);
  settings.OPENROUTER_API_KEY = 'isolated-not-a-key';
  settings.BRAND_RESEARCH_PROJECTS = 'other';
  await assert.rejects(classify(), /not authorized/);
  assert.equal(calls.length, 0);
  const disabled = setup({ enabled: 0, domains: [row('news.example', 3)] });
  assert.ok(disabled);
  await assert.rejects(classify(), /Enable the evaluator/);
  assert.equal(calls.length, 0);
  await assert.rejects(worker.enqueueSourceTypes('project', 'wrong-owner', new URLSearchParams(), 'domain'), /not found/);
});

test('classifies each third-party domain once, keeps own and competitor from project data, and reuses the cache', async () => {
  const { sqlite } = setup({ domains: [row('news.example', 5), row('forum.example', 3), row('gov.example', 1)] });
  const calls = provider(['editorial', 'ugc', 'institutional']);
  const first = await classify();
  assert.equal(first.queued, 3);
  assert.equal(first.batches, 1);
  assert.equal(first.processed, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(calls[0].payload.model, 'typesafe/jev-1.14');
  assert.deepEqual(Object.keys(calls[0].payload.questions), ['s0', 's1', 's2']);
  assert.equal(Object.hasOwn(calls[0].payload.questions.s0.criteria, 'competitor'), false);
  assert.equal(Object.hasOwn(calls[0].payload.questions.s0.criteria, 'you'), false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM source_classifications").get().n, 3);
  const job = sqlite.prepare('SELECT status,cost_usd FROM brand_research_jobs').get();
  assert.deepEqual({ ...job }, { status: 'completed', cost_usd: 0.001 });
  const page = await worker.typedSourcesReport('owner', new URLSearchParams(), { project: { id: 'project' } });
  assert.deepEqual(
    page.rows.map((item) => [item.domain, item.sourceType]),
    [['acme.example', 'you'], ['rival.example', 'competitor'], ['news.example', 'editorial'], ['forum.example', 'ugc'], ['gov.example', 'institutional']],
  );
  const again = await classify();
  assert.equal(again.queued, 0);
  assert.equal(calls.length, 1, 'cached sources never trigger paid work');
});

test('limits one request to bounded batches and leaves the remainder to the scheduler', async () => {
  const domains = Array.from({ length: 130 }, (_, index) => row(`site${String(index).padStart(3, '0')}.example`, 500 - index));
  const { sqlite } = setup({ domains });
  const calls = provider();
  const result = await classify();
  assert.equal(result.queued, 100);
  assert.equal(result.batches, 5);
  assert.equal(result.processed, 2);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => Object.keys(call.payload.questions).length <= 20));
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM brand_research_jobs WHERE status='pending'").get().n, 3);
  const retry = await classify();
  assert.equal(retry.queued, 30, 'pending and cached sources are not queued twice');
  assert.equal(calls.length, 4, 'a repeated request processes at most two more batches');
  // The existing brand research worker must not claim source classification jobs.
  assert.equal(await worker.processBrandResearchJobs(), 0);
  assert.equal(await worker.processSourceTypeJobs(), 2);
  assert.equal(calls.length, 6);
});

test('an uncertain provider outcome is not resent and a changed evaluator uses a separate cache', async () => {
  const { sqlite } = setup({ domains: [row('news.example', 5)] });
  let outbound = 0;
  globalThis.fetch = async () => {
    outbound++;
    throw new Error('Isolated transport timeout.');
  };
  await classify();
  assert.equal(outbound, 1);
  assert.equal(sqlite.prepare('SELECT status FROM brand_research_jobs').get().status, 'unknown');
  const again = await classify();
  assert.equal(again.queued, 0, 'unknown outcomes block an automatic resend');
  assert.equal(outbound, 1);
  const calls = provider(['editorial']);
  sqlite.prepare("UPDATE brand_research_jobs SET status='completed'").run();
  sqlite.prepare("INSERT INTO source_classifications(kind,key,provider,model,rubric,type,classified_at) VALUES('domain','news.example','jev','typesafe/jev-1.14','source-types-v1','editorial','2026-01-01')").run();
  let page = await worker.typedSourcesReport('owner', new URLSearchParams(), { project: { id: 'project' } });
  assert.equal(page.rows.find((item) => item.domain === 'news.example').sourceType, 'editorial');
  sqlite.prepare("UPDATE brand_research_configurations SET provider='decisions',revision=2").run();
  page = await worker.typedSourcesReport('owner', new URLSearchParams(), { project: { id: 'project' } });
  assert.equal(page.rows.find((item) => item.domain === 'news.example').sourceType, 'unclassified');
  assert.equal(page.classifier.model, 'openai/gpt-6-luna-decisions');
  assert.equal(calls.length, 0, 'reading and changing configuration never call the provider');
});

test('distribution reports shares, partial classification and the type filter', async () => {
  const { sqlite } = setup({ domains: [row('news.example', 6), row('forum.example', 4), row('new.example', 2)] });
  const stamp = '2026-01-01';
  for (const [key, type] of [['news.example', 'editorial'], ['forum.example', 'ugc']])
    sqlite.prepare("INSERT INTO source_classifications(kind,key,provider,model,rubric,type,classified_at) VALUES('domain',?,'jev','typesafe/jev-1.14','source-types-v1',?,?)").run(key, type, stamp);
  globalThis.sourceFixture.citations = 9 + 8 + 6 + 4 + 2;
  const report = await worker.sourceTypesReport('owner', new URLSearchParams(), { project: { id: 'project' } });
  assert.equal(report.citations, 29);
  assert.equal(report.unclassified, 2);
  assert.equal(report.classified, 27);
  assert.deepEqual(
    report.types.map((item) => [item.type, item.citations]),
    [['you', 9], ['competitor', 8], ['editorial', 6], ['ugc', 4], ['unclassified', 2]],
  );
  assert.ok(Math.abs(report.types.reduce((sum, item) => sum + item.share, 0) - 100) < 1e-9);
  const filtered = await worker.typedSourcesReport('owner', new URLSearchParams('type=ugc'), { project: { id: 'project' } });
  assert.deepEqual(filtered.rows.map((item) => item.domain), ['forum.example']);
  const missing = await worker.typedSourcesReport('owner', new URLSearchParams('type=unclassified'), { project: { id: 'project' } });
  assert.deepEqual(missing.rows.map((item) => item.domain), ['new.example']);
  const own = await worker.typedSourcesReport('owner', new URLSearchParams('type=you'), { project: { id: 'project' } });
  assert.deepEqual(own.rows.map((item) => item.domain), ['acme.example']);
  await assert.rejects(worker.typedSourcesReport('owner', new URLSearchParams('type=bogus'), { project: { id: 'project' } }), /Invalid source type/);
});
