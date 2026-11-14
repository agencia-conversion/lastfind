import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

// The scheduler computes the first screens of monitored projects whose inputs changed, and only those, a bounded number per
// tick, resuming where the last tick stopped; a failed read leaves the project to be warmed again.
const root = resolve(import.meta.dirname, '../../..');
const fixtures = {
  './env': `export const db=()=>globalThis.warm.db;`,
  './project-store-transport': `export const projectStoreRpc=async(message)=>globalThis.warm.status(message);`,
  './project-store-read': `export const copyVersion=()=>'v1';export const digest=async(value)=>JSON.stringify(value);export const keptAll=async()=>[];`,
  './report-response': `export const reportResponse=async(owner,q)=>{globalThis.warm.read(q.get('project'),'reports?'+q);if(globalThis.warm.fail===q.get('view'))throw new Error('store busy');return {kept:false,body:globalThis.warm.body?JSON.stringify(globalThis.warm.body(q)):undefined};};`,
  './brand-decisions': `export const brandsOverview=async(project,owner,{fresh})=>{globalThis.warm.read(project,'brands'+(fresh?'?fresh=1':''));return globalThis.warm.brands??{};};`,
  './brand-research': `export const researchCopyReads=()=>Promise.resolve([]);export const brandResearchReport=async()=>({});
    export const settledReadingStatement=(project)=>globalThis.warm.db.prepare("SELECT MAX(COALESCE(completed_at,'')) settled FROM brand_research_jobs WHERE project_id=?").bind(project);
    export const keptResearchReport=async(project,owner,q,{fresh},compute)=>{globalThis.warm.read(project,'brand-research'+(fresh?'?fresh=1':''));return compute();};`,
  './internal-models': `export const publicResearchReport=(report)=>report;`,
  './brand-decision-events': `export const decisionEventsStatement=(project)=>globalThis.warm.db.prepare("SELECT ? project,'events' kind").bind(project);`,
  './source-types': `export const sourceTypeRevisionStatement=()=>globalThis.warm.db.prepare("SELECT 'catalog' kind");
    export const pendingBatchesStatement=()=>globalThis.warm.db.prepare('SELECT 0 n');`,
  './semantic-source-rows': `export const semanticSourceVersionStatement=()=>null;`,
  './http': 'export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }',
  './favicon': `export const faviconHost=(value)=>/^[a-z0-9.-]+\\.[a-z]{2,}$/.test(value)?value.replace(/^www\\./,''):null;
    export const brandFavicon=async(host)=>globalThis.warm.icon(host);`,
  './raw-responses': `export const rawResponsesBucket=()=>globalThis.warm.bucket;`,
};
const bundle = await build({
  entryPoints: [resolve(root, 'packages/core/lib/server/first-screen-warm.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  alias: { '@': resolve(root, 'packages/core') },
  plugins: [{
    name: 'warm-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/[a-z-]+$/ }, (args) => (args.path in fixtures ? { path: args.path, namespace: 'fixture' } : undefined));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtures[args.path], loader: 'js' }));
    },
  }],
});
const { warmFirstScreens, warmProject, FAVICON_WARM_CONCURRENCY, FAVICON_WARM_HOSTS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function d1(sqlite) {
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => sqlite.prepare(sql).run(...params),
    sql,
    params,
  });
  return { prepare: (sql) => statement(sql), batch: async (statements) => statements.map((s) => ({ results: sqlite.prepare(s.sql).all(...s.params) })) };
}

test('only monitored projects whose inputs changed are warmed, a few per tick, from where the last tick stopped', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE projects(id TEXT,workspace_id TEXT,name TEXT,archived INTEGER,daily_enabled INTEGER);
    CREATE TABLE project_stores(project_id TEXT,workspace_id TEXT,generation TEXT,initialized INTEGER,source_revision INTEGER,applied_revision INTEGER);
    CREATE TABLE brand_research_configurations(project_id TEXT,workspace_id TEXT,enabled INTEGER);
    CREATE TABLE brand_research_jobs(project_id TEXT,status TEXT,completed_at TEXT);
    CREATE TABLE system_state(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO projects VALUES('a','o1','A',0,1),('b','o2','B',0,1),('c','o3','Archived',1,1),('d','o4','Paused',0,0),('e','o5','Behind',0,1);
    INSERT INTO project_stores VALUES('a','o1','g',1,5,5),('b','o2','g',1,7,7),('c','o3','g',1,1,1),('d','o4','g',1,1,1),('e','o5','g',1,3,2);`);
  const reads = [];
  const epochs = { a: 1, b: 1 };
  const settling = { a: false, b: false };
  globalThis.warm = {
    db: d1(sqlite),
    read: (project, path) => reads.push([project, path]),
    status: (message) => ({ epoch: epochs[message.scope.projectId], positionsPending: false, bounds: message.bounds.map(() => 'snapped'), job: null, settling: settling[message.scope.projectId] }),
  };
  const projects = () => [...new Set(reads.map(([project]) => project))];
  try {
    // First look: both monitored, caught-up projects are warmed; archived, paused and behind ones are not looked at.
    let result = await warmFirstScreens();
    assert.deepEqual(result, { checked: 2, warmed: 2, failed: 0 });
    assert.deepEqual(projects(), ['a', 'b']);
    const paths = reads.filter(([project]) => project === 'a').map(([, path]) => path);
    assert.ok(paths.includes('reports?project=a&days=28&view=summary'), 'the Overview with no filter');
    assert.ok(paths.includes('reports?project=a&days=28&view=sources&kind=cited&group=domain&order=presence'));
    assert.ok(paths.includes('brand-research?fresh=1'), 'sentiment computed now');
    assert.ok(paths.includes('brands?fresh=1'), 'the Brands list computed now');
    assert.equal(paths.length, new Set(paths).size, 'each read once');
    // Nothing changed: looked at, nothing read.
    reads.length = 0;
    result = await warmFirstScreens();
    assert.deepEqual(result, { checked: 2, warmed: 0, failed: 0 });
    assert.equal(reads.length, 0);
    // New data in one project, a reading settled in the other: both change; one per tick, the next tick takes the other.
    epochs.a = 2;
    sqlite.exec("INSERT INTO brand_research_jobs VALUES('b','completed','2026-10-29T10:00:00.000Z')");
    reads.length = 0;
    result = await warmFirstScreens({ warm: 1 });
    assert.deepEqual(result, { checked: 1, warmed: 1, failed: 0 });
    assert.deepEqual(projects(), ['a']);
    reads.length = 0;
    result = await warmFirstScreens({ warm: 1 });
    assert.deepEqual(projects(), ['b']);
    // A read that fails leaves the project changed: it is warmed again next time.
    epochs.a = 3;
    globalThis.warm.fail = 'history';
    reads.length = 0;
    result = await warmFirstScreens();
    assert.equal(result.failed, 1);
    assert.deepEqual(projects(), ['a']);
    delete globalThis.warm.fail;
    reads.length = 0;
    await warmFirstScreens();
    assert.deepEqual(projects(), ['a']);
    reads.length = 0;
    await warmFirstScreens();
    assert.equal(reads.length, 0);
    // Data still arriving (the store changed in the last minutes): not warmed after every batch, once it settles.
    epochs.a = 4;
    settling.a = true;
    reads.length = 0;
    assert.deepEqual(await warmFirstScreens(), { checked: 2, warmed: 0, failed: 0 });
    epochs.a = 5;
    assert.equal(reads.length, 0);
    settling.a = false;
    assert.deepEqual(await warmFirstScreens(), { checked: 2, warmed: 1, failed: 0 });
    assert.deepEqual(projects(), ['a']);
  } finally {
    delete globalThis.warm;
    sqlite.close();
  }
});

test('the icons of the sites the first screens show are kept before anyone opens them: once each, six at a time, a bounded number', async () => {
  const icons = [];
  let open = 0;
  let peak = 0;
  globalThis.warm = {
    read: () => {},
    bucket: {},
    // The Overview ranks brands, Sources lists domains and pages (each page with its site), Brands its rows.
    body: (q) => (q.get('view') === 'summary' ? { brands: [{ name: 'Acme', domain: 'acme.example' }, { name: 'Beta', domain: 'www.beta.example' }] } : { rows: [{ key: 'https://acme.example/a', domain: 'acme.example' }, { key: 'x', domain: 'not a host' }] }),
    brands: { rows: Array.from({ length: 200 }, (_, index) => ({ name: `Brand ${index}`, domain: `brand${index}.example` })) },
    icon: async (host) => {
      icons.push(host);
      peak = Math.max(peak, ++open);
      await new Promise((resolve) => setTimeout(resolve, 2));
      open--;
      return host.startsWith('brand1') ? null : { image: new Uint8Array(1) };
    },
  };
  try {
    const result = await warmProject('a', 'o1');
    assert.deepEqual(icons.slice(0, 2), ['acme.example', 'beta.example'], 'screen order, one host each');
    assert.equal(icons.length, FAVICON_WARM_HOSTS);
    assert.equal(new Set(icons).size, icons.length);
    assert.equal(peak, FAVICON_WARM_CONCURRENCY);
    assert.ok(result.favicons > 0 && result.favicons < icons.length, 'a site without an icon is not counted');
    // Without a bucket (nowhere to keep them) nothing is fetched.
    icons.length = 0;
    globalThis.warm.bucket = undefined;
    assert.equal((await warmProject('a', 'o1')).favicons, 0);
    assert.equal(icons.length, 0);
  } finally {
    delete globalThis.warm;
  }
});
