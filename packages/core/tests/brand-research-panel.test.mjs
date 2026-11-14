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
      "import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {BrandResearchPanel} from './components/analytics/brand-research-panel';import {CompetitorDiscoveryPanel} from './components/lastfind/competitor-discovery-panel';import {BrandReportTabs,parseBrandReportView} from './components/analytics/brand-report-tabs';export {parseBrandReportView,syncBrandReportView,BRAND_REPORT_VIEWS} from './components/analytics/brand-report-tabs';export const renderTabs=(value)=>renderToStaticMarkup(React.createElement(BrandReportTabs,{value:parseBrandReportView(value)},'ACTIVE REPORT'));export const renderDiscovery=(props)=>renderToStaticMarkup(React.createElement(CompetitorDiscoveryPanel,props));export const render=(props)=>renderToStaticMarkup(React.createElement(BrandResearchPanel,props));",
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
            'export const useReport=()=>({data:globalThis.researchPanelFixture.report,loading:!!globalThis.researchPanelFixture.loading});',
          '@/lib/client':
            "export const requestJson=async(path,method,body)=>{const fixture=globalThis.researchPanelFixture;if(!fixture.requests)throw Error('Rendering a report must not mutate.');fixture.requests.push({path,method,body});return fixture.responses.shift();};",
          '@/components/lastfind/competitor-discovery-panel':
            "import React from 'react';export const CompetitorDiscoveryPanel=()=>React.createElement('section',null,'DISCOVERY SETTINGS');",
          './shared':
            "import React from 'react';export const FilterSelect=({label,disabled,options,value})=>React.createElement('select',{'aria-label':label,disabled,defaultValue:value},options?.map(option=>React.createElement('option',{key:option.value,value:option.value},option.label)));export const SiteFavicon=()=>null;",
          // The real PageFilters portals into the page header (client only).
          '@/components/lastfind/presentation/page-heading':
            "import React from 'react';export const PageFilters=({children})=>React.createElement(React.Fragment,null,children);",
          '@/components/lastfind/identity-icons':
            "import React from 'react';export const EngineBadge=({engine})=>React.createElement('span',null,engine);",
        };
        stubs['@/components/ui/tabs'] =
          "import React from 'react';const C=React.createContext();export const Tabs=({value,children})=>React.createElement(C.Provider,{value},React.createElement('div',null,children));export const TabsList=({children,...props})=>React.createElement('div',{...props,role:'tablist'},children);export const TabsTrigger=({children,value})=>React.createElement('button',{role:'tab','aria-selected':React.useContext(C)===value},children);export const TabsContent=({children,value})=>React.createElement('section',{role:'tabpanel','data-view':value},children);";
        stubs['@/components/ui/dropdown-menu'] =
          "import React from 'react';" +
          ['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuGroup', 'DropdownMenuItem', 'DropdownMenuLabel', 'DropdownMenuCheckboxItem']
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
            'TableFooter',
            'TableHead',
            'TableHeader',
            'TableRow',
          ],
        }))
          stubs['@/components/ui/' + path] =
            "import React from 'react';" +
            (path === 'button' ? "export const buttonVariants=()=>'';" : '') +
            names
              .map(
                (name) =>
                  name === 'Button'
                    ? `export const Button=({children,disabled,onClick,'aria-current':current,'aria-pressed':pressed})=>{globalThis.researchPanelFixture?.buttons?.push({label:children,disabled,onClick});return React.createElement('button',{disabled,'aria-current':current,'aria-pressed':pressed},children);};`
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
      distribution: { positive: 0, neutral: 0, negative: 0 },
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
      assert.doesNotMatch(read, /openai\/gpt-6-luna-decisions/);
      assert.match(
        read,
        locale === 'en' ? /Manage in Settings/ : /Gerenciar em Configurações/,
      );
      assert.doesNotMatch(
        read,
        /Sentiment evaluator|Avaliador de sentimento|Enable evaluation|Habilitar avaliação|Save changes|Salvar alterações|Evaluate up to|Avaliar até|DISCOVERY SETTINGS/,
      );
      const settings = fixtureModule.exports.render({
        ...props,
        settings: true,
      });
      assert.doesNotMatch(settings, /<select|Liquid|Jev|Decisions|Sentiment evaluator|Avaliador de sentimento/);
      assert.match(settings, /DISCOVERY SETTINGS/);
      assert.match(
        settings,
        locale === 'en' ? /Save changes/ : /Salvar alterações/,
      );
      assert.match(
        settings,
        locale === 'en' ? /Enable evaluation/ : /Habilitar avaliação/,
      );
      assert.match(settings, /settings-block-footer/);
      assert.match(settings, locale === 'en' ? /<button disabled="">Cancel/ : /<button disabled="">Cancelar/);
      assert.doesNotMatch(settings, /Manage in Settings|Gerenciar em Configurações/);
    } finally {
      delete globalThis.researchPanelFixture;
    }
  });

for (const locale of ['en', 'pt-BR'])
  test(`loading sentiment is announced and labelled, never a bare grey block (${locale})`, () => {
    globalThis.researchPanelFixture = { locale, loading: true };
    try {
      const html = fixtureModule.exports.render(props);
      assert.match(html, /<output[^>]*aria-busy="true"/);
      assert.match(
        html,
        locale === 'en' ? /Loading sentiment…/ : /Carregando sentimentos…/,
      );
    } finally {
      delete globalThis.researchPanelFixture;
    }
  });

test('Competitors settings has a single grid content child containing both management panels and the checks budget', () => {
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
  // The common-word checks' monthly budget follows the two management panels.
  assert.deepEqual(panels, ['LiveCompetitorSettings', 'BrandResearchPanel', 'MentionBudget']);
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
    // An evidence excerpt is a cut of the answer's markdown: inside its button it reads as text, the brand marked, no
    // raw markers, links or citations (the Brands side panel shows it the same way).
    const quoted = fixtureModule.exports.renderDiscovery({
      ...props,
      sample: { ...sample, suggestions: [{ ...candidate('Peacock', 'peacocktv.com'), evidence: [{ runId: 'r1', createdAt: '2026-10-30T00:00:00Z', excerpt: '1. **Peacock** streams [NBC shows](https://nbc.example/a).[[1]](https://nbc.example/b)' }] }] },
      research,
      readOnly: false,
      onCompleted: () => {},
    });
    assert.match(quoted, /“1\. <mark class="[^"]*">Peacock<\/mark> streams NBC shows\.”/);
    assert.doesNotMatch(quoted, /\*\*|\]\(|\[\[/);
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
    const html = fixtureModule.exports.render({ ...props, settings: true });
    assert.match(html, /Evaluations queued/);
    assert.doesNotMatch(html, /Processing queued evaluations/);
    // The prompt page shows the reading only: no queue, coverage or failure status.
    const promptPage = fixtureModule.exports.render(props);
    assert.doesNotMatch(promptPage, /Evaluations queued|not evaluated|Partial scope|cost pending|operator/);
  } finally {
    delete globalThis.researchPanelFixture;
  }
});

for (const locale of ['en', 'pt-BR'])
  test(`brand pages keep legacy filters and Sentiment deep links without internal navigation (${locale})`, () => {
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
        'general',
      );
      fixtureModule.exports.syncBrandReportView(initial, 'general', true);
      assert.equal(initial.has('brandView'), false);
      fixtureModule.exports.syncBrandReportView(initial, 'rejected', true);
      assert.equal(initial.get('brandView'), 'rejected');
      fixtureModule.exports.syncBrandReportView(initial, 'rejected', false);
      assert.equal(initial.get('engine'), 'chat_gpt');
      assert.equal(initial.get('topic'), 'topic');
      assert.equal(initial.has('brandView'), false);
      const general = fixtureModule.exports.renderTabs(undefined),
        sentiment = fixtureModule.exports.renderTabs('sentiment');
      assert.match(general, /data-view="general"/);
      assert.match(sentiment, /data-view="general"/);
      for (const value of ['general', 'discovered', 'rejected'])
        assert.match(fixtureModule.exports.renderTabs(value), new RegExp(`data-view="${value}"`));
      // The lists are chosen in the header's Brands filter on that screen; the monitored brands are its own option,
      // an unknown view is the whole list.
      assert.deepEqual(fixtureModule.exports.BRAND_REPORT_VIEWS.map(([view]) => view), ['general', 'discovered', 'rejected']);
      assert.equal(fixtureModule.exports.parseBrandReportView('tracked'), 'general');
      assert.doesNotMatch(general + sentiment, /<nav|role="tablist"|section-layout|<select/);
      assert.match(general, /ACTIVE REPORT/);
      assert.match(sentiment, /ACTIVE REPORT/);
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
      score: sentiment === 'positive' ? 85 : 35,
      criteria: sentiment === 'positive' ? { recommended: 0, leader: 0 } : { reservation: 0 },
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
          distribution: { positive: 0, neutral: 1, negative: 0 },
          scoreTotal: 60,
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
      // The one band takes the whole bar (its share as the flex grow), in its pastel fill.
      assert.match(html, /background:var\(--sentiment-neutral-fill\);flex-grow:1/);
      assert.match(
        html,
        locale === 'en'
          ? /Real preview sample: 8 answers, 4 questions, collection paused/
          : /Amostra real do preview: 8 respostas, 4 perguntas, coleta pausada/,
      );
      assert.match(
        html,
        locale === 'en'
          ? /original collection dates and sources preserved/
          : /datas de coleta e fontes originais/,
      );
      assert.match(html, /aria-pressed="true"/);
      assert.match(html, locale === 'en' ? /Neutral: 1/ : /Neutros: 1/);
      // Nothing filtered away: no count line (it shows only when a filter hides answers).
      assert.doesNotMatch(html, /loaded details|detalhes carregados|2 of 2|2 de 2/);
      assert.match(html, locale === 'en' ? /Promoters 60–100/ : /Promotores 60–100/);
      // The why of each answer's score: the criteria met above the quote that shows them, and the sum.
      assert.match(html, locale === 'en' ? /score 85\/100/ : /nota 85\/100/);
      assert.match(html, locale === 'en' ? /Starts at 50, \+20 \+15 = 85\./ : /Parte de 50, \+20 \+15 = 85\./);
      assert.match(html, locale === 'en' ? /<figcaption[^>]*>Recommended \+20, Presented as the best or the leader \+15<\/figcaption>/ : /<figcaption[^>]*>Recomendou \+20, Apresentou como a melhor ou líder \+15<\/figcaption>/);
      assert.match(html, locale === 'en' ? /Starts at 50, −15 = 35\./ : /Parte de 50, −15 = 35\./);
      assert.match(
        html,
        locale === 'en'
          ? /Latest answers: mentioned in 2 of 4 questions, 1 evaluated/
          : /Últimas respostas: citada em 2 de 4 perguntas, 1 avaliadas/,
      );
      assert.match(html, locale === 'en' ? /Not mentioned in the latest answers: 2/ : /Sem menção nas últimas respostas: 2/);
      assert.match(
        html,
        locale === 'en' ? /No evaluated sentiment/ : /Sem sentimento avaliado/,
      );
      // The evaluated brand carries the text marker inside its evidence.
      assert.match(html, /<mark class="live-answer-mark live-answer-mark-own">Netflix<\/mark> is excellent/);
      assert.match(html, /<mark class="live-answer-mark live-answer-mark-own">Netflix<\/mark> has poor support/);
      assert.match(html, /chat_gpt/);
      assert.match(html, /gemini/);
      // Each answer is a closed row of the catalog Accordion: the question, brand, score, model and date in its trigger, the
      // evidence kept in the page under it (keepMounted).
      const evidence = html
        .split('data-slot="accordion-item"')
        .slice(1)
        .filter((body) => body.includes('<blockquote'));
      assert.equal(evidence.length, 2);
      for (const body of evidence) {
        const trigger = body.split('</button>')[0];
        assert.match(trigger, /aria-expanded="false"/);
        assert.match(trigger, /Which streaming service/);
        assert.match(trigger, /Netflix/);
        assert.match(trigger, /chat_gpt|gemini/);
        assert.match(trigger, locale === 'en' ? /score (85|35)\/100/ : /nota (85|35)\/100/);
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
          ? /Only the most recent answers are listed; narrow the period to see older ones\./
          : /Só as respostas mais recentes aparecem; restrinja o período para ver as anteriores\./,
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
          ? /Only the most recent answers are listed/
          : /Só as respostas mais recentes aparecem/,
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
  assert.match(section, /<BrandsScreen\b/);
  // Competitor-only questions moved to Prompts (a filter there), so Brands takes no prompt navigation.
  assert.doesNotMatch(section, /onPrompt:/);
  assert.doesNotMatch(section, /<BrandResearchPanel\b/);
  assert.match(section, /filters=\{filterQuery\}/);
  assert.match(section, /request=\{transport\}/);
  assert.match(section, /onTargetsChanged=/);
  assert.equal((section.match(/<DataTable\b/g) || []).length, 0, 'BrandsScreen owns its table');
  assert.doesNotMatch(section, /live-list/);
  const screen = readFileSync(
    root + 'packages/core/components/analytics/brands-screen.tsx',
    'utf8',
  );
  // One table; its loading copy (BrandsSkeleton, the same columns) is the only other.
  assert.equal((screen.slice(0, screen.indexOf('export function BrandsSkeleton')).match(/<DataTable\b/g) || []).length, 1);
  assert.doesNotMatch(screen, /Competitor-only questions|TabsTrigger/);
  assert.doesNotMatch(screen, /brandTopicsPage|By AI model|By topic/);
});

for (const locale of ['en', 'pt-BR'])
  test(`internal evaluator metadata stays hidden for every saved provider (${locale})`, () => {
    try {
      for (const [provider, model] of [['liquid', 'liquid/d1-ultra'], ['jev', 'typesafe/jev-1.14'], ['decisions', 'OpenAI Decisions']]) {
        globalThis.researchPanelFixture = { locale, report: {
          ...report, provider, model, configured: false,
          configuration: { provider, sentimentProvider: provider, enabled: true, revision: 2, updatedAt: null },
        } };
        for (const settings of [false, true]) {
          const html = fixtureModule.exports.render({ ...props, settings });
          assert.doesNotMatch(html, /liquid|d1-ultra|jev|typesafe|OpenAI Decisions|OpenRouter|haiku/i);
          if (settings) {
            assert.match(html, locale === 'en' ? /Brand evaluation isn&#x27;t available on this installation yet/ : /A avaliação de marcas ainda não está disponível nesta instalação/);
            assert.match(html, /href="\/docs"/);
          }
        }
      }
    } finally {
      delete globalThis.researchPanelFixture;
    }
  });

for (const provider of ['liquid', 'jev', 'decisions'])
  test(`evaluation and preview processing keep the server's saved evaluator without a selector (${provider})`, async () => {
    globalThis.researchPanelFixture = {
      locale: 'en',
      report: { ...report, manualProcessing: true, configuration: {
        provider: 'jev', sentimentProvider: provider, enabled: true, revision: 2, updatedAt: null,
      } },
      buttons: [], requests: [], responses: [{ enqueued: 2 }, { processed: 2, pending: 0, failed: 0 }],
    };
    try {
      const html = fixtureModule.exports.render({ ...props, settings: true });
      assert.doesNotMatch(html, /<select/);
      const evaluate = globalThis.researchPanelFixture.buttons.find((button) => button.label === 'Evaluate up to 20 answers');
      assert.ok(evaluate);
      assert.equal(evaluate.disabled, false);
      evaluate.onClick();
      await new Promise(setImmediate);
      assert.deepEqual(globalThis.researchPanelFixture.requests.map(({ method, body }) => ({ method, body })), [
        // The client never names an evaluator; the server keeps the one saved in Admin.
        { method: 'POST', body: {} },
        { method: 'POST', body: { action: 'process' } },
      ]);
    } finally {
      delete globalThis.researchPanelFixture;
    }
  });

// Cached analytics refreshes must not restart independent research requests.
test('all research surfaces refresh on mutations, independently of cache notifications', () => {
  const source = ts.createSourceFile(
    'live-app.tsx',
    readFileSync(
      new URL('../components/analytics/live-app.tsx', import.meta.url),
      'utf8',
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const surfaces = [];
  function visit(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      ['BrandResearchPanel', 'BrandsScreen'].includes(
        node.tagName.getText(source),
      )
    ) {
      surfaces.push(node);
      const refresh = node.attributes.properties.find(
        (attribute) => attribute.name?.getText(source) === 'refresh',
      );
      assert.equal(
        refresh.initializer.expression.getText(source),
        'cache.generation',
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(surfaces.length, 3); // Brands embeds sentiment, no separate panel
});
