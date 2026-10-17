import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stubs = {
  './shared': "export const SiteFavicon=()=>null;",
  '@/components/ui/button': "export const Button=()=>null;",
};
const bundle = await build({
  stdin: {
    contents:
      "import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {TopSourcesList} from './components/analytics/source-types-ui';export const render=(props)=>renderToStaticMarkup(React.createElement(TopSourcesList,props));",
    resolveDir: root + 'packages/core',
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['react', 'react-dom/server', 'react/jsx-runtime'],
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
        builder.onResolve({ filter: /^@\// }, (args) => ({ path: root + 'packages/core/' + args.path.slice(2) + '.ts' }));
      },
    },
  ],
});
const mod = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(root + 'package.json'), mod, mod.exports);

const t = (en) => en;
const link = () => ({ href: '#', onClick() {} });
const row = { key: 'reddit.com', domain: 'reddit.com', title: '', responses: 4, citations: 5, pages: 2, engines: [], mentions: 1, visibility: 10, ownership: 'third-party', sourceType: 'ugc' };

test('Top sources shows a busy loading state, never "no sources", while the report is pending', () => {
  const html = mod.exports.render({ state: 'loading', rows: [], link, t });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Loading sources/);
  assert.doesNotMatch(html, /No cited sources/);
});

test('Top sources reports a failure instead of claiming there are no sources', () => {
  const html = mod.exports.render({ state: 'failed', rows: [], link, t });
  assert.match(html, /role="alert"/);
  assert.match(html, /Could not load the sources/);
  assert.doesNotMatch(html, /No cited sources/);
});

test('Top sources says "no sources" only for an empty response, and lists rows when present', () => {
  assert.match(mod.exports.render({ state: 'ready', rows: [], link, t }), /No cited sources in this period/);
  const html = mod.exports.render({ state: 'ready', rows: [row], link, t });
  assert.match(html, /reddit\.com/);
  assert.doesNotMatch(html, /No cited sources|aria-busy/);
});
