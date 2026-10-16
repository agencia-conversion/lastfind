import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { relativeReportDate } from '../lib/report-date.ts';
const core = fileURLToPath(new URL('..', import.meta.url));
const bundle = await build({
  stdin: {
    contents:
      "export {reportContext,summaryReport,competitorsReport,promptDetail,promptReport} from './lib/server/reports.ts';export {semanticReport} from './lib/server/semantic.ts';export {measuredAssociationReport} from './components/analytics/semantic-measured-data.ts';export {setFixture} from 'fixture';",
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
            "import {current} from 'fixture';export const ownedProject=async(id,owner)=>{if(id!==current().project.id||owner!==current().project.owner_id)throw Error('Access denied');return current().project;};",
          './project-store-read':
            "import {current} from 'fixture';export const projectReadDatabase=async()=>current().database;",
          './env':
            "import {current} from 'fixture';export const db=()=>current().database;export const now=()=>new Date().toISOString();",
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
 CREATE TABLE runs(id TEXT,prompt_id TEXT,project_id TEXT,owner_id TEXT,prompt_text TEXT,engine TEXT,targets_json TEXT,mentions_json TEXT,sources_json TEXT,consulted_sources_json TEXT,analysis_revision TEXT,analysis_targets_json TEXT,analysis_mentions_json TEXT,status TEXT,response_available INTEGER,answer TEXT,created_at TEXT,completed_at TEXT,cost REAL,error TEXT);
 CREATE TABLE semantic_configurations(project_id TEXT,owner_id TEXT,revision INTEGER,configuration_json TEXT,created_at TEXT);
 CREATE TABLE semantic_evaluations(id TEXT,run_id TEXT,project_id TEXT,owner_id TEXT,config_revision INTEGER,assessment_json TEXT,answer_sha256 TEXT,rubric TEXT,model TEXT,coverage TEXT,cost_usd REAL,created_at TEXT);`);
  const database = {
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
    owner_id: 'owner',
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
  const q = new URLSearchParams({
      project: 'project',
      start: '2026-09-01',
      end: '2026-09-30',
    }),
    ctx = await api.reportContext('owner', q);
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
  sql.prepare('UPDATE runs SET targets_json=?,mentions_json=?,answer=? WHERE id=?').run(JSON.stringify([{name:'Old Own',domain:project.domain,aliases:['Historic alias']},{name:'Rival',domain:'rival.example'}]), JSON.stringify({'Old Own':true,Rival:true}), 'Rival first. Historic alias later. Sources: Old Own', 'run-0');
  const renamed = await api.summaryReport(ctx);
  assert.equal(renamed.daily[0].positionSamples, 20);
  assert.equal(renamed.daily[0].positionSum, 21);
  assert.equal(renamed.daily[0].positionSumC0, 49);
  sql.prepare('UPDATE runs SET targets_json=?,mentions_json=?,answer=? WHERE id=?').run(targets, JSON.stringify({'Our Brand':true,Rival:true}), 'Our Brand and Rival appear.', 'run-0');
  sql.prepare('UPDATE runs SET mentions_json=? WHERE id=?').run('null', 'run-29');
  const noMentions = await api.summaryReport(ctx);
  assert.equal(noMentions.daily[0].positionSamplesC0, 29);
  sql.prepare('UPDATE runs SET mentions_json=? WHERE id=?').run(JSON.stringify({'Our Brand':false,Rival:true}), 'run-29');
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
  const compact = await api.promptReport(ctx, true),
    full = await api.promptReport(ctx);
  assert.equal(compact['question-a'].responses, full['question-a'].responses);
  assert.equal(compact['question-a'].latest, undefined);
  assert.ok(full['question-a'].latest);
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
  for (let index = 30; index < 140; index++) sql.prepare(`INSERT INTO runs SELECT ?,prompt_id,project_id,owner_id,prompt_text,engine,targets_json,mentions_json,sources_json,consulted_sources_json,analysis_revision,analysis_targets_json,analysis_mentions_json,status,response_available,answer,created_at,completed_at,cost,error FROM runs WHERE id='run-0'`).run(`unconfigured-${index}`);
  q.delete('engine');
  const unconfigured = await api.semanticReport('project','owner',q);
  assert.equal(unconfigured.configuration.enabled,false);
  assert.deepEqual(unconfigured.coverage,{eligible:140,evaluated:0,unassessed:140});
  assert.equal(unconfigured.association.cells.length,0);
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
