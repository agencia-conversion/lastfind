import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const bundled = await build({
  entryPoints: [resolve(root, 'packages/core/lib/server/semantic-source-rows.ts')],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'isolated-semantic-sources', setup(b) {
    b.onResolve({ filter: /^\.\/(env|http)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: path === './env'
      ? 'export const db=()=>globalThis.semanticSourcesDb;'
      : 'export class ApiError extends Error { constructor(status,message){ super(message);this.status=status; } }' }));
  } }],
});
const { semanticSourceRows, semanticSourcePeriods } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);

test('semantic catalog reads saved completed interface queries only, scoped by owner/project/date/engine, preserving source-less answers', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE semantic_panel_rounds(id TEXT,project_id TEXT,workspace_id TEXT,day TEXT,roster_json TEXT);
    CREATE TABLE semantic_panel_queries(id TEXT,round_id TEXT,project_id TEXT,workspace_id TEXT,engine TEXT,status TEXT,sources_json TEXT,method TEXT);
    CREATE TABLE semantic_panel_readings(query_id TEXT,score INTEGER);`);
  let queries = 0;
  globalThis.semanticSourcesDb = { prepare(statement) { queries++; return { bind(...params) { return {
    all: async () => ({ results: sql.prepare(statement).all(...params) }),
  }; } }; } };
  const put = (id, day, engine, status = 'completed', owner = 'owner', project = 'p', sources = [], method = 'scrape') => {
    sql.prepare('INSERT INTO semantic_panel_rounds VALUES(?,?,?,?,?)').run(id, project, owner, day, JSON.stringify({ brands: [{ name: 'Acme', domain: 'own.test' }] }));
    sql.prepare('INSERT INTO semantic_panel_queries VALUES(?,?,?,?,?,?,?,?)').run(id,id,project,owner,engine,status,JSON.stringify(sources),method);
  };
  const filter = { cutoff: '2026-10-01T15:00:00.000Z', end: '2026-10-19T00:00:00.000Z', previousCutoff: '2026-09-13T15:00:00.000Z', previousEnd: '2026-10-01T15:00:00.000Z', engine: 'all' };
  try {
    put('s1','2026-10-01','chat_gpt','completed','owner','p',[{ url: 'https://shared.test/',domain: 'shared.test' }]);
    put('s2','2026-10-18','claude');
    put('s3','2026-10-18','google_ai_mode');
    put('s4','2026-09-30','gemini');
    put('s5','2026-10-19','gemini');
    put('s6','2026-10-18','gemini','failed');
    put('foreign','2026-10-18','chat_gpt','completed','other');
    put('foreign-project','2026-10-18','chat_gpt','completed','owner','other');
    // A pure model's answer (until 6/11/2026) counts in no score, so its citations are not Semantic Branding sources either.
    put('model','2026-10-18','claude','completed','owner','p',[{ url: 'https://model.test/',domain: 'model.test' }],'llm');
    sql.exec("INSERT INTO semantic_panel_readings VALUES('s1',80),('s1',60)");
    const rows = await semanticSourceRows('p','owner',filter,new URLSearchParams());
    assert.deepEqual(rows.map((row) => row.id), ['s1','s2','s3']);
    // One read brings the comparison too: the period's first day is the period's alone, a gap belongs to neither.
    const read = [{ date: '2026-09-12T00:00:00.000Z' }, { date: '2026-09-13T00:00:00.000Z' }, { date: '2026-09-30T00:00:00.000Z' }, { date: '2026-10-01T00:00:00.000Z' }];
    const days = ({ current, previous }) => [current, previous].map((list) => list.map((row) => row.date.slice(5, 10)));
    assert.deepEqual(days(semanticSourcePeriods(read, filter)), [['10-01'], ['09-13', '09-30']]);
    assert.deepEqual(days(semanticSourcePeriods(read, { ...filter, previousCutoff: '2026-09-01T00:00:00.000Z', previousEnd: '2026-09-20T00:00:00.000Z' })), [['10-01'], ['09-12', '09-13']]);
    assert.equal(rows[0].score, 70);
    assert.equal(rows[1].score, null);
    assert.deepEqual(rows[1].sources, []);
    assert.deepEqual((await semanticSourceRows('p','owner',{ ...filter, engine: 'claude,google_ai_mode' },new URLSearchParams())).map((row) => row.id), ['s2','s3']);
    const before = queries;
    assert.deepEqual(await semanticSourceRows('p','owner',filter,new URLSearchParams('origin=prompts')), []);
    assert.deepEqual(await semanticSourceRows('p','owner',filter,new URLSearchParams('topic=pricing')), []);
    assert.equal(queries, before);
    await assert.rejects(semanticSourceRows('p','owner',filter,new URLSearchParams('origin=unknown')), /origin/);
  } finally { sql.close(); delete globalThis.semanticSourcesDb; }
});
