import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type {
  DemoFilters,
  DemoResponse,
} from '../components/analytics/demo-data.ts';

const coreRoot = fileURLToPath(new URL('../', import.meta.url));

await test('the analytics prototype renders its mock workspace without importing or contacting the live engine', async () => {
  mkdirSync(resolve('.wrangler'), { recursive: true });
  const directory = mkdtempSync(resolve('.wrangler/analytics-prototype-'));
  try {
    const bundled = await build({
      stdin: {
        contents: `
          import React from 'react';
          import { renderToPipeableStream } from 'react-dom/server';
          import { PassThrough } from 'node:stream';
          import { AnalyticsApp } from './components/analytics/analytics-app.tsx';
          import { Overview, getTrendPoints, getTrendScale, formatPositionTick } from './components/analytics/overview.tsx';
          import { parseDemoPromptImport } from './components/analytics/prompts-view.tsx';
          import { SemanticBrandingView, SemanticEvidenceView, SemanticReportDocument } from './components/analytics/semantic-branding.tsx';
          import { createSemanticSnapshot, initialBrandEntities } from './components/analytics/semantic-data.ts';
          import { defaultFilters } from './components/analytics/demo-data.ts';
          import { brandMetrics, demoBrands, demoPrompts, getDemoReport } from './components/analytics/demo-data.ts';
          import { LocaleProvider } from './lib/i18n.tsx';
          async function renderNode(element) {
            return new Promise((resolve,reject) => {
              const stream=new PassThrough(); let html='';
              stream.on('data',chunk => { html+=chunk.toString() });
              stream.on('end',() => resolve(html));
              stream.on('error',reject);
              const controller=renderToPipeableStream(
                element,
                {onAllReady(){controller.pipe(stream)},onShellError:reject,onError:reject}
              );
            });
          }
          export function render(tab,locale='en',authenticatedUser) {
            return renderNode(React.createElement(LocaleProvider,{initialLocale:locale},
              React.createElement(AnalyticsApp,{initialTab:tab,initialSidebarOpen:true,authenticatedUser})));
          }
          export function renderRoute(path,search='') {
            return renderNode(React.createElement(LocaleProvider,{initialLocale:'en'},
              React.createElement(AnalyticsApp,{initialPath:path,initialSearch:search,initialSidebarOpen:true})));
          }
          export { getTrendPoints, getTrendScale, formatPositionTick, parseDemoPromptImport };
          function renderSemanticView(View, locale, section) {
            const project = {id:'conversion-web',name:'Conversion',domain:'conversion.com.br',prompts:demoPrompts};
            return renderNode(React.createElement(LocaleProvider,{initialLocale:locale}, React.createElement(View,{
              project, report:getDemoReport(demoPrompts,defaultFilters), filters:defaultFilters, section,
              onSectionChange(){}, onOpenChat(){}, onOpenSource(){}, onSaveState(){}, onConfigure(){return true}
            })));
          }
          export function renderSemanticBranding(locale, section='associations') {
            return renderSemanticView(SemanticBrandingView, locale, section);
          }
          export function renderSemanticEvidence(locale, section='associations') {
            return renderSemanticView(SemanticEvidenceView, locale, section);
          }
          export function renderSemanticReport(locale, filters=defaultFilters) {
            const snapshot = createSemanticSnapshot({ id: 'snapshot', date: '2026-09-10T12:00:00Z', title: 'Example report', project: { id: 'sample', name: 'Sample company', domain: 'example.com' }, from: '2026-09-09', to: '2026-09-09', filters, entities: initialBrandEntities(), prompts: [{ id: 'p1', text: 'A new question with no data?' }], responses: [] });
            return renderNode(React.createElement(LocaleProvider,{initialLocale:locale}, React.createElement(SemanticReportDocument,{snapshot})));
          }
          export function renderOverview(responses) {
            const report={responses,previous:[],trend:[],brands:demoBrands.map(brand=>({...brand,...brandMetrics(responses,brand.id),change:0}))};
            return renderNode(React.createElement(Overview,{report,prompts:demoPrompts,onNavigate(){},onBrand(){},onOpenChat(){}}));
          }
        `,
        resolveDir: coreRoot,
        loader: 'tsx',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      loader: { '.css': 'empty' },
      jsx: 'automatic',
      metafile: true,
      write: false,
    });
    const code = bundled.outputFiles[0].text;
    assert.ok(
      !code.replaceAll('/api/auth/logout', '').includes('/api/'),
      'Only the signed-in account logout may call an API; the prototype must not submit provider tasks, load private reports, or mutate live projects',
    );
    const dependencies = Object.keys(bundled.metafile.inputs);
    assert.ok(
      dependencies.some((path) => path.endsWith('/analytics/demo-data.ts')),
    );
    assert.deepEqual(
      dependencies.filter((path) => /\/(?:lib\/server|db|worker)\//.test(path)),
      [],
      'Server implementations stay outside the client bundle',
    );
    assert.deepEqual(
      dependencies.filter((path) =>
        /\/(?:components\/lastfind|hooks\/use-report)\b/.test(path),
      ),
      [],
      'The prototype must not retain the former connected shell',
    );

    const filename = join(directory, 'surface.mjs');
    writeFileSync(filename, code);
    const fixture = (await import(pathToFileURL(filename).href)) as {
      render: (
        tab: string,
        locale?: string,
        authenticatedUser?: { id: string; name: string; email: string },
      ) => Promise<string>;
      renderRoute: (path: string, search?: string) => Promise<string>;
      renderOverview: (responses: DemoResponse[]) => Promise<string>;
      renderSemanticReport: (
        locale: string,
        filters?: DemoFilters,
      ) => Promise<string>;
      renderSemanticBranding: (
        locale: string,
        section?: string,
      ) => Promise<string>;
      renderSemanticEvidence: (
        locale: string,
        section?: string,
      ) => Promise<string>;
      parseDemoPromptImport: (
        input: string,
      ) => { text: string; topic: string; country: string; tags: string[] }[];
      formatPositionTick: (value: number, locale: string) => string;
      getTrendScale: (
        points: unknown[],
        brands: string[],
        metric: string,
      ) => { domain: number[]; ticks: number[] };
      getTrendPoints: (
        report: unknown,
        metric: string,
      ) => Record<string, number | string | null>[];
    };
    const accountHtml = await fixture.render('overview', 'en', {
      id: 'signed-in-user',
      name: 'Signed in name',
      email: 'signed-in@example.test',
    });
    assert.match(accountHtml, /Signed in name/);
    assert.match(accountHtml, /signed-in@example.test/);
    assert.doesNotMatch(accountHtml, /diego@example.com/);
    const sections = [
      ['overview', 'Overview', 'Brand ranking'],
      ['prompts', 'Prompts', 'What are the best SEO agencies in Brazil?'],
      ['sources', 'Sources', 'Sources used by AI'],
      ['competitors', 'Brands', 'Tracked brands'],
      ['models', 'AI models', 'Compare AI models'],
      ['chats', 'Chats', 'AI responses'],
      ['semantic-branding', 'Semantic Branding', 'Loading brand attributes…'],
      ['settings', 'Settings', 'Workspace name'],
    ];
    for (const [tab, title, content] of sections) {
      const html = await fixture.render(tab);
      assert.match(html, new RegExp(`<h1(?:\\s[^>]*)?>${title}</h1>`));
      assert.ok(
        html.includes(content),
        `${tab} renders its own working surface`,
      );
      assert.match(html, /Conversion/);
      assert.match(html, /src="\/lastfind\/brand\/icon-3d\.png"/);
      assert.doesNotMatch(html, /\/brand\/lastfind-icon|\/favicon\.svg/);
      assert.doesNotMatch(
        html,
        /Workspace de demonstração|Demo workspace|Sobre esta prévia|About this preview/,
      );
      assert.ok(
        !html.includes('NaN') && !html.includes('Infinity'),
        `${tab} must render finite analytics`,
      );
    }
    for (const [locale, loading] of [
      ['en', 'Loading brand attributes…'],
      ['pt-BR', 'Carregando atributos da marca…'],
    ]) {
      const html = await fixture.render('semantic-branding', locale);
      assert.match(
        html,
        new RegExp(`<output(?:\\s[^>]*)?>${loading}</output>`),
        'SSR exposes an accessible status until browser tab settings can be restored',
      );
      assert.doesNotMatch(
        html,
        /id="semantic-association-summary"|id="semantic-config-name-/,
        'SSR must not render report defaults or mount the attribute editor before restoration',
      );
    }
    const attributeSettings = await fixture.renderRoute(
      '/app/preview/workspaces/conversion/projects/conversion/semantic-branding',
      '?view=attributes',
    );
    assert.match(attributeSettings, /<h1(?:\s[^>]*)?>Brand attributes<\/h1>/);
    assert.match(
      attributeSettings,
      /<output(?:\s[^>]*)?>Loading brand attributes…<\/output>/,
    );
    assert.doesNotMatch(
      attributeSettings,
      /role="dialog"|id="semantic-config-name-/,
    );
    for (const tab of ['overview', 'competitors', 'sources']) {
      for (const locale of ['en', 'pt-BR']) {
        const html = await fixture.render(tab, locale);
        assert.doesNotMatch(
          html,
          /Sentiment|Sentimento|Lastfind score|Confidence|Confiança|Sources by type|Fontes por tipo/,
          `${tab} only exposes initial extraction capabilities`,
        );
      }
    }
    for (const [locale, heading, settingsHeading] of [
      [
        'en',
        'Explore your brand in context',
        'The attributes you want to be known for',
      ],
      [
        'pt-BR',
        'Explore sua marca no contexto',
        'Os atributos pelos quais quer ser reconhecido',
      ],
    ]) {
      const initial = await fixture.renderSemanticEvidence(locale);
      assert.ok(initial.includes(heading));
      assert.doesNotMatch(
        initial,
        /semantic-radar|Lastfind presence index|Índice de presença Lastfind|role="dialog"/,
      );
      const settings = await fixture.renderSemanticEvidence(
        locale,
        'attributes',
      );
      assert.ok(settings.includes(settingsHeading));
      assert.match(settings, /semantic-config-name-technical/);
      assert.doesNotMatch(settings, /role="dialog"/);
    }
    // Render the canonical entry with a restored project separately from the
    // app's SSR loading guard. The real route still needs browser hydration QA.
    for (const [locale, heading, settingsHeading, reportTab] of [
      [
        'en',
        'How AI connects your brand to its attributes',
        'The attributes you want to be known for',
        'Reports',
      ],
      [
        'pt-BR',
        'Como a IA conecta sua marca aos seus atributos',
        'Os atributos pelos quais quer ser reconhecido',
        'Relatórios',
      ],
    ]) {
      const report = await fixture.renderSemanticBranding(locale);
      assert.ok(report.includes(heading));
      assert.match(report, /class="semantic-radar"/);
      for (const section of [
        'summary',
        'score',
        'radar',
        'top',
        'heatmap',
        'explanations',
      ]) {
        assert.ok(report.includes(`href="#semantic-association-${section}"`));
        assert.ok(report.includes(`id="semantic-association-${section}"`));
      }
      assert.match(
        report,
        new RegExp(`role="tab"[^>]*>.*?${reportTab}</button>`),
      );
      assert.doesNotMatch(report, /semantic-evidence-view|role="dialog"/);
      const settings = await fixture.renderSemanticBranding(
        locale,
        'attributes',
      );
      assert.ok(settings.includes(settingsHeading));
      assert.match(settings, /semantic-config-name-technical/);
      assert.doesNotMatch(settings, /role="dialog"|class="semantic-radar"/);
    }
    const scale = fixture.getTrendScale(
      [
        { date: '2026-09-09', own: 12, other: 18 },
        { date: '2026-09-10', own: 14, other: 22 },
      ],
      ['own', 'other'],
      'visibility',
    );
    assert.ok(scale.domain[0] <= 12 && scale.domain[1] >= 22);
    assert.ok(
      scale.domain[1] - scale.domain[0] < 100,
      'clustered series use the vertical space',
    );
    const extremes = fixture.getTrendScale(
      [{ date: '2026-09-09', own: 0, other: 100 }],
      ['own', 'other'],
      'visibility',
    );
    assert.deepEqual(extremes.domain, [0, 100]);
    const positionScale = fixture.getTrendScale(
      [{ date: '2026-09-09', own: 1.5, other: 3 }],
      ['own', 'other'],
      'position',
    );
    assert.deepEqual(positionScale.ticks, [1, 1.5, 2, 2.5, 3, 3.5]);
    assert.deepEqual(
      positionScale.ticks.map((tick) =>
        fixture.formatPositionTick(tick, 'en-US'),
      ),
      ['1', '1.5', '2', '2.5', '3', '3.5'],
    );
    assert.deepEqual(
      positionScale.ticks.map((tick) =>
        fixture.formatPositionTick(tick, 'pt-BR'),
      ),
      ['1', '1,5', '2', '2,5', '3', '3,5'],
    );
    const translated = await fixture.render('overview', 'pt-BR');
    assert.match(translated, /Visibilidade|Visão geral|visibilidade/);
    assert.match(
      translated,
      /62,6%/,
      'Portuguese metrics use the decimal comma',
    );
    assert.match(
      translated,
      /1\.400/,
      'Portuguese counts use the thousands dot',
    );
    const english = await fixture.render('overview', 'en');
    assert.match(english, /62\.6%/, 'US metrics use the decimal point');
    assert.match(english, /1,400/, 'US counts use the thousands comma');
    assert.match(
      await fixture.render('unknown-page'),
      /<h1(?:\s[^>]*)?>Overview<\/h1>/,
      'An unknown legacy initialTab falls back to the overview',
    );

    for (const base of ['/app', '/app/preview']) {
      const lab = await fixture.renderRoute(
        `${base}/workspaces/seo-lab/projects/seo-lab/overview`,
      );
      assert.match(lab, /<h1(?:\s[^>]*)?>Overview<\/h1>/);
      assert.match(
        lab,
        /SEO Lab/,
        'The route selects its workspace and project during SSR',
      );
      assert.ok(
        !lab.includes('62.6%') && !lab.includes('1,400'),
        'A direct link to an empty project must not render another project’s analytics',
      );

      const profile = await fixture.renderRoute(`${base}/account/profile`);
      assert.match(profile, /id="profile-name"/);
      assert.match(profile, /Profile photo/);
      assert.ok(
        !profile.includes('id="workspace-name"'),
        'An account profile link opens profile settings directly',
      );

      const missing = await fixture.renderRoute(
        `${base}/workspaces/missing-team/projects/conversion/overview`,
      );
      assert.match(missing, /This destination is unavailable/);
      assert.ok(
        !missing.includes('Brand ranking') && !missing.includes('62.6%'),
        'Unknown workspace links must not silently expose another workspace’s report',
      );
    }

    for (const [locale, sections] of [
      [
        'en',
        [
          'Report scope',
          'Brand presence and competitors',
          'Associations and priorities',
          'Coverage by engine',
          'Sources and formats',
          'Score method and limits',
          'Questions and evidence appendix',
        ],
      ],
      [
        'pt-BR',
        [
          'Escopo do relatório',
          'Presença da marca e concorrentes',
          'Método do score e limites',
          'Apêndice de perguntas e evidências',
        ],
      ],
    ] as const) {
      const html = await fixture.renderSemanticReport(locale);
      for (const section of sections)
        assert.ok(html.includes(section), section);
      assert.ok(html.includes('A new question with no data?'));
      assert.ok(!html.includes('NaN') && !html.includes('Infinity'));
    }
    const multiFilterReport = await fixture.renderSemanticReport('pt-BR', {
      days: '28',
      models: ['ChatGPT'],
      country: ['Brazil', 'United States'],
      topic: [],
      tag: ['Discovery', 'Comparison'],
      tagMode: 'all',
    });
    assert.match(
      multiFilterReport,
      /Brasil · Estados Unidos \/ Nenhum selecionado \/ Discovery · Comparison/,
    );
    assert.match(multiFilterReport, /Todas as tags selecionadas/);
    const imported = fixture.parseDemoPromptImport(
      'prompt,topic,country,tags\n"Which agencies, for SEO?",SEO,Brazil,Discovery|Buying\n"What is ""quality"" SEO?",SEO,United States,Research',
    );
    assert.equal(imported.length, 2);
    assert.equal(imported[0].text, 'Which agencies, for SEO?');
    assert.deepEqual(imported[0].tags, ['Discovery', 'Buying']);
    assert.throws(
      () =>
        fixture.parseDemoPromptImport('prompt,country\nValid question?,Spain'),
      /country/,
    );
    assert.throws(
      () => fixture.parseDemoPromptImport('prompt\n"Unclosed question?'),
      /quotes/,
    );
    assert.throws(
      () =>
        fixture.parseDemoPromptImport(
          'prompt\n' +
            Array.from({ length: 101 }, () => 'Valid question?').join('\n'),
        ),
      /rows/,
    );

    const trendReport = {
      brands: [{ id: 'conversion' }, { id: 'mestre' }],
      trend: [{ date: '2026-09-08' }, { date: '2026-09-09' }],
      responses: [
        {
          id: 'sample',
          promptId: 'p1',
          date: '2026-09-09T07:00:00Z',
          model: 'ChatGPT',
          brandIds: ['mestre'],
          sentiment: 80,
          sourceIds: [],
          consultedSourceIds: null,
        },
      ],
    };
    assert.equal(
      fixture.getTrendPoints(trendReport, 'shareOfVoice')[0].conversion,
      null,
    );
    assert.equal(
      fixture.getTrendPoints(trendReport, 'shareOfVoice')[1].conversion,
      0,
    );
    assert.equal(
      fixture.getTrendPoints(trendReport, 'shareOfVoice')[1].mestre,
      100,
    );
    assert.equal(
      fixture.getTrendPoints(trendReport, 'position')[1].conversion,
      null,
    );
    assert.equal(fixture.getTrendPoints(trendReport, 'position')[1].mestre, 1);

    const base = {
      promptId: 'p1',
      date: '2026-09-09T07:00:00.000Z',
      model: 'ChatGPT' as const,
      sentiment: 80,
      consultedSourceIds: null,
    };
    const overview = await fixture.renderOverview([
      {
        ...base,
        id: 'one',
        brandIds: ['conversion', 'mestre'],
        sourceIds: ['s1', 's2'],
      },
      {
        ...base,
        id: 'two',
        brandIds: ['mestre', 'conversion'],
        sourceIds: ['s1'],
      },
      { ...base, id: 'three', brandIds: ['mestre'], sourceIds: ['s3'] },
    ]);
    const cards = overview.split('class="metric-summary"').slice(1);
    assert.match(
      cards[0],
      /66\.7%/,
      'Visibility divides brand mentions by the three responses',
    );
    assert.match(
      cards[1],
      /40\.0%/,
      'Share of voice divides two mentions by five total brand mentions',
    );
    const clutchRow = overview.match(
      /<tr\b[^>]*>(?:(?!<\/tr>)[\s\S])*clutch\.co(?:(?!<\/tr>)[\s\S])*<\/tr>/,
    )?.[0];
    assert.ok(clutchRow, 'The cited source appears in the evidence table');
    assert.match(
      clutchRow.replace(/<!--[\s\S]*?-->/g, ''),
      /66\.7%/,
      'Source citation rate divides by responses, not total citation count',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
