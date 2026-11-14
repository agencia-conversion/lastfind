import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The workspace opens every screen: its D1 reads are one batch, the calendar month's usage included (a paid period, known
// from the account, is counted after it).
const root = fileURLToPath(new URL('../../../', import.meta.url));
const stubs = {
  './env': 'export const db=()=>globalThis.workspaceFixture.db;export const setting=()=>"";',
  './capabilities': `export const usageWindow=async()=>({periodStart:globalThis.workspaceFixture.period??new Date().toISOString().slice(0,7)+'-01T00:00:00.000Z',creditsLimit:null,limit:1500});
export const accountCapabilities=async()=>({engines:['chat_gpt'],promptLimit:null,topicLimit:null});export const providerSettings=true;export const collectNewPromptsImmediately=true;export const projectCreationCondition=()=>({sql:'1=1',params:[]});`,
  './project-reads': `export const foundProject=(row)=>row;export const ownedProjectStatement=()=>null;`,
  './auth': 'export const workspaceChoices=async(actor)=>globalThis.workspaceFixture.choices?.(actor);export const newWorkspaceGate=()=>({allowed:true});',
};
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents: "export * from './packages/core/lib/server/workspace.ts';export * from './packages/core/lib/server/workspace-read.ts';",
    resolveDir: root,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'fixtures',
    setup(plugin) {
      plugin.onResolve({ filter: /^\.\/(env|capabilities|project-reads|auth)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
      plugin.onResolve({ filter: /^@\// }, (args) => ({ path: root + 'packages/core/' + args.path.slice(2) + (/\.\w+$/.test(args.path) ? '' : '.ts') }));
    },
  }],
});
const { workspace, workspaceFor } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('the workspace reads D1 in one batch, plus the month usage; projects are addressed by their slug', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE projects(id TEXT,workspace_id TEXT,name TEXT,display_name TEXT,domain TEXT,competitors_json TEXT,location_code INTEGER,language_code TEXT,daily_enabled INTEGER,interval_hours INTEGER,created_at TEXT,archived INTEGER DEFAULT 0,aliases_json TEXT,additional_domains_json TEXT,engines_json TEXT,category TEXT,audience TEXT);
    CREATE TABLE prompts(id TEXT,project_id TEXT,unit_id TEXT,text TEXT,engine TEXT,tag TEXT,tags_json TEXT,active INTEGER,archived INTEGER,next_run_at TEXT,created_at TEXT,engines_override_json TEXT,subscribed INTEGER);
    CREATE TABLE topics(id TEXT,project_id TEXT,name TEXT,engines_override_json TEXT);
    CREATE TABLE runs(id TEXT,workspace_id TEXT,project_id TEXT,status TEXT,created_at TEXT,completed_at TEXT,cost REAL,budget_credits REAL);
    CREATE TABLE system_state(key TEXT,value TEXT);
    CREATE TABLE project_stores(project_id TEXT,workspace_id TEXT,initialized INTEGER,source_revision INTEGER,applied_revision INTEGER);
    INSERT INTO project_stores VALUES('p2','owner',1,3,2),('p1','owner',1,4,4);
    CREATE TABLE workspaces(id TEXT,time_zone TEXT);
    CREATE TABLE agent_turns(id TEXT,workspace_id TEXT,project_id TEXT,conversation_id TEXT,model TEXT,status TEXT,reserved_usd REAL,cost_usd REAL,started_at TEXT,finished_at TEXT);
    INSERT INTO projects(id,workspace_id,name,domain,competitors_json,location_code,language_code,daily_enabled,interval_hours,created_at,archived) VALUES
      ('p0','owner','Second Brand','old.test','[]',2840,'en',1,24,'2025-01-01',1),
      ('p1','owner','Ágil Lab','agil.test','[]',2840,'en',1,24,'2026-01-01',0),('p2','owner','Second Brand','second.test','[]',2840,'en',1,24,'2026-02-01',0),
      ('p3','owner','second brand','second.com.br','[]',2840,'en',1,24,'2026-03-01',0),('p4','owner','Admin','admin-tool.io','[]',2840,'en',1,24,'2026-04-01',0),
      ('x1','other','Second Brand','second.test','[]',2840,'en',1,24,'2026-05-01',0);
    INSERT INTO prompts VALUES('q1','p2','q1','Best tool?','chat_gpt','Awareness','[]',1,0,NULL,'2026-02-02',NULL,1);
    INSERT INTO topics VALUES('t1','p2','Awareness',NULL),('t0','p1','Speed',NULL);
    INSERT INTO runs VALUES('r1','owner','p2','complete','${new Date().toISOString().slice(0, 7)}-02','${new Date().toISOString().slice(0, 7)}-02',0.01,1),
      ('r0','owner','p2','complete','2000-01-02','2000-01-02',0.01,1);
    INSERT INTO agent_turns VALUES('a1','owner','p2','c','m','done',0.02,0.0024,'${new Date().toISOString().slice(0, 7)}-02',NULL);`);
  const blockedAt = new Date().toISOString();
  sqlite.prepare("INSERT INTO system_state(key,value) VALUES('budget_blocked:p2',?),('budget_blocked:p1',?)").run(JSON.stringify({ reason: 'project_budget', module: 'collection', at: blockedAt }), JSON.stringify({ reason: 'project_budget', module: 'semantic', at: blockedAt }));
  // The older migrations, then the one that names every project again (the same SQL in both editions; Cloud's names the
  // workspaces after it).
  // They predate workspaces of their own (0101): the projects' column is owner_id while they run.
  sqlite.exec('ALTER TABLE projects RENAME COLUMN workspace_id TO owner_id');
  for (const file of ['0048_project_slug.sql', '0054_project_code.sql']) sqlite.exec(readFileSync(root + `apps/selfhost/drizzle/${file}`, 'utf8'));
  const migration = readFileSync(root + 'apps/selfhost/drizzle/0100_project_slugs.sql', 'utf8');
  const cloud = path.join(root, 'apps', 'cloud', 'drizzle');
  if (existsSync(cloud)) assert.ok(readFileSync(path.join(cloud, '0108_workspace_project_slugs.sql'), 'utf8').startsWith(migration));
  sqlite.exec(migration);
  sqlite.exec('ALTER TABLE projects RENAME COLUMN owner_id TO workspace_id');
  const stored = () => Object.fromEntries(sqlite.prepare('SELECT id,slug FROM projects ORDER BY id').all().map((row) => [row.id, row.slug]));
  // From the name, accents folded; a repeat in the workspace takes the next number (active projects first), a reserved word
  // too; another workspace's project keeps its own; the code is gone.
  assert.deepEqual(stored(), { p0: 'second-brand-3', p1: 'agil-lab', p2: 'second-brand', p3: 'second-brand-2', p4: 'admin-2', x1: 'second-brand' });
  assert.equal(sqlite.prepare("SELECT count(*) n FROM pragma_table_info('projects') WHERE name='code'").get().n, 0);
  const calls = [];
  const prepare = (sql, params = []) => ({
    sql, params,
    bind: (...values) => prepare(sql, values),
    first: async () => { calls.push('first'); return sqlite.prepare(sql).get(...params) ?? null; },
    all: async () => { calls.push('all'); return { results: sqlite.prepare(sql).all(...params) }; },
  });
  globalThis.workspaceFixture = { db: { prepare, batch: async (statements) => { calls.push('batch'); return statements.map((s) => ({ results: sqlite.prepare(s.sql).all(...s.params) })); } } };
  const user = { id: 'owner', email: 'o@example.test', name: 'Owner' };
  let data = await workspace(user);
  assert.equal(data.selectedProjectId, 'p1');
  assert.deepEqual(data.topics.map((t) => t.name), ['Speed']);
  assert.deepEqual(data.projects.map((p) => p.slug), ['agil-lab', 'second-brand', 'second-brand-2', 'admin-2']);
  assert.deepEqual(calls, ['batch'], 'every project has its slug: nothing is written');
  // A project without one (written by a script) gets the next free one, once.
  sqlite.exec("UPDATE projects SET slug=NULL WHERE id='p3'");
  calls.length = 0;
  data = await workspace(user);
  assert.equal(data.projects.find((p) => p.id === 'p3').slug, 'second-brand-2');
  assert.deepEqual(calls, ['batch', 'all', 'first']);
  // The slug (the address) or the id (the app's own reads) ride in the first batch, and a rename keeps the slug.
  for (const [selected, rename] of [['second-brand'], ['p2'], ['agil-lab'], ['p1'], ['second-brand', 'Brand Two']]) {
    if (rename) sqlite.prepare("UPDATE projects SET name=? WHERE id='p2'").run(rename);
    calls.length = 0;
    data = await workspace(user, selected);
    const p1 = selected === 'agil-lab' || selected === 'p1';
    assert.equal(data.selectedProjectId, p1 ? 'p1' : 'p2', selected);
    if (!p1) {
      assert.deepEqual(data.prompts.map((p) => p.id), ['q1']);
      assert.deepEqual(data.topics.map((t) => t.name), ['Awareness']);
      assert.equal(data.usage.used, 1);
      // The account's collection credits, 9 for the run (US$ 0.01); the agent's are a balance of their own.
      assert.equal(data.usage.creditsUsed, 9);
      // A limit that stopped the project's collection rides in the same batch, for the Overview.
      assert.deepEqual(data.monitoring.collectionBlocked, { reason: 'project_budget', at: blockedAt });
      // Answers collected but not yet in the project's reports (its store behind), in the same batch.
      assert.equal(data.monitoring.unpublished, true);
      assert.equal(data.projects.find((p) => p.id === 'p2').slug, 'second-brand');
    }
    assert.deepEqual(calls, ['batch'], selected);
  }
  assert.equal(data.projects.find((p) => p.id === 'p2').name, 'Brand Two');
  // An address that names no project (a typo, an archived one, another workspace's) selects none and reads no project's
  // prompts or topics: never the first one.
  for (const selected of ['nowhere', 'p0', 'second-brand-3', 'x1']) {
    calls.length = 0;
    data = await workspace(user, selected);
    assert.equal(data.selectedProjectId, null, selected);
    assert.deepEqual([data.prompts, data.topics, data.projects.length], [[], [], 4], selected);
    assert.deepEqual(calls, ['batch'], selected);
  }
  // A paid period that is not the calendar month is counted from its own start, once the account says so.
  calls.length = 0;
  globalThis.workspaceFixture.period = '2000-01-01T00:00:00.000Z';
  assert.equal((await workspace(user, 'p2')).usage.used, 2);
  assert.deepEqual(calls.sort(), ['batch', 'first']);
});

test('a project slug names a project of the workspace the address names, never another workspace\'s', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE projects(id TEXT,workspace_id TEXT,name TEXT,display_name TEXT,domain TEXT,competitors_json TEXT,location_code INTEGER,language_code TEXT,daily_enabled INTEGER,interval_hours INTEGER,created_at TEXT,archived INTEGER DEFAULT 0,aliases_json TEXT,additional_domains_json TEXT,engines_json TEXT,category TEXT,audience TEXT,slug TEXT);
    CREATE TABLE prompts(id TEXT,project_id TEXT,unit_id TEXT,text TEXT,engine TEXT,tag TEXT,tags_json TEXT,active INTEGER,archived INTEGER,next_run_at TEXT,created_at TEXT,engines_override_json TEXT,subscribed INTEGER);
    CREATE TABLE topics(id TEXT,project_id TEXT,name TEXT,engines_override_json TEXT);
    CREATE TABLE runs(id TEXT,workspace_id TEXT,project_id TEXT,status TEXT,created_at TEXT,completed_at TEXT,cost REAL,budget_credits REAL);
    CREATE TABLE system_state(key TEXT,value TEXT);
    CREATE TABLE project_stores(project_id TEXT,workspace_id TEXT,initialized INTEGER,source_revision INTEGER,applied_revision INTEGER);
    CREATE TABLE workspaces(id TEXT,time_zone TEXT);
    CREATE TABLE agent_turns(id TEXT,workspace_id TEXT,project_id TEXT,conversation_id TEXT,model TEXT,status TEXT,reserved_usd REAL,cost_usd REAL,started_at TEXT,finished_at TEXT);
    INSERT INTO projects(id,workspace_id,name,domain,competitors_json,location_code,language_code,daily_enabled,interval_hours,created_at,slug) VALUES
      ('mine','me','Conversion','conversion.test','[]',2840,'en',1,24,'2026-01-01','conversion'),
      ('theirs','agency','Conversion','conversion.test','[]',2840,'en',1,24,'2026-01-02','conversion');`);
  const prepare = (sql, params = []) => ({
    sql, params,
    bind: (...values) => prepare(sql, values),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
  });
  const choices = (actor) => [{ id: 'me', slug: 'me', name: 'Me', role: 'owner', current: actor.workspaceId === 'me' }, { id: 'agency', slug: 'agency', name: 'Agency', role: 'member', current: actor.workspaceId === 'agency' }];
  globalThis.workspaceFixture = { db: { prepare, batch: async (statements) => statements.map((s) => ({ results: sqlite.prepare(s.sql).all(...s.params) })) }, choices };
  const me = { id: 'me', email: 'me@example.test', name: 'Me', role: 'owner' };
  const at = (workspaceId) => ({ ...me, workspaceId, role: workspaceId === 'me' ? 'owner' : 'member' });
  // Two workspaces, each with its "conversion": the workspace the request acts in decides.
  assert.equal((await workspaceFor(at('me'), 'conversion')).selectedProjectId, 'mine');
  assert.equal((await workspaceFor(at('agency'), 'conversion')).selectedProjectId, 'theirs');
  // Another workspace's project is never reached by its id either.
  assert.equal((await workspaceFor(at('me'), 'theirs')).selectedProjectId, null);
  assert.deepEqual((await workspaceFor(at('me'), null)).workspaces.map((item) => item.slug), ['me', 'agency']);
});
