import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await build({
  stdin: {
    contents:
      "import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {BrandResearchPanel} from './components/analytics/brand-research-panel';import {CompetitorDiscoveryPanel} from './components/lastfind/competitor-discovery-panel';import {BrandReportTabs,parseBrandReportView} from './components/analytics/brand-report-tabs';export {parseBrandReportView,syncBrandReportView} from './components/analytics/brand-report-tabs';export const renderTabs=(value)=>renderToStaticMarkup(React.createElement(BrandReportTabs,{value:parseBrandReportView(value),onChange:()=>{}},'ACTIVE REPORT'));export const renderDiscovery=(props)=>renderToStaticMarkup(React.createElement(CompetitorDiscoveryPanel,props));export const render=(props)=>renderToStaticMarkup(React.createElement(BrandResearchPanel,props));",
    resolveDir: root + 'packages/core',
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['react', 'react-dom/server', 'react/jsx-runtime'],
  loader: { '.css': 'empty' },
  jsx: 'automatic',
  plugins: [
    {
      name: 'ui-boundaries',
      setup(builder) {
        const stubs = {
          '@/lib/i18n':
            'export const useI18n=()=>({locale:globalThis.researchPanelFixture.locale});',
          '@/hooks/use-report':
            'export const useReport=()=>({data:globalThis.researchPanelFixture.report,loading:false});',
          '@/lib/client':
            "export const requestJson=()=>{throw Error('Rendering a report must not mutate.');};",
          '@/components/lastfind/competitor-discovery-panel':
            "import React from 'react';export const CompetitorDiscoveryPanel=()=>React.createElement('section',null,'DISCOVERY SETTINGS');",
          './shared':
            "import React from 'react';export const FilterSelect=({label,disabled,options,value})=>React.createElement('select',{'aria-label':label,disabled,defaultValue:value},options?.map(option=>React.createElement('option',{key:option.value,value:option.value},option.label)));export const SiteFavicon=()=>null;",
          '@/components/lastfind/identity-icons':
            "import React from 'react';export const EngineBadge=({engine})=>React.createElement('span',null,engine);",
        };
        stubs['@/components/ui/tabs'] =
          "import React from 'react';const C=React.createContext();export const Tabs=({value,children})=>React.createElement(C.Provider,{value},React.createElement('div',null,children));export const TabsList=({children,...props})=>React.createElement('div',{...props,role:'tablist'},children);export const TabsTrigger=({children,value})=>React.createElement('button',{role:'tab','aria-selected':React.useContext(C)===value},children);export const TabsContent=({children,value})=>React.createElement('section',{role:'tabpanel','data-view':value},children);";
        stubs['@/components/ui/dropdown-menu'] =
          "import React from 'react';" +
          ['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuGroup', 'DropdownMenuItem', 'DropdownMenuLabel']
            .map((name) => `export const ${name}=({children})=>React.createElement('div',null,children);`)
            .join('');
        for (const [path, names] of Object.entries({
          button: ['Button'],
          checkbox: ['Checkbox'],
          skeleton: ['Skeleton'],
          input: ['Input'],
          progress: ['Progress'],
          card: ['Card'],
          table: [
            'Table',
            'TableBody',
            'TableCell',
            'TableHead',
            'TableHeader',
            'TableRow',
          ],
        }))
          stubs['@/components/ui/' + path] =
            "import React from 'react';" +
            names
              .map(
                (name) =>
                  name === 'Button'
                    ? `export const Button=({children,disabled,'aria-current':current,'aria-pressed':pressed})=>React.createElement('button',{disabled,'aria-current':current,'aria-pressed':pressed},children);`
                    : `export const ${name}=({children,disabled})=>React.createElement('${name === 'Checkbox' ? 'input' : 'div'}',{disabled},children);`,
              )
              .join('');
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(stubs, args.path)
            ? { path: args.path, namespace: 'fixture' }
            : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: stubs[args.path],
          loader: 'js',
        }));
        builder.onResolve({ filter: /^@\// }, (args) => {
          const base = root + 'packages/core/' + args.path.slice(2);
          return {
            path:
              ['.ts', '.tsx'].map((extension) => base + extension).find(existsSync) ??
              base + '.ts',
          };
        });
      },
    },
  ],
});
const fixtureModule = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(root + 'package.json'),
  fixtureModule,
  fixtureModule.exports,
);
const props = {
  project: {
    id: 'project',
    name: 'Netflix',
    domain: 'netflix.com',
    competitors: [],
  },
  filters: new URLSearchParams(),
  demo: false,
  refresh: 0,
  busy: false,
  onEvidence: () => {},
  onManage: () => {},
  onAdd: async () => {},
};
const report = {
  configuration: {
    provider: 'decisions',
    enabled: true,
    revision: 2,
    updatedAt: null,
  },
  provider: 'decisions',
  model: 'openai/gpt-6-luna-decisions',
  configured: true,
  allowed: true,
  selectedChannels: 8,
  unassessed: 8,
  jobs: [],
  brands: [
    {
      brand: 'Netflix',
      prompts: 4,
      assessed: 0,
      absent: 0,
      partial: 0,
      pending: 4,
      insufficient: 0,
      ambiguous: 0,
      failed: 0,
      distribution: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
    },
  ],
  details: [],
  suggestions: [],
};
for (const locale of ['en', 'pt-BR'])
  test(`reports are read-only and Settings owns all research configuration (${locale})`, () => {
    globalThis.researchPanelFixture = { locale, report };
    try {
      const read = fixtureModule.exports.render(props);
      assert.match(read, /Netflix/);
      assert.match(read, /openai\/gpt-6-luna-decisions/);
      assert.match(
        read,
        locale === 'en' ? /Manage in Settings/ : /Gerenciar em Settings/,
      );
      assert.doesNotMatch(
        read,
        /Sentiment evaluator|Avaliador de sentimento|Enable evaluation|Habilitar avaliação|Save settings|Salvar configuração|Evaluate up to|Avaliar até|DISCOVERY SETTINGS/,
      );
      const settings = fixtureModule.exports.render({
        ...props,
        settings: true,
      });
      assert.match(settings, /<select/);
      assert.match(settings, /DISCOVERY SETTINGS/);
      assert.match(
        settings,
        locale === 'en' ? /Save settings/ : /Salvar configuração/,
      );
      assert.match(
        settings,
        locale === 'en' ? /Enable evaluation/ : /Habilitar avaliação/,
      );
      assert.doesNotMatch(settings, /Manage in Settings|Gerenciar em Settings/);
    } finally {
      delete globalThis.researchPanelFixture;
    }
  });

test('Competitors settings has a single grid content child containing both management panels', () => {
  const path = root + 'packages/core/components/analytics/live-app.tsx';
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const sections = [];
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      node.left.getText(source) === "settingsSection === 'competitors'"
    )
      sections.push(node.right);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(sections.length, 1);
  const content = sections[0];
  assert.ok(
    ts.isJsxElement(content),
    'The grid content must be one real DOM element, never a fragment.',
  );
  assert.equal(content.openingElement.tagName.getText(source), 'div');
  const className = content.openingElement.attributes.properties.find(
    (attribute) => attribute.name?.getText(source) === 'className',
  ).initializer.text;
  assert.match(className, /live-settings-content/);
  assert.match(className, /min-w-0/);
  assert.match(className, /space-y-/);
  const panels = content.children
    .filter((node) => ts.isJsxSelfClosingElement(node))
    .map((node) => node.tagName.getText(source));
  assert.deepEqual(panels, ['LiveCompetitorSettings', 'BrandResearchPanel']);
});

test('research suggestions require positive evidence verification and hide insufficient, pending or rejected identities; legacy fallback is preserved', () => {
  globalThis.researchPanelFixture = { locale: 'en', report };
  const candidate = (name, domain = null) => ({
    name,
    domain,
    score: 0.8,
    answerCount: 1,
    evidence: [],
  });
  const sample = {
    status: 'complete',
    revision: 'fixture',
    suggestions: [
      candidate('Peacock', 'peacocktv.com'),
      candidate('While'),
      candidate('Unprepared'),
      candidate('It'),
    ],
    processed: 1,
    total: 1,
  };
  const reading = (
    name,
    domain = null,
    verifiedPrompts = 0,
    rejectedPrompts = 0,
  ) => ({
    name,
    domain,
    answerCount: 1,
    verifiedPrompts,
    rejectedPrompts,
    ambiguousPrompts: 0,
    evidence: [],
  });
  try {
    const research = [
      reading('Peacock', 'peacocktv.com', 1),
      reading('While', null, 0, 1),
      reading('MUBI', 'mubi.com'),
      reading('It'),
      reading('Explore Peacock', 'peacocktv.com'),
    ];
    const filtered = fixtureModule.exports.renderDiscovery({
      ...props,
      sample,
      research,
      readOnly: false,
      onCompleted: () => {},
    });
    assert.match(filtered, /Peacock/);
    assert.doesNotMatch(filtered, /MUBI|While|Unprepared|Explore Peacock|>It</);
    const legacy = fixtureModule.exports.renderDiscovery({
      ...props,
      sample,
      readOnly: false,
      onCompleted: () => {},
    });
    assert.match(legacy, /While/);
    assert.match(legacy, /Unprepared/);
    const empty = fixtureModule.exports.renderDiscovery({
      ...props,
      sample,
      research: research.filter((reading) => !reading.verifiedPrompts),
      readOnly: false,
      onCompleted: () => {},
    });
    assert.match(
      empty,
      /No new competitors have been confirmed with sufficient evidence/,
    );
    globalThis.researchPanelFixture.locale = 'pt-BR';
    const emptyPt = fixtureModule.exports.renderDiscovery({
      ...props,
      sample,
      research: [],
      readOnly: false,
      onCompleted: () => {},
    });
    assert.match(
      emptyPt,
      /Nenhum novo concorrente foi confirmado com evidência suficiente/,
    );
  } finally {
    delete globalThis.researchPanelFixture;
  }
});

test('stopped manual queue is labeled queued rather than actively processing', () => {
  globalThis.researchPanelFixture = {
    locale: 'en',
    report: {
      ...report,
      manualProcessing: true,
      jobs: [{ id: 'pending', status: 'pending', error: null }],
    },
  };
  try {
    const html = fixtureModule.exports.render(props);
    assert.match(html, /Evaluations queued/);
    assert.doesNotMatch(html, /Processing queued evaluations/);
  } finally {
    delete globalThis.researchPanelFixture;
  }
});

for (const locale of ['en', 'pt-BR'])
  test(`brand report tabs support General default and Sentiment deep link (${locale})`, () => {
    globalThis.researchPanelFixture = { locale, report };
    try {
      assert.equal(fixtureModule.exports.parseBrandReportView(null), 'general');
      assert.equal(
        fixtureModule.exports.parseBrandReportView('invalid'),
        'general',
      );
      const initial = new URLSearchParams(
        'project=Netflix&days=28&engine=chat_gpt&topic=topic&tags=tag&brandView=sentiment',
      );
      assert.equal(
        fixtureModule.exports.parseBrandReportView(initial.get('brandView')),
        'sentiment',
      );
      const original = new URLSearchParams(initial);
      fixtureModule.exports.syncBrandReportView(initial, 'general', true);
      assert.equal(initial.has('brandView'), false);
      fixtureModule.exports.syncBrandReportView(initial, 'sentiment', true);
      assert.equal(initial.toString(), original.toString());
      fixtureModule.exports.syncBrandReportView(initial, 'sentiment', false);
      assert.equal(initial.get('engine'), 'chat_gpt');
      assert.equal(initial.get('topic'), 'topic');
      assert.equal(initial.has('brandView'), false);
      const general = fixtureModule.exports.renderTabs(undefined),
        sentiment = fixtureModule.exports.renderTabs('sentiment');
      assert.match(general, /<nav[^>]*aria-label="(Brand reports|Relatórios de marcas)"/);
      assert.match(general, /data-view="general"/);
      assert.match(sentiment, /data-view="sentiment"/);
      assert.match(
        general,
        locale === 'en'
          ? /aria-current="page"[^>]*>.*?<span[^>]*>General<\/span>/
          : /aria-current="page"[^>]*>.*?<span[^>]*>Geral<\/span>/,
      );
      assert.match(
        sentiment,
        locale === 'en'
          ? /aria-current="page"[^>]*>.*?<span[^>]*>Sentiment<\/span>/
          : /aria-current="page"[^>]*>.*?<span[^>]*>Sentimentos<\/span>/,
      );
    } finally {
      delete globalThis.researchPanelFixture;
    }
  });

for (const locale of ['en', 'pt-BR'])
  test(`sentiment bars use logical-question aggregates with separate coverage and model evidence (${locale})`, () => {
    const detail = (runId, engine, sentiment, evidence) => ({
      runId,
      unitId: 'same-question',
      prompt: 'Which streaming service?',
      engine,
      date: '2026-10-15T09:00:00Z',
      brand: 'Netflix',
      state: 'assessed',
      sentiment,
      evidence: [evidence],
    });
    const measured = {
      ...report,
      brands: [
        {
          ...report.brands[0],
          prompts: 4,
          assessed: 1,
          absent: 2,
          partial: 2,
          distribution: { positive: 0, neutral: 0, negative: 0, mixed: 1 },
        },
        {
          ...report.brands[0],
          brand: 'Apple TV+',
          prompts: 4,
          assessed: 0,
          absent: 4,
        },
      ],
      details: [
        detail(
          'positive',
          'chat_gpt',
          'positive',
          'Netflix is excellent. <script>alert(1)</script>' +
            'Z'.repeat(1100) +
            ' uncut end',
        ),
        detail('negative', 'gemini', 'negative', 'Netflix has poor support.'),
      ],
      detailsTruncated: true,
      previewImport: {
        answers: 8,
        questions: 4,
        sourceUrl: 'https://demo.example/answers',
        importedAt: '2026-10-15',
        kind: 'public-saved-answer-import',
      },
    };
    globalThis.researchPanelFixture = { locale, report: measured };
    try {
      const html = fixtureModule.exports.render(props);
      assert.match(html, /width:100%/);
      assert.match(
        html,
        locale === 'en'
          ? /Real preview sample: 8 answers · 4 questions · collection paused/
          : /Amostra real do preview: 8 respostas · 4 perguntas · coleta pausada/,
      );
      assert.match(
        html,
        locale === 'en'
          ? /original collection dates and sources preserved/
          : /datas de coleta e fontes originais/,
      );
      assert.match(html, /aria-pressed="true"/);
      assert.match(html, locale === 'en' ? /Mixed: 1/ : /Misto: 1/);
      assert.match(
        html,
        locale === 'en'
          ? /1 evaluated \/ 2 with mention \/ 4 monitored questions/
          : /1 avaliadas \/ 2 com menção \/ 4 perguntas monitoradas/,
      );
      assert.match(html, locale === 'en' ? /No mention: 2/ : /Sem menção: 2/);
      assert.match(
        html,
        locale === 'en' ? /No evaluated sentiment/ : /Sem sentimento avaliado/,
      );
      assert.match(html, /Netflix is excellent/);
      assert.match(html, /Netflix has poor support/);
      assert.match(html, /chat_gpt/);
      assert.match(html, /gemini/);
      const disclosures = [
        ...html.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g),
      ];
      const evidence = disclosures.filter(([, , body]) =>
        body.includes('<blockquote'),
      );
      assert.equal(evidence.length, 2);
      for (const [, attributes, body] of evidence) {
        assert.doesNotMatch(attributes, /\bopen(?:=|\s|$)/);
        const summary = body.split('</summary>')[0];
        assert.match(summary, /Which streaming service/);
        assert.match(summary, /Netflix/);
        assert.match(summary, /chat_gpt|gemini/);
        assert.match(
          summary,
          locale === 'en' ? /View evidence/ : /Ver evidências/,
        );
        assert.match(
          body,
          locale === 'en' ? /Open full response/ : /Abrir resposta completa/,
        );
      }
      assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.ok(html.includes('Z'.repeat(1100) + ' uncut end'));
      assert.doesNotMatch(html, /<script>/);
      assert.match(
        html,
        locale === 'en'
          ? /How sentiment is counted/
          : /Como o sentimento é contado/,
      );

      assert.match(
        html,
        locale === 'en'
          ? /first 120 brand\/answer details before these filters/
          : /primeiros 120 detalhes marca\/resposta antes destes filtros/,
      );
      assert.match(
        html,
        locale === 'en' ? /Response sentiment/ : /Sentimento nesta resposta/,
      );
      assert.doesNotMatch(
        html,
        /DISCOVERY SETTINGS|Save settings|Salvar configuração/,
      );
      globalThis.researchPanelFixture.report = {
        ...measured,
        brands: [],
        details: [],
        truncated: true,
      };
      const empty = fixtureModule.exports.render(props);
      assert.match(
        empty,
        locale === 'en'
          ? /No answers fit this report limit/
          : /Nenhuma resposta cabe neste limite/,
      );
      assert.match(
        empty,
        locale === 'en'
          ? /Missing matches do not mean/
          : /Ausência de resultados não significa/,
      );
    } finally {
      delete globalThis.researchPanelFixture;
    }
  });

test('Brands routing restores its own view through history and General has only one ranking table', () => {
  const source = readFileSync(
    root + 'packages/core/components/analytics/live-app.tsx',
    'utf8',
  );
  assert.match(source, /parseBrandReportView\(query.get\('brandView'\)\)/);
  assert.match(
    source,
    /setBrandView\(parseBrandReportView\(next.get\('brandView'\)\)\)/,
  );
  assert.match(
    source,
    /syncBrandReportView\(params, state.brandView, tab === 'competitors'\)/,
  );
  const start = source.indexOf(
    "{project && !creatingProject && tab === 'competitors'",
  );
  const section = source.slice(
    start,
    source.indexOf("{project && !creatingProject && tab === 'models'", start),
  );
  assert.equal(
    (section.match(/<DataTable\b/g) || []).length,
    1,
  );
  assert.doesNotMatch(section, /brandTopicsPage|By AI model|By topic/);
  assert.match(section, /Competitor-only questions/);
  assert.match(section, /brandView === 'sentiment'/);
});
