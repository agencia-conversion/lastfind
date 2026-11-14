import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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
      globalThis.decisionFixture?.beforeBatch?.();
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
  './env': 'export const db=()=>globalThis.decisionFixture.db;export const now=()=>new Date().toISOString();export const appOrigin=()=>"";export const workerVersion=()=>undefined;export const setting=(name)=>globalThis.decisionFixture.settings?.[name]??"";',
  './decisions-api': 'export const postDecisions=async(payload)=>globalThis.decisionFixture.decisions(payload);',
  './http': `export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
export function textField(value,label,min=1,max=100){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw new ApiError(400,label+': use entre '+min+' e '+max+' caracteres.');return value.trim();}`,
  './workspace': `export async function ownedProject(id,owner){const p=await globalThis.decisionFixture.db.prepare('SELECT * FROM projects WHERE id=? AND workspace_id=? AND archived=0').bind(id,owner).first();if(!p){const e=new Error('Projeto não encontrado.');e.status=404;throw e;}return p;}
export function projectFromRow(p){return{id:String(p.id),name:String(p.name),domain:String(p.domain),aliases:JSON.parse(String(p.aliases_json||'[]')),additional_domains:JSON.parse(String(p.additional_domains_json||'[]')),competitors:JSON.parse(String(p.competitors_json)),location_code:Number(p.location_code),language_code:String(p.language_code),category:'',audience:''};}`,
  './competitor-analysis': `export const syncCountedBrands=async()=>{};export const COMPETITOR_ANALYSIS_DAYS=90;
export const competitorAnalysisStatus=async()=>{if(globalThis.decisionFixture.broken)throw new Error('busy');return {previous:globalThis.decisionFixture.previous,status:globalThis.decisionFixture.status??'complete',processed:2705,total:2705,truncated:false,needsEnsure:false,publicationPending:false,error:null,suggestions:globalThis.decisionFixture.live??globalThis.decisionFixture.suggestions};};
export const ensureCompetitorAnalysis=async()=>{await globalThis.decisionFixture.hold;globalThis.decisionFixture.analysisRuns++;};`,
  // The work after a decision's answer runs at once here (the Worker keeps it alive past the response).
  'cloudflare:workers': 'export const waitUntil=(promise)=>{(globalThis.decisionFixture.pending??=[]).push(promise);};',
  './project-store-read': 'export const projectReadDatabase=async()=>globalThis.decisionFixture.db;export const storedCopy=async()=>({value:null,storedAt:0,keep(){}});',
};
const bundle = await build({
  absWorkingDir: root,
  entryPoints: [root + 'packages/core/lib/server/brand-decisions.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'fixtures',
      setup(plugin) {
        plugin.onResolve({ filter: /^(\.\/(env|http|workspace|competitor-analysis|project-store-read|decisions-api)|cloudflare:workers)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
        plugin.onResolve({ filter: /^@\// }, (args) => ({
          path: root + 'packages/core/' + args.path.slice(2) + (args.path.endsWith('.mjs') ? '' : '.ts'),
        }));
      },
    },
  ],
});
const server = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
const validation = await import(
  `data:text/javascript;base64,${Buffer.from(
    (
      await build({
        absWorkingDir: root,
        entryPoints: [root + 'packages/core/lib/server/validation.ts'],
        bundle: true,
        platform: 'node',
        format: 'esm',
        write: false,
        plugins: [
          {
            name: 'fixtures',
            setup(plugin) {
              plugin.onResolve({ filter: /^\.\/http$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
              plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
              plugin.onResolve({ filter: /^@\// }, (args) => ({ path: root + 'packages/core/' + args.path.slice(2) + (args.path.endsWith('.mjs') ? '' : '.ts') }));
            },
          },
        ],
      })
    ).outputFiles[0].contents,
  ).toString('base64')}`
);

const user = { id: 'owner', email: 'owner@test.example', name: 'Owner' };
const suggestion = (name, answerCount, domain = null) => ({
  name,
  domain,
  score: 0.9,
  answerCount,
  evidence: [{ runId: `run-${name}`, excerpt: `${name} excerpt`, createdAt: '2026-10-16T00:00:00.000Z' }],
});
function setup(edition) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = root + `apps/${edition}/drizzle/`;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(dir + name, 'utf8'));
  sqlite.exec('ALTER TABLE runs ADD COLUMN answer TEXT; ALTER TABLE runs ADD COLUMN response_available INTEGER DEFAULT 1;');
  const stamp = new Date().toISOString();
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('owner','owner@test.example','Owner',?),('other','other@test.example','Other',?)").run(stamp, stamp);
  sqlite
    .prepare(
      "INSERT INTO projects(id,workspace_id,name,domain,competitors_json,language_code,location_code,daily_enabled,created_at) VALUES('project','owner','Netflix','netflix.com',?,'en',2840,0,?)",
    )
    .run(JSON.stringify([{ name: 'Hulu', domain: 'hulu.com' }]), stamp);
  sqlite.prepare("INSERT INTO prompts(id,unit_id,project_id,text,engine,next_run_at,created_at) VALUES('p','p','project','Best streaming?','chat_gpt',?,?)").run(stamp, stamp);
  const answers = [
    'Paramount+ and Paramount Plus are both great.',
    'Paramount+ has Star Trek.',
    'Try Paramount Plus for sports.',
    'Tubi is free.',
  ];
  answers.forEach((answer, index) =>
    sqlite
      .prepare(
        `INSERT INTO runs(id,workspace_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,status,callback_token,cost,created_at,budget_credits,answer,response_available)
         VALUES(?,'owner','project','p',?,'Best streaming?','chat_gpt','[]',2840,'en','complete','fixture',0,?,0,?,1)`,
      )
      .run(`run-${index}`, `key-${index}`, stamp, answer),
  );
  globalThis.decisionFixture = {
    db: d1(sqlite),
    analysisRuns: 0,
    suggestions: [
      suggestion('Roku', 40),
      suggestion('Tubi', 368, 'tubitv.com'),
      suggestion('Paramount+', 335),
      suggestion('Paramount Plus', 8),
    ],
  };
  return sqlite;
}
const project = (sqlite) => sqlite.prepare("SELECT * FROM projects WHERE id='project'").get();
const competitors = (sqlite) => JSON.parse(project(sqlite).competitors_json);
/** A decision and the work that follows its answer. */
const decide = async (input) => {
  const result = await server.decideBrand('project', user, input);
  await Promise.all(globalThis.decisionFixture.pending?.splice(0) ?? []);
  return result;
};
const overview = () => server.brandsOverview('project', 'owner', { fresh: true });

for (const edition of ['selfhost', 'cloud'].filter((name) => existsSync(root + `apps/${name}/drizzle`)))
  test(`brand decisions: project-scoped events, derivation and undo (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      let view = await overview();
      assert.deepEqual(view.rows.map((row) => row.name), ['Tubi', 'Paramount+', 'Roku', 'Paramount Plus']);
      assert.ok(view.rows.every((row) => row.status === 'discovered'));
      // The list carries run ids only; one brand's excerpts come on their own, for its side panel.
      assert.ok(view.rows.every((row) => row.evidence.length && row.evidence.every((item) => item.runId && item.excerpt === '')));
      assert.deepEqual((await server.brandEvidence('project', 'owner', 'tubi')).evidence.map((item) => item.excerpt), ['Tubi excerpt']);

      // Reject a discovery: recorded, hash of the evidence kept, reports untouched.
      const revision = Number(project(sqlite).competitor_targets_revision);
      const rejected = await decide({ action: 'reject', name: 'Roku', responses: 40, sense: 'device maker', evidence: ['run-0'] });
      assert.equal(rejected.changed, false);
      assert.equal(Number(project(sqlite).competitor_targets_revision), revision);
      const stored = sqlite.prepare("SELECT * FROM brand_decision_events WHERE kind='reject'").get();
      assert.equal(stored.author, 'owner@test.example');
      const payload = JSON.parse(stored.payload_json);
      assert.equal(payload.evidence[0].sha256, createHash('sha256').update('Paramount+ and Paramount Plus are both great.').digest('hex'));
      view = await overview();
      assert.equal(view.rows.find((row) => row.name === 'Roku').status, 'rejected');
      assert.equal(view.undoable.kind, 'reject');
      assert.equal((await server.withoutDecided('project', globalThis.decisionFixture.suggestions)).some((row) => row.name === 'Roku'), false);

      // Reopen = undo; a second undo of the same decision is refused.
      await decide({ action: 'undo', eventId: view.undoable.id });
      assert.equal((await overview()).rows.find((row) => row.name === 'Roku').status, 'discovered');
      await assert.rejects(decide({ action: 'undo', eventId: view.undoable.id }), /already undone/);
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM brand_decision_events').get().n, 2);

      // Merge a discovery into another one: answers mentioning both count once.
      await decide({ action: 'alias', name: 'Paramount Plus', into: 'Paramount+', responses: 8 });
      view = await overview();
      const paramount = view.rows.find((row) => row.name === 'Paramount+');
      assert.deepEqual(paramount.aliases, ['Paramount Plus']);
      assert.equal(view.rows.some((row) => row.name === 'Paramount Plus'), false);
      assert.equal(paramount.responses, 335 + 8 - 1);
      await decide({ action: 'undo', eventId: (await overview()).undoable.id });
      assert.ok((await overview()).rows.some((row) => row.name === 'Paramount Plus'));

      // Confirm: becomes a monitored competitor in the same project, revision bumped, analysis restarted.
      const before = Number(project(sqlite).competitor_targets_revision);
      await assert.rejects(decide({ action: 'confirm', name: 'Paramount+' }), /Enter a domain/);
      const runs = globalThis.decisionFixture.analysisRuns;
      await decide({ action: 'confirm', name: 'Tubi', domain: 'https://www.tubitv.com/' });
      assert.deepEqual(competitors(sqlite).map((row) => row.name), ['Hulu', 'Tubi']);
      assert.equal(competitors(sqlite)[1].domain, 'tubitv.com');
      assert.equal(Number(project(sqlite).competitor_targets_revision), before + 1);
      assert.equal(globalThis.decisionFixture.analysisRuns, runs + 1);
      assert.equal((await overview()).rows.some((row) => row.name === 'Tubi'), false);
      await assert.rejects(decide({ action: 'confirm', name: 'Tubi', domain: 'tubitv.com' }), /already monitored/);

      // The answer is the write: the analysis it restarts follows (a busy store no longer holds the click).
      let release;
      globalThis.decisionFixture.hold = new Promise((resolve) => (release = resolve));
      const held = await server.decideBrand('project', user, { action: 'undo', eventId: (await overview()).undoable.id });
      assert.equal(held.changed, true);
      assert.equal(globalThis.decisionFixture.analysisRuns, runs + 1, 'the analysis starts after the answer');
      release();
      await Promise.all(globalThis.decisionFixture.pending.splice(0));
      globalThis.decisionFixture.hold = undefined;
      assert.equal(globalThis.decisionFixture.analysisRuns, runs + 2);
      await decide({ action: 'confirm', name: 'Tubi', domain: 'https://www.tubitv.com/' });

      // While the analysis restarts its list is empty: the list reviewed before is shown, marked as updating.
      globalThis.decisionFixture.status = 'running';
      globalThis.decisionFixture.live = [];
      const updating = await overview();
      assert.equal(updating.analysis.stale, true);
      assert.ok(updating.rows.some((row) => row.name === 'Roku'));
      // The store serves the last complete list itself while the pass runs.
      globalThis.decisionFixture.previous = { suggestions: [suggestion('Pluto TV', 12)], analyzed: 2705 };
      const served = await overview();
      assert.ok(served.rows.some((row) => row.name === 'Pluto TV'));
      assert.equal(served.analysis.analyzed, 2705);
      globalThis.decisionFixture.previous = undefined;
      globalThis.decisionFixture.status = 'complete';
      globalThis.decisionFixture.live = undefined;
      assert.equal((await overview()).analysis.stale, false);

      // A busy project store never hides the decisions.
      globalThis.decisionFixture.broken = true;
      const busy = await overview();
      assert.equal(busy.analysis.unavailable, true);
      assert.ok(busy.rows.some((row) => row.name === 'Roku'));
      assert.equal(busy.undoable.kind, 'confirm');
      globalThis.decisionFixture.broken = false;

      // Merging a discovery into a monitored brand adds the name to the tracked aliases (kept by settings saves).
      await decide({ action: 'alias', name: 'Paramount Plus', into: 'Tubi' });
      assert.deepEqual(competitors(sqlite)[1].aliases, ['Paramount Plus']);
      const saved = validation.projectInput({ ...project(sqlite), aliases: [], additional_domains: [], competitors: competitors(sqlite) });
      assert.deepEqual(saved.competitors[1].aliases, ['Paramount Plus']);
      await decide({ action: 'undo', eventId: (await overview()).undoable.id });
      assert.equal(competitors(sqlite)[1].aliases?.length ?? 0, 0);

      // Correct a domain and rename a monitored brand; both are reversible.
      await decide({ action: 'domain', name: 'Tubi', domain: 'tubi.tv' });
      assert.equal(competitors(sqlite)[1].domain, 'tubi.tv');
      await decide({ action: 'rename', name: 'Tubi', displayName: 'Tubi TV' });
      assert.deepEqual([competitors(sqlite)[1].name, competitors(sqlite)[1].aliases], ['Tubi TV', ['Tubi']]);
      await decide({ action: 'undo', eventId: (await overview()).undoable.id });
      assert.equal(competitors(sqlite)[1].name, 'Tubi');
      await decide({ action: 'undo', eventId: (await overview()).undoable.id });
      assert.equal(competitors(sqlite)[1].domain, 'tubitv.com');

      // Rejecting a monitored brand removes it from the reports; undo brings it back.
      await decide({ action: 'reject', name: 'Hulu', responses: 12 });
      assert.deepEqual(competitors(sqlite).map((row) => row.name), ['Tubi']);
      assert.equal((await overview()).rows.find((row) => row.name === 'Hulu').responses, 12);
      await decide({ action: 'undo', eventId: (await overview()).undoable.id });
      assert.deepEqual(competitors(sqlite).map((row) => row.name).sort(), ['Hulu', 'Tubi']);

      // The brand itself is not reviewable; ownership is enforced; the log is append-only.
      await assert.rejects(decide({ action: 'reject', name: 'Netflix' }), /own brand/);
      await assert.rejects(server.decideBrand('project', { ...user, id: 'other' }, { action: 'reject', name: 'Roku' }), /não encontrado/);
      assert.throws(() => sqlite.exec("UPDATE brand_decision_events SET author='x'"), /append-only/);
      assert.throws(() => sqlite.exec('DELETE FROM brand_decision_events'), /append-only/);
      assert.throws(
        () => sqlite.exec("INSERT INTO brand_decision_events(id,workspace_id,project_id,seq,kind,brand_key,payload_json,author,created_at) VALUES('x','owner','project',999,'undo','k','{}','a','t')"),
        /CHECK/,
      );

      // The limit is one constant; the competitor list never exceeds it.
      sqlite
        .prepare("UPDATE projects SET competitors_json=?")
        .run(JSON.stringify(Array.from({ length: 10 }, (_, index) => ({ name: `Brand ${index}`, domain: `brand${index}.com` }))));
      await assert.rejects(decide({ action: 'confirm', name: 'Roku', domain: 'roku.com' }), /limit reached/);
    } finally {
      sqlite.close();
      delete globalThis.decisionFixture;
    }
  });

for (const edition of ['selfhost', 'cloud'].filter((name) => existsSync(root + `apps/${name}/drizzle`))) {
  test(`brand decisions: a concurrent save never leaves a confirmed event without the change (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      // Another save lands between our read and our write: it moves the revision to the one we expect to write.
      globalThis.decisionFixture.beforeBatch = () => {
        globalThis.decisionFixture.beforeBatch = undefined;
        sqlite
          .prepare("UPDATE projects SET competitors_json=?,competitor_targets_revision=competitor_targets_revision+1")
          .run(JSON.stringify([{ name: 'Hulu', domain: 'hulu.com' }, { name: 'Max', domain: 'max.com' }]));
      };
      await assert.rejects(decide({ action: 'confirm', name: 'Tubi', domain: 'tubitv.com' }), /list changed/);
      assert.deepEqual(competitors(sqlite).map((row) => row.name), ['Hulu', 'Max']);
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM brand_decision_events').get().n, 0);
      // Same revision, nothing else wrote: the decision goes through.
      await decide({ action: 'confirm', name: 'Tubi', domain: 'tubitv.com' });
      assert.deepEqual(competitors(sqlite).map((row) => row.name), ['Hulu', 'Max', 'Tubi']);
      assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM brand_decision_events').get().n, 1);
    } finally {
      sqlite.close();
      delete globalThis.decisionFixture;
    }
  });

  test(`brand decisions: an undo that would change nothing is refused (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      const events = () => sqlite.prepare('SELECT COUNT(*) n FROM brand_decision_events').get().n;
      // Undo "merge A into B" after B was renamed.
      await decide({ action: 'confirm', name: 'Tubi', domain: 'tubitv.com' });
      await decide({ action: 'alias', name: 'Paramount Plus', into: 'Tubi' });
      const merge = (await overview()).undoable.id;
      await decide({ action: 'rename', name: 'Tubi', displayName: 'Tubi TV' });
      const before = events();
      await assert.rejects(decide({ action: 'undo', eventId: merge }), /no longer be undone/);
      assert.equal(events(), before);
      assert.deepEqual(competitors(sqlite)[1].aliases, ['Paramount Plus', 'Tubi']);
      // Reopen "Hulu" after another brand took its domain.
      await decide({ action: 'reject', name: 'Hulu', responses: 5 });
      const reject = (await overview()).undoable.id;
      await decide({ action: 'confirm', name: 'Roku', domain: 'hulu.com' });
      const after = events();
      await assert.rejects(decide({ action: 'undo', eventId: reject }), /no longer be undone/);
      assert.equal(events(), after);
      assert.equal((await overview()).rows.find((row) => row.name === 'Hulu').status, 'rejected');
      // A decision that never touched the list (reject of a discovery) can still be reopened.
      await decide({ action: 'reject', name: 'Paramount+', responses: 335 });
      await decide({ action: 'undo', eventId: (await overview()).undoable.id });
    } finally {
      sqlite.close();
      delete globalThis.decisionFixture;
    }
  });

  test(`brand decisions: renamed discoveries keep the original name and aliases never pass the limit (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      await decide({ action: 'rename', name: 'Roku', key: 'roku', displayName: 'Roku TV' });
      await decide({ action: 'confirm', name: 'Roku TV', key: 'roku', domain: 'roku.com' });
      const roku = competitors(sqlite).find((row) => row.domain === 'roku.com');
      assert.equal(roku.name, 'Roku TV');
      assert.deepEqual(roku.aliases, ['Roku']);
      await decide({ action: 'undo', eventId: (await overview()).undoable.id });
      assert.equal(competitors(sqlite).some((row) => row.domain === 'roku.com'), false);

      sqlite
        .prepare('UPDATE projects SET competitors_json=?')
        .run(JSON.stringify([{ name: 'Tubi', domain: 'tubitv.com', aliases: Array.from({ length: 10 }, (_, index) => `Tubi alt ${index}`) }]));
      const events = () => sqlite.prepare('SELECT COUNT(*) n FROM brand_decision_events').get().n;
      const count = events();
      await assert.rejects(decide({ action: 'alias', name: 'Paramount Plus', into: 'Tubi' }), /10 name variations/);
      await assert.rejects(decide({ action: 'rename', name: 'Tubi', displayName: 'Tubi TV' }), /10 name variations/);
      assert.equal(events(), count);
      assert.equal(competitors(sqlite)[0].aliases.length, 10);
    } finally {
      sqlite.close();
      delete globalThis.decisionFixture;
    }
  });
}

for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(root + `apps/${name}/drizzle`)))
  test(`contained discovery names keep the union of saved answers (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      const answers = ['Rakuten Viki has dramas.', 'Viki alone.', 'Rakuten Viki and Viki.', 'Vikings is a TV show, not this brand.'];
      for (const [index, answer] of answers.entries())
        sqlite.prepare('UPDATE runs SET answer=? WHERE id=?').run(answer, `run-${index}`);
      globalThis.decisionFixture.suggestions = [suggestion('Rakuten Viki', 2), suggestion('Viki', 2)];
      const before = await overview();
      assert.equal(before.rows.find(row => row.name === 'Rakuten Viki').responses, 2);
      await decide({ action: 'alias', name: 'Viki', into: 'Rakuten Viki', responses: 2 });
      const after = await overview();
      assert.equal(after.rows.length, 1);
      assert.equal(after.rows[0].responses, 3);
      assert.deepEqual(after.rows[0].aliases, ['Viki']);
      assert.deepEqual(competitors(sqlite), [{name: 'Hulu', domain: 'hulu.com'}]);
      await decide({ action: 'undo', eventId: after.undoable.id });
      assert.deepEqual((await overview()).rows.map(row => row.responses), [2, 2]);
      // More than one read page, with no separate short name in the added answers.
      const columns = sqlite.prepare('PRAGMA table_info(runs)').all().map(row => row.name);
      const base = sqlite.prepare("SELECT * FROM runs WHERE id='run-0'").get();
      const insert = sqlite.prepare(`INSERT INTO runs(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
      for (let i = 0; i < 30; i++)
        insert.run(...columns.map(column => column === 'id' ? `extra-${i}` : column === 'request_key' ? `extra-key-${i}` : base[column]));
      globalThis.decisionFixture.suggestions = [suggestion('Rakuten Viki', 32), suggestion('Viki', 2)];
      await decide({ action: 'alias', name: 'Viki', into: 'Rakuten Viki', responses: 2 });
      assert.equal((await overview()).rows[0].responses, 33);

    } finally {
      sqlite.close();
      delete globalThis.decisionFixture;
    }
  });

// What the decision model said each discovered name is to the project is only read here: it is asked by the
// analysis job (brand-role-jobs.test.mjs), never while a page loads (fixtures only: no paid call).
const keep = (sqlite, name, role, model = 'liquid/d1-ultra') =>
  sqlite
    .prepare('INSERT INTO brand_role_decisions(project_id,brand_key,model,role,cost_usd,decided_at) VALUES(?,?,?,?,?,?)')
    .run('project', name.toLowerCase(), model, role, 0.0001, new Date().toISOString());
for (const edition of ['selfhost', 'cloud'].filter((name) => existsSync(root + `apps/${name}/drizzle`)))
  test(`brand roles: a page load reads the kept answers and never calls the model (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      const calls = [];
      globalThis.decisionFixture.settings = { OPENROUTER_API_KEY: 'fixture' };
      globalThis.decisionFixture.suggestions = [suggestion('Roku', 40), suggestion('Adobe', 30), suggestion('Tubi', 20), suggestion('Vimeo', 5), suggestion('Canva', 3)];
      globalThis.decisionFixture.decisions = async (payload) => {
        calls.push(payload);
        throw new Error('a page load must not call the provider');
      };
      // Nothing answered yet: every name waits in review, out of the ranking, with the reason.
      let view = await overview();
      assert.equal(calls.length, 0);
      assert.ok(view.rows.every((row) => row.review && row.role === 'competitor'));
      assert.ok(view.rows.every((row) => row.reasons.some((reason) => /decision model has not settled/i.test(reason))));
      // Answers kept by the job: a competitor leaves review, other roles stay in it with that role, "ambiguous" settles nothing.
      keep(sqlite, 'Roku', 'competitor');
      keep(sqlite, 'Adobe', 'client');
      keep(sqlite, 'Tubi', 'ambiguous');
      keep(sqlite, 'Vimeo', 'partner');
      keep(sqlite, 'Canva', 'supplier', 'another/model');
      view = await overview();
      const row = (name) => view.rows.find((item) => item.name === name);
      assert.deepEqual([row('Roku').role, row('Roku').review], ['competitor', false]);
      assert.deepEqual([row('Adobe').role, row('Adobe').review], ['client', true]);
      assert.deepEqual([row('Vimeo').role, row('Vimeo').review], ['partner', true]);
      assert.deepEqual([row('Tubi').role, row('Tubi').review], ['competitor', true]);
      // An answer of a model that is no longer the configured one does not count.
      assert.deepEqual([row('Canva').role, row('Canva').review], ['competitor', true]);
      assert.equal(calls.length, 0);
    } finally {
      sqlite.close();
      delete globalThis.decisionFixture;
    }
  });

test('brand roles: without a key the textual clue stands; with a key a name nobody has answered yet waits in review', async () => {
  const sqlite = setup('selfhost');
  try {
    globalThis.decisionFixture.suggestions = [{ ...suggestion('Adobe', 30), role: 'client', ambiguous: true }, suggestion('Roku', 40)];
    // No OPENROUTER_API_KEY (the independent edition's default): no model can answer, so the detector's own conclusion stands.
    let view = await overview();
    assert.deepEqual(view.rows.map((row) => [row.name, row.role, row.review]).sort(), [['Adobe', 'client', true], ['Roku', 'competitor', false]]);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM brand_role_decisions').get().n, 0);
    // A key is configured but the job has not answered (or it failed): nothing is trusted as a competitor yet.
    globalThis.decisionFixture.settings = { OPENROUTER_API_KEY: 'fixture' };
    view = await overview();
    assert.deepEqual(view.rows.map((row) => [row.name, row.role, row.review]).sort(), [['Adobe', 'client', true], ['Roku', 'competitor', true]]);
  } finally {
    sqlite.close();
    delete globalThis.decisionFixture;
  }
});

for (const edition of ['selfhost', 'cloud'].filter((name) => existsSync(root + `apps/${name}/drizzle`)))
  test(`brands list: a finished analysis paints from the last list, marked; fresh and decisions read it now (${edition})`, async () => {
    const sqlite = setup(edition);
    try {
      let batches = 0;
      globalThis.decisionFixture.beforeBatch = () => batches++;
      const first = await overview();
      assert.equal(first.cachedAt, undefined, 'a list read now carries no mark');
      const read = batches;
      const kept = await server.brandsOverview('project', 'owner');
      assert.ok(kept.cachedAt, 'the last list says it is one');
      assert.equal(batches, read, 'and costs only the ownership read, outside any batch');
      assert.deepEqual(kept.rows.map((row) => row.name), first.rows.map((row) => row.name));
      // A decision forgets the copy: the next plain read is the list as it is now.
      await decide({ action: 'reject', name: 'Roku', responses: 40, sense: 'device maker', evidence: ['run-0'] });
      const after = await server.brandsOverview('project', 'owner');
      assert.equal(after.cachedAt, undefined);
      assert.equal(after.rows.find((row) => row.name === 'Roku').status, 'rejected');
      // A running analysis is never kept: each read is a new one.
      globalThis.decisionFixture.status = 'running';
      await overview();
      assert.equal((await server.brandsOverview('project', 'owner')).cachedAt, undefined);
      // Another owner never reads this owner's copy.
      await assert.rejects(server.brandsOverview('project', 'other'), /não encontrado|not found/i);
      // A project transferred (or archived) after the copy was kept: the former owner's copy is refused, as a full read is.
      globalThis.decisionFixture.status = 'complete';
      await overview();
      assert.ok((await server.brandsOverview('project', 'owner')).cachedAt);
      sqlite.prepare("UPDATE projects SET workspace_id='other' WHERE id='project'").run();
      await assert.rejects(server.brandsOverview('project', 'owner'), (error) => error.status === 404);
      sqlite.prepare("UPDATE projects SET workspace_id='owner' WHERE id='project'").run();
      sqlite.prepare("UPDATE projects SET archived=1 WHERE id='project'").run();
      await assert.rejects(server.brandsOverview('project', 'owner'), (error) => error.status === 404);
    } finally {
      sqlite.close();
      delete globalThis.decisionFixture;
    }
  });

test('a discovery that holds a monitored name whole, or is held by one, may be that brand: the person decides', () => {
  const competitors = [{ name: 'Prime Video', domain: 'primevideo.com', aliases: [] }, { name: 'Max', domain: 'max.com', aliases: ['HBO Max'] }];
  assert.equal(server.sameBrandHint('Amazon Prime Video', competitors), 'Prime Video');
  assert.equal(server.sameBrandHint('Prime Video Channels', competitors), 'Prime Video');
  // Through an alias, and the other way round (the monitored name holds the discovery's).
  assert.equal(server.sameBrandHint('HBO Max Brasil', competitors), 'Max');
  assert.equal(server.sameBrandHint('Prime', competitors), 'Prime Video');
  // Sharing a word is not holding a whole name; inside another word is not either; the same name is the brand itself.
  assert.equal(server.sameBrandHint('Amazon Prime', competitors), null);
  assert.equal(server.sameBrandHint('Maxwell', competitors), null);
  assert.equal(server.sameBrandHint('Prime Video', competitors), null);
});
