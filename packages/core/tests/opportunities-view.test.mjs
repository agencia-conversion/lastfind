import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Opportunities and the intents of Query Fan Out, rendered on the server with fixtures: every state says why it has no
// data (never a zero), in English and Portuguese, and "Create content" hands Contents a plain-text brief.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await build({
  stdin: {
    contents: `import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {SidebarProvider} from './components/ui/sidebar';
    import {OpportunitiesView, OpportunityPage} from './components/analytics/opportunities-view';
    import {FanoutView} from './components/analytics/fanout-view';
    export {buildFanout} from './lib/fanout';
    export const opportunities=p=>renderToStaticMarkup(<OpportunitiesView {...p}/>);
    export const opportunity=p=>renderToStaticMarkup(<SidebarProvider><OpportunityPage {...p}/></SidebarProvider>);
    export const fanout=p=>renderToStaticMarkup(<FanoutView {...p}/>);`,
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
        builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'next/image', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: "import React from 'react';export default ({unoptimized,priority,fill,...p})=>React.createElement('img',p)",
          loader: 'js',
        }));
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
const ui = mod.exports;

const intent = { id: 'prices', name: 'Streaming prices', description: 'Plans compared by price.', entities: [{ type: 'location', value: 'Brazil' }] };
const row = {
  intent,
  impact: 3,
  answers: 4,
  gapAnswers: 3,
  missing: ['chat_gpt', 'claude'],
  engines: [{ engine: 'chat_gpt', answers: 2, mentioned: 0, gap: 2 }, { engine: 'claude', answers: 2, mentioned: 0, gap: 1 }],
  prompts: [{ id: 'p1', text: 'Cheapest streaming?', gap: 2 }],
  promptCount: 1,
  queries: [{ key: 'netflix price', text: 'Netflix price', occurrences: 2 }],
  queryCount: 1,
  competitors: [{ name: 'Hulu', answers: 2 }],
  sources: [{ domain: 'tecmundo.com.br', count: 2 }],
};
const report = { responses: 10, withFanout: 6, queries: 8, classified: 6, intents: 3, opportunities: [row], truncated: false };
const link = (target) => ({ href: `/app/netflix/${target.tab ?? ''}?days=28`, onClick() {} });

for (const locale of ['en', 'pt-BR']) {
  const t = (en, pt) => (locale === 'en' ? en : pt);
  const render = (props) => ui.opportunities({ report, loading: false, failed: false, onRetry() {}, locale, t, link, ...props });
  test(`Opportunities: loading, error and every empty state explains itself (${locale})`, () => {
    assert.match(render({ loading: true }), /aria-busy="true"/);
    assert.match(render({ failed: true }), locale === 'en' ? /The report did not load/ : /O relatório não carregou/);
    assert.match(render({ report: { ...report, responses: 0 } }), locale === 'en' ? /No responses in this period yet/ : /Ainda não há respostas neste período/);
    assert.match(render({ report: { ...report, withFanout: 0 } }), locale === 'en' ? /Searches not returned/ : /Buscas não informadas/);
    const waiting = render({ report: { ...report, classified: 0, opportunities: [] } });
    assert.match(waiting, locale === 'en' ? /Intents are on their way/ : /As intenções estão a caminho/);
    assert.match(waiting, /8/);
    assert.match(render({ report: { ...report, opportunities: [] } }), locale === 'en' ? /No opportunities in this period/ : /Nenhuma oportunidade neste período/);
  });
  test(`Opportunities: the list shows the intent, its entities and who misses the brand (${locale})`, () => {
    const html = render({});
    assert.match(html, /Streaming prices/);
    // One line per row: the entities in their own column, their kinds in its balloon; no badges under the intent.
    assert.match(html, locale === 'en' ? /aria-description="Location: Brazil"/ : /aria-description="Local: Brazil"/);
    assert.match(html, />Brazil</);
    assert.match(html, /aria-description="Streaming prices\nPlans compared by price\."/);
    assert.doesNotMatch(html, /tag-badge/);
    assert.doesNotMatch(html, /whitespace-normal/);
    assert.match(html, locale === 'en' ? /3 of 4/ : /3 de 4/);
    assert.match(html, /Hulu/);
    assert.match(html, /75%/, 'six of eight searches classified');
    assert.match(html, locale === 'en' ? /Summary \(1\)/ : /Resumo \(1\)/, 'the Summary row counts the list');
    assert.match(html, locale === 'en' ? /Columns/ : /Colunas/, 'the column picker is in the toolbar');
    // A row opens the opportunity on its own page (no row expands in place).
    assert.match(html, /<tr[^>]*data-clickable=""[^>]*tabindex="0"/);
    assert.doesNotMatch(html, /aria-expanded="true"/);
    assert.doesNotMatch(html, /tecmundo\.com\.br/, 'the detail is not expanded in the list');
    assert.doesNotMatch(html, /\u00b7|\u2022| \| | — /);
  });
  test(`Opportunities: the opportunity's page has the way back, its figures, drill-downs and Create content (${locale})`, () => {
    const number = new Intl.NumberFormat(locale);
    const html = ui.opportunity({ row, number, t, link, onBack() {} });
    assert.match(html, /<h1>Streaming prices<\/h1>/);
    assert.match(html, /Plans compared by price\./);
    assert.match(html, locale === 'en' ? /aria-label="Back to the opportunities"/ : /aria-label="Voltar às oportunidades"/);
    assert.match(html, /tecmundo\.com\.br/);
    assert.match(html, /Cheapest streaming\?/);
    assert.match(html, /Netflix price/);
    assert.match(html, /Hulu/);
    const create = /<a href="([^"]+)"[^>]*aria-label="(?:Create content for|Criar conteúdo para) Streaming prices"/.exec(html);
    assert.ok(create, 'Create content is a real link');
    const target = new URL(create[1].replaceAll('&amp;', '&'), 'https://app.test');
    assert.equal(target.pathname, '/app/netflix/contents');
    assert.equal(target.searchParams.get('days'), '28', 'the period travels with it');
    const brief = target.searchParams.get('new');
    assert.match(brief, locale === 'en' ? /^Intent: Streaming prices\n/ : /^Intenção: Streaming prices\n/);
    assert.match(brief, /ChatGPT, Claude/);
    assert.match(brief, /"Netflix price"/);
    assert.doesNotMatch(brief, /\u00b7|\u2022| \| | — /);
    assert.doesNotMatch(html, /\u00b7|\u2022| \| | — /);
    // An address whose opportunity left the period says so, with the way back.
    assert.match(ui.opportunity({ row: undefined, number, t, link, onBack() {} }), locale === 'en' ? /This opportunity is not in this period/ : /Esta oportunidade não está neste período/);
  });
}

test('Query Fan Out opens on its intents once the period has some, and on the queries before, with the reason', () => {
  const t = (en) => en;
  const run = (id, queries) => ({ id, engine: 'chat_gpt', prompt_id: `p-${id}`, prompt_text: 'streaming', topic: 'Plans', created_at: '2026-10-20T10:00:00Z', queries, mentioned: false, cited: false });
  const runs = [run('1', ['Netflix price', 'weather']), run('2', ['netflix price'])];
  const props = (grouping) => ({
    report: ui.buildFanout(runs, [{ engine: 'chat_gpt', responses: 2 }], [], '', [], grouping),
    navigation: { search: '', kind: 'all', page: 1, selected: null, term: null },
    onNavigation() {},
    loading: false,
    failed: false,
    onRetry() {},
    api: '/api',
    request() {},
    filters: 'days=28',
    refresh: 0,
    locale: 'en',
    t,
    link: () => ({ href: '/app/netflix/fanout', onClick() {} }),
  });
  const waiting = ui.fanout(props({}));
  assert.match(waiting, /Intents appear after the next collection is classified: 2 searches/);
  assert.match(waiting, /aria-selected="true"[^>]*>Queries</);
  assert.doesNotMatch(waiting, />Intent</, 'no intent column before there are intents');
  const grouped = ui.fanout(props({ intents: [intent], assignments: new Map([['netflix price', 'prices'], ['weather', '']]) }));
  assert.match(grouped, /aria-selected="true"[^>]*>Intents</);
  assert.match(grouped, /Streaming prices/);
  assert.match(grouped, /Location: Brazil/);
  assert.match(grouped, /Searches that fit no intent: 1\./);
  assert.match(grouped, /aria-expanded="false"/);
});
