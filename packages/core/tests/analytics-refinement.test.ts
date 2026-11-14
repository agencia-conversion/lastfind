import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { relativeReportDate } from '../lib/report-date.ts';
import { buildFanout } from '../lib/fanout.ts';
import { runPositionsFor } from './run-positions-fixture.mjs';
const core = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({
  stdin: {
    contents:
      "export {reportContext,summaryReport,historyReport,competitorsReport,promptDetail,promptReport,fanoutReport,fanoutDetail} from './lib/server/reports.ts';export {semanticReport} from './lib/server/semantic.ts';export {measuredAssociationReport} from './components/analytics/semantic-measured-data.ts';export {setFixture} from 'fixture';",
    resolveDir: core,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'isolated-analytics-fixture',
      setup(builder) {
        const stubs: Record<string, string> = {
          fixture:
            'let fixture;export const setFixture=value=>fixture=value;export const current=()=>fixture;',
          './workspace':
            "import {current} from 'fixture';export const ownedProject=async(id,owner)=>{if(id!==current().project.id||owner!==current().project.workspace_id)throw Error('Access denied');return current().project;};",
          './project-store-read':
            "import {current} from 'fixture';export const projectReadDatabase=async()=>current().database;",
          './project-reads':
            "import {current} from 'fixture';export const ownedProjectStatement=(id,owner)=>({token:'project',id,owner});export const projectStoreStatement=()=>({token:'registry'});export const foundProject=(row)=>{if(!row)throw Error('Access denied');return row;};",
          // The first trip of a report: the project answers from the fixture, every other statement runs on its database.
          './env':
            "import {current} from 'fixture';export const now=()=>new Date().toISOString();export const db=()=>{const d=current().database;return new Proxy(d,{get:(t,p)=>{if(p==='batch')return (statements)=>Promise.all(statements.map((s)=>s.token?{results:s.token==='project'&&s.id===current().project.id&&s.owner===current().project.workspace_id?[current().project]:[]}:s.all()));const v=Reflect.get(t,p);return typeof v==='function'?v.bind(t):v;}});};",
          './http':
            'export class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}',
        };
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(stubs, args.path)
            ? { path: args.path, namespace: 'fixture' }
            : undefined,
        );
        builder.onResolve({ filter: /^@\// }, (args) => ({
          path: `${core}/${args.path.slice(2)}.ts`,
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: stubs[args.path]!,
          loader: 'js',
        }));
      },
    },
  ],
});
const api = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
);
await test('real SQL groups logical opportunities, computes SOV and preserves logical detail filters', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE store_meta(key TEXT,value TEXT);CREATE TABLE prompts(id TEXT,unit_id TEXT,project_id TEXT,text TEXT,engine TEXT,tag TEXT,tags_json TEXT);
 CREATE TABLE runs(id TEXT,prompt_id TEXT,project_id TEXT,workspace_id TEXT,prompt_text TEXT,engine TEXT,targets_json TEXT,mentions_json TEXT,sources_json TEXT,consulted_sources_json TEXT,analysis_revision TEXT,analysis_targets_json TEXT,analysis_mentions_json TEXT,status TEXT,response_available INTEGER,answer TEXT,created_at TEXT,completed_at TEXT,cost REAL,error TEXT);
 CREATE TABLE semantic_configurations(project_id TEXT,workspace_id TEXT,revision INTEGER,configuration_json TEXT,created_at TEXT);
 CREATE TABLE semantic_evaluations(id TEXT,run_id TEXT,project_id TEXT,workspace_id TEXT,config_revision INTEGER,assessment_json TEXT,answer_sha256 TEXT,rubric TEXT,model TEXT,coverage TEXT,cost_usd REAL,created_at TEXT);`);
  const database = {
    ensurePositions: runPositionsFor(sql),
    prepare(query: string) {
      let params: unknown[] = [];
      return {
        sql: query,
        bind(...values: unknown[]) {
          params = values;
          return this;
        },
        async all() {
          return { results: sql.prepare(query).all(...(params as never[])) };
        },
        async first() {
          return sql.prepare(query).get(...(params as never[])) ?? null;
        },
      };
    },
    async batch(statements: Array<{ all: () => Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.all()));
    },
  };
  const project = {
    id: 'project',
    workspace_id: 'owner',
    name: 'Our Brand',
    domain: 'own.example',
    competitors_json: JSON.stringify([
      { name: 'Rival', domain: 'rival.example' },
    ]),
  };
  api.setFixture({ project, database });
  const targets = JSON.stringify([
    { name: project.name, domain: project.domain },
    { name: 'Rival', domain: 'rival.example' },
  ]);
  for (const engine of ['chat_gpt', 'google_ai_mode'])
    for (const unit of ['question-a', 'question-b'])
      sql
        .prepare('INSERT INTO prompts VALUES(?,?,?,?,?,?,?)')
        .run(
          `${unit}-${engine}`,
          unit,
          'project',
          `Actual question ${unit}?`,
          engine,
          'Topic',
          '["tag"]',
        );
  for (let i = 0; i < 30; i++) {
    const engine = i % 2 ? 'google_ai_mode' : 'chat_gpt',
      unit = i % 3 ? 'question-a' : 'question-b';
    sql
      .prepare(
        'INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        `run-${i}`,
        `${unit}-${engine}`,
        'project',
        'owner',
        `Actual question ${unit}?`,
        engine,
        targets,
        JSON.stringify({ 'Our Brand': i < 20, Rival: true }),
        '[]',
        null,
        null,
        null,
        null,
        'complete',
        1,
        i < 20 ? 'Our Brand and Rival appear.' : 'Rival appears.',
        '2026-09-05T12:00:00.000Z',
        null,
        0,
        null,
      );
  }
  sql.exec("ALTER TABLE runs ADD COLUMN search_queries_json TEXT DEFAULT '[]'");
  sql.exec('ALTER TABLE runs ADD COLUMN analysis_brands_json TEXT');
  sql.exec('ALTER TABLE runs ADD COLUMN model TEXT');
  // The brand analysis read every answer (share of voice and position count only those).
  sql.exec("INSERT INTO store_meta VALUES('analysis_revision','read');UPDATE runs SET analysis_revision='read',analysis_targets_json=targets_json,analysis_mentions_json=mentions_json");
  sql.prepare("UPDATE runs SET search_queries_json=? WHERE engine='chat_gpt'").run('["Best streaming", "best  streaming!", "site:own.example streaming"]');
  sql.prepare("UPDATE runs SET sources_json=? WHERE id='run-0'").run('[{"url":"https://own.example/page","domain":"own.example"}]');
  const q = new URLSearchParams({
      project: 'project',
      start: '2026-09-01',
      end: '2026-09-30',
    }),
    ctx = await api.reportContext('owner', q);
  const firstHistory = await api.historyReport(ctx, q);
  const secondHistory = await api.historyReport(ctx, new URLSearchParams({...Object.fromEntries(q), page:'2'}));
  const cursorHistory = await api.historyReport(ctx, new URLSearchParams({...Object.fromEntries(q), cursor:firstHistory.nextCursor, page:'2'}));
  assert.equal(firstHistory.runs.length, 25);
  assert.equal(secondHistory.runs.length, 5);
  assert.deepEqual(secondHistory, cursorHistory);
  assert.ok(secondHistory.runs.every((run: {id: string}) => !firstHistory.runs.some((first: {id: string}) => first.id === run.id)));
  await assert.rejects(api.historyReport(ctx, new URLSearchParams({page:'0'})), /Invalid page/);
  // The list holds the set the Summary counts, complete answers only, so its total and pager agree.
  sql.exec("CREATE TEMP TABLE pending_copy AS SELECT * FROM runs WHERE id='run-1'; UPDATE pending_copy SET id='pending-newest',status='pending',response_available=0,created_at='2026-09-29T23:00:00.000Z'; INSERT INTO runs SELECT * FROM pending_copy; DROP TABLE pending_copy");
  const withPending = await api.historyReport(ctx, q);
  assert.ok(!withPending.runs.some((run: {id: string}) => run.id === 'pending-newest'));
  assert.equal((await api.summaryReport(ctx)).metrics.responses, firstHistory.runs.length + secondHistory.runs.length);
  sql.exec("DELETE FROM runs WHERE id='pending-newest'");

  const fanout = await api.fanoutReport(ctx);
  // Only the AI that returned searches is offered: the other engine's 15 responses leave the coverage.
  assert.equal(fanout.responses, 15); assert.equal(fanout.withFanout, 15);
  assert.deepEqual(fanout.fanoutEngines, ['chat_gpt']);
  assert.deepEqual(fanout.engines.map((row: {engine:string}) => row.engine), ['chat_gpt']);
  sql.exec("UPDATE runs SET search_queries_json='[]'");
  const emptyFanout = await api.fanoutReport(ctx);
  assert.deepEqual(emptyFanout.fanoutEngines, []);
  assert.deepEqual(emptyFanout.engines, []);
  assert.equal(emptyFanout.responses, 0);
  assert.equal(emptyFanout.withFanout, 0);
  sql.prepare("UPDATE runs SET search_queries_json=? WHERE engine='chat_gpt'").run('["Best streaming", "best  streaming!", "site:own.example streaming"]');
  assert.equal(fanout.occurrences, 30); assert.equal(fanout.distinct, 2);
  assert.equal(fanout.queries.find((row: {key:string}) => row.key === 'best streaming').mentionedRate, 10 / 15 * 100);
  const fq = new URLSearchParams(q); fq.set('key', 'best streaming');
  const searchDetail = await api.fanoutDetail(ctx, fq);
  assert.equal(searchDetail.runs.length, 15);
  assert.deepEqual(searchDetail.cited, [{domain:'own.example',count:1}]);
  assert.equal(searchDetail.consulted, null);
  assert.equal(searchDetail.runs.find((row: {id:string}) => row.id === 'run-0').cited, true);
  sql.exec("UPDATE runs SET consulted_sources_json='[]' WHERE id='run-0'");
  assert.deepEqual((await api.fanoutDetail(ctx, fq)).consulted, []);
  for (const [key,value,expected] of [['engine','google_ai_mode',0],['engine','chat_gpt',15],['topic','Absent',0],['tags','other',0],['tags','tag',15],['prompt','question-b',5],['start','2026-09-06',0]] as const) {
    const filtered = new URLSearchParams(fq); filtered.set(key,value);
    const context = await api.reportContext('owner',filtered);
    assert.equal((await api.fanoutDetail(context,filtered)).runs.length,expected,`${key}=${value}`);
  }
  for (const key of ['', 'x'.repeat(401)]) {
    fq.set('key',key); await assert.rejects(api.fanoutDetail(ctx,fq), (error: {status:number}) => error.status === 400);
  }
  fq.set('key','unknown');
  assert.deepEqual(await api.fanoutDetail(ctx,fq),{key:'unknown',variants:[],runs:[],cited:[],consulted:null});
  await assert.rejects(api.reportContext('owner',new URLSearchParams({project:'foreign'})),/Access denied/);
  const summary = await api.summaryReport(ctx);
  assert.equal(summary.daily[0].responses, 30);
  assert.equal(summary.daily[0].mentions, 20);
  assert.equal(summary.daily[0].totalMentions, 50);
  assert.equal(summary.daily[0].positionSamples, 20);
  assert.equal(summary.daily[0].positionSum, 20);
  assert.equal(summary.daily[0].position, 1);
  assert.equal(summary.daily[0].positionSamplesC0, 30);
  assert.equal(summary.daily[0].positionSumC0, 50);
  assert.equal(summary.metrics.mentionPosition, summary.daily[0].position);
  const selectedQ = new URLSearchParams(q); selectedQ.set('brand', 'Rival'); selectedQ.set('engine', 'google_ai_mode');
  const selectedSummary = await api.summaryReport(await api.reportContext('owner', selectedQ));
  assert.equal(selectedSummary.daily[0].responses, 15);
  assert.equal(selectedSummary.daily[0].positionSamples, 15);
  assert.equal(selectedSummary.daily[0].positionSum, 25);
  assert.equal(selectedSummary.metrics.mentionPosition, 25 / 15);
  const absentQ = new URLSearchParams(q); absentQ.set('topic', 'Absent');
  assert.deepEqual((await api.summaryReport(await api.reportContext('owner', absentQ))).daily, []);
  const brands0 = await api.competitorsReport(ctx, q);
  sql.prepare('UPDATE runs SET targets_json=?,mentions_json=?,answer=? WHERE id=?').run(JSON.stringify([{name:'Old Own',domain:project.domain,aliases:['Historic alias']},{name:'Rival',domain:'rival.example'}]), JSON.stringify({'Old Own':true,Rival:true}), 'Rival first. Historic alias later. Sources: Old Own', 'run-0');
  sql.exec("UPDATE runs SET analysis_targets_json=targets_json,analysis_mentions_json=mentions_json WHERE id='run-0'");
  const renamed = await api.summaryReport(ctx);
  assert.equal(renamed.daily[0].positionSamples, 20);
  assert.equal(renamed.daily[0].positionSum, 21);
  assert.equal(renamed.daily[0].positionSumC0, 49);
  // An answer collected under an old name still counts for the project's own brand, named as the project is now (the Brands row matches it by name).
  const renamedBrands = await api.competitorsReport(ctx, q);
  const own = renamedBrands.platforms.filter((row: { domain: string }) => row.domain === project.domain);
  assert.deepEqual(own.map((row: { name: string }) => row.name), [String(project.name)]);
  assert.equal(renamedBrands.platforms.some((row: { name: string }) => row.name === 'Old Own'), false);
  assert.equal(own[0].responses, brands0.platforms.find((row: { name: string }) => row.name === String(project.name)).responses);
  sql.prepare('UPDATE runs SET targets_json=?,mentions_json=?,answer=? WHERE id=?').run(targets, JSON.stringify({'Our Brand':true,Rival:true}), 'Our Brand and Rival appear.', 'run-0');
  sql.prepare('UPDATE runs SET mentions_json=? WHERE id=?').run('null', 'run-29');
  sql.exec('UPDATE runs SET analysis_targets_json=targets_json,analysis_mentions_json=mentions_json');
  const noMentions = await api.summaryReport(ctx);
  assert.equal(noMentions.daily[0].positionSamplesC0, 29);
  sql.prepare('UPDATE runs SET mentions_json=? WHERE id=?').run(JSON.stringify({'Our Brand':false,Rival:true}), 'run-29');
  sql.exec('UPDATE runs SET analysis_targets_json=targets_json,analysis_mentions_json=mentions_json');
  const brands = await api.competitorsReport(ctx, q);
  assert.equal(brands.platforms[0].name, 'Rival');
  assert.equal(brands.platforms[0].shareOfVoice, 60);
  assert.equal(brands.platforms[1].shareOfVoice, 40);
  assert.equal(brands.competitorOnly.length, 2);
  assert.equal(
    brands.competitorOnly.reduce(
      (sum: number, row: { responses: number }) => sum + row.responses,
      0,
    ),
    10,
  );
  const opportunity = brands.competitorOnly.find(
    (row: { prompt: string }) => row.prompt === 'question-a',
  );
  assert.match(opportunity.label, /Actual question/);
  assert.equal(opportunity.engines.length, 2);
  assert.deepEqual(opportunity.brands, [
    { name: 'Rival', domain: 'rival.example' },
  ]);
  const detailQuery = new URLSearchParams(q);
  detailQuery.set('prompt', 'question-a');
  const detail = await api.promptDetail(
    await api.reportContext('owner', detailQuery),
    detailQuery,
  );
  assert.equal(
    detail.platforms.reduce(
      (sum: number, row: { responses: number }) => sum + row.responses,
      0,
    ),
    20,
  );
  // The prompt header compares against the previous period with the same scores as the prompt list.
  const listed = (await api.promptReport(ctx, true))['question-a'];
  assert.ok(detail.previous);
  assert.equal(detail.previous.responses, listed.previous.responses);
  assert.equal(detail.previous.mentions, listed.previous.mentions);
  assert.equal(detail.previous.visibility, listed.previous.visibility);
  // The newest complete answer per model does not depend on the history page and skips a newer failed run inside the period.
  const newest = (engine: string) => (sql.prepare("SELECT id FROM runs WHERE prompt_id LIKE 'question-a-%' AND engine=? AND status='complete' AND response_available=1 ORDER BY created_at DESC,id DESC LIMIT 1").get(engine) as { id: string }).id;
  sql.exec("CREATE TEMP TABLE failed_copy AS SELECT * FROM runs WHERE id='run-1'; UPDATE failed_copy SET id='failed-newest',status='failed',response_available=0,created_at='2026-09-05T13:00:00.000Z'; INSERT INTO runs SELECT * FROM failed_copy; DROP TABLE failed_copy");
  const withFailure = await api.promptDetail(await api.reportContext('owner', detailQuery), detailQuery);
  sql.prepare("DELETE FROM runs WHERE id='failed-newest'").run();
  assert.ok(withFailure.platforms.length > 1);
  for (const row of withFailure.platforms) assert.equal(row.latestRunId, newest(row.engine));
  const compact = await api.promptReport(ctx, true),
    full = await api.promptReport(ctx);
  assert.equal(compact['question-a'].responses, full['question-a'].responses);
  assert.equal(compact['question-a'].latest, undefined);
  assert.ok(full['question-a'].latest);
  // The prompts' citations of the brand add up to the Overview's: the Prompts filter "cited / not cited" reads the same answers.
  const rows = Object.values(compact) as { responses: number; cited?: number }[];
  const summaryNow = await api.summaryReport(ctx);
  assert.ok(rows.some((row) => (row.cited ?? 0) > 0));
  assert.ok(Math.abs(rows.reduce((sum, row) => sum + (row.cited ?? 0), 0) / rows.reduce((sum, row) => sum + row.responses, 0) * 100 - summaryNow.metrics.citationPresence) < 1e-9);
  assert.ok(compact['question-a'].totalMentions >= compact['question-a'].mentions);
  assert.equal(
    compact['question-a'].shareOfVoice == null,
    !compact['question-a'].totalMentions,
  );
  if (compact['question-a'].totalMentions) {
    assert.ok(compact['question-a'].shareOfVoice! >= 0);
    assert.ok(compact['question-a'].shareOfVoice! <= 100);
  }
  await assert.rejects(api.reportContext('other-owner', q), /Access denied/);
  const config = {
    enabled: true,
    attributes: [
      { id: 'quality', name: 'Quality' },
      { id: 'coverage', name: 'Coverage' },
    ],
  };
  sql
    .prepare('INSERT INTO semantic_configurations VALUES(?,?,?,?,?)')
    .run(
      'project',
      'owner',
      1,
      JSON.stringify(config),
      '2026-09-01T00:00:00.000Z',
    );
  for (let i = 0; i < 30; i++) {
    const readings = [
      {
        brand: 'Our Brand',
        attribute: 'quality',
        state: i === 0 ? 'ambiguous' : 'assessed',
        score: i === 0 ? null : 0,
      },
      { brand: 'Rival', attribute: 'quality', state: 'assessed', score: 100 },
      {
        brand: 'Our Brand',
        attribute: 'coverage',
        state: 'assessed',
        score: 50,
      },
      {
        brand: 'Rival',
        attribute: 'coverage',
        state: i === 1 ? 'insufficient' : 'assessed',
        score: i === 1 ? null : 50,
      },
    ].map((row) => ({
      ...row,
      reason: 'Synthetic test evidence',
      quote: row.score === null ? null : 'Brand context',
    }));
    sql
      .prepare(
        'INSERT INTO semantic_evaluations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        `evaluation-${i}`,
        `run-${i}`,
        'project',
        'owner',
        1,
        JSON.stringify({ readings }),
        'a'.repeat(64),
        'association-v1',
        'fixture',
        'full',
        0,
        '2026-09-05T13:00:00.000Z',
      );
  }
  const semantic = await api.semanticReport('project', 'owner', q);
  assert.equal(semantic.assessments.length, 20);
  assert.ok(semantic.nextCursor);
  assert.equal(semantic.association.prompts, 2);
  assert.equal(semantic.association.engines.length, 2);
  for (const cell of semantic.association.cells)
    assert.equal(
      cell.samples,
      29,
      'aggregate includes full shared cohort beyond evidence page',
    );
  const measured = api.measuredAssociationReport(
    {
      ...config,
      attributes: config.attributes.map((attribute) => ({
        ...attribute,
        description: '',
      })),
    },
    semantic.association,
  );
  assert.equal(measured.own.entity.name, 'Our Brand');
  assert.equal(measured.own.score, 25);
  assert.equal(measured.ranking[0].score, 75);
  assert.equal(measured.gap, -50);
  const empty = api.measuredAssociationReport(config, {
    ...semantic.association,
    cells: [],
  });
  assert.equal(empty.own.score, null);
  assert.equal(empty.ranking.length, 0);
  q.set('engine', 'google_ai_mode');
  const filtered = await api.semanticReport('project', 'owner', q);
  assert.deepEqual(filtered.association.engines, ['google_ai_mode']);
  assert.equal(filtered.coverage.evaluated, 15);
  sql.prepare('DELETE FROM semantic_configurations WHERE project_id=?').run('project');
  for (let index = 30; index < 140; index++) sql.prepare(`INSERT INTO runs SELECT ?,prompt_id,project_id,workspace_id,prompt_text,engine,targets_json,mentions_json,sources_json,consulted_sources_json,analysis_revision,analysis_targets_json,analysis_mentions_json,status,response_available,answer,created_at,completed_at,cost,error,search_queries_json,analysis_brands_json,model FROM runs WHERE id='run-0'`).run(`unconfigured-${index}`);
  q.delete('engine');
  const unconfigured = await api.semanticReport('project','owner',q);
  assert.equal(unconfigured.configuration.enabled,false);
  assert.deepEqual(unconfigured.coverage,{eligible:140,evaluated:0,unassessed:140});
  assert.equal(unconfigured.association.cells.length,0);
  sql.exec("UPDATE runs SET response_available=0 WHERE id='run-0'");
  assert.equal((await api.fanoutReport(ctx)).responses,124);
  for(let index=140;index<5100;index++) sql.prepare("INSERT INTO runs SELECT ?,prompt_id,project_id,workspace_id,prompt_text,engine,targets_json,mentions_json,sources_json,consulted_sources_json,analysis_revision,analysis_targets_json,analysis_mentions_json,status,1,answer,created_at,completed_at,cost,error,search_queries_json,analysis_brands_json,model FROM runs WHERE id='run-0'").run(`cap-${index}`);
  const capped = await api.fanoutReport(ctx);
  assert.equal(capped.truncated,true); assert.equal(capped.withFanout,5000);
  fq.set('key','best streaming'); assert.equal((await api.fanoutDetail(ctx,fq)).runs.length,50);
  sql.close();
});
await test('Query Fan Out of a large store stays under the read size limit and matches every answer read in full', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE store_meta(key TEXT,value TEXT);CREATE TABLE prompts(id TEXT,unit_id TEXT,project_id TEXT,text TEXT,engine TEXT,tag TEXT,tags_json TEXT);
 CREATE TABLE runs(id TEXT,prompt_id TEXT,project_id TEXT,workspace_id TEXT,prompt_text TEXT,engine TEXT,targets_json TEXT,mentions_json TEXT,sources_json TEXT,consulted_sources_json TEXT,analysis_revision TEXT,analysis_targets_json TEXT,analysis_mentions_json TEXT,status TEXT,response_available INTEGER,answer TEXT,created_at TEXT,search_queries_json TEXT);`);
  // The project store refuses a read whose rows add up to more than 4 MiB (ProjectStore.runQueries): so does this one.
  const reads: number[] = [];
  const database = {
    prepare(query: string) {
      return {
        sql: query,
        params: [] as unknown[],
        bind(...values: unknown[]) {
          return { ...this, params: values };
        },
      };
    },
    async batch(statements: Array<{ sql: string; params: unknown[] }>) {
      let bytes = 0;
      const results = statements.map(({ sql: query, params }) => ({ results: sql.prepare(query).all(...(params as never[])) }));
      for (const { results: rows } of results) for (const row of rows) bytes += Buffer.byteLength(JSON.stringify(row));
      if (bytes > 4 * 1024 * 1024) throw new Error('Query result is too large');
      reads.push(bytes);
      return results;
    },
  };
  const project = { id: 'big', workspace_id: 'owner', name: 'Acme', domain: 'acme.example', competitors_json: JSON.stringify([{ name: 'Rival', domain: 'rival.example' }]) };
  api.setFixture({ project, database });
  const targets = JSON.stringify([{ name: 'Acme', domain: 'acme.example' }, { name: 'Rival', domain: 'rival.example' }]);
  const words = ['melhor', 'plataforma', 'vídeo', 'streaming', 'preço', 'família', 'acme', 'rival', 'filmes', 'séries', '2026', 'site:acme.example', 'comparação'];
  const prompts = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, text: `Qual é a melhor plataforma de streaming para a família número ${i}, comparando preço, catálogo e dispositivos?`, tag: `Tópico ${i % 5}` }));
  for (const prompt of prompts) sql.prepare('INSERT INTO prompts VALUES(?,?,?,?,?,?,?)').run(prompt.id, null, 'big', prompt.text, 'chat_gpt', prompt.tag, '[]');
  const insert = sql.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  // 2 x 5,001 answers with long questions and six searches each: read in full, the two periods were about 7 MB.
  let seed = 1;
  const random = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const inputs: Array<{ id: string; engine: string; prompt_id: string; prompt_text: string; topic: string; created_at: string; queries: string[]; mentioned: boolean; cited: boolean; previous: boolean }> = [];
  sql.exec('BEGIN');
  for (let i = 0; i < 10002; i++) {
    const prompt = prompts[i % prompts.length], previous = i >= 5001;
    const created = new Date(Date.parse(previous ? '2026-08-31T23:00:00.000Z' : '2026-09-30T23:00:00.000Z') - (i % 5001) * 500000).toISOString();
    const queries = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => words[Math.floor(random() * words.length)]).join(' '));
    const mentioned = random() < 0.5, cited = random() < 0.3, engine = i % 3 ? 'chat_gpt' : 'google_ai_mode';
    insert.run(`run-${String(i).padStart(5, '0')}`, prompt.id, 'big', 'owner', prompt.text, engine, targets, JSON.stringify({ Acme: mentioned, Rival: true }),
      JSON.stringify(cited ? [{ url: 'https://acme.example/a', domain: 'acme.example' }] : []), null, null, null, null, 'complete', 1, 'answer', created, JSON.stringify(queries));
    inputs.push({ id: `run-${String(i).padStart(5, '0')}`, engine, prompt_id: prompt.id, prompt_text: prompt.text, topic: prompt.tag, created_at: created, queries, mentioned, cited, previous });
  }
  sql.exec('COMMIT');
  const q = new URLSearchParams({ project: 'big', start: '2026-09-01', end: '2026-10-01' });
  const report = await api.fanoutReport(await api.reportContext('owner', q));
  assert.ok(reads.every((bytes) => bytes < 2.5 * 1024 * 1024), `reads of ${reads.join(', ')} bytes`);
  // The oracle: every answer of both periods read in full, newest first, as the report did before.
  const newest = (rows: typeof inputs) => rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, 5000);
  const coverage = ['chat_gpt', 'google_ai_mode'].map((engine) => ({ engine, responses: inputs.filter((run) => !run.previous && run.engine === engine).length }));
  const expected = buildFanout(newest(inputs.filter((run) => !run.previous)) as never, coverage as never, [{ name: 'Acme', own: true }, { name: 'Rival', own: false }], '', newest(inputs.filter((run) => run.previous)) as never);
  assert.deepEqual(report, { ...expected, fanoutEngines: report.fanoutEngines, truncated: true });
  assert.deepEqual([...report.fanoutEngines].sort(), ['chat_gpt', 'google_ai_mode']);
  assert.ok(report.termTrend.some((row: { change: number | null }) => row.change !== null), 'the previous period is compared');
  sql.close();
});
await test('friendly dates localize relative time and preserve invalid/missing values', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(
    relativeReportDate('2026-10-13T12:00:00Z', 'en', now),
    'yesterday',
  );
  assert.equal(
    relativeReportDate('2026-10-13T12:00:00Z', 'pt-BR', now),
    'ontem',
  );
  assert.equal(relativeReportDate('bad', 'pt-BR', now), '—');
});
