import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const liveApp = readFileSync(root + 'packages/core/components/analytics/live-app.tsx', 'utf8');
const summaryPager = liveApp.slice(liveApp.indexOf('  const summaryPager ='), liveApp.indexOf('  const promptPagerFrom ='));
const responsesPager = liveApp.slice(liveApp.indexOf('  const responsePages ='), liveApp.indexOf('  // The Summary counts'));
const bundle = await build({
  stdin: {
    contents: `import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {AnswerMarkdown} from './components/analytics/answer-markdown';
    import {LocaleProvider} from './lib/i18n';
    import {useCollectionPage,CompactPagination} from './components/analytics/shared';
    import {SemanticJustifications} from './components/analytics/semantic-justifications';
    export {justificationText,representative} from './components/analytics/semantic-justifications';
    const Collection=({size})=>useCollectionPage(Array(size).fill(null),'fixture',1,undefined,'', {page:1000,onPage:()=>{}}).controls;
    export const collection=(locale,size)=>renderToStaticMarkup(<LocaleProvider initialLocale={locale}><Collection size={size}/></LocaleProvider>);
    export const attribute=(locale,data,brand)=>renderToStaticMarkup(<LocaleProvider initialLocale={locale}><SemanticJustifications data={data} brand={brand} attribute="series" attributeName={()=>'Series and originals'} evidence={{base:'/e',scope:'',period:'2026-10-12',request:()=>new Promise(()=>{})}} link={()=>({href:'#',onClick(){}})}/></LocaleProvider>);
    import {formatNumber} from './lib/number-format';
    export const responses=(locale,history,historyPages,responsePage,total)=>{
      const currentHistory=responsePage===1?history:historyPages[responsePage-2];
      const tabSummary=total==null?null:{metrics:{responses:total}};
      const t=(en,pt)=>locale==='pt-BR'?pt:en;
      const calls=[];
      const setResponsePage=page=>calls.push(['cached',page]);
      const loadMore=(...args)=>calls.push(['load',...args]);
      ${summaryPager}
      const renderPager=summaryPager;
      ${responsesPager.replace('summaryPager({', '(pager => { globalThis.responsePager = pager; return renderPager(pager); })({')}
      return {html:renderToStaticMarkup(<LocaleProvider initialLocale={locale}>{responsesPager}</LocaleProvider>),select:globalThis.responsePager.onPage,pages:globalThis.responsePager.pages,calls};
    };
    export {formatNumber,formatPercent} from './lib/number-format';
    export {modelEvidenceText} from './components/analytics/model-evidence';
    export const answer=text=>renderToStaticMarkup(<AnswerMarkdown text={text}/>);
    export const highlighted=(text,names)=>renderToStaticMarkup(<AnswerMarkdown text={text} highlight={{own:[names[0]],others:names.slice(1)}}/>);`,
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
      name: 'aliases',
      setup(builder) {
        // The real PageFilters portals into the page header (client only).
        builder.onResolve({ filter: /^@\/components\/lastfind\/presentation\/page-heading$/ }, () => ({ path: 'page-heading', namespace: 'stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: "import React from 'react';export const PageFilters=({children})=>React.createElement(React.Fragment,null,children);",
          loader: 'js',
          resolveDir: root,
        }));
        builder.onResolve({ filter: /^@\// }, (args) => {
          const base = root + 'packages/core/' + args.path.slice(2);
          return {
            path:
              ['.ts', '.tsx'].map((e) => base + e).find(existsSync) ??
              base + '.ts',
          };
        });
      },
    },
  ],
});
const mod = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(root + 'package.json'),
  mod,
  mod.exports,
);
const ui = mod.exports;

test('justifications: one row per brand, best note first, with the note and the AIs\' disagreement in its header, never a count', () => {
  for (const locale of ['en', 'pt-BR']) {
    for (const reliable of [true, false]) {
      const cell = (score, engines) => ({ attribute: 'series', reliable, score, samples: Object.keys(engines).length, units: Object.keys(engines).length, engines });
      const data = {
        ownBrand: 'Netflix',
        answered: ['chat_gpt', 'claude', 'perplexity'],
        scores: [
          { name: 'Netflix', domain: 'netflix.com', attributes: [cell(90, { chat_gpt: { score: 70 }, claude: { score: 100 }, perplexity: { score: 100 } })] },
          { name: 'Rival', domain: 'rival.test', attributes: [cell(95, { chat_gpt: { score: 95 }, claude: { score: 95 }, perplexity: { score: 95 } })] },
          { name: 'Quiet', domain: 'quiet.test', attributes: [] },
        ],
        added: [],
      };
      // Rival chosen in the heatmap: its row is the open one, the others stay closed; your brand is in bold (no "You" label), no tint.
      const html = ui.attribute(locale, data, 'Rival');
      assert.match(html, /data-slot="accordion" data-variant="rows"/);
      const rows = html.split('data-slot="accordion-item"').slice(1);
      const headers = rows.map((row) => row.slice(0, row.indexOf('</h3>')));
      assert.deepEqual(headers.map((header) => /wrap-anywhere[^"]*">([^<]+)</.exec(header)[1]), ['Rival', 'Netflix', 'Quiet']);
      assert.deepEqual(headers.map((header) => header.includes('aria-expanded="true"')), [true, false, false]);
      assert.doesNotMatch(html, /data-highlight/);
      assert.deepEqual(headers.map((header) => header.includes('wrap-anywhere font-(--weight-strong)')), [false, true, false]);
      assert.doesNotMatch(html, locale === 'en' ? />You</ : />Você</);
      assert.match(headers[1], new RegExp(`<span class="sr-only">${locale === 'en' ? 'Note' : 'Nota'} </span>90</span>`));
      // Only the note beside the brand: no count of AIs or evaluations (since 9/11/2026).
      assert.doesNotMatch(headers[1], /\d\/\d (AIs|IAs)/);
      assert.match(headers[1], new RegExp(`>${locale === 'en' ? 'AIs disagree' : 'IAs divergem'}</span>`));
      assert.doesNotMatch(headers[0], /disagree|divergem/);
      assert.equal(headers[1].includes(locale === 'en' ? 'little evidence' : 'pouca evidência'), !reliable);
      // A brand without notes is a dash, never a zero.
      assert.match(headers[2], new RegExp(`${locale === 'en' ? 'No note' : 'Sem nota'} </span>—</span>`));
      // The open row loads what the AIs answered.
      assert.match(rows[0], /aria-busy="true"/);
    }
  }
});

test('a brand added since the collection says it enters the next one, not "no evidence" (6/11/2026)', () => {
  for (const [locale, text] of [['en', 'Added after this collection: it enters the next one.'], ['pt-BR', 'Adicionada depois desta coleta: entra na próxima.']]) {
    const data = { ownBrand: 'Netflix', answered: ['chat_gpt'], scores: [{ name: 'Netflix', domain: 'netflix.com', attributes: [] }, { name: 'New', domain: 'new.test', attributes: [] }], added: ['New'] };
    const html = ui.attribute(locale, data, 'New');
    assert.ok(html.includes(text), locale);
    assert.doesNotMatch(html.split('data-slot="accordion-item"').find((row) => row.includes('>New<')), /no evidence\.|sem evidência\./);
  }
});

test('justification: the AIs\' reasons as one paragraph, each once, each closed by a full stop', () => {
  assert.equal(ui.justificationText(['Strong catalog', null, ' Strong catalog ', 'Many originals!', '', 'Wide range.']), 'Strong catalog. Many originals! Wide range.');
  assert.equal(ui.justificationText([null, '  ']), '');
  // The justification is one answer's, as in the reference: the note closest to the mean (here 80), one with a reason and evidences first.
  const answer = (id, score, reason = 'Why.', evidence = ['Fact.']) => ({ id, reading: { score, reason, evidence } });
  assert.equal(ui.representative([answer('a', 95), answer('b', 79, null), answer('c', 81), answer('d', 65)]).id, 'c');
  assert.equal(ui.representative([answer('a', 90), answer('b', 70)]).id, 'a');
});

test('response detail renders markdown instead of raw symbols', () => {
  const html = ui.answer(
    '# Title\n\nUse **Acme** via [site](https://acme.example).\n\n- one\n- two',
  );
  assert.match(html, /<strong>Acme<\/strong>/);
  assert.match(
    html,
    /<a href="https:\/\/acme\.example" target="_blank" rel="noopener noreferrer">site<\/a>/,
  );
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.doesNotMatch(html, /\*\*|\]\(|# Title|- one/);
});

test('response detail markdown never emits raw HTML or unsafe links', () => {
  const html = ui.answer(
    '<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>',
  );
  assert.doesNotMatch(html, /<script|<img|href="javascript/i);
  assert.match(html, /&lt;script&gt;/);
});

test('response detail renders markdown tables with safe cells', () => {
  const html = ui.answer(
    '| Service | Link |\n|:---|---:|\n| **Netflix** | [site](https://n.example) |\n| Evil | [x](javascript:alert(1)) |',
  );
  // The app's one table (DataTable): its classes, its alignment and the label each cell shows on a phone.
  assert.match(html, /data-slot="table"[^>]*analytics-table/);
  assert.match(html, /data-slot="table-head"[^>]*>Service</);
  assert.match(html, /data-slot="table-head"[^>]*text-right[^>]*>Link</);
  assert.match(html, /data-slot="table-cell"[^>]*data-label="Service"><strong>Netflix<\/strong>/);
  assert.match(html, /<a href="https:\/\/n\.example" target="_blank" rel="noopener noreferrer">site<\/a>/);
  assert.doesNotMatch(html, /\|---|\*\*|href="javascript/i);
});

test('percentages use a comma in pt-BR and a dot in English', () => {
  assert.equal(ui.formatPercent('pt-BR', 30.64), '30,6%');
  assert.equal(ui.formatPercent('en', 30.64), '30.6%');
  assert.equal(ui.formatNumber('pt-BR', 2, 1), '2,0');
  assert.equal(ui.formatNumber('en', 2, 1), '2.0');
  const row = { responses: 3, citationCoverage: 66.67 };
  const t = (en) => en;
  assert.equal(ui.modelEvidenceText(row, 'citationCoverage', 'pt-BR', t), '66,7%');
  assert.equal(ui.modelEvidenceText(row, 'citationCoverage', 'en', t), '66.7%');
});

test('live app uses the shared formatter, the translated status and a short search placeholder', () => {
  const source = readFileSync(
    root + 'packages/core/components/analytics/live-app.tsx',
    'utf8',
  );
  assert.doesNotMatch(source, /toFixed/);
  assert.match(source, /detail\.status === 'complete' \? t\('Complete', 'Concluída'\)/);
  assert.match(source, /placeholder=\{t\('Search…', 'Buscar…'\)\} ariaLabel=\{t\('Search questions'/);
});


test('integer presentation groups thousands by language and preserves small counts in both editions', () => {
  for (const [locale, grouped] of [['en', '2,237'], ['pt-BR', '2.237']]) {
    assert.equal(ui.formatNumber(locale, 2237), grouped);
    assert.equal(ui.formatNumber(locale, 1000), locale === 'en' ? '1,000' : '1.000');
    for (const count of [0, 1, 999]) assert.equal(ui.formatNumber(locale, count), String(count));
    const pagination = ui.collection(locale, 2237);
    assert.ok(pagination.includes(`${locale === 'en' ? 'Page' : 'Página'} ${locale === 'en' ? '1,000' : '1.000'} / ${grouped}, ${grouped}`));
    assert.equal(ui.collection(locale, 0), '');
  }
});


test('model visibility keeps the absent marker when there are no responses', () => {
  const source = readFileSync(root + 'packages/core/components/analytics/live-app.tsx', 'utf8');
  const file = ts.createSourceFile('live-app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cells = [];
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const key = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(file) === 'key');
      const cell = node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(file) === 'cell');
      if (key?.initializer.getText(file) === "'visibility'" && cell && cell.initializer.getText(file).includes('item.responses')) {
        cells.push(cell.initializer.getText(file));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(cells.length, 1);
  for (const locale of ['en', 'pt-BR']) {
    for (const expression of cells) {
      // The figure is a drill-down link: its text is what the cell shows.
      const js = ts.transpileModule(`(${expression})`, { compilerOptions: { jsx: ts.JsxEmit.React }, fileName: 'cell.tsx' }).outputText;
      const React = { createElement: (_type, _props, ...children) => children.join('') };
      const cell = new Function('React', 'DrillLink', 'link', 'locale', 'formatPercent', 'formatNumber', `return ${js}`)(React, null, null, locale, ui.formatPercent, ui.formatNumber);
      assert.equal(cell({responses:0, visibility:0}), '—');
      assert.equal(cell({responses:2237, visibility:30.6}), locale === 'en' ? '30.6%' : '30,6%');
    }
  }
});


test('response summary pager uses the known total and fetches any selected page, keeping cursor paging without a total', () => {
  for (const [locale, total] of [['en', '3,461'], ['pt-BR', '3.461']]) {
    const history = { runs: Array(25).fill({}), nextCursor: 'next' };
    const known = ui.responses(locale, history, [], 1, 3461);
    assert.ok(known.html.includes(locale === 'en' ? `1 to 25 of ${total}` : `1 a 25 de ${total}`));
    // The page picker is the app's Select (its options render when it opens): the pager offers every page.
    assert.equal(known.pages, 139);
    assert.doesNotMatch(known.html, /<select/);
    known.select(139);
    assert.deepEqual(known.calls, [['load', 139]]);
    const last = ui.responses(locale, history, [...Array(137), {runs:Array(11).fill({}),nextCursor:null}], 139, 3461);
    assert.ok(last.html.includes(locale === 'en' ? `3,451 to 3,461 of ${total}` : `3.451 a 3.461 de ${total}`));
    last.select(1);
    assert.deepEqual(last.calls, [['cached', 1]]);
    const unknown = ui.responses(locale, history, [], 1, undefined);
    assert.ok(unknown.html.includes(locale === 'en' ? '1 to 25 of 25+' : '1 a 25 de 25+'));
    assert.equal(unknown.pages, 2);
    unknown.select(2);
    assert.deepEqual(unknown.calls, [['load', 2, 'next']]);
    const end = ui.responses(locale, {runs:Array(11).fill({}),nextCursor:null}, [], 1, undefined);
    assert.ok(end.html.includes(locale === 'en' ? '1 to 11 of 11' : '1 a 11 de 11'));
    assert.doesNotMatch(end.html, /11\+/);
  }
});

test('brand marks follow the rendered Markdown: never a name twice, never a raw bold marker (bold, links, lists, tables, headings)', () => {
  const names = ['Conversion', 'Semrush', 'Ubersuggest'];
  const text = (html) => html.replace(/<[^>]+>/g, '');
  const marks = (html) => [...html.matchAll(/<mark class="([^"]+)">([^<]+)<\/mark>/g)].map((match) => match[2]);
  // Google AI Mode writes a linked name twice, as text and as its link, and breaks its bold around the links it adds
  // (a production answer of 12/11/2026, read as "SemrushSemrush" with the asterisks showing).
  const aiMode = [
    '- Semrush[Semrush](https://www.semrush.com/) ** /** Ubersuggest[Ubersuggest](https://neilpatel.com/ubersuggest/) ** (Bundle)**',
    '\t- **Price:** varies; see Semrush[Semrush](https://www.semrush.com/prices/).[[1]](https://www.google.com/search?q=semrush)',
  ].join('\n');
  const html = ui.highlighted(aiMode, names);
  assert.doesNotMatch(text(html), /SemrushSemrush|UbersuggestUbersuggest|\*\*/);
  assert.match(html, /<a href="https:\/\/www\.semrush\.com\/"[^>]*><mark class="live-answer-mark">Semrush<\/mark><\/a>/);
  assert.deepEqual(marks(html), ['Semrush', 'Ubersuggest', 'Semrush']);
  assert.match(text(html), /Semrush  \/ Ubersuggest  \(Bundle\)/);
  // Bold, a link, a list, a table and a heading with a brand: each marked once, inside its formatting, no marker left.
  const formatted = ui.highlighted(
    [
      '## Semrush vs Ubersuggest',
      '',
      'The leaders are **Semrush** and [Ubersuggest](https://neilpatel.com/ubersuggest/), with **[Conversion](https://conversion.com.br)** for services.',
      '',
      '1. **Semrush:** complete.',
      '2. *Ubersuggest* – cheaper.',
      '',
      '| Tool | Price |',
      '|---|---|',
      '| **Semrush** | high |',
      '| [Ubersuggest](https://neilpatel.com/ubersuggest/) | low |',
    ].join('\n'),
    names,
  );
  assert.doesNotMatch(text(formatted), /SemrushSemrush|UbersuggestUbersuggest|ConversionConversion|\*\*/);
  assert.deepEqual(marks(formatted), ['Semrush', 'Ubersuggest', 'Semrush', 'Ubersuggest', 'Conversion', 'Semrush', 'Ubersuggest', 'Semrush', 'Ubersuggest']);
  assert.match(formatted, /<strong><mark class="live-answer-mark">Semrush<\/mark><\/strong>/);
  assert.match(formatted, /<mark class="live-answer-mark live-answer-mark-own">Conversion<\/mark>/);
  // A name that only ends like the link text, or an asterisk the answer escaped, stays as written.
  assert.match(text(ui.highlighted('BigSemrush[Semrush](https://www.semrush.com/)', names)), /^BigSemrushSemrush$/);
  assert.match(text(ui.highlighted("Don't F\\*\\*k with Cats", names)), /F\*\*k/);
});
