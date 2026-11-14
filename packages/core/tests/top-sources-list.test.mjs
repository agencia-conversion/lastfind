import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stubs = {
  './shared': "import {createElement} from 'react'; export const SiteFavicon=()=>null; export const EmptyState=(p)=>createElement('div',{role:p.tone==='error'?'alert':undefined},p.title,p.description,p.action);",
  '@/components/ui/button': "export const Button=()=>null; export const buttonVariants=()=>'';",
};
const bundle = await build({
  stdin: {
    contents:
      "import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {TopSourcesList,SourceTypesPanel,ContentTypesPanel} from './components/analytics/source-types-ui';export const renderTypes=(props,content=false)=>renderToStaticMarkup(React.createElement(content?ContentTypesPanel:SourceTypesPanel,props));export const render=(props)=>renderToStaticMarkup(React.createElement(TopSourcesList,props));",
    resolveDir: root + 'packages/core',
    loader: 'tsx',
  },
  jsx: 'automatic',
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
        builder.onResolve({ filter: /^@\// }, (args) => {
          const base = root + 'packages/core/' + args.path.slice(2);
          return { path: ['.ts', '.tsx'].map((extension) => base + extension).find(existsSync) ?? base + '.ts' };
        });
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

test('Top content reuses the URL grouping with page title when present', () => {
  const page = {
    ...row,
    key: 'https://reddit.com/r/seo',
    domain: 'reddit.com',
    title: 'SEO tips',
    responses: 9,
  };
  const html = mod.exports.render({ state: 'ready', rows: [page], link, t, group: 'url' });
  assert.match(html, /SEO tips/);
  assert.match(html, /Top content|Page/);
  assert.match(mod.exports.render({ state: 'ready', rows: [], link, t, group: 'url' }), /No cited pages in this period/);
});


test('top sources table sorts before taking five and preserves type/ownership on the domain line', () => {
  const rows = Array.from({length: 6}, (_,i) => ({...row,key:'source'+i,domain:'source'+i+'.example',responses:i+1,presence:{presence:i+1,slots:i+1},ownership:i===5?'own':i===4?'competitor':'third-party'}));
  const html=mod.exports.render({state:'ready',rows,link,t});
  assert.ok(html.indexOf('source5.example') < html.indexOf('source4.example'));
  assert.doesNotMatch(html,/source0.example/);
  assert.match(html,/st-name-line/);assert.match(html,/>You</);assert.match(html,/>Competitor</);
  assert.match(html,/Domain|Presence/);
  assert.equal(rows[0].responses,1);
  const unknown=mod.exports.render({state:'ready',rows:[{...row,key:'',domain:'',sourceType:'unclassified'}],link,t});
  assert.match(unknown,/Unknown domain/);assert.match(unknown,/Not classified/);
});
test('donut legends follow citation totals with unchanged identity colors', () => {
  const report={classifier:{state:'ready'},citations:10,classified:10,unclassified:0,truncated:false,pendingBatches:0,types:[{type:'corporate',citations:2,share:20},{type:'editorial',citations:8,share:80}]};
  for(const content of [false,true]) {
    const html=mod.exports.renderTypes({report,loading:false,failed:false,locale:'en',t,onSelectType(){}},content);
    assert.ok(html.indexOf('Editorial, 80%') > 0 && html.indexOf('Editorial, 80%') < html.indexOf('Corporate, 20%'));
    assert.match(html,/background:var\(--source-type-editorial\)/);
  }
  assert.equal(report.types[0].type,'corporate');
});
test('top sources table shows the localized presence percent, never a response count under the presence header', () => {
  for (const [locale, grouped] of [['en', '2,237'], ['pt-BR', '2.237']]) {
    const presence = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(19.2);
    assert.match(mod.exports.render({state:'ready',rows:[{...row,presence:{presence:19.2,slots:1}}],link,t,locale}), new RegExp(`${presence.replace('.', '\\.')}%`));
    const withoutPresence = mod.exports.render({state:'ready',rows:[{...row,responses:2237}],link,t,locale});
    assert.doesNotMatch(withoutPresence, new RegExp(grouped.replace('.', '\\.')));
    assert.match(withoutPresence, /—/);
    assert.doesNotMatch(mod.exports.render({state:'ready',rows:[],link,t,locale}), /st-count|>0</);
  }
});

for (const locale of ['en', 'pt-BR'])
  test(`missing source evaluation configuration has neutral copy and a guide (${locale})`, () => {
    const t = (en, pt) => locale === 'en' ? en : pt;
    const report = { classifier: { state: 'unconfigured', provider: 'jev', model: 'typesafe/jev-1.14' }, citations: 2, classified: 0, unclassified: 2, truncated: false, pendingBatches: 0, types: [] };
    for (const content of [false, true]) {
      const html = mod.exports.renderTypes({ report, loading: false, failed: false, locale, t, onSelectType() {} }, content);
      assert.doesNotMatch(html, /OpenRouter|typesafe|jev|Liquid|Decisions/);
      assert.match(html, locale === 'en' ? /Source classification is not available on this installation yet/ : /A classificação de fontes ainda não está disponível nesta instalação/);
      assert.match(html, /href="\/docs"/);
    }
  });
