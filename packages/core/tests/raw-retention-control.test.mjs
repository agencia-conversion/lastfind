// Data retention outside the project store (lib/server/retention.ts), on each edition's real migrations: the raw archive, the
// excerpts the decision models read and Semantic Branding's raw answers go only for a project with a retention, only before
// its cutoff and only that project's; a dry run counts exactly what the batches remove, and changes nothing. Existing projects
// keep everything after the migration; a new one takes 90 days.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const NOW = Date.parse('2026-11-11T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (days) => new Date(NOW - days * DAY).toISOString();

function d1(sqlite) {
  const prepare = (sql, params = []) => ({
    sql,
    params,
    bind: (...values) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
  });
  return {
    prepare,
    batch: async (statements) =>
      statements.map(({ sql, params }) =>
        /^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) } : { meta: { changes: sqlite.prepare(sql).run(...params).changes } },
      ),
  };
}

const fakes = {
  env: "export const db=()=>globalThis.retention.db; export const now=()=>globalThis.retention.now;",
  'project-store': "export async function getProjectStore(projectId){return {initialized:1,generation:'g-'+projectId};}",
  'project-store-transport': 'export const projectStoreRpc=async(message)=>globalThis.retention.rpc(message);',
  'raw-responses': 'export const rawResponsesBucket=()=>globalThis.retention.bucket;',
};
const bundle = await build({
  entryPoints: [`${root}packages/core/lib/server/retention.ts`],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'retention-fakes',
    setup(plugin) {
      plugin.onResolve({ filter: /^\.\/[a-z-]+$/ }, (args) => (args.path.slice(2) in fakes ? { path: args.path.slice(2), namespace: 'fake' } : undefined));
      plugin.onResolve({ filter: /^@\// }, (args) => ({ path: `${root}packages/core/${args.path.slice(2)}.ts` }));
      plugin.onLoad({ filter: /.*/, namespace: 'fake' }, (args) => ({ contents: fakes[args.path], loader: 'js' }));
    },
  }],
});
const { applyRetention, retentionStep } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(`${root}apps/${name}/drizzle`))) {
  test(`${edition}: retention removes one project's raw data before its cutoff, its dry run counts it, other projects untouched`, async () => {
    const sqlite = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
    const folder = `${root}apps/${edition}/drizzle/`;
    const files = readdirSync(folder).filter((name) => name.endsWith('.sql')).sort();
    const retention = files.findIndex((name) => name.endsWith('_data_retention.sql'));
    assert.ok(retention > 0);
    // A project created before the migration keeps everything; one created after takes 90 days.
    for (const file of files.slice(0, retention)) sqlite.exec(readFileSync(folder + file, 'utf8'));
    const project = (id, owner) =>
      sqlite.prepare(`INSERT INTO projects(id,${sqlite.prepare("SELECT 1 FROM pragma_table_info('projects') WHERE name='workspace_id'").get() ? 'workspace_id' : 'owner_id'},name,domain,competitors_json,location_code,language_code,created_at) VALUES(?,?,?,?,'[]',2840,'en',?)`).run(id, owner, id, `${id}.test`, iso(400));
    project('old', 'owner');
    for (const file of files.slice(retention)) sqlite.exec(readFileSync(folder + file, 'utf8'));
    project('kept', 'owner');
    project('other', 'someone');
    const days = (id) => sqlite.prepare('SELECT raw_retention_days d FROM projects WHERE id=?').get(id).d;
    assert.equal(days('old'), null, 'a project from before the migration keeps everything');
    assert.equal(days('kept'), 90, 'a new project keeps 90 days');
    assert.equal(days('other'), 90);
    sqlite.prepare('UPDATE projects SET raw_retention_days=NULL WHERE id=?').run('other');

    // 200 days of runs, jobs and Semantic Branding queries in each project.
    for (const id of ['old', 'kept', 'other'])
      for (let day = 0; day < 200; day++) {
        const run = `${id}-run-${day}`;
        sqlite
          .prepare(`INSERT INTO runs(id,workspace_id,project_id,prompt_id,prompt_text,engine,targets_json,location_code,language_code,callback_token,status,request_key,created_at,raw_response_status,raw_response_key)
            VALUES(?,?,?,?,'Q','chat_gpt','[]',2840,'en',?,?,?,?,'archived',?)`)
          .run(run, id === 'other' ? 'someone' : 'owner', id, `${id}-prompt`, `t-${run}`, day === 0 ? 'pending' : 'complete', `slot:${day}`, iso(day), `raw/v1/owner/${id}/${run}/abc.json`);
        sqlite
          .prepare(`INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,cost_usd,input_json,result_json,requested_at)
            VALUES(?,?,?,?,'project-sentiment:v1','sha','openrouter','m','completed',0.02,0.01,'{"excerpt":"text"}','{"score":60}',?)`)
          .run(`${id}-job-${day}`, 'owner', id, `input-${day}`, iso(day));
        sqlite.prepare("INSERT INTO semantic_panel_rounds(id,workspace_id,project_id,day,frequency,period_start,config_revision,language_code,location_code,roster_json,status,created_at) VALUES(?,?,?,?,'daily',?,1,'en',2840,'[]','done',?)")
          .run(`${id}-round-${day}`, 'owner', id, iso(day).slice(0, 10), iso(day).slice(0, 10), iso(day));
        sqlite.prepare("INSERT INTO semantic_panel_queries(id,round_id,workspace_id,project_id,engine,method,model,question,status,reserved_usd,requested_at,response,input_json) VALUES(?,?,?,?,'chat_gpt','scrape','m','Q','completed',0.02,?,'raw answer','{\"q\":1}')")
          .run(`${id}-query-${day}`, `${id}-round-${day}`, 'owner', id, iso(day));
      }
    sqlite.prepare("UPDATE projects SET raw_retention_days=90 WHERE id='old'").run();
    sqlite.prepare("UPDATE projects SET raw_retention_days=180 WHERE id='kept'").run();
    const snapshot = (id) => ({
      runs: sqlite.prepare('SELECT id,raw_purged_at,status,raw_response_key FROM runs WHERE project_id=? ORDER BY id').all(id),
      jobs: sqlite.prepare('SELECT id,input_json,result_json,cost_usd FROM brand_research_jobs WHERE project_id=? ORDER BY id').all(id),
      panel: sqlite.prepare('SELECT id,response,input_json FROM semantic_panel_queries WHERE project_id=? ORDER BY id').all(id),
    });
    const other = snapshot('other');
    const before = { old: snapshot('old'), kept: snapshot('kept') };
    const deleted = [];
    const store = [];
    globalThis.retention = {
      db: d1(sqlite),
      now: new Date(NOW).toISOString(),
      bucket: { delete: async (keys) => deleted.push(...keys) },
      rpc: async (message) => {
        store.push(message);
        return message.dryRun ? { answers: 7, before: message.before } : { answers: 0, more: false, before: message.before };
      },
    };
    try {
      const dry = await applyRetention({ projectId: null, dryRun: true });
      const counts = Object.fromEntries(dry.projects.map((item) => [item.projectId, item]));
      assert.deepEqual(Object.keys(counts).sort(), ['kept', 'old'], 'only projects with a retention');
      // Strictly before the cutoff: days 91..199 (90 days), days 181..199 (180 days).
      assert.deepEqual([counts.old.rawResponses, counts.old.jobInputs, counts.old.panelAnswers, counts.old.answers], [109, 109, 109, 7]);
      assert.deepEqual([counts.kept.rawResponses, counts.kept.jobInputs, counts.kept.panelAnswers], [19, 19, 19]);
      assert.deepEqual(snapshot('old'), before.old, 'a dry run changes nothing');
      assert.deepEqual(deleted, []);
      assert.ok(store.every((message) => message.dryRun && message.scope.projectId !== 'other'));

      let removed = 0;
      for (let more = true, round = 0; more; round++) {
        assert.ok(round < 10);
        const batch = await applyRetention({ projectId: 'old', dryRun: false, limit: 50 });
        removed += batch.projects[0].rawResponses;
        more = batch.projects[0].more;
      }
      assert.equal(removed, counts.old.rawResponses, 'the batches remove what the dry run counted');
      assert.equal(deleted.length, 109);
      assert.ok(deleted.every((key) => key.includes('/old/')), 'only this project\'s archive');
      const after = snapshot('old');
      const cutoff = iso(90);
      for (const run of after.runs) {
        const day = Number(run.id.split('-').at(-1));
        assert.equal(run.raw_purged_at !== null, iso(day) < cutoff, `run of day ${day}`);
        assert.equal(run.raw_response_key, `raw/v1/owner/old/${run.id}/abc.json`, 'the run keeps every other column');
      }
      for (const job of after.jobs) {
        const day = Number(job.id.split('-').at(-1));
        assert.equal(job.input_json === '{}', day > 90, `job of day ${day}`);
        assert.equal(job.result_json, '{"score":60}', 'the reading stays');
        assert.equal(job.cost_usd, 0.01, 'the cost stays');
      }
      for (const query of after.panel) assert.equal(query.response === null, Number(query.id.split('-').at(-1)) > 90);
      assert.deepEqual(snapshot('other'), other, 'a project without retention is untouched');
      assert.deepEqual(snapshot('kept'), before.kept, 'another project with a retention is untouched by this one\'s run');
      assert.deepEqual((await applyRetention({ projectId: 'old', dryRun: true })).projects[0].rawResponses, 0);

      // The scheduler: at most once an hour, every project with a retention.
      store.length = 0;
      assert.deepEqual(await retentionStep(NOW), { projects: 2 });
      assert.deepEqual(await retentionStep(NOW + 60_000), { skipped: true });
      assert.ok(store.every((message) => message.scope.projectId !== 'other'));
      assert.equal(snapshot('kept').runs.filter((run) => run.raw_purged_at).length, 19);
      assert.deepEqual(snapshot('other'), other);
    } finally {
      delete globalThis.retention;
      sqlite.close();
    }
  });
}
