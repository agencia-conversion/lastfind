import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { runPositionsFor } from './run-positions-fixture.mjs';
import { siteTypeRuleSql } from '../lib/source-type-rules.ts';

const root = resolve(import.meta.dirname, '../../..');
const bundle = await build({
  entryPoints: [resolve(root, 'packages/core/lib/server/reports.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  alias: { '@': resolve(root, 'packages/core') },
  plugins: [
    {
      name: 'isolated-presence',
      setup(b) {
        b.onResolve(
          { filter: /^\.\/(workspace|project-store-read|http|semantic-source-rows|env|project-reads)$/ },
          ({ path }) => ({ path, namespace: 'fixture' }),
        );
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === './semantic-source-rows'
              ? "export const semanticSourceStatement=()=>({token:'semantic'});export const semanticSourceRowsFrom=()=>globalThis.presenceFixture?.semanticSources ?? [];export const semanticSourcePeriods=(current)=>({current,previous:globalThis.presenceFixture?.previousSemanticSources ?? []});"
              : path === './env'
              ? "export const now=()=>new Date().toISOString();export const db=()=>({batch:async(statements)=>statements.map((s)=>({results:s.token==='project'?[globalThis.presenceFixture.project]:[]}))});"
              : path === './project-reads'
              ? "export const ownedProjectStatement=()=>({token:'project'});export const projectStoreStatement=()=>({token:'registry'});export const foundProject=(row)=>row;"
              : path === './http'
              ? 'export class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}'
              : path === './workspace'
                ? 'export const ownedProject=async()=>globalThis.presenceFixture.project;'
                : 'export const projectReadDatabase=async()=>globalThis.presenceFixture.database;',
          loader: 'js',
        }));
      },
    },
  ],
});
const { sourcesReport, sourceCounts, sourceEntityReport, summaryReport, reportContext, parseReportFilter } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
);

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE store_meta(key TEXT,value TEXT);
    CREATE TABLE prompts(id TEXT,project_id TEXT,unit_id TEXT,tag TEXT);
    CREATE TABLE runs(id TEXT,project_id TEXT,prompt_id TEXT,engine TEXT,status TEXT,response_available INTEGER,
    sources_json TEXT,consulted_sources_json TEXT,targets_json TEXT,analysis_revision TEXT,analysis_targets_json TEXT,created_at TEXT);`);
  const putPrompt = sql.prepare('INSERT INTO prompts(id,project_id,unit_id) VALUES(?,?,?)');
  // Two subscriptions of the same logical question/model must still count once.
  for (const [id, unit] of [
    ['a', 'q1'],
    ['a-old', 'q1'],
    ['b', 'q1'],
    ['c', 'q2'],
  ])
    putPrompt.run(id, 'p', unit);
  const put = sql.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  let serial = 0;
  const add = (
    prompt,
    engine,
    keys,
    consulted = null,
    status = 'complete',
    project = 'p',
  ) => {
    const sources = keys.map((domain) => ({
      url: `https://${domain}/page`,
      domain,
      title: domain,
    }));
    put.run(
      `r${++serial}`,
      project,
      prompt,
      engine,
      status,
      1,
      JSON.stringify(sources),
      consulted === null
        ? null
        : JSON.stringify(
            consulted.map((domain) => ({
              url: `https://${domain}/page`,
              domain,
            })),
          ),
      JSON.stringify([{ name: 'Acme', domain: 'own.test' }]),
      null,
      null,
      '2026-10-18T00:00:00.000Z',
    );
  };
  const database = {
    prepare(query) {
      return {
        bind(...params) {
          return {
            all: async () => ({ results: sql.prepare(query).all(...params) }),
            first: async () => sql.prepare(query).get(...params) ?? null,
          };
        },
      };
    },
  };
  const ctx = {
    database,
    withClause: 'WITH report_brand(value) AS (SELECT ?)',
    brandBinding: 'primary',
    where: 'r.project_id=?',
    bindings: ['p'],
    mentionExpression: '0',
  };
  return { sql, add, ctx };
}

test('presence weights logical question × model once, deduplicates URLs, excludes unavailable consulted evidence', async () => {
  const { sql, add, ctx } = fixture();
  try {
    add('a', 'chat_gpt', ['own.test', 'own.test', 'rare.test'], ['own.test']);
    add('a-old', 'chat_gpt', ['own.test'], []);
    add('b', 'gemini', ['own.test']);
    add('b', 'gemini', []);
    add('c', 'chat_gpt', []); // eligible zero-source answer belongs in cited denominator
    add('a', 'chat_gpt', ['foreign.test'], null, 'complete', 'other');
    add('a', 'chat_gpt', ['failed.test'], null, 'failed');
    const page = await sourcesReport(ctx, new URLSearchParams());
    assert.equal(page.presenceVersion, 1);
    assert.deepEqual(page.totals, { slots: 3, questions: 2, models: 2 });
    const own = page.rows.find((r) => r.key === 'own.test');
    assert.equal(own.presence.presence, 50); // (1 + 1/2 + 0) / 3
    assert.deepEqual(
      { ...own.presence, presence: 0 },
      { presence: 0, slots: 2, questions: 1, steady: 1, once: 1, single: 0 },
    );
    assert.equal(own.responses, 3);
    assert.equal(own.citations, 4);
    assert.equal(page.rows.length, 2);
    const consulted = await sourcesReport(
      ctx,
      new URLSearchParams('kind=consulted'),
    );
    assert.deepEqual(consulted.totals, { slots: 1, questions: 1, models: 1 });
    assert.equal(consulted.rows[0].presence.presence, 50);
    assert.equal(consulted.available, 2);
    const empty = await sourcesReport(
      { ...ctx, bindings: ['absent'] },
      new URLSearchParams(),
    );
    assert.deepEqual(empty.rows, []);
    assert.deepEqual(empty.totals, { slots: 0, questions: 0, models: 0 });
    assert.equal(empty.leaders, undefined);
  } finally {
    sql.close();
  }
});

test('all sources: cited and consulted together, each response once; not cited keeps only the consulted ones', async () => {
  const { sql, add, ctx } = fixture();
  try {
    add('a', 'chat_gpt', ['own.test'], ['own.test', 'read.test']);
    add('a-old', 'chat_gpt', ['own.test'], []);
    add('b', 'gemini', ['own.test']); // no consulted list: its citations still count
    add('c', 'chat_gpt', [], ['read.test', 'read.test']);
    const cited = await sourcesReport(ctx, new URLSearchParams('kind=cited'));
    const all = await sourcesReport(ctx, new URLSearchParams('kind=all'));
    // Same denominator as the cited list: every complete answer.
    assert.deepEqual(all.totals, cited.totals);
    assert.deepEqual(all.rows.map((row) => [row.key, row.cited]), [['own.test', true], ['read.test', false]]);
    const own = all.rows.find((row) => row.key === 'own.test');
    // Cited and consulted in the same answer is one hit and one citation.
    assert.equal(own.responses, 3);
    assert.equal(own.citations, 3);
    assert.equal(own.presence.presence, cited.rows.find((row) => row.key === 'own.test').presence.presence);
    const read = all.rows.find((row) => row.key === 'read.test');
    assert.equal(read.responses, 2);
    assert.equal(read.citations, 0);
    assert.equal(read.presence.presence, 50); // q1×ChatGPT 1 of 2 collections, q2×ChatGPT 1 of 1, q1×Gemini none: (0.5 + 1 + 0) / 3
    const uncited = await sourcesReport(ctx, new URLSearchParams('kind=uncited'));
    assert.deepEqual(uncited.rows.map((row) => row.key), ['read.test']);
    assert.equal(uncited.rows[0].presence.presence, read.presence.presence);
    assert.equal(uncited.leaders.ranking[0].key, 'read.test');
    assert.ok(cited.rows.every((row) => row.cited === true));
    assert.ok((await sourcesReport(ctx, new URLSearchParams('kind=consulted'))).rows.every((row) => row.cited === undefined));
    await assert.rejects(sourcesReport(ctx, new URLSearchParams('kind=mentioned')), /Invalid source filter/);
  } finally {
    sql.close();
  }
});

test('evidence: each row says whether it was cited and whether consulted, without changing the presence of the list read', async () => {
  const { sql, add, ctx } = fixture();
  try {
    add('a', 'chat_gpt', ['own.test'], ['own.test', 'read.test']);
    add('a-old', 'chat_gpt', ['own.test'], []);
    add('b', 'gemini', ['own.test', 'cited.test']); // no consulted list
    add('c', 'chat_gpt', [], ['read.test']);
    const flags = (page) => Object.fromEntries(page.rows.map((row) => [row.key, [row.cited, row.consulted]]));
    const all = await sourcesReport(ctx, new URLSearchParams('kind=all'));
    assert.deepEqual(flags(all), { 'own.test': [true, true], 'read.test': [false, true], 'cited.test': [true, false] });
    for (const kind of ['cited', 'consulted']) {
      const plain = await sourcesReport(ctx, new URLSearchParams(`kind=${kind}`));
      const read = await sourcesReport(ctx, new URLSearchParams(`kind=${kind}&evidence=1`));
      assert.deepEqual(read.totals, plain.totals, `${kind}: same denominator`);
      assert.deepEqual(read.rows.map((row) => [row.key, row.presence, row.responses]), plain.rows.map((row) => [row.key, row.presence, row.responses]), `${kind}: same rows and presence`);
    }
    assert.deepEqual(flags(await sourcesReport(ctx, new URLSearchParams('kind=cited&evidence=1'))), { 'own.test': [true, true], 'cited.test': [true, false] });
    // A citation in an answer without a consulted list still counts as cited.
    assert.deepEqual(flags(await sourcesReport(ctx, new URLSearchParams('kind=consulted&evidence=1'))), { 'own.test': [true, true], 'read.test': [false, true] });
  } finally {
    sql.close();
  }
});

test('deterministic site types apply before SQL pagination without changing the cohort', async () => {
  const { sql, add, ctx } = fixture();
  try {
    const docs = ['developers.google.com', 'developer.example.com', 'docs.python.org', 'devdocs.example.com'];
    const ordinary = ['google.com', 'developers-example.com', 'api.docs.example.com'];
    add('a', 'chat_gpt', [...docs, ...ordinary, 'catalog-reference.test']);
    add('b', 'gemini', ['docs.python.org']);
    const all = await sourcesReport(ctx, new URLSearchParams());
    const rules = (types) => siteTypeRuleSql('lower(key)', types);
    const reference = await sourcesReport(ctx, new URLSearchParams(), 50, {
      keys: ['catalog-reference.test'], rules: rules(['reference']),
    });
    assert.deepEqual(new Set(reference.rows.map(r => r.key)), new Set([...docs, 'catalog-reference.test']));
    assert.equal(reference.leaders.ranking[0].key, 'docs.python.org');
    assert.deepEqual(reference.totals, all.totals);
    const page = await sourcesReport(ctx, new URLSearchParams('page=3'), 2, {
      keys: ['catalog-reference.test'], rules: rules(['reference']),
    });
    assert.equal(page.rows.length, 1);
    assert.deepEqual(page.leaders, reference.leaders);
    const corporate = await sourcesReport(ctx, new URLSearchParams(), 50, {
      keys: [...docs, ...ordinary], rules: rules(['corporate']),
    });
    assert.deepEqual(new Set(corporate.rows.map(r => r.key)), new Set(ordinary), 'google.com is Corporate by rule, the others by catalog key');
    const unclassified = await sourcesReport(ctx, new URLSearchParams(), 50, {
      keys: ['catalog-reference.test'], exclude: true, rules: rules(['unclassified']),
    });
    assert.deepEqual(new Set(unclassified.rows.map(r => r.key)), new Set(['developers-example.com', 'api.docs.example.com']), 'a host a rule types is never unclassified');
    assert.deepEqual(unclassified.totals, all.totals);
  } finally {
    sql.close();
  }
});

test('ranking, widest reach, owner/type selection and pagination cover more than 1,000 sources', async () => {
  const { sql, add, ctx } = fixture();
  try {
    const bulk = Array.from(
      { length: 1100 },
      (_, i) => `volume${String(i).padStart(4, '0')}.test`,
    );
    add('a', 'chat_gpt', bulk, ['single.test']);
    for (let i = 0; i < 9; i++) add('a', 'chat_gpt', bulk);
    add('b', 'gemini', ['winner.test', 'own.test']);
    add('c', 'chat_gpt', ['winner.test']);
    const first = await sourcesReport(ctx, new URLSearchParams());
    const legacy = await sourcesReport(
      ctx,
      new URLSearchParams('order=responses'),
    );
    assert.equal(legacy.rows[0].key, 'volume0000.test');
    assert.equal(legacy.rows[0].responses, 10);
    assert.equal(first.rows[0].key, 'winner.test'); // fewer raw responses but higher weighted presence
    assert.equal(first.rows[0].presence.questions, 2);
    assert.equal(first.leaders.widest.key, 'winner.test');
    assert.equal(first.hasMore, true);
    await assert.rejects(
      sourcesReport(ctx, new URLSearchParams('order=invalid')),
      /Invalid source filter/,
    );
    const later = await sourcesReport(ctx, new URLSearchParams('page=22'));
    assert.equal(later.rows.length, 50);
    assert.deepEqual(later.leaders, first.leaders);
    const last = await sourcesReport(ctx, new URLSearchParams('page=23'));
    assert.equal(last.rows.length, 2);
    assert.equal(last.hasMore, false);
    const selected = await sourcesReport(ctx, new URLSearchParams(), 50, {
      keys: ['winner.test'],
    });
    assert.deepEqual(
      selected.rows.map((r) => r.key),
      ['winner.test'],
    );
    assert.deepEqual(selected.totals, first.totals);
    const excluded = await sourcesReport(ctx, new URLSearchParams(), 50, {
      keys: bulk,
      exclude: true,
    });
    assert.deepEqual(
      new Set(excluded.rows.map((r) => r.key)),
      new Set(['winner.test', 'own.test']),
    );
    const own = await sourcesReport(ctx, new URLSearchParams('owner=own'));
    assert.deepEqual(
      own.rows.map((r) => r.key),
      ['own.test'],
    );
    const single = await sourcesReport(
      ctx,
      new URLSearchParams('kind=consulted'),
    );
    assert.equal(single.rows[0].presence.single, 1);
    assert.equal(single.rows[0].presence.steady, 0);
    assert.equal(single.rows[0].presence.once, 0);
    // A column order (`sort` + `dir`) reorders the whole list before paging; the leaders keep ranking by presence.
    const byName = await sourcesReport(ctx, new URLSearchParams('sort=source&dir=asc'));
    assert.equal(byName.rows[0].key, 'own.test');
    assert.deepEqual(byName.leaders, first.leaders);
    const byNameDesc = await sourcesReport(ctx, new URLSearchParams('sort=source&dir=desc'));
    assert.equal(byNameDesc.rows[0].key, 'winner.test');
    const lastByName = await sourcesReport(ctx, new URLSearchParams('sort=source&dir=desc&page=23'));
    assert.equal(lastByName.rows.at(-1).key, 'own.test');
    const byReach = await sourcesReport(ctx, new URLSearchParams('sort=questions&dir=desc'));
    assert.equal(byReach.rows[0].key, 'winner.test');
    await assert.rejects(sourcesReport(ctx, new URLSearchParams('sort=type')), /Invalid source sort/);
  } finally {
    sql.close();
  }
});

test('sourceCounts lists every cited key once, paged by key, over the same cohort as the ranked report', async () => {
  const { sql, add, ctx } = fixture();
  try {
    add('a', 'chat_gpt', ['b.test', 'a.test', 'c.test', 'c.test']);
    add('b', 'gemini', ['c.test', 'd.test']);
    add('c', 'chat_gpt', ['e.test']);
    add('a', 'chat_gpt', ['failed.test'], null, 'failed');
    add('a', 'chat_gpt', ['foreign.test'], null, 'complete', 'other');
    const first = await sourceCounts(ctx, new URLSearchParams(), 0, 3);
    assert.deepEqual(first.rows.map((r) => [r.key, r.responses, r.domain]), [['a.test', 1, 'a.test'], ['b.test', 1, 'b.test'], ['c.test', 2, 'c.test']]);
    assert.equal(first.hasMore, true);
    const rest = await sourceCounts(ctx, new URLSearchParams(), 3, 3);
    assert.deepEqual(rest.rows.map((r) => r.key), ['d.test', 'e.test']);
    assert.equal(rest.hasMore, false);
    const urls = await sourceCounts(ctx, new URLSearchParams('group=url'), 0, 10);
    assert.deepEqual(urls.rows[0], { key: 'https://a.test/page', responses: 1, domain: 'a.test', title: 'a.test' });
    const ranked = await sourcesReport(ctx, new URLSearchParams('order=responses'), 50);
    assert.deepEqual(ranked.rows.map((r) => [r.key, r.responses]).sort(), [...first.rows, ...rest.rows].map((r) => [r.key, r.responses]).sort());
  } finally {
    sql.close();
  }
});

test('summary sample n deduplicates logical question/model and preserves exact comparison windows in both editions', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE store_meta(key TEXT,value TEXT);
    CREATE TABLE prompts(id TEXT PRIMARY KEY,project_id TEXT,unit_id TEXT,tag TEXT,tags_json TEXT);
    INSERT INTO prompts VALUES('a','p','q1','Topic','[]'),('old-a','p','q1','Topic','[]'),('b','p','q1','Topic','[]');
    CREATE TABLE runs(id TEXT,project_id TEXT,workspace_id TEXT,prompt_id TEXT,engine TEXT,status TEXT,response_available INTEGER,
      created_at TEXT,prompt_text TEXT,answer TEXT,targets_json TEXT,mentions_json TEXT,sources_json TEXT,cost REAL,
      analysis_revision TEXT,analysis_targets_json TEXT,analysis_mentions_json TEXT,analysis_brands_json TEXT,model TEXT);`);
  const put=sql.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL)');
  const targets=JSON.stringify([{name:'Acme',domain:'acme.test'}]);
  for(const [id,prompt,engine,date,status,available,owner] of [
    ['r1','a','chat_gpt','2026-10-10T13:00:00Z','complete',1,'owner'],
    ['r2','a','chat_gpt','2026-10-11T13:00:00Z','complete',1,'owner'],
    ['r3','old-a','chat_gpt','2026-10-11T13:00:00Z','complete',1,'owner'],
    ['r4','b','gemini','2026-10-11T13:00:00Z','complete',1,'owner'],
    ['r5','a','chat_gpt','2026-10-08T13:00:00Z','complete',1,'owner'],
    ['failed','a','claude','2026-10-11T13:00:00Z','failed',1,'owner'],
    ['unavailable','a','perplexity','2026-10-11T13:00:00Z','complete',0,'owner'],
    ['foreign','a','google_ai_mode','2026-10-11T13:00:00Z','complete',1,'other'],
  ]) put.run(id,'p',owner,prompt,engine,status,available,date,'Which tool?','Acme',targets,'{"Acme":true}','[]',0);
  // The brand analysis read every answer (share of voice and position count only those).
  sql.exec("INSERT INTO store_meta VALUES('analysis_revision','read');UPDATE runs SET analysis_revision='read',analysis_targets_json=targets_json,analysis_mentions_json=mentions_json");
  const database={
    ensurePositions:runPositionsFor(sql),
    prepare(query){return {sql:query,params:[],bind(...params){return {...this,params}},async all(){return {results:sql.prepare(this.sql).all(...this.params)}}}},
    async batch(statements){return Promise.all(statements.map(statement=>statement.all()))},
  };
  globalThis.presenceFixture={database,project:{id:'p',name:'Acme',domain:'acme.test',competitors_json:'[]'}};
  try {
    const query='project=p&start=2026-10-10&end=2026-10-11';
    const report=await summaryReport(await reportContext('owner',new URLSearchParams(query)));
    assert.equal(report.metrics.responses,4);
    assert.deepEqual(report.samples,{current:2,previous:1});
    // One answer then against four now: under half, so no comparison (lib/period-coverage), never a change from a thin base.
    assert.equal(report.comparison.hasPreviousData,false);
    // One channel row per model of the current period, in model order; a model absent from the period has none.
    assert.deepEqual(report.channels.map(({engine,visibility,shareOfVoice,mentionPosition})=>[engine,visibility,shareOfVoice,mentionPosition]),[['chat_gpt',100,100,1],['gemini',100,100,1]]);
    const filtered=await summaryReport(await reportContext('owner',new URLSearchParams(query+'&engine=chat_gpt')));
    assert.deepEqual(filtered.samples,{current:1,previous:1});
    const absent=await summaryReport(await reportContext('owner',new URLSearchParams('project=p&start=2026-09-01&end=2026-09-02')));
    assert.deepEqual(absent.samples,{current:0,previous:0});
    assert.equal(absent.comparison.hasPreviousData,false);
    // No change markers on the chart (6/11/2026): the summary no longer lists where an AI changed model.
    assert.equal('modelChanges' in report,false);
    for(const range of ['start=2026-10-10&end=2026-10-11','start=2026-10-10T12:30:00Z&end=2026-10-12T17:45:00Z']) {
      const bounds=parseReportFilter(new URLSearchParams(range));
      assert.equal(Date.parse(bounds.cutoff)-Date.parse(bounds.previousCutoff),Date.parse(bounds.end)-Date.parse(bounds.cutoff));
    }
  } finally {sql.close();delete globalThis.presenceFixture;}
});

test('change: each row\'s presence in the comparison period, its semantic answers included; none without answers there', async () => {
  const { sql, add, ctx } = fixture();
  try {
    // The comparison is the project `prev` here (the fixture's period condition is the project).
    for (const [id, unit] of [['a', 'q1'], ['b', 'q1']]) sql.prepare('INSERT INTO prompts(id,project_id,unit_id) VALUES(?,?,?)').run(id, 'prev', unit);
    add('a', 'chat_gpt', ['own.test', 'new.test']);
    add('b', 'gemini', ['own.test']);
    add('a', 'chat_gpt', ['own.test'], null, 'complete', 'prev');
    add('b', 'gemini', [], null, 'complete', 'prev');
    ctx.previousBindings = ['prev'];
    ctx.previousSemanticSources = [{ id: 's0', engine: 'claude', sources: [{ domain: 'new.test', url: 'https://new.test/page' }], targets: [], score: null }];
    const previous = (page) => Object.fromEntries(page.rows.map((row) => [row.key, row.previousPresence === null ? null : Math.round(row.previousPresence * 10) / 10]));
    const plain = await sourcesReport(ctx, new URLSearchParams('kind=cited&evidence=1'));
    assert.ok(plain.rows.every((row) => !('previousPresence' in row)), 'only when asked');
    const read = await sourcesReport(ctx, new URLSearchParams('kind=cited&evidence=1'), undefined, undefined, true);
    assert.deepEqual(read.rows.map((row) => [row.key, row.presence]), plain.rows.map((row) => [row.key, row.presence]), 'the period is unchanged');
    // Comparison: q1×ChatGPT cites own.test, q1×Gemini nothing, the semantic answer new.test: each 1 of 3 combinations.
    assert.deepEqual(previous(read), { 'own.test': 33.3, 'new.test': 33.3 });
    assert.deepEqual(previous(await sourcesReport(ctx, new URLSearchParams('kind=cited&origin=prompts'), undefined, undefined, true)), { 'own.test': 50, 'new.test': 0 });
    assert.deepEqual(previous(await sourcesReport(ctx, new URLSearchParams('kind=all&group=url&sort=presence&dir=asc'), undefined, undefined, true)), { 'https://new.test/page': 33.3, 'https://own.test/page': 33.3 });
    // A comparison period without answers has no presence, never 0.
    const empty = await sourcesReport({ ...ctx, previousBindings: ['absent'], previousSemanticSources: [] }, new URLSearchParams(''), undefined, undefined, true);
    assert.deepEqual(previous(empty), { 'own.test': null, 'new.test': null });
  } finally {
    sql.close();
  }
});

test('origins reuse source keys, sum citations and count each semantic response score once', async () => {
  const { sql, add, ctx } = fixture();
  try {
    add('a', 'chat_gpt', ['shared.test']);
    add('b', 'gemini', ['prompts.test']);
    ctx.semanticSources = [
      { id: 's1', engine: 'chat_gpt', sources: [
        { domain: 'shared.test', url: 'https://shared.test/page' },
        { domain: 'shared.test', url: 'https://shared.test/other' },
        { domain: 'semantic.test', url: 'https://semantic.test/page' },
      ], targets: [{ name: 'Acme', domain: 'own.test' }], score: 80 },
      { id: 's2', engine: 'gemini', sources: [{ domain: 'shared.test', url: 'https://shared.test/page' }], targets: [], score: 40 },
      { id: 's3', engine: 'claude', sources: [], targets: [], score: 70 },
      { id: 's4', engine: 'google_ai_mode', sources: [], targets: [], score: 60 },
      { id: 's5', engine: 'perplexity', sources: [{ domain: 'unscored.test', url: 'https://unscored.test/' }], targets: [], score: null },
    ];
    const all = await sourcesReport(ctx, new URLSearchParams('origin=all'));
    const prompts = await sourcesReport(ctx, new URLSearchParams('origin=prompts'));
    const semantic = await sourcesReport(ctx, new URLSearchParams('origin=semantic-branding'));
    assert.equal(all.rows.filter((row) => row.key === 'shared.test').length, 1);
    assert.equal(prompts.rows.length, 2);
    assert.equal(semantic.rows.length, 3);
    assert.equal(all.complete, prompts.complete + semantic.complete);
    assert.equal(all.rows.find((row) => row.key === 'shared.test').responses, 3);
    assert.equal(semantic.rows.find((row) => row.key === 'shared.test').averageScore, 60);
    assert.equal(semantic.rows.find((row) => row.key === 'unscored.test').averageScore, null);
    assert.equal(semantic.totals.models, 5); // source-less answers remain in the denominator
    assert.equal(semantic.available, 0); // no invented consulted evidence
    assert.equal((await sourcesReport(ctx, new URLSearchParams('origin=semantic-branding&kind=consulted'))).rows.length, 0);
    const urls = await sourcesReport(ctx, new URLSearchParams('origin=all&group=url'));
    assert.equal(urls.rows.find((row) => row.key === 'https://shared.test/page').responses, 3);
    const counts = await sourceCounts(ctx, new URLSearchParams('origin=semantic-branding'));
    assert.equal(counts.rows.find((row) => row.key === 'shared.test').responses, 2);
    const owned = await sourcesReport(ctx, new URLSearchParams('origin=semantic-branding&owner=own'));
    assert.equal(owned.rows.length, 0);
    await assert.rejects(sourcesReport(ctx, new URLSearchParams('origin=invalid')), /origin/);
  } finally { sql.close(); }
});

test('all origins preserve prompt visibility and semantic-only sources have no measurement', async () => {
  const { sql, add, ctx } = fixture();
  try {
    add('a', 'chat_gpt', ['shared.test', 'shared.test']);
    add('b', 'gemini', ['shared.test']);
    add('c', 'chat_gpt', ['unmentioned.test']);
    ctx.mentionExpression = "CASE WHEN r.prompt_id='a' THEN 1 ELSE 0 END";
    ctx.semanticSources = [{ id: 's1', engine: 'chat_gpt', sources: [
      { domain: 'shared.test', url: 'https://shared.test/page' },
      { domain: 'semantic.test', url: 'https://semantic.test/page' },
    ], targets: [], score: null }];
    for (const group of ['domain', 'url']) {
      const get = (origin) => sourcesReport(ctx, new URLSearchParams({ origin, group }));
      const prompts = await get('prompts'), all = await get('all'), semantic = await get('semantic-branding');
      const shared = (page) => page.rows.find((row) => row.domain === 'shared.test');
      assert.equal(shared(prompts).visibility, 50);
      assert.equal(shared(all).visibility, shared(prompts).visibility);
      assert.equal(shared(all).responses, 3); // all source citations still count
      assert.equal(shared(all).mentions, 1); // duplicate links do not duplicate mentions
      assert.equal(all.rows.find((row) => row.domain === 'unmentioned.test').visibility, 0);
      assert.equal(all.rows.find((row) => row.domain === 'semantic.test').visibility, null);
      assert(semantic.rows.every((row) => row.visibility === null));
      assert.equal(all.leaders.ranking.find((row) => row.domain === 'shared.test').visibility, 50);
    }
  } finally { sql.close(); }
});

test('source detail keeps semantic counts, daily/model presence and URLs consistent with its list', async () => {
  const { sql, ctx } = fixture();
  try {
    for (const column of ['workspace_id TEXT','mentions_json TEXT','analysis_mentions_json TEXT','prompt_text TEXT']) sql.exec(`ALTER TABLE runs ADD COLUMN ${column}`);
    for (const column of ['text TEXT','tags_json TEXT']) sql.exec(`ALTER TABLE prompts ADD COLUMN ${column}`);
    ctx.database.batch = async (statements) => Promise.all(statements.map((statement) => statement.all()));
    globalThis.presenceFixture = {
      database: ctx.database,
      project: { id: 'p', workspace_id: 'owner', name: 'Acme', domain: 'own.test', competitors_json: '[]' },
      semanticSources: [
        { id: 's1',date: '2026-10-18T00:00:00.000Z',engine: 'chat_gpt',sources: [
          { domain: 'source.test',url: 'https://source.test/a',title: 'A' },
          { domain: 'source.test',url: 'https://source.test/b',title: 'B' },
        ],targets: [],score: 80 },
        { id: 's2',date: '2026-10-18T00:00:00.000Z',engine: 'claude',sources: [],targets: [],score: 70 },
      ],
    };
    const q = new URLSearchParams('project=p&view=domain-detail&key=source.test&origin=semantic-branding&start=2026-10-01&end=2026-10-18');
    const detail = await sourceEntityReport('owner', q, 'domain');
    const context = await reportContext('owner', q);
    const list = await sourcesReport(context, q);
    assert.deepEqual(detail.presence, list.rows[0].presence);
    assert.deepEqual(detail.totals, list.totals);
    assert.equal(detail.metrics.citing, 1);
    assert.equal(detail.metrics.total, 2);
    assert.equal(detail.averageScore, 80);
    assert.equal(detail.daily[0].presence, 50);
    assert.equal(detail.platforms[0].presence, 100);
    assert.equal(detail.urls.length, 2);
    assert.equal(detail.history.runs.length, 0);
    assert.equal(detail.prompts.length, 0);
  } finally { delete globalThis.presenceFixture; sql.close(); }
});

test('query filters domain/URL keys before pagination; leaders follow; title alone does not match', async () => {
  const { sql, add, ctx } = fixture();
  try {
    // Title contains "reddit" but domain/URL do not — must not match.
    const put = sql.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    put.run(
      'r-title',
      'p',
      'a',
      'chat_gpt',
      'complete',
      1,
      JSON.stringify([{ url: 'https://news.example/item', domain: 'news.example', title: 'reddit thread' }]),
      null,
      JSON.stringify([{ name: 'Acme', domain: 'own.test' }]),
      null,
      null,
      '2026-10-18T00:00:00.000Z',
    );
    add('a', 'chat_gpt', ['reddit.com', 'own.test', 'blog.example']);
    add('b', 'gemini', ['reddit.com', 'other.test']);
    const byDomain = await sourcesReport(ctx, new URLSearchParams('query=ReDdIt'));
    assert.deepEqual(byDomain.rows.map((r) => r.key), ['reddit.com']);
    assert.equal(byDomain.leaders.ranking[0].key, 'reddit.com');
    assert.equal(byDomain.leaders.widest.key, 'reddit.com');
    const empty = await sourcesReport(ctx, new URLSearchParams('query=zzzz-absent'));
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.leaders, undefined);
    // URL group: path substring matches; title-only still does not.
    const urls = await sourcesReport(ctx, new URLSearchParams('group=url&query=/blog/'));
    // fixture add() builds https://{domain}/page — no /blog/; seed one.
    put.run(
      'r-blog',
      'p',
      'c',
      'chat_gpt',
      'complete',
      1,
      JSON.stringify([{ url: 'https://own.test/blog/launch', domain: 'own.test', title: 'Launch' }]),
      null,
      JSON.stringify([{ name: 'Acme', domain: 'own.test' }]),
      null,
      null,
      '2026-10-18T00:00:00.000Z',
    );
    const blog = await sourcesReport(ctx, new URLSearchParams('group=url&query=/blog/'));
    assert.deepEqual(blog.rows.map((r) => r.key), ['https://own.test/blog/launch']);
    assert.equal(urls.rows.length, 0);
  } finally {
    sql.close();
  }
});
