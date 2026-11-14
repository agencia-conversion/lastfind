import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The conversation's agent, the real class (worker/agent.ts) with the Agents SDK's own registry: what a connection
// may call over the WebSocket. Only the Workers runtime, the framework's request headers and an optional shell are faked; nothing runs.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const file = (base) => [`${base}.ts`, `${base}.tsx`, base].find((candidate) => existsSync(candidate)) ?? base;
const bundle = await build({
  absWorkingDir: root,
  // The SDK's registry is not in its package exports: read from its file.
  stdin: { contents: `export { LastfindAgent } from './packages/core/worker/agent.ts'; export { FIRST_CALL_TOOLS } from './packages/core/lib/agent.ts'; export { isCallableMethod } from ${JSON.stringify(path.join(root, 'node_modules/agents/dist/callable-decorator.js'))};`, resolveDir: root, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'error',
  // A few dependencies are CommonJS and require Node's own modules.
  banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(root)});` },
  plugins: [{
    name: 'workers',
    setup(plugin) {
      plugin.onResolve({ filter: /^(cloudflare:|next\/headers$|just-bash$)/ }, (args) => ({ path: args.path, namespace: 'workers' }));
      plugin.onLoad({ filter: /.*/, namespace: 'workers' }, (args) => ({
        contents: args.path.startsWith('cloudflare:')
          ? 'export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}};export class WorkerEntrypoint{};export class RpcTarget{};export class EmailMessage{};export const env={};export const exports={};export const waitUntil=()=>{};'
          : 'export const headers=async()=>new Headers();export const cookies=async()=>({get:()=>undefined});export class Bash{};export const defineCommand=()=>{};export default {};',
        loader: 'js',
      }));
      // Vite bundles the skills with import.meta.glob; none is needed here.
      plugin.onLoad({ filter: /agent-skills\.ts$/ }, (args) => ({ contents: readFileSync(args.path, 'utf8').replace(/import\.meta\.glob\([^)]*\)/, '{}'), loader: 'ts' }));
      plugin.onResolve({ filter: /^@edition\// }, (args) => ({ path: file(path.join(root, 'apps/selfhost', args.path.slice(9))) }));
      plugin.onResolve({ filter: /^@\// }, (args) => ({ path: file(path.join(root, 'packages/core', args.path.slice(2))) }));
    },
  }],
});
const { LastfindAgent, FIRST_CALL_TOOLS, isCallableMethod } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

test('a live connection cannot approve, decline or list the changes waiting on approval (only decideChange can)', () => {
  const think = Object.getPrototypeOf(LastfindAgent.prototype);
  for (const name of ['approveExecution', 'rejectExecution', 'pendingApprovals', 'pendingExecutions']) {
    assert.equal(isCallableMethod(think[name]), true, `Think registers ${name} for clients (the reason for the override)`);
    assert.ok(Object.hasOwn(LastfindAgent.prototype, name), `${name} is redeclared`);
    assert.equal(isCallableMethod(LastfindAgent.prototype[name]), false, `${name} is not callable from a connection`);
  }
});

test('a live-connection ticket opens one connection: the agent spends its nonce and forgets it once it expired', async () => {
  const stored = new Map();
  const self = { ctx: { storage: { get: async (key) => stored.get(key), put: async (key, value) => void stored.set(key, value) } } };
  const claim = (nonce, expires) => LastfindAgent.prototype.claimTicket.call(self, nonce, expires);
  const later = Date.now() + 120_000;
  assert.equal(await claim('n1', later), true);
  assert.equal(await claim('n1', later), false, 'a second use is refused');
  assert.equal(await claim('n2', later), true);
  stored.get('tickets').n1 = Date.now() - 1;
  assert.equal(await claim('n3', later), true);
  assert.deepEqual(Object.keys(stored.get('tickets')).sort(), ['n2', 'n3'], 'an expired one is dropped');
  assert.equal(LastfindAgent.prototype.claimTicket.length, 2);
  assert.equal(isCallableMethod(LastfindAgent.prototype.claimTicket), false, 'never from a connection');
});

test("the first call's tools are the agent's own (Think adds activate_skill), and more_tools is one of them", () => {
  const tools = Object.keys(LastfindAgent.prototype.getTools.call({}));
  for (const name of FIRST_CALL_TOOLS) assert.ok(tools.includes(name) || name === 'activate_skill', name);
});
