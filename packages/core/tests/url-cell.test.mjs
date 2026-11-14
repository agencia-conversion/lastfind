import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await build({
  stdin: {
    contents:
      "import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {UrlCell,urlLabel} from './components/analytics/url-cell';export {urlLabel};export const render=(props)=>renderToStaticMarkup(React.createElement(UrlCell,{link:(target)=>({href:'/app?entity='+target.entity.key,onClick(){}}),t:(en)=>en,...props}));",
    resolveDir: root + 'packages/core',
    loader: 'tsx',
  },
  jsx: 'automatic',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['react', 'react-dom/server', 'react/jsx-runtime', 'lucide-react'],
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'stubs',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/shared$/ }, () => ({ path: 'shared', namespace: 'stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const SiteFavicon=()=>null;', loader: 'js' }));
      },
    },
  ],
});
const loaded = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, (await import('node:module')).createRequire(root + 'package.json'));
const { render, urlLabel } = loaded.exports;

const url = 'https://example.com/guide';

test('a known title labels the link and the URL stays in the tooltip', () => {
  const html = render({ url, title: 'The guide' });
  assert.match(html, /<a href="\/app\?entity=https:\/\/example\.com\/guide"[^>]*aria-description="https:\/\/example\.com\/guide"><span class="truncate">The guide</);
  assert.doesNotMatch(html, /<small/);
});

test('without a title (or with the URL as title) the URL is the label', () => {
  assert.equal(urlLabel(url), url);
  assert.equal(urlLabel(url, ''), url);
  assert.equal(urlLabel(url, url), url);
  assert.match(render({ url, title: url }), />https:\/\/example\.com\/guide<\/span>/);
});

test('the icon opens the external page in a new tab, beside the in-app link', () => {
  const html = render({ url, title: 'The guide' });
  assert.match(html, /<a href="https:\/\/example\.com\/guide" target="_blank" rel="noopener noreferrer"[^>]*aria-label="Open page in a new tab: /);
});

test('secondary prints the URL under a known title only', () => {
  assert.match(render({ url, title: 'The guide', secondary: true }), /<small class="st-url">https:\/\/example\.com\/guide<\/small>/);
  assert.doesNotMatch(render({ url, secondary: true }), /<small/);
});

test('an empty URL renders no link and no icon', () => {
  const html = render({ url: '' });
  assert.doesNotMatch(html, /target="_blank"/);
  assert.doesNotMatch(html, /href=/);
});
