import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';

// Metadata from generateMetadata (docs sections, blog articles) is rendered blocking, inside <head>, for every user
// agent instead of streamed into the body for browsers and Googlebot: crawlers (Google's raw HTML pass included) read
// title, description, canonical, hreflang and JSON-LD only there. Next's htmlLimitedBots decides which agents get it
// blocking; any non-empty agent matches. Those routes' metadata is computed in memory, so the shell waits for nothing
// (time to first byte measured equal on /docs/plans and /blog/geo).
export const METADATA_IN_HEAD = '.';
import { defineConfig } from 'vite';

export function applicationConfig(options) {
  return defineConfig(async ({ command }) => {
    const { root, core, application, runtime, testing, port } = options;
    process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
    process.env.WRANGLER_WRITE_LOGS ??= 'false';
    process.env.WRANGLER_LOG_PATH = resolve(runtime, '.wrangler/logs');
    process.env.MINIFLARE_REGISTRY_PATH = resolve(runtime, '.wrangler/registry');
    const { configuration, configureVite } = await import(pathToFileURL(resolve(application, 'runtime.config.mjs')).href);
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
    const justBash = resolve(core, 'worker/just-bash-stub.mjs');
    const { cloudflare } = await import('@cloudflare/vite-plugin');
    // Edition-owned frontend tooling may add plugins/aliases, never override
    // the shared Worker entrypoint or the Cloudflare configuration above.
    const frontend = configureVite
      ? await configureVite({ root, application, runtime, testing, command })
      : {};
    return {
      // The agent SDK's MCP client imports pkce-challenge, which exports only `node` and `browser` builds: the Worker
      // takes the browser one (Web Crypto). Its skill script runner imports just-bash, a shell interpreter Lastfind never
      // runs (no skill carries a script): a stand-in, also inside pre-bundled dependencies.
      resolve: {
        alias: {
          ...frontend.aliases,
          '@': core,
          '@edition': application,
          'pkce-challenge': resolve(root, 'node_modules/pkce-challenge/dist/index.browser.js'),
          'just-bash': justBash,
        },
      },
      optimizeDeps: { exclude: ['next/link'] },
      // The agent chat's React hooks (a client component) are never part of the server graph: its server environment
      // must not pre-bundle them (swr has no default export under react-server).
      environments: {
        rsc: {
          optimizeDeps: {
            exclude: ['@cloudflare/think/react', 'agents/react', 'agents/chat/react', '@ai-sdk/react', 'swr'],
            rolldownOptions: { plugins: [{ name: 'lastfind-just-bash', resolveId: (id) => (id === 'just-bash' ? justBash : null) }] },
          },
        },
      },
      css: { postcss: { plugins: [tailwindcss({base: application})] } },
      server: { port, fs: { allow: [root] }, ...(process.env.CODEX_SANDBOX === 'seatbelt' ? { watch: { useFsEvents: false, usePolling: true } } : {}) },
      plugins: [...(frontend.plugins ?? []), vinext({ nextConfig: { htmlLimitedBots: METADATA_IN_HEAD } }), cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] }, persistState: { path: resolve(runtime, '.wrangler', testing ? 'test-state' : 'state') }, config })],
    };
  });
}
