// The agent's server code against the real migrations in memory (node:sqlite as D1), bundled with esbuild and its edges
// faked: the database binding, the plan, the project lookup, the account's workspace, the MCP routes, the audit, the
// conversation's Durable Object, the model call. No network, no provider key, no paid call.
// ponytail: agent.test.mjs keeps its own copy of this harness while other branches edit it; move it here once they land.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

export const root = fileURLToPath(new URL('../../../../', import.meta.url));
const core = path.join(root, 'packages/core');

export function d1(sqlite) {
  const prepare = (sql, params = []) => ({
    bind: (...values) => prepare(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...params).changes } }),
  });
  const batch = async (statements) => {
    const results = [];
    for (const statement of statements) results.push({ ...(await statement.all()), meta: { changes: sqlite.prepare('SELECT changes() n').get().n } });
    return results;
  };
  return { prepare, batch };
}

const files = (directory) =>
  readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
const skillsDir = path.join(core, 'agent-skills');
const skillFiles = Object.fromEntries(files(skillsDir).filter((file) => file.endsWith('.md')).map((file) => [`../../agent-skills/${path.relative(skillsDir, file)}`, readFileSync(file, 'utf8')]));

const fixtures = {
  'cloudflare:workers': `export const env=new Proxy({},{get:(_,key)=>globalThis.fixture?.env?.[key]});export const waitUntil=(p)=>{globalThis.fixture.pending.push(p)};`,
  agents: `export const getAgentByName=async(namespace,id)=>globalThis.fixture.agentStub(id);`,
  '@edition/server/identity': `export const resolveActor=async(user,owner)=>globalThis.fixture.resolve(user,owner);`,
  '@edition/server/workspace-slugs': `export const workspaceInPath=true;export const workspaceSlug=async()=>'acme-team';export const workspaceIdBySlug=async()=>null;`,
  [path.join(core, 'lib/server/project-path.ts')]: `export const projectAppPath=async(owner,id)=>'/app/acme-team/acme'+(id==='p2'?'-2':'');`,
  '@edition/lib/admin-access': `export const isAdmin=(user)=>!!user&&(globalThis.fixture.admins??[]).includes(user.email);`,
  [path.join(core, 'lib/server/env.ts')]: `export const db=()=>globalThis.fixture.db;export const now=()=>globalThis.fixture.now?.()??new Date().toISOString();export const setting=(k)=>globalThis.fixture.settings[k]??'';export const workerSetting=(k)=>globalThis.fixture.settings[k]??'';export const appOrigin=()=>'https://app.example.test';`,
  [path.join(core, 'lib/server/http.ts')]: `export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}`,
  [path.join(core, 'lib/server/auth.ts')]: `const R={viewer:0,member:1,admin:2,owner:3};export const roleAtLeast=(r,n)=>R[r]>=R[n];`,
  [path.join(core, 'lib/server/capabilities.ts')]: `export const providerSettings=false;export const accountCapabilities=async()=>({engines:[],promptLimit:null,topicLimit:null,agent:true});
export const usageWindow=async()=>({periodStart:new Date().toISOString().slice(0,7)+'-01T00:00:00.000Z',creditsLimit:310,limit:null});
export const agentBudgetCondition=()=>({sql:'1=1',params:[]});`,
  [path.join(core, 'lib/server/workspace.ts')]: `import {ApiError} from './http';export const ownedProject=async(id,owner)=>{if(!['p1','p2'].includes(id)||owner!=='owner-1')throw new ApiError(404,'Project not found.');return {id,name:'Acme',domain:'acme.example',location_code:2076,language_code:'en',aliases_json:'[]',competitors_json:'[{"name":"Rivalco"}]'};};`,
  [path.join(core, 'lib/server/classifier-models.ts')]: `export const classifierModels=(id,current)=>({model:current,fallback:null});`,
  [path.join(core, 'lib/server/api-access.ts')]: `export const audit=async()=>{};`,
  [path.join(core, 'lib/server/mcp.ts')]: `export const actorToolContext=()=>({call:async()=>({}),everyWorkspace:async()=>[]});`,
  [path.join(core, 'lib/server/brand-research.ts')]: `export const researchBudgetCondition=()=>({sql:'1=1',params:[]});`,
  [path.join(core, 'lib/server/decisions-api.ts')]: `export const postChat=async(payload)=>globalThis.fixture.postChat(payload);export const postDecisions=postChat;`,
};

/** The modules `entries` names (export lines with paths under packages/core), bundled with the fakes. */
export async function load(entries) {
  const bundle = await build({
    absWorkingDir: root,
    stdin: { contents: entries.join('\n'), resolveDir: core, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'fixtures',
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) => {
            if (args.path in fixtures) return { path: args.path, namespace: 'fixture' };
            let resolved = args.path.startsWith('@/') ? path.join(core, args.path.slice(2)) : args.path.startsWith('.') && !args.resolveDir.includes('node_modules') ? path.resolve(args.resolveDir, args.path) : null;
            if (!resolved) return;
            if (!existsSync(resolved)) resolved += '.ts';
            return resolved in fixtures ? { path: resolved, namespace: 'fixture' } : { path: resolved };
          });
          plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtures[args.path], loader: 'ts', resolveDir: path.dirname(args.path) }));
          // Vite bundles the skills with import.meta.glob; here the same files are read from disk.
          plugin.onLoad({ filter: /agent-skills\.ts$/ }, (args) => ({ contents: readFileSync(args.path, 'utf8').replace(/import\.meta\.glob\([^)]*\)/, JSON.stringify(skillFiles)), loader: 'ts' }));
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}

export const owner = { id: 'owner-1', email: 'owner@example.test', name: 'Owner', workspaceId: 'owner-1', role: 'owner' };
export const member = { id: 'member-1', email: 'member@example.test', name: 'Member', workspaceId: 'owner-1', role: 'member' };
export const viewer = { id: 'viewer-1', email: 'viewer@example.test', name: 'Viewer', workspaceId: 'owner-1', role: 'viewer' };

/** A fresh database with the independent edition's migrations and the three accounts; `fixture` overrides the fakes. */
export function setup(fixture = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(path.join(root, 'apps/selfhost/drizzle')).filter((n) => n.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(path.join(root, 'apps/selfhost/drizzle', name), 'utf8'));
  for (const account of [owner, member, viewer]) sqlite.prepare('INSERT INTO accounts(id,email,name,created_at) VALUES(?,?,?,?)').run(account.id, account.email, account.name, new Date().toISOString());
  for (const id of ['p1', 'p2'])
    sqlite.prepare("INSERT INTO projects(id,workspace_id,name,domain,created_at) VALUES(?,'owner-1','Acme','acme.example',?)").run(id, new Date().toISOString());
  globalThis.fixture = {
    db: d1(sqlite),
    settings: { OPENROUTER_API_KEY: 'test-key-not-real', SESSION_SECRET: 'agent-test-session-secret-not-production-0123456789' },
    env: { LASTFIND_AGENT: {} },
    pending: [],
    resolve: async (user, workspaceId) => {
      const role = user.id === workspaceId ? 'owner' : { 'member-1': 'member', 'viewer-1': 'viewer' }[user.id];
      return role ? { ...user, workspaceId, role } : { ...user, workspaceId: user.id, role: 'owner' };
    },
    agentStub: (id) => ({ transcript: async () => globalThis.fixture.transcripts?.[id] ?? [] }),
    postChat: async () => {
      throw new Error('No model call in this test.');
    },
    ...fixture,
  };
  return { sqlite };
}
