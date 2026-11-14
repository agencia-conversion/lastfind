// Classifier notice copy, and type panels no longer print an unclassified remainder line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stubs = {
  './shared': "import {createElement} from 'react'; export const SiteFavicon=()=>null; export const EmptyState=(p)=>createElement('div',{role:p.tone==='error'?'alert':undefined},p.title,p.description,p.action);",
  '@/components/ui/button': "import {createElement} from 'react'; export const Button=(p)=>createElement('button',null,p.children); export const buttonVariants=()=>'';",
};
const bundle = await build({
  stdin: {
    contents:
      "import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {ClassifierNotice,SourceTypesPanel} from './components/analytics/source-types-ui';export const renderPanel=(props)=>renderToStaticMarkup(React.createElement(SourceTypesPanel,props));export const renderNotice=(props)=>renderToStaticMarkup(React.createElement(ClassifierNotice,props));",
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

const en = (a) => a;
const pt = (_, b) => b;
const ready = { state: 'ready', provider: 'liquid', model: 'm', rubric: 'r' };
const notice = (classifier, unclassified, extra = {}, t = en) =>
  mod.exports.renderNotice({ classifier, unclassified, noun: 'domains', onClassify() {}, onConfigure() {}, t, ...extra });
const panel = (classifier, unclassified, t = en) =>
  mod.exports.renderPanel({
    report: {
      classifier,
      citations: 1000,
      classified: 1000 - unclassified,
      unclassified,
      truncated: false,
      pendingBatches: 0,
      types: [
        ...(unclassified < 1000 ? [{ type: 'editorial', citations: 1000 - unclassified, share: ((1000 - unclassified) / 1000) * 100 }] : []),
        ...(unclassified ? [{ type: 'unclassified', citations: unclassified, share: (unclassified / 1000) * 100 }] : []),
      ],
    },
    loading: false, failed: false, locale: 'en', t, onSelectType() {}, onClassify() {}, onConfigure() {},
  });

test('"the evaluator is off" appears only when it is off and a source has no type', () => {
  const off = { ...ready, state: 'disabled' };
  assert.doesNotMatch(notice(off, 0), /evaluator is off/);
  assert.equal(notice(off, 0), '');
  assert.match(notice(off, 3), /source evaluator is off/);
  assert.match(notice(off, 3, {}, pt), /avaliador de fontes est/);
  for (const state of ['unconfigured', 'unavailable']) assert.equal(notice({ ...ready, state }, 0), '', `${state} with nothing to classify`);
  assert.match(notice({ ...ready, state: 'unavailable' }, 2), /not enabled for this project/);
  assert.doesNotMatch(panel(off, 0), /evaluator is off|not classified yet|ainda não classificado/);
});

test('with classification automatic there is no explanatory banner and no "only when you ask"', () => {
  const automatic = { ...ready, automatic: true };
  assert.equal(notice(automatic, 5), '', 'automatic idle: no how-it-works banner');
  assert.doesNotMatch(notice(automatic, 5), /only when you ask|classified automatically|<button/);
  assert.equal(notice(automatic, 0), '', 'nothing to say once everything has a type');
  const label = panel(automatic, 6);
  assert.doesNotMatch(label, /classified automatically|about once an hour|only when you ask/);
  assert.doesNotMatch(label, /not classified yet|ainda não classificado|<button[^>]*>Classify|Not classified|Não classificado/);
});

test('a project without automatic classification keeps the manual button and its explanation', () => {
  const html = notice(ready, 5);
  assert.match(html, /runs only when you ask/);
  assert.match(html, /Classify domains/);
  assert.match(panel(ready, 6), /runs only when you ask|Classify domains/);
  assert.doesNotMatch(panel(ready, 6), /not classified yet|ainda não classificado|Not classified|Não classificado/);
  assert.doesNotMatch(notice(ready, 5), /automatically/);
  // A running batch is still reported as running.
  assert.match(notice(ready, 0, { pending: true }), /Classification is running/);
});

test('an automatic project drops waiting/paused how-to copy and keeps the monthly ceiling', () => {
  const auto = (activity) => ({ ...ready, automatic: true, activity });
  assert.equal(notice(auto('running'), 6), '');
  assert.doesNotMatch(panel(ready, 6), /not classified yet|ainda não classificado/);
  for (const activity of ['waiting', 'paused']) {
    for (const t of [en, pt]) {
      assert.equal(notice(auto(activity), 6, {}, t), '', activity);
      assert.doesNotMatch(panel(auto(activity), 6, t), /about once an hour|is paused|está pausada|not classified yet|ainda não classificado|Not classified|Não classificado|Classify/, activity);
    }
  }
  assert.match(notice(auto('ceiling'), 6), /resumes next month/);
  assert.match(notice(auto('ceiling'), 6, {}, pt), /retoma no mês que vem/);
  assert.doesNotMatch(notice(auto('ceiling'), 6), /<button/);
  // Nothing without a type: nothing to explain, in any state.
  for (const activity of ['waiting', 'paused', 'ceiling']) assert.equal(notice(auto(activity), 0), '');
});

test('no internal model name reaches the notice or the panel', () => {
  const html = ['running', 'waiting', 'paused', 'ceiling'].map((activity) => { const c = { ...ready, automatic: true, activity, model: 'liquid/d1-ultra', provider: 'liquid' }; return notice(c, 3) + panel(c, 3); }).join('');
  assert.doesNotMatch(html, /d1-ultra|liquid|jev|typesafe|openrouter/i);
});

test('type panel never lists unclassified in the donut or legend, even when the report includes it', () => {
  const html = panel(ready, 400);
  assert.match(html, /aria-label="[^"]*: Editorial, 100%"/);
  assert.doesNotMatch(html, /Not classified|Não classificado|not classified yet|ainda não classificado|40%/);
});
