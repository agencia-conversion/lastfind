import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// The documentation as pages: an index and one URL per section, every section described, old one-page anchors mapped to
// their page, and the scroll spy marking the heading being read (also at the end of a page).
const root = fileURLToPath(new URL('../../../', import.meta.url));
const stubs = {
  '@/lib/i18n': 'export const useI18n = () => ({ locale: globalThis.__docsLocale ?? "en" });',
  '@/components/ui/breadcrumb':
    "import {createElement as h} from 'react'; const c = (tag) => (p) => h(tag, {href: p.href}, p.children); export const Breadcrumb = c('nav'), BreadcrumbList = c('ol'), BreadcrumbItem = c('li'), BreadcrumbLink = c('a'), BreadcrumbPage = c('span'), BreadcrumbSeparator = () => null;",
};
const bundle = await build({
  stdin: {
    contents:
      "import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {DocsLayout, docsAnchorSection, headingInView} from './components/lastfind/docs/docs-layout'; import {productDocsSections} from './components/lastfind/docs/product-docs'; export {docsAnchorSection, headingInView, productDocsSections}; export const render = (props) => renderToStaticMarkup(React.createElement(DocsLayout, props));",
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
      name: 'boundaries',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
        builder.onResolve({ filter: /^@\// }, (args) => {
          const base = root + 'packages/core/' + args.path.slice(2);
          return { path: ['.ts', '.tsx'].map((extension) => base + extension).find(existsSync) ?? base + '.ts' };
        });
      },
    },
  ],
});
const docs = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(docs, docs.exports, createRequire(root + 'packages/core/package.json'));
const { render, docsAnchorSection, headingInView, productDocsSections } = docs.exports;

const en = (english) => english;
const pt = (_english, portuguese) => portuguese;
const groups = [
  { id: 'use', label: 'Get started' },
  { id: 'product', label: 'Features' },
  { id: 'settings', label: 'Settings' },
];

for (const edition of ['cloud', 'selfhost']) {
  test(`${edition}: every section page has a slug, a title and its own description in both languages`, () => {
    for (const l of [en, pt]) {
      const sections = productDocsSections(l, edition);
      const ids = sections.flatMap((s) => [s.id, ...s.subs.map((x) => x.id)]);
      assert.equal(new Set(ids).size, ids.length, 'section and part ids are unique (old anchors map to one page)');
      assert.equal(new Set(sections.map((s) => s.description)).size, sections.length);
      for (const s of sections) {
        assert.match(s.id, /^[a-z0-9-]+$/);
        assert.equal(typeof s.title, 'string');
        assert.ok(s.description.length >= 70 && s.description.length <= 170, `${s.id}: ${s.description.length} characters`);
        assert.match(s.description, /\.$/);
        assert.doesNotMatch(`${s.title} ${s.description}`, /[\u00b7\u2022|]| \u2014 /);
      }
    }
  });
}

test('the index lists every section page and renders no section body', () => {
  const sections = productDocsSections(en, 'cloud');
  const html = render({ base: '/docs', hero: { title: 'Docs', lead: 'All of it.' }, groups, sections, breadcrumbs: [] });
  for (const s of sections) {
    assert.ok(html.includes(`href="/docs/${s.id}"`), s.id);
    assert.ok(html.includes(s.description), s.id);
  }
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<h2 id="group-product">/);
  assert.doesNotMatch(html, /id="visibility"|aria-current="page"[^>]*>Metrics</);
  assert.doesNotMatch(html, /href="#(?!group-)/, 'no in-page links to sections');
});

test('a section page: its h1, parts as h2, the current page marked, related and pager as page links', () => {
  globalThis.__docsLocale = 'pt-BR';
  const sections = productDocsSections(pt, 'cloud');
  const html = render({ base: '/pt-br/docs', section: 'metrics', hero: { title: 'Docs', lead: '' }, groups, sections, breadcrumbs: [] });
  globalThis.__docsLocale = undefined;
  const metrics = sections.find((s) => s.id === 'metrics');
  assert.ok(html.includes(`<h1>${metrics.title}</h1>`));
  assert.ok(html.includes(metrics.description));
  for (const part of metrics.subs) assert.match(html, new RegExp(`<h2 id="${part.id}">`));
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<h3\b/);
  assert.match(html, /href="\/pt-br\/docs\/metrics" aria-current="page">Métricas</);
  assert.match(html, /href="\/pt-br\/docs\/start" rel="prev"/);
  assert.match(html, /href="\/pt-br\/docs\/filters" rel="next"/);
  for (const id of metrics.related) assert.ok(html.includes(`class="text-link" href="/pt-br/docs/${id}"`), id);
  // "On this page" lists only this page's parts.
  const toc = html.match(/<nav class="docs-toc"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.deepEqual([...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]), metrics.subs.map((x) => x.id));
});

test('old one-page anchors land on the page that holds them', () => {
  const sections = productDocsSections(en, 'selfhost');
  assert.equal(docsAnchorSection(sections, 'metrics')?.id, 'metrics');
  assert.equal(docsAnchorSection(sections, 'visibility')?.id, 'metrics');
  assert.equal(docsAnchorSection(sections, 'fan-out')?.id, 'prompts');
  assert.equal(docsAnchorSection(sections, 'group-product'), undefined);
  assert.equal(docsAnchorSection(sections, 'nothing'), undefined);
});

test('scroll spy: the last heading above the reading line, and at the end of the page the last one on screen', () => {
  const height = 900;
  assert.equal(headingInView([300, 900, 1600], { end: false, height }), -1, 'before the first heading');
  assert.equal(headingInView([100, 700, 1400], { end: false, height }), 0, 'a heading reached by an anchor jump (scroll margin 100px)');
  assert.equal(headingInView([-600, -40, 500], { end: false, height }), 1, 'reading the second part');
  // A short last part at the bottom: it never reaches the line, but it is the one on screen at the end.
  assert.equal(headingInView([-600, -40, 500], { end: true, height }), 2);
  assert.equal(headingInView([-600, 300, 500, 1000], { end: true, height }), 2, 'a heading below the screen is not read');
});
