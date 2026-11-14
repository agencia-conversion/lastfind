import { spawn } from 'node:child_process';
import { openSync, closeSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { root, prepareRuntime, run } from './runtime.mjs';
const edition = process.argv[2] || 'selfhost';
const { integration = {} } = await import(pathToFileURL(resolve(root, 'apps', edition, 'runtime.config.mjs')).href);
const port = Number(process.env.CONDUCTOR_PORT ? Number(process.env.CONDUCTOR_PORT) + 2 : integration.port || 3092);
const { runtime } = await prepareRuntime(edition, { testing: true, port });
const config = resolve(runtime, 'wrangler.local.json');
const state = resolve(runtime, '.wrangler/test-state');
rmSync(state, { force: true, recursive: true });
const env = { ...process.env, LASTFIND_TESTING: 'true', LASTFIND_TEST_OWNER_KEY: 'isolated-owner-test-key-only-not-for-production', LASTFIND_TEST_URL: `http://localhost:${port}`, LASTFIND_TEST_CONFIG: config, LASTFIND_TEST_DB_DIR: resolve(state, 'v3/d1'), LASTFIND_TEST_WORKSPACE: runtime, LASTFIND_TEST_SESSION_SECRET: integration.sessionSecret || 'isolated-personal-test-secret-not-for-production', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_SEND_METRICS: 'false' };
for (const check of integration.preflight || []) run(check[0] === 'node' ? process.execPath : check[0], check.slice(1).map(arg => arg.startsWith('./') ? resolve(root, arg) : arg), { cwd: resolve(root, 'packages/core'), env });
run(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', 'DB', '--local', '--config', config, '--persist-to', state], { cwd: runtime, env });
const log = resolve(runtime, 'integration-server.log');
const fd = openSync(log, 'w', 0o600);
env.LASTFIND_TEST_SERVER_LOG = log;
const child = spawn(resolve(root, 'node_modules/.bin/vinext'), ['dev', '--port', String(port)], { cwd: runtime, env, stdio: ['ignore', fd, fd], detached: process.platform !== 'win32' });
try {
  let ready = false;
  for (let attempt = 0; attempt < 90 && child.exitCode === null; attempt++) {
    try { const response = await fetch(`${env.LASTFIND_TEST_URL}/api/health`, { signal: AbortSignal.timeout(2000) }); if (response.ok && (await response.json()).ok) { ready = true; break; } } catch { /* local server is starting */ }
    await delay(1000);
  }
  if (!ready) throw new Error('Isolated integration server failed to start.');
  for (const check of integration.http || []) run(check[0] === 'node' ? process.execPath : check[0], check.slice(1).map(arg => arg.startsWith('./') ? resolve(root, arg) : arg), { cwd: runtime, env });
  console.log(`Independent integration checks passed for ${edition}.`);
} catch (error) {
  if (existsSync(log)) console.error(readFileSync(log, 'utf8').slice(-12000));
  throw error;
} finally {
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch { /* child already exited */ }
  closeSync(fd);
}
