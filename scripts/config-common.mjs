import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export function applicationConfig(options) {
  return defineConfig(async ({ command }) => {
    const { root, core, application, runtime, testing, port } = options;
    process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
    process.env.WRANGLER_WRITE_LOGS ??= 'false';
    process.env.WRANGLER_LOG_PATH = resolve(runtime, '.wrangler/logs');
    process.env.MINIFLARE_REGISTRY_PATH = resolve(runtime, '.wrangler/registry');
    const { configuration } = await import(pathToFileURL(resolve(application, 'runtime.config.mjs')).href);
    const config = await configuration({ root, testing, port, production: command === 'build' });
    config.main = resolve(core, 'worker/index.ts');
    config.d1_databases = config.d1_databases.map(database => ({ ...database, migrations_dir: resolve(application, 'drizzle') }));
    // Development values are deliberately opt-in and worktree-local. Production
    // .env and operator files are never copied into a generated app or build.
    const devVars = resolve(root, `.env.dev.${options.edition}`);
    if (command === 'serve' && !testing && existsSync(devVars)) {
      const { parseEnv } = await import('node:util');
      config.vars = { ...config.vars, ...parseEnv(readFileSync(devVars, 'utf8')) };
    }
    const { cloudflare } = await import('@cloudflare/vite-plugin');
    return {
      resolve: { alias: { '@': core, '@edition': application } },
      css: { postcss: { plugins: [tailwindcss({base: application})] } },
      server: { port, fs: { allow: [root] }, ...(process.env.CODEX_SANDBOX === 'seatbelt' ? { watch: { useFsEvents: false, usePolling: true } } : {}) },
      plugins: [vinext(), cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] }, persistState: { path: resolve(runtime, '.wrangler', testing ? 'test-state' : 'state') }, config })],
    };
  });
}
