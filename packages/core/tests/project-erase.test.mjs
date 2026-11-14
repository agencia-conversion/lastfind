import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Deleting a project (10/11/2026): the request tombstones it, the scheduler erases what it held. Fixtures only: the
// control database is SQLite with both editions' migrations, R2 and the project store objects are maps in this file.
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
        const results = statements.map(({ sql, params }) => (/^\s*(SELECT|WITH)\b/i.test(sql) ? { results: sqlite.prepare(sql).all(...params) } : { meta: { changes: sqlite.prepare(sql).run(...params).changes } }));
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
  './env': 'export const db=()=>globalThis.eraseFixture.db;export const now=()=>new Date().toISOString();',
  './http': 'export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}',
  './raw-responses': 'export const rawResponsesBucket=()=>globalThis.eraseFixture.bucket;',
  './project-store-transport': 'export const projectStoreRpc=async(message)=>globalThis.eraseFixture.store(message);',
  'cloudflare:workers': 'export const env={PROJECT_STORES:{},LASTFIND_AGENT:{}};',
  '@/lib/server/auth': 'export async function requireActor({role}){const a=globalThis.eraseFixture.actor;if(role==="owner"&&a.role!=="owner"){const e=new Error("Your role in this workspace does not allow this action.");e.status=403;throw e;}return a;}',
  '@/lib/server/http':
    'export const sameOrigin=()=>{};export const body=async(r)=>r.json();export const json=(v,s=200)=>Response.json(v,{status:s});export const fail=async(e)=>Response.json({error:e.message},{status:e.status??500});',
};
async function load(entry) {
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: [root + entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'fixtures',
        setup(plugin) {
          plugin.onResolve({ filter: /^(\.\/(env|http|raw-responses|project-store-transport)|cloudflare:workers|@\/lib\/server\/(auth|http))$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
          plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
          plugin.onResolve({ filter: /^@\// }, (args) => ({ path: root + 'packages/core/' + args.path.slice(2) + (args.path.endsWith('.mjs') ? '' : '.ts') }));
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}
const erase = await load('packages/core/lib/server/project-erase.ts');
erase.setConversationEraser(async (id) => { globalThis.eraseFixture.destroyed.push(id); });
const route = await load('packages/core/app/api/projects/[id]/erase/route.ts');

function setup(edition) {
  const sqlite = new DatabaseSync(':memory:');
  const dir = root + `apps/${edition}/drizzle/`;
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(dir + name, 'utf8'));
  const stamp = new Date().toISOString();
  sqlite.prepare("INSERT INTO accounts(id,email,name,created_at) VALUES('owner','owner@test.example','Owner',?)").run(stamp);
  for (const id of ['doomed', 'kept'])
    sqlite.prepare("INSERT INTO projects(id,workspace_id,name,domain,competitors_json,daily_enabled,created_at) VALUES(?,'owner',?,?,'[{\"name\":\"Rival\",\"domain\":\"rival.com\"}]',1,?)").run(id, id === 'doomed' ? 'Acme' : 'Other', `${id}.com`, stamp);
  for (const project of ['doomed', 'kept']) {
    sqlite.prepare("INSERT INTO prompts(id,project_id,text,engine,next_run_at,created_at) VALUES(?,?,?,'chat_gpt',?,?)").run(`${project}:p`, project, 'Best tools?', stamp, stamp);
    sqlite
      .prepare("INSERT INTO runs(id,workspace_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,status,callback_token,cost,created_at,next_poll_at,budget_credits,raw_response_status,raw_response_key) VALUES(?,'owner',?,?,?,'Best tools?','chat_gpt','[\"Acme\"]',2840,'en','complete','t',0.01,?,?,9,'stored',?)")
      .run(`${project}:done`, project, `${project}:p`, `${project}:done`, stamp, stamp, `raw/v1/owner/${project}/r/x.json`);
    sqlite
      .prepare("INSERT INTO agent_conversations(id,workspace_id,account_id,project_id,title,pinned,created_at,updated_at) VALUES(?,'owner','owner',?,'Chat',0,?,?)")
      .run(`${project}:chat`, project, stamp, stamp);
    sqlite
      .prepare("INSERT INTO brand_research_jobs(id,workspace_id,project_id,input_key,context_key,answer_sha256,provider,model,status,reserved_usd,cost_usd,input_json,requested_at) VALUES(?,'owner',?,?,'ctx','sha','p','m','pending',0.05,0,'{\"brands\":[\"Acme\"]}',?)")
      .run(`${project}:job`, project, `${project}:job`, stamp);
  }
  // A queued collection (not sent yet): deleting cancels it and gives its credits back.
  sqlite
    .prepare("INSERT INTO runs(id,workspace_id,project_id,prompt_id,request_key,prompt_text,engine,targets_json,location_code,language_code,status,callback_token,cost,created_at,next_poll_at,budget_credits,raw_response_status) VALUES('doomed:queued','owner','doomed','doomed:p','q','Best tools?','chat_gpt','[]',2840,'en','queued','t',0,?,?,9,'none')")
    .run(stamp, stamp);
  sqlite.prepare("INSERT INTO project_backups(id,project_id,workspace_id,generation,status,parts,bytes,created_at) VALUES('b1','doomed','owner','old-generation','ready',1,10,?)").run(stamp);
  const objects = new Map(
    ['raw/v1/owner/doomed/r/x.json', 'backups/v1/owner/doomed/b1/0', 'restores/v1/owner/doomed/r1.ndjson', 'raw/v1/owner/kept/r/x.json', 'favicons/doomed.com'].map((key) => [key, 'x']),
  );
  const wiped = [];
  globalThis.eraseFixture = {
    db: d1(sqlite),
    destroyed: [],
    actor: { workspaceId: 'owner', email: 'owner@test.example', role: 'owner' },
    bucket: {
      list: async ({ prefix, limit }) => {
        const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
        return { objects: keys.slice(0, limit).map((key) => ({ key })), truncated: keys.length > limit };
      },
      delete: async (keys) => keys.forEach((key) => objects.delete(key)),
    },
    store: async (message) => {
      assert.equal(message.action, 'erase');
      wiped.push(message.scope.generation);
      return { erased: true };
    },
  };
  return { sqlite, objects, wiped };
}
const post = (body) => route.POST(new Request('https://lastfind.test/api/projects/doomed/erase', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'doomed' }) });
const count = (sqlite, sql, ...params) => sqlite.prepare(sql).get(...params).n;

// The public export carries only the independent edition's migrations.
for (const edition of ['cloud', 'selfhost'].filter((name) => existsSync(root + `apps/${name}/drizzle/`))) {
  test(`${edition}: only the owner deletes, and only with the project's exact name`, async () => {
    const { sqlite } = setup(edition);
    globalThis.eraseFixture.actor.role = 'admin';
    assert.equal((await post({ name: 'Acme' })).status, 403);
    globalThis.eraseFixture.actor.role = 'owner';
    assert.equal((await post({ name: 'acme' })).status, 400);
    assert.equal((await post({})).status, 400);
    assert.equal(count(sqlite, "SELECT COUNT(*) n FROM projects WHERE deleted_at IS NOT NULL"), 0);
  });

  test(`${edition}: deleting tombstones the project at once, cancels unsent work and is audited`, async () => {
    const { sqlite } = setup(edition);
    assert.equal((await post({ name: ' Acme ' })).status, 200);
    const project = sqlite.prepare("SELECT archived,daily_enabled,deleted_at FROM projects WHERE id='doomed'").get();
    assert.equal(project.archived, 1);
    assert.equal(project.daily_enabled, 0);
    assert.ok(project.deleted_at);
    assert.deepEqual({ ...sqlite.prepare("SELECT status,budget_credits FROM runs WHERE id='doomed:queued'").get() }, { status: 'failed', budget_credits: 0 });
    assert.equal(sqlite.prepare("SELECT status FROM brand_research_jobs WHERE id='doomed:job'").get().status, 'cancelled');
    assert.equal(sqlite.prepare("SELECT status FROM brand_research_jobs WHERE id='kept:job'").get().status, 'pending');
    assert.deepEqual({ ...sqlite.prepare('SELECT actor,action,key FROM admin_audit_log').get() }, { actor: 'owner@test.example', action: 'delete', key: 'project:doomed' });
    // Gone from the archived list and cannot come back; a second delete finds nothing.
    const archived = readFileSync(root + 'packages/core/app/api/projects/archived/route.ts', 'utf8').match(/'(SELECT [^']+)'/)[1];
    assert.deepEqual(sqlite.prepare(archived).all('owner'), []);
    const unarchive = readFileSync(root + 'packages/core/app/api/projects/[id]/unarchive/route.ts', 'utf8').match(/'(UPDATE projects[^']+)'/)[1];
    assert.equal(sqlite.prepare(unarchive).run('doomed', 'owner').changes, 0);
    assert.equal((await post({ name: 'Acme' })).status, 404);
  });

  test(`${edition}: the scheduler erases what the project held, resumably, and keeps the spending rows`, async () => {
    const { sqlite, objects, wiped } = setup(edition);
    await post({ name: 'Acme' });
    // A collection still with the provider holds the erasure back: its result would write the archive again.
    sqlite.prepare("UPDATE runs SET status='pending' WHERE id='doomed:done'").run();
    assert.equal(await erase.eraseDeletedProjects(), 0);
    assert.ok(objects.has('raw/v1/owner/doomed/r/x.json'));
    sqlite.prepare("UPDATE runs SET status='complete' WHERE id='doomed:done'").run();
    // More prompts than a page: the first tick leaves some, the next one finishes.
    const stamp = new Date().toISOString();
    for (let index = 0; index < erase.ERASE_PAGE + 5; index++)
      sqlite.prepare("INSERT INTO prompts(id,project_id,text,engine,next_run_at,created_at) VALUES(?,'doomed',?,'chat_gpt',?,?)").run(`doomed:p${index}`, `Prompt ${index}`, stamp, stamp);
    assert.equal(await erase.eraseDeletedProjects(), 0);
    assert.ok(count(sqlite, "SELECT COUNT(*) n FROM prompts WHERE project_id='doomed'") > 0);
    assert.equal(await erase.eraseDeletedProjects(), 1);
    assert.equal(await erase.eraseDeletedProjects(), 0, 'nothing left to erase');
    // R2: the project's prefixes, nothing else.
    assert.deepEqual([...objects.keys()].sort(), ['favicons/doomed.com', 'raw/v1/owner/kept/r/x.json']);
    // Every store generation known (current and backed up) was wiped once; the conversation objects destroyed.
    assert.ok(wiped.includes('old-generation'));
    assert.equal(new Set(wiped).size, wiped.length);
    assert.deepEqual(globalThis.eraseFixture.destroyed, ['doomed:chat']);
    // A prompt a kept run points at stays, blanked and archived; the others are gone.
    assert.deepEqual(sqlite.prepare("SELECT id,text,archived FROM prompts WHERE project_id='doomed'").all().map((row) => ({ ...row })), [{ id: 'doomed:p', text: '', archived: 1 }]);
    for (const table of ['agent_conversations', 'project_backups', 'project_stores', 'project_store_outbox'])
      assert.equal(count(sqlite, `SELECT COUNT(*) n FROM ${table} WHERE project_id='doomed'`), 0, table);
    // Kept: the tombstone (with its stamp) and the spending rows, blanked.
    const tombstone = sqlite.prepare("SELECT name,erased_at,competitors_json FROM projects WHERE id='doomed'").get();
    assert.ok(tombstone.erased_at);
    assert.equal(tombstone.competitors_json, '[]');
    assert.deepEqual({ ...sqlite.prepare("SELECT prompt_text,targets_json,raw_response_key,cost,budget_credits FROM runs WHERE id='doomed:done'").get() }, { prompt_text: '', targets_json: '[]', raw_response_key: null, cost: 0.01, budget_credits: 9 });
    assert.equal(sqlite.prepare("SELECT input_json FROM brand_research_jobs WHERE id='doomed:job'").get().input_json, '{}');
    // The other project is untouched.
    assert.equal(count(sqlite, "SELECT COUNT(*) n FROM prompts WHERE project_id='kept'"), 1);
    assert.equal(sqlite.prepare("SELECT prompt_text FROM runs WHERE id='kept:done'").get().prompt_text, 'Best tools?');
    assert.equal(count(sqlite, "SELECT COUNT(*) n FROM agent_conversations WHERE project_id='kept'"), 1);
  });
}
