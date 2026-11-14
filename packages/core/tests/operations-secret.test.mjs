import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The operations route (export, restore, flush any project) and the scheduler's tick do not share a secret: once
// OPERATIONS_SECRET is set, CRON_SECRET opens only the tick. Without it, an installation keeps working as before.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const core = path.join(root, 'packages/core');
const fakes = {
  '@/lib/server/env': `export const db=()=>({prepare:()=>({bind:()=>({first:async()=>globalThis.opsFixture.project??null})})});export const setting=(k)=>globalThis.opsFixture[k]??'';`,
  '@/lib/server/http': `export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
export const json=(value,status=200)=>Response.json(value,{status});export const fail=(e)=>Response.json({error:e.message},{status:e.status??500});export const sameOrigin=()=>{};`,
  '@/lib/server/project-store': `export const getProjectStore=async()=>null;export const flushProjectStores=async()=>({flushed:true});
export const exportProjectStore=async(...args)=>{globalThis.opsFixture.exported=args;return new Response('ndjson');};`,
  '@/lib/server/auth': `export const requireActor=async()=>({id:'member-a',workspaceId:'owner-1',role:'owner'});`,
  '@/lib/server/workspace': 'export const ownedProject=async()=>({});',
  '@/lib/server/project-store-transport': 'export const projectStorageConfigured=()=>true;',
  '@/lib/server/capabilities': 'export const ownerRestore=true;',
  '@/lib/server/project-backups': 'export const madeByLastfind=async()=>true;',
  '@/lib/server/project-restores': 'export const projectRestoreActive=async()=>false;',
  '@/lib/server/project-store-actions': 'export const projectStorageAction=async()=>({});export const storageActionBody=async(r)=>r.json();',
  '@/lib/server/first-screen-warm': 'export const warmProject=async()=>({});',
  '@/lib/server/ai-bots': 'export const rereadLandings=async(options)=>({dryRun:options.dryRun,projects:[],options});',
  '@/lib/server/retention': 'export const applyRetention=async(options)=>({dryRun:options.dryRun,projects:[],options});',
  '@/lib/server/competitor-analysis': 'export const ensureCompetitorAnalysis=async(projectId,workspaceId,restart)=>({status:restart?"pending":"complete",projectId,workspaceId,restart});',
  '@/lib/server/semantic-panel-worker': 'export const rereadPanelAnswers=async(options)=>({scanned:0,notes:0,recovered:0,next:null,options}); export const prunePanelRounds=async(options)=>({dryRun:options.dryRun,projects:[],options}); export const panelRoundNow=async(projectId,maxUsd,redo)=>{ if(!(maxUsd>0)) throw new Error("maxUsd must be above 0."); return {round:"2026-11-08",added:["claude"],moved:1,queries:[],inFlight:0,projectId,maxUsd,redo}; };',
  '@/lib/server/comparison-worker': 'export const comparisonRoundNow=async(projectId,maxUsd)=>{ if(!(maxUsd>0)) throw new Error("maxUsd must be above 0."); return {period:"2026-11-13",complete:true,runs:[],inFlight:0,projectId,maxUsd}; }; export const rereadComparisons=async(projectId,after,limit)=>({projectId,after,limit,next:null});',
  '@/lib/server/monitor': 'export const tick=async()=>({ticked:true});',
};
async function load(entry) {
  const bundle = await build({
    entryPoints: [path.join(core, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [{
      name: 'fakes',
      setup(plugin) {
        plugin.onResolve({ filter: /^@\// }, (args) => (args.path in fakes ? { path: args.path, namespace: 'fake' } : { path: path.join(core, args.path.slice(2)) + '.ts' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fake' }, (args) => ({ contents: fakes[args.path], loader: 'js' }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}
const storage = await load('app/api/operations/project-storage/route.ts');
const cron = await load('app/api/cron/route.ts');
const userStorage = await load('app/api/projects/[id]/storage/route.ts');
const cronSecret = 'c'.repeat(40),
  opsSecret = 'o'.repeat(40);
const call = (route, secret) =>
  route.POST(new Request('https://example.test/x', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'flush' }) })).then((response) => response.status);

test('CRON_SECRET opens the operations route only until OPERATIONS_SECRET is set; the tick keeps CRON_SECRET', async () => {
  globalThis.opsFixture = { CRON_SECRET: cronSecret };
  assert.equal(await call(storage, cronSecret), 200, 'an installation without OPERATIONS_SECRET works as before');
  globalThis.opsFixture = { CRON_SECRET: cronSecret, OPERATIONS_SECRET: opsSecret };
  assert.equal(await call(storage, cronSecret), 401, 'the scheduler secret no longer exports, restores or flushes');
  assert.equal(await call(storage, opsSecret), 200);
  // The Semantic Branding re-read is an operator action behind the same secret, one bounded page at a time.
  const reread = (secret) => storage.POST(new Request('https://example.test/x', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'semantic-reread', after: 'q1', limit: 1000 }) }));
  assert.equal((await reread(cronSecret)).status, 401);
  assert.deepEqual((await (await reread(opsSecret)).json()).options, { after: 'q1', limit: 200, projectId: null });
  // The Comparison re-read takes the project and pages the same way.
  globalThis.opsFixture.project = { id: 'p1', workspace_id: 'owner-1' };
  const comparison = await storage.POST(new Request('https://example.test/x', { method: 'POST', headers: { authorization: `Bearer ${opsSecret}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'comparison-reread', projectId: 'p1', after: 'r3', limit: 9999 }) }));
  assert.deepEqual(await comparison.json(), { projectId: 'p1', after: 'r3', limit: 500, next: null });
  delete globalThis.opsFixture.project;
  assert.equal(await call(cron, cronSecret), 200);
  assert.equal(await call(cron, opsSecret), 401, 'the operations secret does not run the tick');
  // A short operations secret closes the route instead of falling back.
  globalThis.opsFixture = { CRON_SECRET: cronSecret, OPERATIONS_SECRET: 'short' };
  assert.equal(await call(storage, cronSecret), 401);
  assert.equal(await call(storage, 'short'), 401);
});

test('agent conversations: the owner\'s export holds only their own; the operator export, every account\'s', async () => {
  globalThis.opsFixture = { OPERATIONS_SECRET: opsSecret, project: { id: 'p1', workspace_id: 'owner-1' } };
  await userStorage.GET(new Request('https://example.test/api/projects/p1/storage?format=export'), { params: Promise.resolve({ id: 'p1' }) });
  assert.deepEqual(globalThis.opsFixture.exported, ['p1', 'owner-1', 'member-a'], 'the requesting account\'s conversations only');
  const response = await storage.POST(new Request('https://example.test/x', { method: 'POST', headers: { authorization: `Bearer ${opsSecret}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'export', projectId: 'p1' }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(globalThis.opsFixture.exported, ['p1', 'owner-1', null], 'the operator copy keeps every account\'s');
});

test('the Semantic Branding round now is an operator action on a known project, with its spend cap', async () => {
  globalThis.opsFixture = { CRON_SECRET: cronSecret, OPERATIONS_SECRET: opsSecret, project: { id: 'p1', workspace_id: 'owner-1' } };
  const round = (secret, body) => storage.POST(new Request('https://example.test/x', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'semantic-round', ...body }) }));
  assert.equal((await round(cronSecret, { projectId: 'p1', maxUsd: 2 })).status, 401);
  const done = await (await round(opsSecret, { projectId: 'p1', maxUsd: 2 })).json();
  assert.deepEqual([done.projectId, done.maxUsd, done.added], ['p1', 2, ['claude']]);
  // A redo only when asked with a literal true.
  assert.equal(done.redo, false);
  assert.equal((await (await round(opsSecret, { projectId: 'p1', maxUsd: 2, redo: 'yes' })).json()).redo, false);
  assert.equal((await (await round(opsSecret, { projectId: 'p1', maxUsd: 2, redo: true })).json()).redo, true);
  // What stops it answers 409 with the reason.
  const refused = await round(opsSecret, { projectId: 'p1' });
  assert.equal(refused.status, 409);
});

test('the Comparison round now is an operator action on a known project, with its spend cap', async () => {
  globalThis.opsFixture = { CRON_SECRET: cronSecret, OPERATIONS_SECRET: opsSecret, project: { id: 'p1', workspace_id: 'owner-1' } };
  const round = (secret, body) => storage.POST(new Request('https://example.test/x', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'comparison-round', ...body }) }));
  assert.equal((await round(cronSecret, { projectId: 'p1', maxUsd: 1 })).status, 401);
  const done = await (await round(opsSecret, { projectId: 'p1', maxUsd: 1 })).json();
  assert.deepEqual([done.projectId, done.maxUsd, done.inFlight], ['p1', 1, 0]);
  // What stops it answers 409 with the reason; an unknown project, 404.
  assert.equal((await round(opsSecret, { projectId: 'p1' })).status, 409);
  globalThis.opsFixture.project = null;
  assert.equal((await round(opsSecret, { projectId: 'nope', maxUsd: 1 })).status, 404);
});

test('the brand analysis of a project is an operator action: a restart only with a literal true, else its status', async () => {
  globalThis.opsFixture = { CRON_SECRET: cronSecret, OPERATIONS_SECRET: opsSecret, project: { id: 'p1', workspace_id: 'owner-1' } };
  const analysis = (secret, body) => storage.POST(new Request('https://example.test/x', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'analysis', projectId: 'p1', ...body }) }));
  assert.equal((await analysis(cronSecret, { restart: true })).status, 401);
  assert.deepEqual(await (await analysis(opsSecret, { restart: true })).json(), { status: 'pending', projectId: 'p1', workspaceId: 'owner-1', restart: true });
  assert.equal((await (await analysis(opsSecret, { restart: 'yes' })).json()).restart, false);
  assert.equal((await (await analysis(opsSecret, {})).json()).status, 'complete');
});

test('the Semantic Branding prune of the old scale is an operator action that only counts unless dryRun is a literal false', async () => {
  globalThis.opsFixture = { CRON_SECRET: cronSecret, OPERATIONS_SECRET: opsSecret };
  const prune = (secret, body) => storage.POST(new Request('https://example.test/x', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'semantic-prune', ...body }) }));
  assert.equal((await prune(cronSecret, {})).status, 401);
  // Every project, without a project lookup; a dry run unless asked otherwise.
  assert.deepEqual((await (await prune(opsSecret, {})).json()).options, { projectId: null, dryRun: true, all: false });
  assert.deepEqual((await (await prune(opsSecret, { dryRun: 'false', projectId: 'p1' })).json()).options, { projectId: 'p1', dryRun: true, all: false });
  assert.deepEqual((await (await prune(opsSecret, { dryRun: false })).json()).options, { projectId: null, dryRun: false, all: false });
  // Every round (Semantic Branding zeroed, 10/11/2026) only with a literal `all: true`, still a dry run by default.
  assert.deepEqual((await (await prune(opsSecret, { all: true, projectId: 'p1' })).json()).options, { projectId: 'p1', dryRun: true, all: true });
  assert.deepEqual((await (await prune(opsSecret, { all: 'true' })).json()).options, { projectId: null, dryRun: true, all: false });
});

test('the AI Traffic landing pages re-read is an operator action, a dry run unless dryRun is a literal false', async () => {
  globalThis.opsFixture = { CRON_SECRET: cronSecret, OPERATIONS_SECRET: opsSecret };
  const reread = (secret, body) => storage.POST(new Request('https://example.test/x', { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'ai-bots-reread', ...body }) }));
  assert.equal((await reread(cronSecret, {})).status, 401);
  assert.deepEqual((await (await reread(opsSecret, {})).json()).options, { projectId: null, dryRun: true });
  assert.deepEqual((await (await reread(opsSecret, { dryRun: false, projectId: 'p1' })).json()).options, { projectId: 'p1', dryRun: false });
});
