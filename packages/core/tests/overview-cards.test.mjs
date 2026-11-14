import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const liveApp = readFileSync(root + 'packages/core/components/analytics/live-app.tsx', 'utf8');
const overviewKpis = liveApp.match(/<OverviewKpis[\s\S]*?<\/OverviewKpis>/)?.[0];
assert.ok(overviewKpis, 'Overview composes sentiment inside the KPI strip');
assert.ok(liveApp.indexOf(overviewKpis) < liveApp.indexOf('{summary.metrics.responses ?'));
// An installation without DataForSEO keys says collection is off, in the empty Overview and in the monitoring line.
assert.equal((liveApp.match(/workspace\.config\?\.dataforseo === false/g) || []).length, 2);
assert.match(liveApp, /Monitoring is off: this installation has no search data key\./);
assert.match(liveApp, /Add it in Admin > Providers/);
// The monitoring line names the cadence only: the queue size is operational.
assert.doesNotMatch(liveApp, /monitoring\?\.pending/);
const bundle = await build({
  stdin: {
    contents: `import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {FanoutView} from './components/analytics/fanout-view';
    export {buildFanout} from './lib/fanout';
    export const fanout=p=>renderToStaticMarkup(<FanoutView {...p}/>);
    import {OverviewKpis} from './components/analytics/overview-kpis';
    import {SourceTypesPanel,ContentTypesPanel,TopSourcesList} from './components/analytics/source-types-ui';
    export const kpis=p=>renderToStaticMarkup(<OverviewKpis {...p}/>);
    export const siteTypes=p=>renderToStaticMarkup(<SourceTypesPanel {...p}/>);
    export const contentTypes=p=>renderToStaticMarkup(<ContentTypesPanel {...p}/>);
    export const topSources=p=>renderToStaticMarkup(<TopSourcesList {...p}/>);
    import {SourcesPresenceTable} from './components/analytics/sources-presence';
    export const sourcesTable=p=>renderToStaticMarkup(<SourcesPresenceTable {...p}/>);
    export {sentimentScore} from './components/analytics/overview-sentiment-card';
    export {summarizeSentiment,sentimentByUnit} from './lib/brand-research';
    import {OverviewSentimentCard,useOverviewSentiment} from './components/analytics/overview-sentiment-card';
    import {RecentResponsesTable} from './components/analytics/recent-responses-table';
    import {ModelEvidenceNotice,modelEvidenceColumns} from './components/analytics/model-evidence';
    import {DataTable} from './components/lastfind/presentation/data-table';
    import {Note} from './components/lastfind/presentation/note';
    import {TagBadge} from './components/lastfind/presentation/tag-badge';
    export {sortRows} from './components/lastfind/presentation/data-table';
    export {collectionWindow} from './components/analytics/shared';
    export const table=p=>renderToStaticMarkup(<DataTable {...p}/>);
    export const note=p=>renderToStaticMarkup(<Note {...p}/>);
    export const badge=p=>renderToStaticMarkup(<TagBadge {...p}/>);
    export {hasModelEvidence,modelEvidenceText,modelsSummaryValues} from './components/analytics/model-evidence';
    export const sentiment=p=>renderToStaticMarkup(<OverviewSentimentCard {...p}/>);
    const LiveSentiment=p=>{const read=useOverviewSentiment(p);return <OverviewSentimentCard brand={p.brand} locale={p.locale} demo={p.demo} {...read}/>};
    export const demo=p=>renderToStaticMarkup(<LiveSentiment {...p}/>);
    export const overview=({summary,locale,t,link,project,filterQuery,cache,demoMode,transport,sentiment,workspace={},processing=false,evaluating=false})=>renderToStaticMarkup(${overviewKpis});
    export const recent=p=>renderToStaticMarkup(<RecentResponsesTable {...p}/>);
    import {TopTerms} from './components/analytics/fanout-view';
    export const topTerms=p=>renderToStaticMarkup(<TopTerms {...p}/>);
    import {MoreCompetitorsNote} from './components/analytics/more-competitors-note';
    export const competitorsNote=p=>renderToStaticMarkup(<MoreCompetitorsNote {...p}/>);
    export const evidence=(rows,locale,t)=>renderToStaticMarkup(<><DataTable rows={rows} columns={modelEvidenceColumns(rows,locale,t)} rowKey={r=>r.key}/><ModelEvidenceNotice rows={rows} t={t}/></>);`,
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
        builder.onResolve({ filter: /^next\/image$/ }, () => ({
          path: 'next/image',
          namespace: 'fixture',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            "import React from 'react';export default ({unoptimized,priority,fill,...p})=>React.createElement('img',p)",
          loader: 'js',
        }));
        builder.onResolve({ filter: /^@\// }, (args) => {
          const base = root + 'packages/core/' + args.path.slice(2);
          return {
            path:
              ['.ts', '.tsx']
                .map((extension) => base + extension)
                .find(existsSync) ?? base + '.ts',
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
const ui = mod.exports,
  t = (en) => en;
const brand = {
  brand: 'Netflix',
  prompts: 4,
  assessed: 4,
  absent: 0,
  partial: 0,
  pending: 0,
  insufficient: 0,
  ambiguous: 0,
  failed: 0,
  distribution: { positive: 3, neutral: 1, negative: 0 },
  // Question means 90, 90, 97 and 75: index 88.
  scoreTotal: 352,
};
const report = {
  selectedChannels: 4,
  brands: [brand],
  configuration: { enabled: true },
  configured: true,
  allowed: true,
  truncated: false,
};
const props = { brand: 'Netflix', locale: 'en', demo: false, report };

test('sentiment uses the selected brand question aggregate, including measured zero and disabled historic data', () => {
  assert.match(ui.sentiment(props), /class="metric-number">88</);
  // No count of evaluated questions anywhere on the card, not even in its info (since 10/11/2026).
  assert.doesNotMatch(ui.sentiment(props), /evaluated questions|perguntas avaliadas/);
  // The index carries its promoter, neutral and detractor shares as a bar on its line, never as a text line under it.
  assert.match(ui.sentiment(props), /class="metric-number">88<span class="sentiment-bar"[^>]*><span class="sr-only">Promoters 75%, Neutral 25%, Detractors 0%<\/span>/);
  // Each band carries its own tone (neutral is yellow, --sentiment-neutral).
  assert.match(ui.sentiment(props), /<span data-band="positive" style="flex-grow:75;--band-tone:var\(--state-good\)">75%<\/span><span data-band="neutral" style="flex-grow:25;--band-tone:var\(--sentiment-neutral\)">25%<\/span><\/span>/);
  assert.doesNotMatch(ui.sentiment(props), /<p><span>Promoters/);
  assert.match(
    ui.sentiment({
      ...props,
      report: {
        ...report,
        brands: [
          {
            ...brand,
            distribution: { positive: 0, neutral: 0, negative: 4 },
            scoreTotal: 0,
          },
        ],
      },
    }),
    /class="metric-number">0</,
  );
  const historic = ui.sentiment({
    ...props,
    report: {
      ...report,
      configuration: { enabled: false },
      truncated: true,
      brands: [{ ...brand, partial: 2 }],
    },
  });
  for (const value of [
    'metric-number">88<',
    'Sentiment evaluation is off for this project.',
  ])
    assert.ok(historic.includes(value));
  assert.doesNotMatch(historic, /Partial evaluation coverage|limited sample/);
  // Server setup reasons explain a missing score, never sit beside a saved one.
  for (const setup of [{ allowed: false }, { configured: false }]) {
    const saved = ui.sentiment({ ...props, operator: true, report: { ...report, ...setup } });
    assert.match(saved, /metric-number">88</);
    assert.doesNotMatch(saved, /not enabled for this project|not configured on this server/);
    const unmeasured = { ...report, ...setup, brands: [{ ...brand, assessed: 0, pending: 4 }] };
    // Only the owner of an independent installation hears about server setup; everyone else reads one neutral line.
    assert.match(
      ui.sentiment({ ...props, operator: true, report: unmeasured }),
      setup.configured === false ? /not configured on this server/ : /Waiting for the evaluation of these answers\./,
    );
    const customer = ui.sentiment({ ...props, report: unmeasured });
    assert.match(customer, /Waiting for the evaluation of these answers\./);
    assert.doesNotMatch(customer, /not enabled for this project|not configured on this server/);
  }
  assert.doesNotMatch(
    ui.sentiment({ ...props, brand: 'Other' }),
    /metric-number">88</,
  );
});
test('the sentiment index is the mean of the 0–100 scores, rounded to an integer, in both locales', () => {
  for (const locale of ['en', 'pt-BR']) {
    for (const [scoreTotal, distribution, index, shares] of [
      [400, { positive: 4, neutral: 0, negative: 0 }, 100, ['100%', '0%', '0%']],
      [240, { positive: 2, neutral: 0, negative: 2 }, 60, ['50%', '0%', '50%']],
      [330, { positive: 1, neutral: 3, negative: 0 }, 83, ['25%', '75%', '0%']],
    ]) {
      const html = ui.sentiment({
        ...props,
        locale,
        report: { ...report, brands: [{ ...brand, distribution, scoreTotal }] },
      });
      assert.ok(html.includes(`class="metric-number">${index}<span class="sentiment-bar"`));
      assert.match(html, locale === 'en' ? /Sentiment index from 0 to 100/ : /Índice de sentimento de 0 a 100/);
      // The card's label is one word, one line in both languages (card-row harmony); the info says it is an index.
      assert.match(html, locale === 'en' ? /Sentiment<\/span>/ : /Sentimento<\/span>/);
      const [promoters, neutral, detractors] = shares;
      assert.ok(html.includes(locale === 'en' ? `Promoters ${promoters}, Neutral ${neutral}, Detractors ${detractors}` : `Promotores ${promoters}, Neutros ${neutral}, Detratores ${detractors}`));
      assert.doesNotMatch(html, /evaluated questions|perguntas avaliadas/);
    }
  }
});
test('sentiment explains a missing score with one strongest reason; a measured score carries no coverage caveat', () => {
  for (const locale of ['en', 'pt-BR']) {
    const tr = (en, pt) => (locale === 'en' ? en : pt);
    const off = tr(
      'Sentiment evaluation is off for this project.',
      'A avaliação de sentimento está desligada neste projeto.',
    );
    const notYet = tr('Waiting for the evaluation of these answers.', 'Aguardando a avaliação destas respostas.');
    // Failures, queue and coverage are operational: never on the Overview.
    const operational = [
      tr('Some evaluations failed.', 'Algumas avaliações falharam.'),
      tr('Sentiment evaluation in progress.', 'Avaliação de sentimento em andamento.'),
      tr('Partial evaluation coverage.', 'Cobertura de avaliação parcial.'),
    ];
    const reasons = [off, notYet, notYet, notYet];
    for (const assessed of [0, 4]) {
      for (let priority = 0; priority < reasons.length; priority++) {
        const html = ui.sentiment({
          ...props,
          locale,
          report: {
            ...report,
            configuration: { enabled: priority > 0 },
            truncated: true,
            brands: [
              {
                ...brand,
                assessed,
                failed: priority <= 1 ? 1 : 0,
                pending: priority <= 2 ? 1 : 0,
                partial: 1,
              },
            ],
          },
        });
        // Measured: only the project-level "off" survives; unmeasured: one neutral line.
        const shown = assessed && priority > 0 ? null : reasons[priority];
        if (shown) assert.ok(html.includes(shown));
        for (const other of [...reasons, ...operational].filter((reason) => reason !== shown))
          assert.ok(!html.includes(other));
        assert.match(
          html,
          assessed
            ? /class="metric-number">88</
            : /class="metric-number"><span class="text-body">/,
        );
      }
    }
  }
});
test('sentiment shows one row per project channel, with a dash where the channel has no evaluated question', () => {
  const html = ui.sentiment({
    ...props,
    engines: ['chat_gpt', 'gemini'],
    report: {
      ...report,
      brands: [{ ...brand, channels: [{ engine: 'chat_gpt', assessed: 2, distribution: { positive: 1, neutral: 1, negative: 0 }, scoreTotal: 150 }] }],
    },
  });
  assert.match(html, /class="metric-rows"/);
  assert.match(html, /ChatGPT<\/dt><dd>75<\/dd>/);
  assert.match(html, /Gemini<\/dt><dd>—<\/dd>/);
});
test('unmeasured sentiment, request loading and failure explain absence without fabricated zero', () => {
  for (const [extra, expected] of [
    [{ loading: true }, /aria-busy="true"/],
    [{ error: 'failed' }, /Could not load sentiment/],
    [
      { report: { ...report, selectedChannels: 0 } },
      /No responses in this period/,
    ],
    [
      {
        report: {
          ...report,
          brands: [
            {
              ...brand,
              assessed: 0,
              pending: 4,
              failed: 1,
              ambiguous: 1,
              insufficient: 1,
            },
          ],
        },
      },
      /Waiting for the evaluation of these answers\./,
    ],
    [
      { report: { ...report, brands: [{ ...brand, assessed: 0, absent: 4 }] } },
      /No brand mentions/,
    ],
  ]) {
    const html = ui.sentiment({ ...props, ...extra });
    assert.match(html, expected);
    assert.doesNotMatch(html, /class="metric-number">\d|NaN/);
  }
  // The demo reads the public aggregate (it never calls the private endpoint) and shows the score once the project is evaluated.
  assert.match(
    ui.demo({ projectId: 'demo', brand: 'Netflix', filters: new URLSearchParams(), refresh: 0, demo: true, locale: 'pt-BR' }),
    /Carregando sentimento deste período/,
  );
  const demoProps = { ...props, demo: true, report: { ...report, configured: undefined, allowed: undefined } };
  assert.match(ui.sentiment(demoProps), /class="metric-number">88</);
  assert.doesNotMatch(ui.sentiment(demoProps), /evaluated questions/);
  for (const [report, expected] of [
    [undefined, /Sentiment is not available in this demo/],
    [{ configuration: { enabled: false }, selectedChannels: 0, brands: [] }, /Sentiment is not available in this demo/],
    [{ ...demoProps.report, brands: [{ ...brand, assessed: 0, pending: 4 }] }, /Waiting for the evaluation of these answers\./],
    [{ ...demoProps.report, brands: [] }, /Waiting for the evaluation of these answers\./],
  ]) {
    const html = ui.sentiment({ ...demoProps, report });
    assert.match(html, expected);
    assert.doesNotMatch(html, /class="metric-number">\d|NaN/);
  }
  assert.match(ui.sentiment({ ...demoProps, error: 'x', report: undefined, locale: 'pt-BR' }), /Sentimento não está disponível nesta demonstração/);
});
test('evidence shows measured coverage, never mistakes a missing list or response for a query count', () => {
  const row = {
    key: 'chat_gpt',
    responses: 2,
    citationCoverage: 100,
    consultedCoverage: 50,
  };
  const html = ui.evidence([row], 'en', t);
  assert.match(html, /100\.0%/);
  assert.match(html, /50\.0%/);
  assert.match(html, /Not a query count/);
  assert.match(
    ui.evidence(
      [{ ...row, citationCoverage: 0, consultedCoverage: 0 }],
      'en',
      t,
    ),
    />0\.0%/,
  );
  assert.match(
    ui.evidence(
      [{ ...row, citationCoverage: 0, consultedCoverage: 0 }],
      'en',
      t,
    ),
    /No citations returned/,
  );
  assert.equal(
    ui.hasModelEvidence({ ...row, consultedCoverage: 0 }, 'consultedCoverage'),
    false,
  );
  for (const value of [undefined, null, NaN]) {
    assert.equal(
      ui.modelEvidenceText(
        { ...row, citationCoverage: value },
        'citationCoverage',
        'en',
        t,
      ),
      'Not available',
    );
    assert.equal(
      ui.hasModelEvidence(
        { ...row, citationCoverage: value },
        'citationCoverage',
      ),
      false,
    );
  }
  assert.equal(
    ui.modelEvidenceText({ ...row, responses: 0 }, 'citationCoverage', 'en', t),
    'No responses in this period',
  );
  const noList = ui.evidence([{ ...row, consultedCoverage: 0 }, { ...row, key: 'b' }], 'en', t);
  assert.doesNotMatch(noList, /were not provided/);
  assert.match(noList, /did not provide it/);
  assert.equal(ui.modelEvidenceText({ ...row, consultedCoverage: 0 }, 'consultedCoverage', 'en', t), '—');
  // Summary row: counts add up, rates weigh each model by its responses, a model that sent no list adds nothing to consulted sources.
  const summary = ui.modelsSummaryValues([
    { ...row, key: 'a', responses: 10, mentions: 5, visibility: 50, citationCoverage: 100, consultedCoverage: 80 },
    { ...row, key: 'b', responses: 30, mentions: 3, visibility: 10, citationCoverage: 50, consultedCoverage: 0 },
    { ...row, key: 'c', responses: 0, mentions: 0, visibility: 0, citationCoverage: 0, consultedCoverage: 0 },
  ]);
  assert.deepEqual(summary, { responses: 40, mentions: 8, visibility: 20, citationCoverage: 62.5, consultedCoverage: 80 });
  assert.equal(ui.modelsSummaryValues([]).visibility, null);
  const none = ui.evidence([{ ...row, consultedCoverage: 0 }], 'en', t);
  assert.doesNotMatch(none, /Consulted sources/);
  const empty = ui.evidence([{ ...row, responses: 0 }], 'en', t);
  assert.doesNotMatch(empty, /Responses with citations \(%\)|Consulted sources provided \(%\)/);
  assert.match(empty, /No responses in this period/);
  const mixed = ui.evidence(
    [{ ...row, key: 'empty', responses: 0 }, row],
    'en',
    t,
  );
  assert.match(mixed, /Responses with citations \(%\)/);
  assert.match(mixed, /No responses in this period/);
});
test('model evidence uses the locale decimal separator in English and Portuguese', () => {
  for (const locale of ['en', 'pt-BR']) {
    const tr = (en, pt) => (locale === 'en' ? en : pt);
    const html = ui.evidence(
      [
        {
          key: 'chat_gpt',
          responses: 2,
          citationCoverage: 99.84,
          consultedCoverage: 92.4,
        },
      ],
      locale,
      tr,
    );
    const [a, b, other] = locale === 'en' ? ['99.8%', '92.4%', /99,8%|92,4%/] : ['99,8%', '92,4%', /99\.8%|92\.4%/];
    assert.ok(html.includes(a) && html.includes(b));
    assert.doesNotMatch(html, other);
  }
});
test('recent responses are an analytic table: the whole row is the link, sortable, no blue links, distinct unsettled states', () => {
  const run = (id, prompt, engine, at) => ({ id, engine, prompt_text: prompt, created_at: at });
  const p = {
    state: 'ready',
    runs: [run('r1', 'Which service?', 'chat_gpt', '2026-10-17T10:00:00Z'), run('r2', 'Best tool?', 'chat_gpt', '2026-10-18T10:00:00Z')],
    locale: 'en',
    t,
    link: (to) => ({ href: '/app?days=28&run=' + to.run, onClick() {} }),
  };
  const html = ui.recent(p);
  assert.equal((html.match(/<a /g) || []).length, 0);
  assert.equal((html.match(/<tr[^>]*data-clickable=""[^>]*tabindex="0"/g) || []).length, 2);
  assert.match(html, /Which service/);
  assert.equal((html.match(/class="table-sort"/g) || []).length, 3);
  assert.match(html, /aria-sort="descending"/);
  // Newest first by default.
  assert.ok(html.indexOf('Best tool?') < html.indexOf('Which service?'));
  assert.doesNotMatch(html, /live-response-card|live-list/);
  // Model and date take their content's width; the prompt takes the rest and truncates at its column's edge (CSS ellipsis),
  // never at a fixed number of characters or behind a fixed-width neighbour.
  assert.match(html, /<td[^>]*max-w-0"[^>]*><span class="block truncate"[^>]*aria-description="Best tool\?">/);
  assert.equal((html.match(/<th[^>]*w-px whitespace-nowrap/g) || []).length, 2);
  assert.match(html, /inline-flex min-w-max items-center/);
  assert.doesNotMatch(html, /max-w-\[\d+ch\]|table-fixed|w-48|w-40/);
  assert.match(ui.recent({ ...p, state: 'loading', runs: [] }), /aria-busy="true"/);
  assert.match(ui.recent({ ...p, state: 'failed', runs: [] }), /role="alert"/);
  assert.match(ui.recent({ ...p, runs: [] }), /No responses in this period/);
});

test('overview KPIs show the figure and its change only, with the concept and missing comparisons in the info tooltip, in both languages', () => {
  const metrics = { responses: 2705, visibility: 80, shareOfVoice: 30, mentionPosition: 2, citationPresence: 20 };
  const summary = {
    metrics, samples: { current: 600, previous: 500 },
    availability: Object.fromEntries(['visibility','shareOfVoice','mentionPosition','citationPresence'].map(key => [key,{current: 2705, previous: 1000}])),
    comparison: { comparable: true, hasPreviousData: true, delta: { visibility: 2, shareOfVoice: -3, mentionPosition: -1, citationPresence: 0 } },
  };
  for (const locale of ['en','pt-BR']) {
    const t = (en,pt) => locale === 'en' ? en : pt;
    const props = { summary,locale,t,link: to => ({href:'/app?tab='+to.tab,onClick(){}}) };
    const html = ui.kpis(props);
    assert.doesNotMatch(html,/n = |versus previous|ante período anterior|combinations|combinações/);
    assert.equal((html.match(/class="metric-help"/g)||[]).length,4);
    assert.match(html,locale === 'en' ? /Citations/ : /Citações/);
    for (const value of locale === 'en' ? ['2.0 pp','3.0 pp','>1.0<','0.0 pp'] : ['2,0 pp','3,0 pp','>1,0<','0,0 pp']) assert.ok(html.includes(value),value);
    // Lower position is better: a position that fell from the previous period is good news, a rise is bad news; the arrow follows the figure.
    // Every card takes the margin of error (5 points, since 10/11/2026): visibility +2 pp, share of voice −3 pp and a position's fall
    // by 1 are neutral, never green or red, the position too; past the margin it colours by its meaning.
    assert.equal((html.match(/metric-change negative/g)||[]).length,0);
    assert.equal((html.match(/metric-change positive/g)||[]).length,0);
    assert.equal((html.match(/metric-change neutral/g)||[]).length,4);
    assert.match(html,/within the margin of error|dentro da margem de erro/);
    const position = (delta) => ui.kpis({...props,summary:{...summary,comparison:{...summary.comparison,delta:{...summary.comparison.delta,mentionPosition:delta}}}}).match(/<span class="metric-change [^"]+"[^>]*>(?:(?!<\/span><\/span>).)*5[.,]5(?:(?!<\/span><\/span>).)*<\/span><\/span>/)?.[0];
    assert.match(ui.kpis({...props,summary:{...summary,comparison:{...summary.comparison,delta:{...summary.comparison.delta,mentionPosition:-1.5}}}}),/metric-change neutral(?:(?!<\/span><\/span>).)*1[.,]5/);
    const better = position(-5.5), worse = position(5.5);
    assert.match(better,/metric-change positive/);
    assert.match(better,/sr-only">(increase|aumento)</);
    assert.match(better,/arrow-down-right/);
    assert.match(worse,/metric-change negative/);
    assert.match(worse,/sr-only">(decrease|queda)</);
    assert.match(worse,/arrow-up-right/);
    const absent = ui.kpis({...props, summary:{...summary,samples:{current:600,previous:0},comparison:{...summary.comparison,hasPreviousData:false}}});
    assert.match(absent,locale === 'en' ? /No complete responses in the previous period of the same length/ : /Sem respostas completas no período anterior de igual duração/);
    assert.doesNotMatch(absent,/metric-change/);
    // 10/11/2026: an earlier period with under half the answers (Conversion: 140 against 3,464) is no comparison, said in the balloon.
    const thin = ui.kpis({...props,summary:{...summary,comparison:{...summary.comparison,hasPreviousData:false,previous:{...metrics,responses:140}},metrics:{...metrics,responses:3464}}});
    assert.match(thin,locale === 'en' ? /No comparison: the previous period of the same length measured 140 answers against 3,464 now, fewer than half/ : /Sem comparação: o período anterior de igual duração mediu 140 respostas ante 3\.464 agora, menos da metade/);
    assert.doesNotMatch(thin,/metric-change/);
    const changed = ui.kpis({...props,summary:{...summary,comparison:{...summary.comparison,comparable:false}}});
    assert.match(changed,locale === 'en' ? /tracked brands changed/ : /marcas monitoradas mudaram/);
    const empty = ui.kpis({...props,summary:{...summary,metrics:{...metrics,responses:0},samples:{current:0,previous:0},availability:{},comparison:{...summary.comparison,hasPreviousData:false}}});
    assert.match(empty,locale === 'en' ? /No complete responses in this period/ : /Sem respostas completas neste período/);
    assert.doesNotMatch(empty,/>0[.,]0%/);
    // Each card breaks its figure down per model; a model with no measure shows a dash, never a zero.
    const channels = ui.kpis({...props,summary:{...summary,channels:[{engine:'chat_gpt',visibility:75,shareOfVoice:null,mentionPosition:1.5,citationPresence:10},{engine:'gemini',visibility:50,shareOfVoice:20,mentionPosition:null,citationPresence:0}]}});
    assert.equal((channels.match(/class="metric-rows"/g)||[]).length,4);
    assert.equal((channels.match(/>ChatGPT</g)||[]).length,4);
    for (const value of locale === 'en' ? ['>75.0%<','>1.5<','>20.0%<'] : ['>75,0%<','>1,5<','>20,0%<']) assert.ok(channels.includes(value),value);
    assert.equal((channels.match(/<dd>—<\/dd>/g)||[]).length,2);
    assert.doesNotMatch(ui.kpis(props),/metric-rows/);
  }
});
test('drill down: each Overview card and model row opens the answers behind it, and the sentiment index the brand page', () => {
  const metrics = { responses: 10, visibility: 80, shareOfVoice: 30, mentionPosition: 2, citationPresence: 20 };
  const summary = {
    metrics, samples: { current: 10, previous: 0 },
    availability: Object.fromEntries(['visibility', 'shareOfVoice', 'mentionPosition', 'citationPresence'].map((key) => [key, { current: 10, previous: 0 }])),
    comparison: { comparable: true, hasPreviousData: false, delta: {} },
    channels: [{ engine: 'chat_gpt', visibility: 75, shareOfVoice: 30, mentionPosition: 1.5, citationPresence: 10 }],
  };
  const link = (to) => ({ href: '/app?' + new URLSearchParams(Object.entries(to).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)])), onClick() {} });
  const html = ui.kpis({ summary, locale: 'en', t: (en) => en, link });
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll('&amp;', '&'));
  assert.equal(hrefs.filter((href) => href === '/app?tab=responses&mention=mentioned').length, 3, 'visibility, share of voice and position: the answers that name the brand');
  assert.equal(hrefs.filter((href) => href === '/app?tab=responses&mention=all&cites=own').length, 1, 'citations: the answers citing the own domain');
  assert.equal(hrefs.filter((href) => href.includes('engine=chat_gpt')).length, 4, 'each model row: the same cohort in that model');
  assert.match(html, /aria-label="[^"]*Open the responses behind it"/);
  const sentiment = ui.sentiment({ ...props, link, engines: ['chat_gpt'], report: { ...report, brands: [{ ...brand, channels: [{ engine: 'chat_gpt', ...brand }] }] } });
  assert.match(sentiment, /href="\/app\?tab=competitors&amp;brandPage=netflix"[^>]*>88</);
  assert.match(sentiment, /href="\/app\?tab=competitors&amp;brandPage=netflix&amp;engine=chat_gpt"/);
  // Each band's share opens the answers of your brand in that band (75% promoters, 25% neutral): the drill already holds only
  // answers that mention it (the effective mention), so the mention filter is cleared, never `mentioned`.
  assert.match(sentiment, /<a aria-label="Promoters 75%\. Open these answers" href="\/app\?tab=responses&amp;sentiment=positive&amp;mention=all"[^>]*>75%<\/a>/);
  assert.match(sentiment, /href="\/app\?tab=responses&amp;sentiment=neutral&amp;mention=all"/);
  assert.doesNotMatch(sentiment, /sentiment=negative/);
  assert.match(sentiment, /Open brand page/);
  // The public demo has no band filter: no figure of the card is a link there.
  assert.doesNotMatch(ui.sentiment({ ...props, demo: true, link }), /href=/);
});
test('the Prompts sentiment column reads the same per-question verdicts the Overview score adds up, for every question', () => {
  // 150 questions (more than the 120 details the report samples), two models each; question 0 has a positive and a neutral reading.
  const reading = (score) => ({ id: 'b0', state: 'assessed', score, sentiment: score >= 60 ? 'positive' : score >= 40 ? 'neutral' : 'negative', candidate: null, evidence: ['Acme.'] });
  const scoreCycle = [100, 50, 20, 30];
  const sentiments = ['positive', 'neutral', 'negative'];
  const observations = [];
  for (let unit = 0; unit < 150; unit++)
    for (const [index, engine] of ['chat_gpt', 'gemini'].entries())
      for (const brand of ['Acme', 'Rival'])
        observations.push({
          runId: `${unit}-${engine}-${brand}`, unitId: `q${unit}`, engine, createdAt: '2026-10-15T12:00:00Z', brand,
          mentioned: unit % 7 !== 6, status: 'completed', fullCoverage: true,
          reading: reading(unit === 0 ? (index ? 70 : 90) : scoreCycle[(unit + index * (unit % 3)) % 4]),
        });
  const overview = ui.summarizeSentiment(observations).brands.find((row) => row.brand === 'Acme');
  const units = ui.sentimentByUnit(observations, 'Acme');
  const scores = Object.values(units).map((unit) => ui.sentimentScore(unit));
  assert.equal(scores.length, overview.assessed, 'every assessed question has a score, none is cut by the detail sample');
  assert.equal(Object.keys(units).length > 120, true);
  assert.equal(units.q6, undefined, 'a question that never names the brand has no score, not a zero');
  assert.equal(ui.sentimentScore(units.q0), 80, 'a question takes the mean of its models (90 and 70), as the Overview counts it');
  for (const key of sentiments)
    assert.equal(Object.values(units).reduce((sum, unit) => sum + unit.distribution[key], 0), overview.distribution[key], key);
  assert.equal(Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length), ui.sentimentScore(overview));
  // The column reads that aggregate, never the details sample.
  assert.match(liveApp, /promptSentimentRemote\.data\?\.units/);
  assert.doesNotMatch(liveApp, /promptSentimentRemote\.data\?\.details/);
  // Read only once the workspace is ready: the demo transport answers "not ready" before, and that answer stuck (always "—" on /demo).
  assert.match(liveApp, /summaryPath = useMemo\(\(\) => \{[\s\S]{0,200}if \(!projectId \|\| !workspaceReady \|\|/);
  assert.match(liveApp, /promptSentimentQuery = useMemo\(\(\) => \{[\s\S]{0,200}if \(tab !== 'prompts' \|\| !projectId \|\| !workspaceReady\) return null;/);
});
test('overview pairs Site types with Most cited domains, Content types with Most cited pages, Top terms with Query Fan Out', () => {
  assert.match(
    liveApp,
    /overview-grid overview-pair[\s\S]*?<SourceTypesPanel[\s\S]*?Most cited domains[\s\S]*?<TopSourcesList[\s\S]*?group="domain"[\s\S]*?overview-grid overview-pair[\s\S]*?<ContentTypesPanel[\s\S]*?Most cited pages[\s\S]*?group="url"[\s\S]*?overview-grid overview-pair[\s\S]*?<TopTermsCard[\s\S]*?Query Fan Out[\s\S]*?overview-recent[\s\S]*?Recent responses/,
  );
  const screenReads = readFileSync(root + 'packages/core/components/analytics/screen-reads.ts', 'utf8');
  assert.match(liveApp, /overviewPaths = useMemo\(\(\) => overviewReadPaths\(/);
  assert.match(screenReads, /sources: cited\('domain'\),\s*content: cited\('url'\),[\s\S]*fanout:/);
  assert.match(liveApp, /cutBrandRanking/);
  // The ranking's discovered rows use the chart's window and leave with the chart under a narrowing filter.
  assert.match(liveApp, /\(discoveredMeasured \? discoveries\.brands : \[\]\)\.map\(\(brand\) => \{\s*const period = discoveredInPeriod\(summary, brand\.days\)/);
  // Their share of voice is in the card's universe (every identified brand), so they chart it too; never a position.
  assert.match(liveApp, /discoveredCharted = overviewChart !== 'position' && discoveredMeasured/);
  // Lower position is better on the Brands card too.
  assert.match(readFileSync(root + 'packages/core/components/analytics/brands-screen.tsx', 'utf8'), /delta\.mentionPosition\} locale=\{locale\} invert \/>/);
  assert.doesNotMatch(liveApp, /\{t\('Discovered', 'Descoberta'\)\}/);
});

test('donut center no longer shows 100% share', () => {
  const uiSource = readFileSync(root + 'packages/core/components/analytics/source-types-ui.tsx', 'utf8');
  assert.doesNotMatch(uiSource, /<strong>100%<\/strong>/);
  assert.doesNotMatch(uiSource, /t\('share', 'participação'\)/);
});

test('type shares are among classified only: no unclassified slice, no remainder line, shares rebased', () => {
  for(const locale of ['en','pt-BR']) {
    const t=(en,pt)=>locale==='en'?en:pt;
    const report={citations:13489,unclassified:3489,classified:10000,pendingBatches:0,classifier:{state:'ready'},types:[{type:'editorial',citations:10000,share:74.1},{type:'unclassified',citations:3489,share:25.9}]};
    const props={report,loading:false,failed:false,locale,t,onSelectType(){}};
    for(const render of [ui.siteTypes,ui.contentTypes]) {
      const html=render(props);
      assert.match(html,/100%/);
      assert.match(html,/aria-label="[^"]*: Editorial, 100%"/);
      assert.doesNotMatch(html,/Not classified|Não classificado|not classified yet|ainda não classificado|74[.,]1%|25[.,]9%/);
      assert.doesNotMatch(html,/13[,.]?489|10[,.]?000|3[,.]?489/);
      assert.match(html,locale==='en'? /among classified/ : /só entre/);
      assert.match(render({...props,loading:true}),/aria-busy="true"/);
      assert.match(render({...props,failed:true}),/role="alert"/);
    }
  }
});

test('live Overview keeps one sentiment card in the KPI strip with zero responses in both locales', () => {
  for (const locale of ['en', 'pt-BR']) {
    const html = ui.overview({
      summary: { metrics: { responses: 0 }, samples: { current: 0, previous: 0 }, availability: {}, comparison: { delta: {} } },
      locale, t: (en, pt) => locale === 'en' ? en : pt,
      link: () => ({ href: '/app', onClick() {} }),
      project: { id: 'empty', name: 'Netflix' }, filterQuery: new URLSearchParams(), cache: { generation: 0 }, demoMode: false, sentiment: { loading: true },
    });
    assert.equal((html.match(/class="metric-strip/g) || []).length, 1);
    assert.equal((html.match(/<article/g) || []).length, 5);
    assert.equal((html.match(/<span>(Sentiment|Sentimento)<\/span>/g) || []).length, 1);
    assert.match(html, locale === 'en' ? /No complete responses in this period/ : /Sem respostas completas neste período/);
    assert.doesNotMatch(html, /class="metric-number">0/);
  }
});

test('sentiment helper preserves measured zero and has no score without assessed questions', () => {
  assert.equal(ui.sentimentScore({...brand,assessed:0}),null);
  assert.equal(ui.sentimentScore(brand),88);
  assert.equal(ui.sentimentScore({...brand,distribution:{positive:0,neutral:0,negative:4},scoreTotal:0}),0);
});

test('zero monitored questions cannot prove absence of brand mentions', () => {
  const html = ui.sentiment({...props,report:{...report,brands:[{...brand,prompts:0,assessed:0,absent:0}]}});
  assert.match(html,/Waiting for the evaluation of these answers\./);
  assert.doesNotMatch(html,/No brand mentions/);
});

test('analytic table: sortable columns, default sort, clickable rows without links, numbers at the end', () => {
  const rows = [{ id: 'a', name: 'Bravo', n: 2 }, { id: 'b', name: 'Alpha', n: 10 }, { id: 'c', name: 'Charlie', n: null }];
  const base = {
    rows,
    rowKey: (row) => row.id,
    columns: [
      { key: 'name', header: 'Name', sortValue: (row) => row.name, cell: (row) => row.name },
      { key: 'n', header: 'Count', align: 'end', sortValue: (row) => row.n, cell: (row) => String(row.n) },
      { key: 'plain', header: 'Plain', cell: () => 'x' },
    ],
  };
  const order = (html) => rows.map((row) => html.indexOf(row.name)).every((position, index, all) => index === 0 || position > all[index - 1]);
  assert.ok(order(ui.table(base)), 'without a sort rows keep their order');
  const byName = ui.table({ ...base, defaultSort: { key: 'name', direction: 'asc' } });
  assert.ok(byName.indexOf('Alpha') < byName.indexOf('Bravo') && byName.indexOf('Bravo') < byName.indexOf('Charlie'));
  assert.match(byName, /aria-sort="ascending"/);
  assert.equal((byName.match(/aria-sort="none"/g) || []).length, 1);
  assert.equal((byName.match(/class="table-sort"/g) || []).length, 2);
  // Empty values stay last in both directions.
  for (const direction of ['asc', 'desc']) {
    const html = ui.table({ ...base, defaultSort: { key: 'n', direction } });
    assert.ok(html.indexOf('Charlie') > html.indexOf('Alpha') && html.indexOf('Charlie') > html.indexOf('Bravo'), direction);
  }
  assert.match(ui.table({ ...base, defaultSort: { key: 'n', direction: 'desc' } }), /<th[^>]*text-right/);
  const clickable = ui.table({ ...base, rowLink: (row) => ({ href: '/x/' + row.id, onClick() {} }) });
  assert.equal((clickable.match(/data-clickable=""/g) || []).length, 3);
  assert.equal((clickable.match(/<tr[^>]*tabindex="0"/g) || []).length, 3);
  assert.doesNotMatch(clickable, /<a /);
  assert.doesNotMatch(ui.table(base), /data-clickable|<tr[^>]*tabindex/);
  // Paginated lists order the whole list first and control the sort: the table shows the arrow, keeps the order it got.
  const controlled = ui.table({ ...base, sort: { key: 'name', direction: 'desc' }, onSortChange() {} });
  assert.match(controlled, /aria-sort="descending"/);
  assert.ok(order(controlled), 'controlled rows are not reordered by the table');
  const ordered = ui.sortRows(rows, base.columns, { key: 'name', direction: 'desc' });
  assert.deepEqual(ordered.map((row) => row.name), ['Charlie', 'Bravo', 'Alpha']);
  assert.equal(ui.sortRows(rows, base.columns, undefined), rows);
});

test('a paged list is ordered as a whole before the page is cut, on every screen with a table', () => {
  const prompts = Array.from({ length: 30 }, (_, index) => ({ id: `p${index}`, visibility: (index * 7) % 30 }));
  const columns = [{ key: 'visibility', sortValue: (row) => row.visibility }];
  const sort = { key: 'visibility', direction: 'desc' };
  const ordered = ui.sortRows(prompts, columns, sort);
  const pages = [1, 2].map((page) => ui.collectionWindow(ordered, page, 25).rows);
  assert.deepEqual(pages.flat().map((row) => row.visibility), Array.from({ length: 30 }, (_, index) => 29 - index));
  assert.equal(pages[1].length, 5, 'the second page continues the order of the first');
  // Server-paged lists (responses, opportunities, prompt detail) have no arrow; the sources list asks the server.
  const analytics = 'packages/core/components/analytics/';
  for (const file of ['brands-screen', 'source-entity-page', 'sources-presence', 'prompt-brand-ranking', 'fanout-view', 'live-app', 'model-evidence'])
    assert.match(readFileSync(root + analytics + file + '.tsx', 'utf8'), /sortValue/, `${file} sorts its columns`);
  assert.match(readFileSync(root + 'packages/core/components/analytics/screen-reads.ts', 'utf8'), /params\.set\('sort', source\.sort\.key\)/);
  assert.match(liveApp, /source: \{ kind: sourceKind, group: sourceGroup, page: sourcePage, type: typeFilter, owner: ownerFilter, origin: sourceOrigin, sort: sourceSort \}/);
  assert.match(liveApp, /useSortedPage\(\s*workspace\?\.topics/);
  assert.match(liveApp, /const orderedPrompts = sortRows\(/);
});

test('badge is discreet and one step smaller than the line; note keeps the card inset', () => {
  for (const tone of ['neutral', 'primary', 'danger', 'success', 'warning', 'quiet', 'muted'])
    assert.match(ui.badge({ tone, children: 'Label' }), new RegExp(`data-tone="${tone}"[^>]*class="[^"]*tag-badge`));
  // The tones are the catalog Badge's `tone` variant (ui/badge.tsx).
  const badge = readFileSync(root + 'packages/core/components/ui/badge.tsx', 'utf8');
  assert.match(badge, /text-caption/);
  assert.match(badge, /px-1\.5 py-0/);
  assert.match(badge, /bg-\[color-mix\(in_srgb,var\(--tone\)_6%,var\(--background\)\)\]/);
  assert.match(ui.note({ children: 'Text' }), /px-5 py-3/);
  assert.match(ui.note({ children: 'Failed', tone: 'danger' }), /role="alert"/);
  assert.match(ui.note({ children: 'Wait', status: true }), /^<output/);
});

test('type panels list a limited number of types and add the rest, "Other" included, up in "Other types"', () => {
  const types = ['editorial', 'corporate', 'ugc', 'reference', 'institutional'].map((type, index) => ({ type, citations: 50 - index * 10, share: 50 - index * 10 }));
  const report = { citations: 150, unclassified: 0, classified: 150, pendingBatches: 0, classifier: { state: 'ready' }, types };
  const html = ui.contentTypes({ report, loading: false, failed: false, locale: 'en', t, onSelectType() {}, limit: 3 });
  assert.match(html, /Other types<\/span><span class="chart-legend-value">20(\.0)?%/);
  assert.equal((html.match(/Open pages of this type/g) || []).length, 3, 'the summed slice has nothing to open');
  assert.doesNotMatch(ui.contentTypes({ report, loading: false, failed: false, locale: 'en', t, onSelectType() {} }), /Other types/);
  // "Other" (a type) is never a second grey slice beside the summed one: it joins it, last.
  const withOther = { ...report, types: [...types, { type: 'other', citations: 45, share: 45 }] };
  const merged = ui.contentTypes({ report: withOther, loading: false, failed: false, locale: 'en', t, onSelectType() {}, limit: 3 });
  assert.equal((merged.match(/chart-legend-name">Other/g) || []).length, 1);
  // Alone, "Other" keeps its own name and opens its pages.
  const alone = ui.contentTypes({ report: { ...report, types: [...types.slice(0, 3), { type: 'other', citations: 20, share: 20 }] }, loading: false, failed: false, locale: 'en', t, onSelectType() {}, limit: 3 });
  assert.equal((alone.match(/Open pages of this type/g) || []).length, 4);
  assert.doesNotMatch(alone, /Other types/);
});

test('quiet type panels drop the notices that only describe classification, and keep the actionable ones', () => {
  const report = (classifier, classified = 60) => ({ citations: 100, unclassified: 100 - classified, classified, pendingBatches: 0, classifier, types: classified ? [{ type: 'editorial', citations: classified, share: classified }] : [] });
  const render = (classifier, quiet, classified) => ui.siteTypes({ report: report(classifier, classified), loading: false, failed: false, locale: 'en', t, onSelectType() {}, onConfigure() {}, quiet });
  const automatic = { state: 'ready', automatic: true, activity: 'waiting' };
  assert.doesNotMatch(render(automatic, false), /about once an hour|Automatic classification looks/);
  assert.doesNotMatch(render(automatic, true), /about once an hour|Automatic classification looks/);
  // Answers but nothing typed yet: the card still says why it has no chart.
  assert.match(render(automatic, true, 0), /Nothing in this period has a type yet/);
  // With type shares on the chart, setup/off notices contradict the data — hide them on overview.
  assert.doesNotMatch(render({ state: 'disabled' }, true), /source evaluator is off|Open settings|Abrir configurações/);
  assert.doesNotMatch(render({ state: 'unconfigured' }, true), /not available on this installation|Open settings/);
  // No typed data yet: the setup notice stays so the empty chart is explained.
  assert.match(render({ state: 'unconfigured' }, true, 0), /not available on this installation/);
  assert.match(render({ state: 'unconfigured' }, true, 0), /Open settings/);
});


test('fanout has no section shortcuts and preserves unavailable, loading and failed states', () => {
  const report = ui.buildFanout([{ id: 'r', engine: 'chat_gpt', prompt_id: 'p', prompt_text: 'streaming', topic: 'General', created_at: '2026-10-20T10:00:00Z', queries: ['best streaming'], mentioned: true, cited: false }], [{ engine: 'chat_gpt', responses: 1 }], []);
  const props = { report, navigation: { search: '', kind: 'all', page: 1, selected: null, term: null }, onNavigation() {}, loading: false, failed: false, onRetry() {}, api: '/api', request() {}, filters: 'days=30', refresh: 0, locale: 'en', t, link: () => ({ href: '/demo?tab=fanout&days=30', onClick() {} }) };
  const html = ui.fanout(props);
  assert.doesNotMatch(html, /href="#fanout-|Report sections/);
  assert.match(html, /data-clickable=""/);
  assert.doesNotMatch(html, /live-table-scroll|st-caption|st-partial/);
  // Queries opens with six data columns at most (shell.md section 8): Prompts and AIs start hidden, in the Columns menu.
  const heads = [...html.matchAll(/<th\b[^>]*>[\s\S]*?<\/th>/g)].map(([th]) => th.replace(/<[^>]+>/g, '').trim());
  assert.ok(heads.includes('Query') && heads.includes('Occurrences'), heads.join());
  assert.ok(!heads.includes('Prompts') && !heads.includes('AIs'), heads.join());
  assert.match(ui.fanout({ ...props, loading: true }), /aria-busy="true"/);
  assert.match(ui.fanout({ ...props, failed: true }), /The report did not load/);
  assert.match(ui.fanout({ ...props, report: { ...report, responses: 0 } }), /No responses in this period yet/);
  assert.match(ui.fanout({ ...props, report: { ...report, withFanout: 0 } }), /Not returned does not mean zero searches/);
});


test('heatmap cells keep colour on the cell and brand headers keep row scope', () => {
  const html = ui.table({
    rows: [{ id: 'a', score: 0 }, { id: 'b', score: null }], rowKey: row => row.id,
    columns: [
      { key: 'brand', header: 'Brand', rowHeader: true, cell: row => row.id },
      { key: 'score', header: 'Score', cellStyle: row => row.score == null ? undefined : { backgroundColor: '#ff0000' }, cell: row => row.score ?? 'No evidence' },
    ],
    singleLine: true, containerProps: { role: 'region', tabIndex: 0, 'aria-label': 'Comparison' },
  });
  assert.equal((html.match(/scope="row"/g) || []).length, 2);
  assert.match(html, /<td[^>]*style="background-color:#ff0000"[^>]*>0<\/td>/);
  assert.match(html, /<td[^>]*>No evidence<\/td>/);
  assert.doesNotMatch(html, /responsive-table/);
  assert.match(html, /role="region"[^>]*tabindex="0"[^>]*aria-label="Comparison"/);
});


test('table minimum width, colgroup and mobile roles travel through the catalog', () => {
  const html = ui.table({
    compact: true, minWidth: 1080, className: 'table-fixed', rows: [{ id: 'a' }], rowKey: row => row.id,
    columns: [
      { key: 'select', header: 'Select', width: 44, mobile: 'check', cell: () => 'Select' },
      { key: 'name', header: 'Name', mobile: 'title', cell: row => row.id },
      { key: 'count', header: 'Count', width: 152, label: 'Count', cell: () => 1 },
      { key: 'actions', header: '', width: 48, mobile: 'actions', cell: () => 'Open' },
    ],
  });
  assert.match(html, /data-compact="true"/);
  assert.match(html, /responsive-table/);
  assert.match(html, /--data-table-min-width:1080px/);
  assert.match(html, /<colgroup><col style="width:44px"\/><col\/><col style="width:152px"\/><col style="width:48px"\/><\/colgroup>/);
  for (const role of ['check', 'title', 'actions']) assert.ok(html.includes(`data-mobile="${role}"`));
  assert.match(html, /data-label="Count"/);
  assert.doesNotMatch(ui.table({ rows: [], columns: [], rowKey: () => '' }), /--data-table-min-width/);
});

test('a fit table gives the spare width to its text columns and fits its figures to their header and value', () => {
  const columns = [
    { key: 'query', header: 'Query', mobile: 'title', width: 460, shrinkTo: '14rem', sortValue: row => row.query, cell: row => row.query },
    { key: 'topic', header: 'Topic', sortValue: row => row.topic, cell: row => row.topic },
    { key: 'ais', header: 'AIs', sortValue: () => 2, cell: () => 'icons' },
    { key: 'count', header: 'Occurrences', align: 'end', sortValue: row => row.count, cell: row => row.count },
    { key: 'note', header: 'Note', cell: () => 'x' },
    { key: 'actions', header: '', width: 48, mobile: 'actions', cell: () => 'Open' },
  ];
  const rows = [{ id: 'a', query: 'best streaming services', topic: null, count: 9 }, { id: 'b', query: 'netflix plans', topic: 'International and niche viewing', count: 4 }];
  const widths = (html) => [...html.matchAll(/<th\b[^>]*>/g)].map(([tag]) => tag.match(/data-width="(\w+)"/)?.[1] ?? '-');
  const html = ui.table({ singleLine: true, rows, rowKey: row => row.id, columns });
  // The first value that is not empty says what a column holds: a text sort makes a text column.
  // A figure (sorted as a number or aligned to the end) fits; a column with neither (Note) keeps the table's sizing.
  assert.deepEqual(widths(html), ['-', 'text', 'content', 'content', '-', '-']);
  assert.match(html, /<td[^>]*data-width="text"[^>]*><div class="data-table-text"[^>]*>International and niche viewing<\/div><\/td>/);
  // No text column (Brands: a name and figures), a table in a card (fixed layout) or no name column: the widths stay as they were.
  assert.doesNotMatch(ui.table({ singleLine: true, rows, rowKey: row => row.id, columns: columns.filter((column) => column.key !== 'topic') }), /data-width/);
  assert.doesNotMatch(ui.table({ singleLine: true, minWidth: 0, rows, rowKey: row => row.id, columns }), /data-width/);
  assert.doesNotMatch(ui.table({ singleLine: true, rows, rowKey: row => row.id, columns: columns.map((column) => ({ ...column, shrinkTo: undefined })) }), /data-width/);
});

test('a list screen table stacks as cards on a phone (name and every figure, labelled); a table in a card stays one and drops its rank', () => {
  const columns = [
    { key: 'rank', header: '#', width: 44, mobile: 'hide', cell: (_, index) => index + 1 },
    { key: 'name', header: 'Brand', mobile: 'title', cell: row => row.id },
    { key: 'share', header: 'Share of voice', align: 'end', cell: () => '20%' },
  ];
  const list = ui.table({ fill: true, singleLine: true, rows: [{ id: 'a' }], rowKey: row => row.id, columns });
  assert.match(list, /responsive-table/);
  assert.match(list, /data-single-line="wide"/);
  assert.match(list, /data-label="Share of voice"/, 'a figure without its own label borrows its header');
  const card = ui.table({ singleLine: true, minWidth: 0, rows: [{ id: 'a' }], rowKey: row => row.id, columns });
  assert.doesNotMatch(card, /responsive-table|data-label=/);
  assert.match(card, /<col data-mobile="hide" style="width:44px"\/>/);
  // Stacked cards sort from one "Sort by" choice (catalog Select) and its direction, not from the column headers.
  const sortable = ui.table({ fill: true, singleLine: true, rows: [{ id: 'a' }], rowKey: row => row.id, defaultSort: { key: 'share', direction: 'desc' },
    columns: [...columns.slice(0, 2), { ...columns[2], sortValue: () => 20, info: 'Share of the mentions.' }] });
  assert.match(sortable, /class="data-table-sort"[^>]*>[\s\S]*Sort by[\s\S]*data-slot="select-trigger"/);
  assert.match(sortable, /aria-label="Descending, reverse the order"/);
  assert.doesNotMatch(card, /data-table-sort/);
});

test('Top terms ranks words and phrases with frequency bars, the terms in the same searches under each, each opening Query Fan Out', () => {
  const t = (en) => en;
  const link = (to) => ({ href: `?tab=${to.tab}&term=${encodeURIComponent(to.fanoutTerm ?? '')}`, onClick() {} });
  const phrases = [
    { term: 'são paulo', words: 2, count: 12, rate: 24, with: [{ term: 'preço', count: 5 }, { term: '2026', count: 3 }] },
    { term: 'agência de seo', words: 3, count: 6, rate: 12, with: [] },
    { term: 'preço', words: 1, count: 20, rate: 40, with: [] },
  ];
  // Phrases and words are two lists: a single word (20 searches) never pushes the phrases out.
  const html = ui.topTerms({ phrases, kind: 'phrases', link, locale: 'en', t, limit: 6 });
  assert.match(html, /^<ul class="bar-list" aria-label="Top terms">/);
  assert.doesNotMatch(html, />preço<\/a>/);
  // The phrase as one term, its searches and their share, its bar against the most searched (100) and the next at half.
  assert.match(html, /href="\?tab=fanout&amp;term=s%C3%A3o%20paulo"[^>]*>são paulo<\/a>/);
  assert.match(html, /12 \(24%\)/);
  assert.equal([...html.matchAll(/aria-valuenow="(\d+)"/g)].map((match) => +match[1]).join(','), '100,50');
  // What appears with it in the same searches, as badges after "With"; a term with none has no line.
  assert.match(html, /class="bar-list-detail"><span>With<\/span>[\s\S]*preço[\s\S]*2026/);
  assert.equal((html.match(/bar-list-detail/g) ?? []).length, 1);
  // The term the screen is narrowed to is marked, and its link clears it.
  const words = ui.topTerms({ phrases, kind: 'words', link, locale: 'en', t, selected: 'preco' });
  assert.match(words, /href="\?tab=fanout&amp;term="[^>]*>preço<\/a>[\s\S]*In the chart/);
  assert.doesNotMatch(words, /são paulo<\/a>/);
  // No term: said, never an empty card.
  assert.match(ui.topTerms({ phrases: [], kind: 'phrases', link, locale: 'en', t }), /No repeated phrases in this period\./);
});

test('brand ranking invites adding competitors instead of counting hidden discoveries', () => {
  const props = { competitors: 2, discovered: true, onAdd() {}, t };
  assert.match(ui.competitorsNote(props), /Monitor at least 5 competitors for a richer report/);
  assert.match(ui.competitorsNote(props), /Add competitors/);
  assert.doesNotMatch(ui.competitorsNote({ ...props, onAdd: undefined }), /<button/);
  assert.equal(ui.competitorsNote({ ...props, competitors: 5 }), '');
  assert.equal(ui.competitorsNote({ ...props, discovered: false }), '');
  assert.doesNotMatch(liveApp, /more discovered name/);
  // The breadcrumb starts at the screen: the project lives in the sidebar switcher.
  assert.doesNotMatch(liveApp, /topbar-project/);
});

test('drill down: a cited source\'s figure in Sources opens the answers that cite it; a consulted one or a Semantic Branding one keeps its note', () => {
  const link = (to) => ({ href: '/app?' + new URLSearchParams(Object.entries(to).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)])), onClick() {} });
  const presence = { presence: 40, slots: 4, questions: 2, steady: 0, once: 0, single: 4 };
  const row = (key, extra = {}) => ({ key, domain: 'example.com', title: '', responses: 3, citations: 5, pages: 1, engines: ['chat_gpt'], mentions: 0, visibility: null, ownership: 'third-party', cited: true, consulted: false, presence, ...extra });
  const sources = (rows, origin = 'prompts') => ({ origin, totals: { slots: 10, questions: 5, models: 2 }, rows, hasMore: false, available: rows.length, complete: rows.length });
  const table = (page, group = 'domain', kind = 'cited') => ui.sourcesTable({ sources: page, group, kind, page: 1, onSortChange() {}, locale: 'en', t: (en) => en, link });
  const html = table(sources([row('example.com'), row('quiet.example', { cited: false, consulted: true })]), 'domain', 'all');
  assert.match(html, /<a aria-label="Presence 40\.0%\. Open the answers that cite it" href="\/app\?tab=responses&amp;cites=example\.com&amp;mention=all"[^>]*aria-description="3 responses cite or consult it; 5 citations">40\.0%<\/a>/);
  assert.doesNotMatch(html, /cites=quiet\.example/);
  assert.match(table(sources([row('https://example.com/guide')]), 'url'), /cites=https%3A%2F%2Fexample\.com%2Fguide/);
  assert.doesNotMatch(table(sources([row('example.com')]), 'domain', 'consulted'), /tab=responses/);
  assert.doesNotMatch(table(sources([row('example.com')], 'semantic-branding')), /tab=responses/);
  // With every origin, a source only Semantic Branding answers cite (no visibility of the prompts) has no Responses to open.
  assert.doesNotMatch(table(sources([row('example.com')], 'all')), /tab=responses/);
  assert.match(table(sources([row('example.com', { visibility: 50 })], 'all')), /cites=example\.com/);
});
