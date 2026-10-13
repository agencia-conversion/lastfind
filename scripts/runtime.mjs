import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function files(directory, prefix = '') {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(resolve(directory, entry.name), `${prefix}${entry.name}/`)
    : [`${prefix}${entry.name}`]);
}
export function run(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${binary} failed (${result.status ?? result.signal})`);
  return result;
}
export function runTestFiles(tests, execute = run) {
  // The discovery suite builds large stress fixtures, so it runs alone to keep
  // its memory and CPU spikes from slowing the rest of the suite. Its own
  // assertions bound decoder work, not elapsed time, and do not depend on this.
  const exclusiveTests = tests.filter(path => path.endsWith('/competitor-discovery.test.ts'));
  const concurrentTests = tests.filter(path => !exclusiveTests.includes(path));
  if (exclusiveTests.length) execute(process.execPath, ['--experimental-strip-types', '--test', ...exclusiveTests]);
  if (concurrentTests.length) execute(process.execPath, ['--experimental-strip-types', '--test', ...concurrentTests]);
}
export async function prepareRuntime(edition, { testing = false, port = process.env.CONDUCTOR_PORT || '3001' } = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(edition)) throw new Error('Invalid application name');
  const application = resolve(root, 'apps', edition);
  if (!existsSync(resolve(application, 'runtime.config.mjs'))) throw new Error('Unknown application');
  const core = resolve(root, 'packages/core');
  const runtime = resolve(root, '.runtime', edition);
  mkdirSync(runtime, { recursive: true });
  // Only route wrappers are generated. All implementation imports the canonical
  // source directly; editing a workspace never creates another copy of the core.
  rmSync(resolve(runtime, 'app'), { recursive: true, force: true });
  const routes = new Set();
  for (const source of [resolve(core, 'app'), resolve(application, 'app')]) {
    for (const path of files(source)) {
      if (routes.has(path)) throw new Error(`Duplicate application route: ${path}`);
      routes.add(path);
      const destination = resolve(runtime, 'app', path);
      mkdirSync(dirname(destination), { recursive: true });
      symlinkSync(resolve(source, path), destination);
    }
  }
  // Vinext discovers proxy.ts at the generated project root, outside app/.
  // Keep edition-specific request behavior canonical in apps/<edition> and
  // expose it to the generated runtime without copying source.
  const runtimeProxy = resolve(runtime, 'proxy.ts');
  rmSync(runtimeProxy, { force: true });
  const applicationProxy = resolve(application, 'proxy.ts');
  if (existsSync(applicationProxy)) symlinkSync(applicationProxy, runtimeProxy);
  const publicDir = resolve(runtime, 'public');
  rmSync(publicDir, { recursive: true, force: true });
  for (const source of [resolve(core, 'public'), resolve(application, 'public')]) {
    if (existsSync(source)) cpSync(source, publicDir, { recursive: true, errorOnExist: true, force: false });
  }
  const options = JSON.parse(readFileSync(resolve(core, 'tsconfig.json'), 'utf8')).compilerOptions;
  writeFileSync(resolve(runtime, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { ...options, incremental: false, paths: { '@/*': [`${core}/*`], '@edition/*': [`${application}/*`] } },
    include: [`${core}/**/*.ts`, `${core}/**/*.tsx`, `${application}/**/*.ts`, `${application}/**/*.tsx`],
    exclude: ['**/node_modules/**'],
  }, null, 2));
  writeFileSync(resolve(runtime, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(resolve(runtime, 'vite.config.mjs'), `import { applicationConfig } from ${JSON.stringify(pathToFileURL(resolve(root, 'scripts/config-common.mjs')).href)};\nexport default applicationConfig(${JSON.stringify({ edition, runtime, core, application, root, testing, port: Number(port) })});\n`);
  const { configuration } = await import(pathToFileURL(resolve(application, 'runtime.config.mjs')).href);
  const config = await configuration({ root, testing, port: Number(port), production: false });
  config.main = resolve(core, 'worker/index.ts');
  config.d1_databases = config.d1_databases.map(database => ({ ...database, migrations_dir: resolve(application, 'drizzle') }));
  writeFileSync(resolve(runtime, 'wrangler.local.json'), JSON.stringify(config, null, 2));
  return { runtime, core, application };
}
export async function main([edition = 'selfhost', action = 'dev', ...args] = process.argv.slice(2)) {
  const portFlag = args.indexOf('--port');
  const port = portFlag >= 0 ? args[portFlag + 1] : process.env.CONDUCTOR_PORT || process.env.PORT || '3001';
  const { runtime, core, application } = await prepareRuntime(edition, { testing: process.env.LASTFIND_TESTING === 'true', port });
  const bin = name => resolve(root, 'node_modules/.bin', name);
  if (action === 'dev' || action === 'db') {
    const state = resolve(runtime, '.wrangler', process.env.LASTFIND_TESTING === 'true' ? 'test-state' : 'state');
    run(bin('wrangler'), ['d1', 'migrations', 'apply', 'DB', '--local', '--config', 'wrangler.local.json', '--persist-to', state], { cwd: runtime, stdio: ['ignore', 'inherit', 'inherit'] });
    if (action === 'db') return runtime;
  }
  if (action === 'dev' || action === 'build') {
    run(bin('vinext'), [action, ...args], { cwd: runtime, env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_SEND_METRICS: 'false' } });
  } else if (action === 'typecheck') {
    run(bin('tsc'), ['--noEmit', '--project', resolve(runtime, 'tsconfig.json')]);
  } else if (action === 'test') {
    const tests = [resolve(core, 'tests'), resolve(application, 'tests')].flatMap(dir => files(dir).filter(path => path.endsWith('.test.ts') || path.endsWith('.test.mjs')).map(path => resolve(dir, path)));
    runTestFiles(tests);
  } else if (action === 'integration') {
    run(process.execPath, [resolve(root, 'scripts/integration.mjs'), edition]);
  } else throw new Error(`Unknown command: ${action}`);
  return runtime;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
