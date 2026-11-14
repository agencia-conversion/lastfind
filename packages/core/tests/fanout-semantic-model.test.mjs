import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await build({
  stdin: {
    contents: `import React from 'react';
      import {renderToStaticMarkup} from 'react-dom/server';
      import {LocaleProvider} from './lib/i18n';
      import {FanoutView} from './components/analytics/fanout-view';
      import {SemanticAssociationReport} from './components/analytics/semantic-association-report';
      export const fanout=p=>renderToStaticMarkup(<LocaleProvider initialLocale={p.locale}><FanoutView {...p}/></LocaleProvider>);
      export const semantic=(report,locale)=>renderToStaticMarkup(<LocaleProvider initialLocale={locale}><SemanticAssociationReport report={report} idPrefix="semantic-perception" overall={{}} lead={<p>score</p>} after={<p>sources</p>} explanations={()=>null}/></LocaleProvider>);
      export {FanoutView};`,
    resolveDir: root + 'packages/core', loader: 'tsx',
  },
  bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
  loader: { '.css': 'empty' },
  plugins: [{ name: 'fixture-image', setup(b) {
    b.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'next/image', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: `import React from 'react';export default ({unoptimized,priority,fill,...p})=><img {...p}/>;`, loader: 'tsx',
    }));
  } }],
});
const require = createRequire(root + 'package.json');
const mod = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, mod, mod.exports);
const ui = mod.exports;
const queries = Array.from({ length: 26 }, (_, i) => ({
  key: 'query ' + i, text: i === 25 ? '=SUM(1,2)' : 'query ' + i, kind: 'search',
  occurrences: i === 25 ? 75 : 1, prompts: 1, topic: '', engines: ['chat_gpt'],
  mentionedRate: i === 25 ? 100 : 0, citedRate: i === 25 ? 0 : 100,
}));
const report = { responses: 100, withFanout: 100, occurrences: 100, distinct: 26,
  engines: [], queries, termTrend: [], daily: [], terms: [], added: [], brands: [], sites: [], topics: [] };
const props = (locale = 'en', page = 1) => ({
  navigation: { search: '', kind: 'all', selected: null, term: null, page },
  onNavigation() {}, report, loading: false, failed: false, onRetry() {}, api: '/api/demo',
  request: () => { throw Error('No provider or network in fixtures'); }, filters: '', refresh: 0,
  locale, t: (en, pt) => locale === 'en' ? en : pt, link: () => ({ href: '/demo?tab=fanout', onClick() {} }),
});

for (const locale of ['en', 'pt-BR']) {
  test(`Fan Out summary weights the full filtered set across both pages (${locale})`, () => {
    const first = ui.fanout(props(locale));
    const second = ui.fanout(props(locale, 2));
    for (const html of [first, second]) {
      assert.match(html, /data-fill="true"/);
      assert.match(html, locale === 'en' ? /Summary \(26\)/ : /Resumo \(26\)/);
      assert.match(html, /75%/);
      assert.match(html, /25%/);
      assert.match(html, /compact-pagination/);
      assert.doesNotMatch(html, /NaN|export-button/);
    }
    assert.match(first, locale === 'en' ? /1 to 25 of 26/ : /1 a 25 de 26/);
    assert.match(second, locale === 'en' ? /26 to 26 of 26/ : /26 a 26 de 26/);
    assert.match(second, /=SUM\(1,2\)/);
    assert.doesNotMatch(second, /query 0</);
    const narrowed = props(locale);
    narrowed.navigation.search = 'query 0';
    assert.match(ui.fanout(narrowed), locale === 'en' ? /Summary \(1\)/ : /Resumo \(1\)/);
  });
  test(`Semantic sub-header uses existing sections and only offers a rendered radar (${locale})`, () => {
    const attributes = Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: 'Attribute ' + i }));
    const brand = { entity: { id: 'own', name: 'Acme', domain: 'acme.example' },
      attributes: attributes.map((attribute) => ({ attribute, observedValue: 80, observedDenominator: 3 })) };
    const semantic = { configuration: { attributes }, own: brand, brands: [brand] };
    const html = ui.semantic(semantic, locale);
    for (const section of ['summary', 'heatmap', 'radar', 'explanations', 'sources']) {
      assert.match(html, new RegExp(`aria-controls="semantic-perception-${section}"`));
      assert.match(html, new RegExp(`id="semantic-perception-${section}"`));
    }
    assert.match(html, locale === 'en' ? /Report sections/ : /Seções do relatório/);
    assert.ok(html.indexOf('semantic-section-tabs') < html.indexOf('id="semantic-perception-summary"'));
    assert.match(html, locale === 'en' ? /Who is associated with what/ : /Quem é associado a quê/);
    // Drill down: the brand and its overall score open its justifications, as each attribute's note does.
    // Your brand in bold, without the "You" label.
    assert.match(html, locale === 'en' ? /<button type="button" class="semantic-site drill-link font-\(--weight-strong\)" aria-label="Acme\. Read its justifications">/ : /aria-label="Acme\. Ler as justificativas"/);
    assert.doesNotMatch(html, locale === 'en' ? />You</ : />Você</);
    assert.match(html, locale === 'en' ? /aria-label="Acme: Overall score No evidence\. Read its justifications"/ : /aria-label="Acme: Score geral Sem evidência\. Ler as justificativas"/);
    // The radar draws every brand of the project, never a cut, and its legend comes under it.
    const rivals = Array.from({ length: 5 }, (_, i) => ({ ...brand, entity: { id: 'rival' + i, name: 'Rival ' + i, domain: `rival${i}.example` } }));
    const many = ui.semantic({ ...semantic, brands: [brand, ...rivals] }, locale);
    const radar = many.slice(many.indexOf('id="semantic-perception-radar"'), many.indexOf('id="semantic-perception-explanations"'));
    assert.equal(radar.match(/fill-opacity=".045"/g)?.length, 6);
    // The legend is the catalog's ChartLegend, every brand a toggle, under the radar.
    assert.ok(radar.indexOf('chart-legend') > radar.indexOf('<svg'));
    assert.equal(radar.match(/aria-pressed="true"/g)?.length, 6);
    assert.match(radar, /Rival 4/);
    const noRadar = { ...semantic, configuration: { attributes: attributes.slice(0, 2) } };
    assert.doesNotMatch(ui.semantic(noRadar, locale), /aria-controls="semantic-perception-radar"/);
  });
}

test('Fan Out global export uses the filtered loaded rows and keeps CSV formula protection', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react');
  const { create, act } = require('react-test-renderer');
  const action = { current: null };
  let renderer, csv, downloaded;
  const previousDocument = globalThis.document;
  const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { csv = blob; return 'blob:fixture'; };
  URL.revokeObjectURL = () => {};
  globalThis.document = { createElement: () => ({ click() { downloaded = this.download; } }) };
  // The cells' balloons (catalog Hint) look up the window and the DOM classes when they mount.
  const previous = { window: globalThis.window, Element: globalThis.Element, HTMLElement: globalThis.HTMLElement };
  const dom = { Element: class {}, HTMLElement: class {} };
  Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {}, ...dom }, ...dom });
  try {
    const p = props();
    p.navigation.search = 'query 25';
    await act(async () => { renderer = create(React.createElement(ui.FanoutView, { ...p, ref: action })); });
    assert.equal(typeof action.current, 'function');
    action.current();
    assert.equal(downloaded, 'query-fan-out.csv');
    const text = await csv.text();
    assert.match(text, /"'=SUM\(1,2\)"/);
    assert.doesNotMatch(text, /query 0/);
    await act(async () => renderer.unmount());
    assert.equal(action.current, null);
  } finally {
    globalThis.document = previousDocument;
    Object.assign(globalThis, previous);
    URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
  }
});

test('Fan Out route identity changes by level and term, not table filters or pagination', () => {
  const live = readFileSync(root + 'packages/core/components/analytics/live-app.tsx', 'utf8');
  const expression = live.match(/const routeKey = (JSON.stringify\([^\n]+\));/)[1];
  const identity = new Function('navState', 'fanoutNavigation', `return ${expression};`);
  const navigation = props().navigation;
  const key = (change) => { const fanout = { ...navigation, ...change }; return identity({ projectId: 'fixture', tab: 'fanout', fanout }, fanout); };
  assert.notEqual(key({}), key({ selected: 'query 0' }));
  assert.notEqual(key({}), key({ term: 'channel' }));
  assert.equal(key({}), key({ search: 'Netflix', kind: 'site', page: 2 }));
});
