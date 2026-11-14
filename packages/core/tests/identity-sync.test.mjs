import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { build } from 'esbuild';

// A read never waits for the account sync (it finishes after the response); a write waits for it, and syncs itself when the
// one a read left running failed.
const fixtures = {
  '@edition/server/identity': `
    export const currentIdentity = async () => ({ id: 'u1', email: 'a@example.test', name: 'A' });
    export const ensureIdentity = (user) => globalThis.identity.ensure(user);
    export const resolveActor = async (user) => ({ ...user, workspaceId: user.id, role: 'owner' });
    export const workspaceChoices = async () => [];`,
  'cloudflare:workers': 'export const waitUntil = (promise) => globalThis.identity.later.push(promise);',
  './http': 'export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }',
};
const bundle = await build({
  entryPoints: [resolve(import.meta.dirname, '../lib/server/auth.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'identity-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /^(@edition\/server\/identity|cloudflare:workers|\.\/http)$/ }, (args) => ({ path: args.path, namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtures[args.path], loader: 'js' }));
      },
    },
  ],
});
const auth = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('reads do not wait for the account sync; writes wait for it, and redo a failed one', async () => {
  let release;
  const calls = [];
  globalThis.identity = {
    later: [],
    ensure: (user) => {
      calls.push(user.id);
      return calls.length === 1 ? new Promise((_, reject) => (release = () => reject(new Error('D1 busy')))) : Promise.resolve();
    },
  };
  // The read answers while the sync is still running.
  const actor = await auth.requireActor();
  assert.equal(actor.workspaceId, 'u1');
  assert.equal(calls.length, 1);
  assert.equal(globalThis.identity.later.length, 1, 'the sync finishes after the response');
  // A write waits for it; that one failed, so the write syncs again before going on.
  let wrote = false;
  const write = auth.requireActor({ write: true }).then(() => (wrote = true));
  await new Promise((done) => setTimeout(done, 10));
  assert.equal(wrote, false, 'the write waits for the running sync');
  release();
  await write;
  assert.deepEqual(calls, ['u1', 'u1']);
  // Synced: the next minute's requests do not sync again.
  await auth.requireActor({ write: true });
  await auth.requireActor();
  assert.equal(calls.length, 2);
  delete globalThis.identity;
});
