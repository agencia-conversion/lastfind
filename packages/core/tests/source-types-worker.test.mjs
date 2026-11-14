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
const fixtureImports = {
  './env': `export const db=()=>globalThis.sourceFixture.db;export const now=()=>new Date().toISOString();export const setting=(key)=>globalThis.sourceFixture.settings[key]||'';`,
  './http': `export class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}`,
  './workspace': `export async function ownedProject(id,owner){const p=await globalThis.sourceFixture.db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived=0').bind(id,owner).first();if(!p)throw new Error('Project not found.');return p;}`,
  './project-store-read': 'export const projectReadDatabase=async()=>globalThis.sourceFixture.db;export const storedCopy=async()=>({value:null,storedAt:0,keep(){}});',
  './capabilities': 'export const researchAllProjects=true;',
  './competitor-analysis': `export const competitorAnalysisStatus=async()=>({status:'complete',needsEnsure:false,suggestions:[]});`,
  './reports': `export const parseReportFilter=(q)=>({engine:'all',cutoff:'2020-01-01T00:00:00.000Z',end:'2099-01-01T00:00:00.000Z'});
export const reportContext=async()=>({project:{id:'project'}});
import { DatabaseSync } from 'node:sqlite';
// The type selection runs as the real list composes it (reports.ts): the rules' CASE, else the catalog keys.
const selected=(rows,selection)=>{const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE s(key TEXT)');for(const row of rows)sql.prepare('INSERT INTO s VALUES (?)').run(row.key);const keyIn='key '+(selection.exclude?'NOT IN':'IN')+' (SELECT value FROM json_each(?))';const where=selection.rules?'CASE '+selection.rules.sql+' ELSE '+keyIn+' END':keyIn;const kept=new Set(sql.prepare('SELECT key FROM s WHERE '+where).all(...(selection.rules?.params??[]),JSON.stringify(selection.keys)).map((r)=>r.key));sql.close();return rows.filter((row)=>kept.has(row.key));};
export const sourcesReport=async(ctx,q,size=50,selection)=>{const owner=q.get('owner');const all=globalThis.sourceFixture.sources[q.get('group')||'domain']||[];const rows=(selection?selected(all,selection):all).filter((row)=>!owner||(owner==='own'?row.ownership==='own':owner==='competitor'?row.ownership==='competitor':row.ownership==='third-party'));return {rows:rows.slice(0,size),hasMore:rows.length>size,available:0,complete:rows.length};};
export const SOURCE_COUNT_PAGE=10;
export const SOURCE_KEY_COUNT_PAGE=10;
export const sourceCounts=async(ctx,q,offset=0,size=10)=>{const rows=[...(globalThis.sourceFixture.sources[q.get('group')||'domain']||[])].sort((a,b)=>a.key<b.key?-1:1).slice(offset,offset+size+1);return {rows:rows.slice(0,size),hasMore:rows.length>size};};
export const sourceKeyCounts=async(ctx,q,offset=0,size=10)=>{const rows=[...(globalThis.sourceFixture.sources[q.get('group')||'domain']||[])].sort((a,b)=>a.key<b.key?-1:1).slice(offset,offset+size+1).map(({key,responses})=>({key,responses}));return {rows:rows.slice(0,size),hasMore:rows.length>size};};
export const citationTotal=async()=>globalThis.sourceFixture.citations;
export const sourceEntityReport=async()=>globalThis.sourceFixture.detail;`,
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
        plugin.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'workers-shim' }));
        plugin.onLoad({ filter: /.*/, namespace: 'workers-shim' }, () => ({ contents: 'export const waitUntil=()=>{};export const env={};', loader: 'js' }));
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
function setup({ provider = 'jev', enabled = 1, domains = [], before = '9999' } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  // `before` stops short of a migration so a test can seed what production held before it.
  for (const name of readdirSync(root + 'apps/selfhost/drizzle').filter((name) => name.endsWith('.sql') && name < before).sort())
    sqlite.exec(readFileSync(root + 'apps/selfhost/drizzle/' + name, 'utf8'));
  const stamp = new Date().toISOString();
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('owner','test@example.invalid','Test',?)").run(stamp);
  // Before 0101 the workspace was its owner: the column is owner_id.
  const ws = sqlite.prepare("SELECT 1 FROM pragma_table_info('projects') WHERE name='workspace_id'").get() ? 'workspace_id' : 'owner_id';
  sqlite.prepare(`INSERT INTO projects(id,${ws},name,domain,category,daily_enabled,created_at) VALUES('project','owner','Acme','acme.example','software',0,?)`).run(stamp);
  sqlite.prepare(`INSERT INTO brand_research_configurations(project_id,${ws},provider,enabled,revision,updated_at) VALUES(?,?,?,?,1,?)`).run('project', 'owner', provider, enabled, stamp);
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

const documentationDomains = [
  'developers.google.com', 'developers.google.cn', 'docs.python.org',
  'developer.example.com', 'devdocs.example.com', 'DOCS.example.com',
];
const ordinaryDomains = ['python.org', 'developers-example.com', 'api.docs.example.com'];

test('documentation site types override stale Corporate cache across list, filter, detail and Overview without a provider', async () => {
  const { sqlite, settings } = setup({ enabled: 0, domains: documentationDomains.map((key) => row(key, 3)) });
  delete settings.OPENROUTER_API_KEY;
  const calls = provider();
  for (const key of [...documentationDomains, ...ordinaryDomains])
    sqlite.prepare("INSERT INTO source_catalog(kind,key,provider,model,rubric,type,classified_at) VALUES('domain',?,'jev','typesafe/jev-1.14','source-types-v1','corporate','2026-01-01')").run(key.toLowerCase());
  const classifier = await worker.sourceTypeClassifier('project', 'owner');
  const types = await worker.cachedSourceTypes('domain', [...documentationDomains, ...ordinaryDomains], classifier);
  assert.deepEqual(documentationDomains.map((key) => types.get(key)), documentationDomains.map(() => 'reference'));
  assert.deepEqual(ordinaryDomains.map((key) => types.get(key)), ordinaryDomains.map(() => 'corporate'));
  const ctx = { project: { id: 'project' } };
  const page = await worker.typedSourcesReport('owner', new URLSearchParams('type=reference'), ctx);
  assert.deepEqual(page.rows.map((item) => item.domain), documentationDomains);
  globalThis.sourceFixture.detail = { key: documentationDomains[0], domain: documentationDomains[0], urls: [] };
  assert.equal((await worker.sourceEntityDetail('owner', new URLSearchParams('project=project'), 'domain')).sourceType, 'reference');
  globalThis.sourceFixture.citations = 17 + documentationDomains.length * 3;
  const overview = await worker.sourceTypesReport('owner', new URLSearchParams(), ctx);
  assert.equal(overview.types.find((item) => item.type === 'reference').citations, documentationDomains.length * 3);
  assert.equal(overview.types.some((item) => item.type === 'corporate'), false);
  assert.equal(calls.length, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM brand_research_jobs').get().n, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM source_catalog WHERE type='corporate'").get().n, documentationDomains.length + ordinaryDomains.length, 'existing catalog rows are preserved');
});

test('uncached documentation domains never queue or reserve paid work; other domains still use the provider fixture', async () => {
  const { sqlite } = setup();
  globalThis.sourceFixture.sources.domain = documentationDomains.map((key) => row(key, 3));
  const calls = provider(['corporate']);
  const result = await classify();
  assert.deepEqual([result.queued, result.batches, result.processed], [0, 0, 0]);
  assert.equal(calls.length, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM brand_research_jobs').get().n, 0);
  const classifier = await worker.sourceTypeClassifier('project', 'owner');
  assert.equal((await worker.cachedSourceTypes('domain', ordinaryDomains, classifier)).size, 0);
  globalThis.sourceFixture.sources.domain.push(...ordinaryDomains.map((key) => row(key, 1)));
  assert.equal((await classify()).queued, ordinaryDomains.length);
  assert.deepEqual(calls[0].payload.state.items.map((item) => item.domain), ordinaryDomains);
});

// The reported cases. Social networks and news outlets typed UGC and Editorial before Social and Press existed read as
// Social and Press at once, everywhere, free; the catalog keeps the evaluator's row (provenance, and the admin decides the paid redo).
test('social networks and the press read as Social and Press over a stale UGC/Editorial row in the list, the filter and the Overview, free', async () => {
  const { sqlite } = setup({ domains: [row('youtube.com', 5), row('m.youtube.com', 1), row('nytimes.com', 4), row('blog.example', 2)] });
  const calls = provider(['editorial']);
  for (const [key, type] of [['youtube.com', 'ugc'], ['nytimes.com', 'editorial'], ['blog.example', 'editorial'], ['acme.example', 'corporate'], ['rival.example', 'corporate']])
    sqlite.prepare("INSERT INTO source_catalog(kind,key,provider,model,rubric,type,classified_at) VALUES('domain',?,'jev','typesafe/jev-1.14','source-types-v1',?,'2026-01-01')").run(key, type);
  const ctx = { project: { id: 'project' } };
  const list = async (type) => (await worker.typedSourcesReport('owner', new URLSearchParams(`type=${type}`), ctx)).rows.map((item) => item.domain);
  assert.deepEqual(await list('social'), ['youtube.com', 'm.youtube.com'], 'a host with no row of its own is typed by its site');
  assert.deepEqual(await list('ugc'), []);
  assert.deepEqual(await list('press'), ['nytimes.com']);
  assert.deepEqual(await list('editorial'), ['blog.example']);
  assert.deepEqual(await list('unclassified'), []);
  assert.deepEqual((await worker.typedSourcesReport('owner', new URLSearchParams(), ctx)).rows.map((item) => item.sourceType),
    ['corporate', 'corporate', 'social', 'social', 'press', 'editorial']);
  globalThis.sourceFixture.citations = 29;
  const overview = await worker.sourceTypesReport('owner', new URLSearchParams(), ctx);
  assert.deepEqual(Object.fromEntries(overview.types.map((item) => [item.type, item.citations])), { corporate: 17, social: 6, press: 4, editorial: 2 });
  assert.equal((await classify()).queued, 0, 'nothing is left for the evaluator');
  assert.equal(calls.length, 0);
  assert.deepEqual(sqlite.prepare("SELECT key,type FROM source_catalog WHERE key IN ('youtube.com','nytimes.com') ORDER BY key").all().map((item) => ({ ...item })),
    [{ key: 'nytimes.com', type: 'editorial' }, { key: 'youtube.com', type: 'ugc' }], 'the stored rows are not rewritten');
});

test('a domain question goes with the pages AI answers cited from it, and its batch records the question version', async () => {
  const { sqlite } = setup({ domains: [row('documentarytube.example', 3)] });
  globalThis.sourceFixture.sources.url = [
    { ...row('documentarytube.example', 3), key: 'https://documentarytube.example/best-streaming', title: 'Best Streaming Services for Documentaries in 2026' },
    { ...row('other.example', 2), key: 'https://other.example/x', title: 'Unrelated' },
  ];
  const calls = provider(['editorial']);
  await classify();
  const question = Object.values(calls[0].payload.questions).find((item) => item.instructions.includes('documentarytube.example'));
  assert.match(question.instructions, /Best Streaming Services for Documentaries in 2026/);
  assert.doesNotMatch(question.instructions, /Unrelated/);
  assert.equal(calls[0].payload.state.prompt, 'domain-prompt-v2');
  const input = JSON.parse(sqlite.prepare("SELECT input_json FROM brand_research_jobs WHERE context_key LIKE 'source-types:%'").get().input_json);
  assert.equal(input.prompt, 'domain-prompt-v2');
});

test('documentation domains already pending before the rule release settle without a provider or cost', async () => {
  const { sqlite } = setup();
  const calls = provider();
  const items = documentationDomains.map((key) => ({ kind: 'domain', key, domain: key }));
  sqlite.prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at)
    VALUES('waiting','owner','project','k','source-types:source-types-v1:jev','k','jev','typesafe/jev-1.14','pending',0.02,?,?)`).run(JSON.stringify({ kind: 'domain', items }), new Date().toISOString());
  assert.equal(await worker.processSourceTypeJobs(), 1);
  assert.equal(calls.length, 0);
  assert.deepEqual({ ...sqlite.prepare('SELECT status,cost_usd,reserved_usd FROM brand_research_jobs').get() }, { status: 'completed', cost_usd: 0, reserved_usd: 0 });
});

test('documentation site rules preserve URL content classification and also apply in the demo', async () => {
  setup({ enabled: 0 });
  const calls = provider();
  const key = 'https://docs.python.org/tutorial/';
  globalThis.sourceFixture.sources.url = [{ ...row('docs.python.org', 2), key }];
  const ctx = { project: { id: 'project' } };
  const page = await worker.typedSourcesReport('owner', new URLSearchParams('group=url'), ctx, true);
  assert.deepEqual(page.rows.map((item) => [item.sourceType, item.domainType]), [['unclassified', 'reference']]);
  assert.equal((await worker.cachedSourceTypes('url', ['docs.python.org', key], worker.PUBLIC_DEMO_CLASSIFIER)).size, 0);
  assert.equal(calls.length, 0);
});

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
  await assert.rejects(classify(), /Source classification is not available on this installation/);
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

test('classifies every cited domain once, own and competitor included, and reuses the cache', async () => {
  const { sqlite } = setup({ domains: [row('news.example', 5), row('forum.example', 3), row('gov.example', 1)] });
  const calls = provider(['corporate', 'corporate', 'editorial', 'ugc', 'institutional']);
  const first = await classify();
  assert.equal(first.queued, 5, 'your own and competitor domains are typed too');
  assert.equal(first.batches, 1);
  assert.equal(first.processed, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(calls[0].payload.model, 'typesafe/jev-1.14');
  assert.deepEqual(Object.keys(calls[0].payload.questions), ['s0', 's1', 's2', 's3', 's4']);
  assert.equal(Object.hasOwn(calls[0].payload.questions.s0.criteria, 'competitor'), false);
  assert.equal(Object.hasOwn(calls[0].payload.questions.s0.criteria, 'you'), false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM source_catalog").get().n, 5);
  const job = sqlite.prepare('SELECT status,cost_usd FROM brand_research_jobs').get();
  assert.deepEqual({ ...job }, { status: 'completed', cost_usd: 0.001 });
  const page = await worker.typedSourcesReport('owner', new URLSearchParams(), { project: { id: 'project' } });
  assert.deepEqual(
    page.rows.map((item) => [item.domain, item.ownership, item.sourceType]),
    [['acme.example', 'own', 'corporate'], ['rival.example', 'competitor', 'corporate'], ['news.example', 'third-party', 'editorial'], ['forum.example', 'third-party', 'ugc'], ['gov.example', 'third-party', 'institutional']],
    'the site type is cached for every domain; ownership is a separate mark',
  );
  const again = await classify();
  assert.equal(again.queued, 0);
  assert.equal(calls.length, 1, 'cached sources never trigger paid work');
});

test('limits one request to bounded batches and leaves the remainder to the scheduler', async () => {
  const domains = Array.from({ length: 128 }, (_, index) => row(`site${String(index).padStart(3, '0')}.example`, 500 - index));
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

test('BRAND_RESEARCH_PROJECTS=* (independent edition) lets the scheduler pick up pending source batches', async () => {
  const domains = Array.from({ length: 128 }, (_, index) => row(`site${String(index).padStart(3, '0')}.example`, 500 - index));
  const { settings, sqlite } = setup({ domains });
  settings.BRAND_RESEARCH_PROJECTS = '*';
  provider();
  assert.equal((await classify()).processed, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM brand_research_jobs WHERE status='pending'").get().n, 3);
  assert.equal(await worker.processSourceTypeJobs(), 2, 'the scheduler used to select none of them with *');
});

test('an uncertain provider outcome is not resent and a changed evaluator keeps the classifications', async () => {
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
  sqlite.prepare("INSERT INTO source_catalog(kind,key,rubric,type,provider,model,classified_at) VALUES('domain','news.example','source-types-v1','editorial','jev','typesafe/jev-1.14','2026-01-01')").run();
  let page = await worker.typedSourcesReport('owner', new URLSearchParams(), { project: { id: 'project' } });
  assert.equal(page.rows.find((item) => item.domain === 'news.example').sourceType, 'editorial');
  sqlite.prepare("UPDATE brand_research_configurations SET provider='decisions',revision=2").run();
  page = await worker.typedSourcesReport('owner', new URLSearchParams(), { project: { id: 'project' } });
  // The evaluator is provenance, not part of the key: switching it never reclassifies a known site.
  assert.equal(page.rows.find((item) => item.domain === 'news.example').sourceType, 'editorial');
  assert.equal(page.classifier.model, 'openai/gpt-6-luna-decisions');
  assert.equal(calls.length, 0, 'reading and changing configuration never call the provider');
});

test('distribution reports site-type shares, partial classification and the type and owner filters', async () => {
  const { sqlite } = setup({ domains: [row('news.example', 6), row('forum.example', 4), row('new.example', 2)] });
  const stamp = '2026-01-01';
  for (const [key, type] of [['news.example', 'editorial'], ['forum.example', 'ugc'], ['acme.example', 'corporate']])
    sqlite.prepare("INSERT INTO source_catalog(kind,key,rubric,type,provider,model,classified_at) VALUES('domain',?,'source-types-v1',?,'jev','typesafe/jev-1.14',?)").run(key, type, stamp);
  globalThis.sourceFixture.citations = 9 + 8 + 6 + 4 + 2;
  const report = await worker.sourceTypesReport('owner', new URLSearchParams(), { project: { id: 'project' } });
  assert.equal(report.citations, 29);
  // The competitor has no cached type yet: it stays visibly unclassified instead of being counted as "Competitor".
  assert.equal(report.unclassified, 10);
  assert.equal(report.classified, 19);
  assert.deepEqual(
    report.types.map((item) => [item.type, item.citations]),
    [['unclassified', 10], ['corporate', 9], ['editorial', 6], ['ugc', 4]],
  );
  assert.ok(Math.abs(report.types.reduce((sum, item) => sum + item.share, 0) - 100) < 1e-9);
  const ctx = { project: { id: 'project' } };
  const filtered = await worker.typedSourcesReport('owner', new URLSearchParams('type=ugc'), ctx);
  assert.deepEqual(filtered.rows.map((item) => item.domain), ['forum.example']);
  const missing = await worker.typedSourcesReport('owner', new URLSearchParams('type=unclassified'), ctx);
  assert.deepEqual(missing.rows.map((item) => item.domain), ['rival.example', 'new.example']);
  // Owner filter is independent of the type; the legacy You/Competitor types map to it.
  const own = await worker.typedSourcesReport('owner', new URLSearchParams('owner=own'), ctx);
  assert.deepEqual(own.rows.map((item) => [item.domain, item.ownership, item.sourceType]), [['acme.example', 'own', 'corporate']]);
  const rivals = await worker.typedSourcesReport('owner', new URLSearchParams('owner=competitor'), ctx);
  assert.deepEqual(rivals.rows.map((item) => [item.domain, item.sourceType]), [['rival.example', 'unclassified']]);
  const third = await worker.typedSourcesReport('owner', new URLSearchParams('owner=third-party&type=editorial'), ctx);
  assert.deepEqual(third.rows.map((item) => item.domain), ['news.example']);
  const none = await worker.typedSourcesReport('owner', new URLSearchParams('owner=competitor&type=editorial'), ctx);
  assert.deepEqual(none.rows, []);
  // You and Competitor are owners, never source types (no older link is read before 0.1).
  for (const type of ['you', 'competitor']) await assert.rejects(worker.typedSourcesReport('owner', new URLSearchParams(`type=${type}`), ctx), /Invalid source type/);
  await assert.rejects(worker.typedSourcesReport('owner', new URLSearchParams('type=bogus'), ctx), /Invalid source type/);
  await assert.rejects(worker.typedSourcesReport('owner', new URLSearchParams('owner=bogus'), ctx), /Invalid source owner/);
});

const urlRow = (url, responses, domain = new URL(url).hostname) => ({ ...row(domain, responses), key: url, title: url.split('/').pop() });

test('content types report shares of cited URLs, declares the unclassified part and honors the window', async () => {
  const { sqlite } = setup();
  globalThis.sourceFixture.sources.url = [
    urlRow('https://news.example/top-10', 6),
    urlRow('https://news.example/a-vs-b', 4),
    urlRow('https://forum.example/t/1', 3),
    urlRow('https://new.example/x', 2),
  ];
  for (const [key, type] of [['https://news.example/top-10', 'listicle'], ['https://news.example/a-vs-b', 'comparison']])
    sqlite.prepare("INSERT INTO source_catalog(kind,key,rubric,type,provider,model,classified_at) VALUES('url',?,'source-types-v1',?,'jev','typesafe/jev-1.14','2026-01-01')").run(key, type);
  globalThis.sourceFixture.citations = 15;
  const report = await worker.contentTypesReport('owner', new URLSearchParams(), { project: { id: 'project' } });
  assert.equal(report.citations, 15);
  assert.equal(report.classified, 10);
  assert.equal(report.unclassified, 5);
  assert.equal(report.truncated, false);
  assert.deepEqual(report.types.map((item) => [item.type, item.citations, item.urls]), [['listicle', 6, 1], ['unclassified', 5, 2], ['comparison', 4, 1]]);
  assert.ok(Math.abs(report.types.reduce((sum, item) => sum + item.share, 0) - 100) < 1e-9);
  assert.equal(report.classifier.state, 'ready');
  // Citations not covered by the URL window (13 pages of 10 here) are declared unclassified, never dropped.
  globalThis.sourceFixture.sources.url.push(...Array.from({ length: 260 }, (_, index) => urlRow(`https://z.example/${String(index).padStart(3, '0')}`, 1)));
  globalThis.sourceFixture.citations = 300;
  const tail = await worker.contentTypesReport('owner', new URLSearchParams(), { project: { id: 'project' } });
  assert.equal(tail.truncated, true);
  assert.equal(tail.citations, 300);
  // 130 keys read: the 4 above plus 126 fillers; 5 + 126 of them unclassified, plus 159 not read.
  assert.equal(tail.unclassified, 290);
  assert.equal(tail.types[0].type, 'unclassified');
});

test('reads that overlap fold the legacy classifications once, and a report asks the catalog once per kind', async () => {
  const { sqlite } = setup();
  globalThis.sourceFixture.sources.url = [urlRow('https://news.example/top-10', 6), urlRow('https://forum.example/t/1', 3)];
  globalThis.sourceFixture.citations = 9;
  const database = globalThis.sourceFixture.db, seen = [];
  globalThis.sourceFixture.db = { ...database, prepare: (sql) => (seen.push(sql), database.prepare(sql)) };
  await Promise.all([1, 2, 3].map(() => worker.contentTypesReport('owner', new URLSearchParams(), { project: { id: 'project' } })));
  assert.equal(seen.filter((sql) => sql.includes('MAX(classified_at)')).length, 1);
  assert.equal(seen.filter((sql) => sql.includes('FROM source_catalog')).length, 3);
  seen.length = 0;
  await worker.typedSourcesReport('owner', new URLSearchParams('group=url'), { project: { id: 'project' } });
  assert.equal(seen.filter((sql) => sql.includes('FROM source_catalog')).length, 2, 'one lookup for URLs and one for their domains');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM source_catalog').get().n, 0);
});

test('page types are cached separately from site types and URL rows carry the site type of their domain', async () => {
  const { sqlite } = setup();
  globalThis.sourceFixture.sources.url = [urlRow('https://news.example/top-10', 6)];
  sqlite.prepare("INSERT INTO source_catalog(kind,key,rubric,type,provider,model,classified_at) VALUES('url','https://news.example/top-10','source-types-v1','listicle','jev','typesafe/jev-1.14','2026-01-01')").run();
  sqlite.prepare("INSERT INTO source_catalog(kind,key,rubric,type,provider,model,classified_at) VALUES('domain','news.example','source-types-v1','editorial','jev','typesafe/jev-1.14','2026-01-01')").run();
  const page = await worker.typedSourcesReport('owner', new URLSearchParams('group=url'), { project: { id: 'project' } });
  assert.deepEqual(page.rows.map((item) => [item.sourceType, item.domainType]), [['listicle', 'editorial']]);
  const filtered = await worker.typedSourcesReport('owner', new URLSearchParams('group=url&type=listicle'), { project: { id: 'project' } });
  assert.equal(filtered.rows.length, 1);
  await assert.rejects(worker.typedSourcesReport('owner', new URLSearchParams('group=url&type=editorial'), { project: { id: 'project' } }), /Invalid source type/);
});

test('the public demo reads the fixed evaluator cache and never reports a disabled evaluator', async () => {
  const { sqlite } = setup({ enabled: 0, domains: [row('news.example', 6), row('gone.example', 1)] });
  sqlite.prepare("INSERT INTO source_catalog(kind,key,rubric,type,provider,model,classified_at) VALUES('domain','news.example','source-types-v1','editorial','jev','typesafe/jev-1.14','2026-01-01')").run();
  const calls = provider();
  const ctx = { project: { id: 'project' } };
  const demo = await worker.typedSourcesReport('owner', new URLSearchParams(), ctx, true);
  assert.equal(demo.classifier.state, 'demo');
  assert.deepEqual(demo.rows.filter((item) => item.ownership === 'third-party').map((item) => [item.domain, item.sourceType]), [['news.example', 'editorial'], ['gone.example', 'unclassified']]);
  const customer = await worker.typedSourcesReport('owner', new URLSearchParams(), ctx);
  assert.equal(customer.classifier.state, 'disabled', 'customers keep classifying only by explicit action');
  assert.equal((await worker.sourceTypesReport('owner', new URLSearchParams(), ctx, true)).classifier.state, 'demo');
  assert.equal((await worker.contentTypesReport('owner', new URLSearchParams(), ctx, true)).classifier.state, 'demo');
  assert.notEqual(await worker.sourceTypeRevision('project', 'owner', true), await worker.sourceTypeRevision('project', 'owner'));
  assert.equal(calls.length, 0, 'reading never calls the provider');
});

const catalog = (sqlite, kind) => sqlite.prepare('SELECT key,type,provider FROM source_catalog WHERE kind=? ORDER BY key').all(kind).map((item) => ({ ...item }));

test('one page cited in many shapes, days and evaluators is classified once and never again', async () => {
  const { sqlite } = setup();
  // What the same page looks like across prompts, days and engines: tracking suffix, text fragment, www, trailing slash, http.
  const page = 'https://news.example/best-streaming';
  globalThis.sourceFixture.sources.url = [
    urlRow(page, 9),
    urlRow('https://www.news.example/best-streaming?utm_source=chatgpt.com', 5),
    urlRow('https://news.example/best-streaming/#:~:text=The%20best', 4),
    urlRow('http://news.example/best-streaming', 2),
    urlRow('https://news.example/other-page', 3),
  ];
  const calls = provider(['listicle', 'comparison']);
  const first = await classify('url');
  assert.deepEqual([first.queued, calls.length, calls[0].payload.state.items.length], [2, 1, 2], 'two pages, one request');
  assert.deepEqual(catalog(sqlite, 'url').map((item) => item.key), [page, 'https://news.example/other-page']);
  const again = await classify('url');
  assert.deepEqual([again.queued, calls.length], [0, 1], 'a page already classified is not queued again');
  // Switching the evaluator does not reclassify anything: the new one finds every page typed.
  sqlite.prepare("UPDATE brand_research_configurations SET provider='decisions',revision=2").run();
  const switched = await classify('url');
  assert.deepEqual([switched.queued, calls.length], [0, 1]);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM source_catalog').get().n, 2);
  // Every shape of the page reads the one type.
  const classifier = await worker.sourceTypeClassifier('project', 'owner');
  const types = await worker.cachedSourceTypes('url', globalThis.sourceFixture.sources.url.map((item) => item.key), classifier);
  assert.equal(new Set([...types.entries()].filter(([key]) => key.includes('best-streaming')).map(([, type]) => type)).size, 1);
  assert.equal(types.size, 5);
});

test('a page another project already queued is not queued again, and a queued batch that became known sends nothing', async () => {
  const { sqlite, settings } = setup();
  const stamp = new Date().toISOString();
  sqlite.prepare("INSERT INTO projects(id,workspace_id,name,domain,category,daily_enabled,created_at) VALUES('other','owner','Other','other.example','software',0,?)").run(stamp);
  sqlite.prepare("INSERT INTO brand_research_configurations(project_id,workspace_id,provider,enabled,revision,updated_at) VALUES('other','owner','jev',1,1,?)").run(stamp);
  settings.BRAND_RESEARCH_PROJECTS = 'project,other';
  globalThis.sourceFixture.sources.domain = [row('news.example', 5), row('forum.example', 3)];
  const calls = provider(['editorial']);
  // The first project's batch is waiting for the scheduler.
  const items = ['acme.example', 'rival.example', 'news.example', 'forum.example'].map((key) => ({ kind: 'domain', key, domain: key }));
  sqlite.prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,input_json,requested_at)
    VALUES('waiting','owner','project','k','source-types:source-types-v1:jev','k','jev','typesafe/jev-1.14','pending',0.02,?,?)`).run(JSON.stringify({ kind: 'domain', items }), stamp);
  const second = await worker.enqueueSourceTypes('other', 'owner', new URLSearchParams(), 'domain');
  assert.equal(second.queued, 0, 'the same four sites are already waiting');
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM brand_research_jobs WHERE status='pending'").get().n, 1);
  // Meanwhile the catalog learns two of them (another batch, the migration...).
  for (const key of ['news.example', 'forum.example', 'acme.example', 'rival.example'])
    sqlite.prepare("INSERT INTO source_catalog(kind,key,rubric,type,provider,model,classified_at) VALUES('domain',?,'source-types-v1','editorial','jev','typesafe/jev-1.14','2026-01-01')").run(key);
  assert.equal(await worker.processSourceTypeJobs(), 1);
  assert.equal(calls.length, 0, 'nothing left to ask, so no provider call');
  assert.deepEqual({ ...sqlite.prepare('SELECT status,cost_usd,reserved_usd FROM brand_research_jobs').get() }, { status: 'completed', cost_usd: 0, reserved_usd: 0 });
});

test('the migration keeps what production already classified and the fold costs no provider call', async () => {
  const { sqlite } = setup({ before: '0023' });
  const legacy = sqlite.prepare("INSERT INTO source_classifications(kind,key,provider,model,rubric,type,classified_at) VALUES(?,?,?,?,'source-types-v1',?,?)");
  const jev = ['jev', 'typesafe/jev-1.14'];
  const luna = ['decisions', 'openai/gpt-6-luna-decisions'];
  // Domains: the same site under two evaluators and a www spelling.
  legacy.run('domain', 'news.example', ...jev, 'editorial', '2026-10-01');
  legacy.run('domain', 'news.example', ...luna, 'reference', '2026-10-05');
  legacy.run('domain', 'www.forum.example', ...jev, 'ugc', '2026-10-01');
  // URLs: the same page as cited on different days (tracking suffix, fragment) plus a distinct one.
  legacy.run('url', 'https://news.example/top-10?utm_source=chatgpt.com', ...jev, 'listicle', '2026-10-01');
  legacy.run('url', 'https://www.news.example/top-10#:~:text=a', ...jev, 'comparison', '2026-10-03');
  legacy.run('url', 'https://news.example/top-10', ...luna, 'listicle', '2026-10-02');
  legacy.run('url', 'https://news.example/review', ...jev, 'article', '2026-10-01');
  const before = sqlite.prepare('SELECT COUNT(*) n FROM source_classifications').get().n;
  for (const migration of readdirSync(root + 'apps/selfhost/drizzle').filter(name => name.endsWith('.sql') && name >= '0023').sort()) sqlite.exec(readFileSync(root + 'apps/selfhost/drizzle/' + migration, 'utf8'));
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM source_catalog').get().n, 0, 'the migration only creates the catalog');
  const calls = provider();
  const classifier = await worker.sourceTypeClassifier('project', 'owner');
  const types = await worker.cachedSourceTypes('url', ['https://news.example/top-10', 'https://news.example/review'], classifier);
  assert.deepEqual(Object.fromEntries(types), { 'https://news.example/top-10': 'comparison', 'https://news.example/review': 'article' }, 'the newest classification of the page wins');
  assert.deepEqual(catalog(sqlite, 'url').map((item) => item.key), ['https://news.example/review', 'https://news.example/top-10']);
  // Domains: the same site under two evaluators and a www spelling; the newest classification wins.
  assert.deepEqual(catalog(sqlite, 'domain'), [{ key: 'forum.example', type: 'ugc', provider: 'jev' }, { key: 'news.example', type: 'reference', provider: 'decisions' }]);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM source_classifications').get().n, before, 'the old table is untouched');
  assert.ok(sqlite.prepare("SELECT 1 FROM system_state WHERE key='source_catalog_fold_mark'").get());
  // Running everything again changes nothing and asks nobody.
  sqlite.prepare("DELETE FROM system_state WHERE key='source_catalog_fold_mark'").run();
  await worker.foldLegacyClassifications();
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM source_catalog').get().n, 4);
  assert.equal(calls.length, 0);
  // A row an older Worker still writes while a release rolls out is picked up by the next isolate.
  legacy.run('domain', 'late.example', ...jev, 'corporate', '2026-10-09');
  await worker.foldLegacyClassifications();
  const late = () => sqlite.prepare("SELECT COUNT(*) n FROM source_catalog WHERE key='late.example'").get().n;
  assert.equal(late(), 0, 'one fold per isolate');
  globalThis.sourceFixture.db = d1(sqlite);
  await worker.foldLegacyClassifications();
  assert.equal(late(), 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM source_catalog').get().n, 5);
  assert.equal(calls.length, 0);
});

const D1_ULTRA = 'liquid/d1-ultra';
const JEV = 'typesafe/jev-1.14';
/** Answers by model: a handler returns a Response, or a thrown error for a transport failure. */
function modelProvider(handlers) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    calls.push(payload.model);
    return handlers[payload.model](payload);
  };
  return calls;
}
const ok = (model, cost) => (payload) =>
  new Response(JSON.stringify({ ...decision(payload.questions, ['editorial'], cost), model }), { status: 200 });
const jobAndCatalog = (sqlite) => ({
  job: { ...sqlite.prepare('SELECT status,model,cost_usd FROM brand_research_jobs').get() },
  catalog: sqlite.prepare('SELECT DISTINCT model FROM source_catalog').all().map((item) => item.model),
});

test('LASTFIND_CLASSIFIER_MODELS switches the source-type model and the recorded model follows', async () => {
  const { sqlite, settings } = setup({ domains: [row('news.example', 5)] });
  settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ source_types: D1_ULTRA });
  const calls = modelProvider({ [D1_ULTRA]: ok(D1_ULTRA, 0.0002) });
  assert.equal((await worker.sourceTypeClassifier('project', 'owner')).model, D1_ULTRA);
  await classify();
  assert.deepEqual(calls, [D1_ULTRA]);
  assert.deepEqual(jobAndCatalog(sqlite), { job: { status: 'completed', model: D1_ULTRA, cost_usd: 0.0002 }, catalog: [D1_ULTRA] });
});

test('a missing, malformed or invalid setting keeps the default model and logs', async () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    for (const value of ['', 'not json', '{"source_types":42}', '{"source_types":"bad model!"}', '{"semantic":"x"}']) {
      const { settings } = setup();
      settings.LASTFIND_CLASSIFIER_MODELS = value;
      assert.equal((await worker.sourceTypeClassifier('project', 'owner')).model, JEV, value);
    }
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 3);
});

test('a configured model that fails with no cost (5xx) falls back to the previous engine once', async () => {
  const { sqlite, settings } = setup({ domains: [row('news.example', 5)] });
  settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ source_types: D1_ULTRA });
  const calls = modelProvider({ [D1_ULTRA]: () => new Response('down', { status: 503 }), [JEV]: ok(JEV, 0.001) });
  await classify();
  assert.deepEqual(calls, [D1_ULTRA, JEV]);
  const { job, catalog } = jobAndCatalog(sqlite);
  // A 5xx may have been billed without a reported cost: the whole reservation stays held for both calls.
  assert.equal(job.status, 'unsettled');
  assert.equal(job.model, JEV, 'the engine that answered is recorded');
  assert.deepEqual(catalog, [JEV]);
});

test('a billed first answer that does not parse gets no fallback: both calls must fit the one reservation', async () => {
  const { sqlite, settings } = setup({ domains: [row('news.example', 5)] });
  settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ source_types: D1_ULTRA });
  const calls = modelProvider({ [D1_ULTRA]: () => new Response(JSON.stringify({ model: D1_ULTRA, answers: {}, usage: { cost: 0.019 } }), { status: 200 }), [JEV]: ok(JEV, 0.003) });
  await classify();
  assert.deepEqual(calls, [D1_ULTRA]);
  const { job, catalog } = jobAndCatalog(sqlite);
  assert.deepEqual(catalog, []);
  const { spent } = sqlite.prepare('SELECT SUM(MAX(cost_usd,reserved_usd)) spent FROM brand_research_jobs').get();
  assert.ok(job.cost_usd <= 0.02 && spent <= 0.02 + 1e-9, `${spent} held of the US$ 0.02 reserved`);
});

test('when the previous engine fails too the job fails after exactly two calls', async () => {
  const { sqlite, settings } = setup({ domains: [row('news.example', 5)] });
  settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ source_types: D1_ULTRA });
  const down = () => new Response('down', { status: 503 });
  const calls = modelProvider({ [D1_ULTRA]: down, [JEV]: down });
  await classify();
  assert.deepEqual(calls, [D1_ULTRA, JEV]);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM source_catalog').get().n, 0);
  assert.equal(sqlite.prepare('SELECT status FROM brand_research_jobs').get().status, 'unknown');
});

test('a refused key, credit or rate limit, or a request that may have been served, is never sent again to the fallback model', async () => {
  for (const [name, respond] of [
    ['401', () => new Response('{}', { status: 401 })],
    ['402', () => new Response('{}', { status: 402 })],
    ['403', () => new Response('{}', { status: 403 })],
    ['429', () => new Response('{}', { status: 429, headers: { 'retry-after': '0.001' } })],
    ['408', () => new Response('{}', { status: 408 })],
    ['timeout', () => { throw new Error('The operation timed out.'); }],
  ]) {
    const { sqlite, settings } = setup({ domains: [row('news.example', 5)] });
    settings.LASTFIND_CLASSIFIER_MODELS = JSON.stringify({ source_types: D1_ULTRA });
    const calls = modelProvider({ [D1_ULTRA]: respond, [JEV]: ok(JEV, 0.001) });
    await classify();
    // A rate limit is sent again twice to the same model (it was not billed), never to the fallback.
    assert.deepEqual(calls, name === '429' ? [D1_ULTRA, D1_ULTRA, D1_ULTRA] : [D1_ULTRA], name);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM source_catalog').get().n, 0, name);
  }
});

for (const provider of ['jev', 'decisions']) test(`changing sentiment to Liquid preserves the ${provider} source classifier and catalog`, async () => {
  const {sqlite} = setup({provider});
  const originalFetch = globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('No paid calls');};
  try {
    sqlite.prepare("INSERT INTO source_catalog(kind,key,rubric,type,provider,model,classified_at) VALUES('domain','acme.example','source-types-v1','corporate',?,'saved','2026-01-01')").run(provider);
    const before=await worker.sourceTypeClassifier('project','owner');
    const catalogBefore=catalog(sqlite,'domain');
    await worker.saveBrandResearchConfiguration('project','owner',{provider:'liquid',enabled:true,expectedRevision:1});
    assert.deepEqual(await worker.sourceTypeClassifier('project','owner'),before);
    assert.deepEqual(catalog(sqlite,'domain'),catalogBefore);
    assert.equal(calls,0);
  } finally {globalThis.fetch=originalFetch;sqlite.close();delete globalThis.sourceFixture;}
});
