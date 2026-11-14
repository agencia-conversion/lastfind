import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
      import {LocaleProvider} from './lib/i18n';
      import {BrandsScreen} from './components/analytics/brands-screen';
      import {OverviewSentimentCard} from './components/analytics/overview-sentiment-card';
      import {BrandSentimentAnalysis} from './components/analytics/brand-sentiment-analysis';
      export {sentimentScore} from './components/analytics/overview-sentiment-card';
      export {buildBrandRows, withPending, brandSummary} from './components/analytics/brands-screen';
      export const brands=p=>{
        const useState=React.useState;
        React.useState=initial=>useState(initial==='brands' ? globalThis.brandsFixture.tab??initial : initial);
        try { return renderToStaticMarkup(<LocaleProvider initialLocale={globalThis.brandsFixture.locale}><BrandsScreen {...p}/></LocaleProvider>); }
        finally { React.useState=useState; }
      };
      export const card=p=>renderToStaticMarkup(<OverviewSentimentCard {...p}/>);
      export const evidence=p=>renderToStaticMarkup(<LocaleProvider initialLocale={globalThis.brandsFixture.locale}><BrandSentimentAnalysis {...p}/></LocaleProvider>);`,
    resolveDir: root + 'packages/core',
    loader: 'tsx',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
  loader: { '.css': 'empty' },
  plugins: [
    {
      name: 'fixtures',
      setup(builder) {
        const stubs = {
          '@/hooks/use-report': `export const useReport=(url,refresh,request)=>{const f=globalThis.brandsFixture;f.reads.push({url,refresh,request});return url?.includes('/brand-research') ? f.remote : {data:f.overview,loading:false};};`,
          'next/image': `import React from 'react';export default ({unoptimized,priority,fill,...p})=><img {...p}/>;`,
          '@/components/ui/button': `import React from 'react';export const Button=({children,onClick,variant,size,...props})=>{globalThis.brandsFixture.buttons.push({children,onClick,props});return <button {...props}>{children}</button>;};export const buttonVariants=()=>'';`,
          '@/components/ui/toast': `const toast={adds:[],statuses:[],add(opts){const id='toast'+this.adds.length;this.adds.push({id,opts});return id;},close(){}};globalThis.brandsToast=toast;export{toast};export const useStatusToast=(id,status)=>{toast.statuses.push({id,status});};`,
          '@/components/ui/dropdown-menu': `import React from 'react';const push=(children,onClick,props={})=>globalThis.brandsFixture.buttons.push({children,onClick,props});
            const Pass=({children})=>children;
            export const DropdownMenu=Pass;
            export const DropdownMenuTrigger=({children,render})=>render??children;
            export const DropdownMenuContent=Pass;
            export const DropdownMenuItem=({children,onClick,...props})=>{push(children,onClick,props);return <button type="button" onClick={onClick} {...props}>{children}</button>;};
            export const DropdownMenuCheckboxItem=Pass;
            export const DropdownMenuSeparator=()=>null;
            export const DropdownMenuSub=Pass;
            export const DropdownMenuSubContent=Pass;
            export const DropdownMenuSubTrigger=Pass;
            export const DropdownMenuLabel=Pass;
            export const DropdownMenuGroup=Pass;
            export const DropdownMenuPortal=Pass;
            export const DropdownMenuRadioGroup=Pass;
            export const DropdownMenuRadioItem=Pass;`,
          '@/components/ui/alert-dialog': `import React from 'react';const push=(children,onClick,props={})=>globalThis.brandsFixture.buttons.push({children,onClick,props});
            export const AlertDialog=({children})=>children;
            export const AlertDialogContent=({children})=>children;
            export const AlertDialogHeader=({children})=>children;
            export const AlertDialogFooter=({children})=>children;
            export const AlertDialogTitle=({children})=>children;
            export const AlertDialogDescription=({children})=>children;
            export const AlertDialogCancel=({children})=>children;
            export const AlertDialogAction=({children,onClick,...props})=>{push(children,onClick,{...props,'data-confirm':true});return <button type="button" onClick={onClick}>{children}</button>;};
            export const ConfirmDialog=({title,description,confirmLabel,onConfirm,children})=><>{title}{description}{children}<AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction></>;`,
        };
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(stubs, args.path)
            ? { path: args.path, namespace: 'fixture' }
            : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: stubs[args.path],
          loader: 'tsx',
        }));
        builder.onResolve({ filter: /^@\// }, (args) => {
          const base = root + 'packages/core/' + args.path.slice(2);
          return {
            path:
              ['.ts', '.tsx'].map((ext) => base + ext).find(existsSync) ??
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
const row = {
  brand: 'Netflix',
  prompts: 4,
  assessed: 4,
  absent: 0,
  pending: 0,
  failed: 0,
  partial: 0,
  ambiguous: 0,
  insufficient: 0,
  distribution: { positive: 3, neutral: 1, negative: 0 },
  scoreTotal: 352,
};
const research = {
  configuration: { enabled: true },
  configured: true,
  allowed: true,
  selectedChannels: 4,
  brands: [row],
  details: [],
  unread: [],
};
const project = {
  id: 'isolated',
  name: 'Netflix',
  domain: 'netflix.com',
  competitors: [{ name: 'Nova', domain: 'nova.example' }],
};
const report = {
  platforms: [
    {
      name: 'Netflix',
      mentions: 4,
      responses: 4,
      visibility: 100,
      shareOfVoice: 100,
    },
  ],
  competitorOnly: [],
};
const request = () => {
  throw Error('No network in fixture tests');
};
function setup(locale = 'en', remote = { data: research, loading: false }) {
  globalThis.brandsFixture = { locale, remote, reads: [], buttons: [], overview: undefined };
  return {
    project,
    report,
    loading: false,
    view: 'general',
    onView() {},
    refresh: 7,
    busy: false,
    demo: false,
    t: (en, pt) => (locale === 'en' ? en : pt),
    link: () => ({ href: '/fixture', onClick() {} }),
    error: '',
    clearError() {},
    onEvidence() {},
    filters: new URLSearchParams(
      'days=28&start=2026-10-01&end=2026-10-20&engine=chat_gpt&topic=a&tags=b&provider=ignored',
    ),
    request,
    api: '/api',
    page: null,
  };
}

test('reject X then toast Undo posts undo with the row key (pending clear)', async () => {
  const posts = [];
  let releaseReject;
  const rejectGate = new Promise((resolve) => {
    releaseReject = resolve;
  });
  const props = setup();
  globalThis.brandsFixture.overview = {
    analysis: { analyzed: 3, status: 'complete', processed: 3, total: 3 },
    domainDiscovery: { pending: 0, paid: false, capped: false },
    events: [],
    undoable: null,
    rows: [
      {
        key: 'rival',
        name: 'Rival',
        status: 'discovered',
        domain: 'rival.example',
        domainSuggested: false,
        review: false,
        reasons: [],
        role: 'competitor',
        responses: 3,
        aliases: [],
        sense: '',
        rejectEventId: null,
        evidence: [{ runId: 'run-1' }],
      },
    ],
  };
  props.request = async (_url, method, body) => {
    if (method === 'POST') {
      posts.push(body);
      if (body.action === 'reject') {
        await rejectGate;
        return { id: 'evt-reject' };
      }
      if (body.action === 'undo') return { id: 'evt-undo', changed: false };
    }
    throw Error(`Unexpected ${method}`);
  };
  if (globalThis.brandsToast) globalThis.brandsToast.adds.length = 0;
  ui.brands(props);
  const rejectItem = globalThis.brandsFixture.buttons.find(
    (button) => button.props?.['aria-label'] === 'Reject Rival',
  );
  assert.ok(rejectItem?.onClick, 'reject menu item present');
  rejectItem.onClick();
  const confirm = globalThis.brandsFixture.buttons.find((button) => button.props?.['data-confirm']);
  assert.ok(confirm?.onClick, 'confirm dialog action present');
  const rejectDone = confirm.onClick();
  await Promise.resolve();
  assert.equal(globalThis.brandsToast.adds.length, 1, 'toast before server responds');
  assert.match(globalThis.brandsToast.adds[0]?.opts?.title ?? '', /Rival, Rejected|Rival, Rejeitada/);
  assert.ok(globalThis.brandsToast.adds[0]?.opts?.actionProps?.onClick, 'Undo visible before POST');
  releaseReject();
  await rejectDone;
  assert.equal(posts[0]?.action, 'reject');
  assert.equal(posts[0]?.key, 'rival');
  const undoClick = globalThis.brandsToast.adds.at(-1)?.opts?.actionProps?.onClick;
  assert.ok(undoClick, 'success toast with Undo');
  await undoClick();
  await Promise.resolve();
  assert.equal(posts.at(-1)?.action, 'undo');
  assert.equal(posts.at(-1)?.eventId, 'evt-reject');
  assert.equal(posts.at(-1)?.key, 'rival', 'undo must carry the row key so pending clears');
});

test('monitored reject then Undo with changed calls onTargetsChanged (fresh workspace)', async () => {
  const posts = [];
  let targets = 0;
  const props = setup();
  props.project = {
    ...project,
    competitors: [{ name: 'Orbit', domain: 'orbit.example' }],
  };
  props.onTargetsChanged = async () => {
    targets += 1;
  };
  globalThis.brandsFixture.overview = {
    analysis: { analyzed: 3, status: 'complete', processed: 3, total: 3 },
    domainDiscovery: { pending: 0, paid: false, capped: false },
    events: [],
    undoable: null,
    rows: [],
  };
  props.request = async (_url, method, body) => {
    if (method === 'POST') {
      posts.push(body);
      if (body.action === 'reject') return { id: 'evt-orbit', changed: true };
      if (body.action === 'undo') return { id: 'evt-undo', changed: true };
    }
    throw Error(`Unexpected ${method}`);
  };
  if (globalThis.brandsToast) globalThis.brandsToast.adds.length = 0;
  ui.brands(props);
  const rejectItem = globalThis.brandsFixture.buttons.find(
    (button) => button.props?.['aria-label'] === 'Reject Orbit',
  );
  assert.ok(rejectItem?.onClick, 'reject menu item present for monitored Orbit');
  rejectItem.onClick();
  const confirm = globalThis.brandsFixture.buttons.find((button) => button.props?.['data-confirm']);
  assert.ok(confirm?.onClick, 'confirm dialog action present');
  await confirm.onClick();
  await Promise.resolve();
  assert.equal(targets, 1, 'reject refresh drops cached workspace');
  const undoClick = globalThis.brandsToast.adds.at(-1)?.opts?.actionProps?.onClick;
  assert.ok(undoClick, 'success toast with Undo');
  await undoClick();
  await Promise.resolve();
  assert.equal(posts.at(-1)?.action, 'undo');
  assert.equal(posts.at(-1)?.key, 'orbit');
  assert.equal(targets, 2, 'undo must refresh workspace after cache invalidate');
});

test('a monitored brand still listed as rejected by a stale analysis shows once, as monitored', () => {
  const rows = ui.buildBrandRows(
    { ...project, competitors: [{ name: 'Orbit', domain: 'orbit.example' }] },
    report,
    { analysis: { analyzed: 3 }, rows: [{ key: 'orbit', name: 'Orbit', status: 'rejected', responses: 2, aliases: [], evidence: [], days: {} }] },
  );
  assert.deepEqual(rows.filter((row) => row.key === 'orbit').map((row) => row.status), ['tracked']);
});

test('ranked by mentions, your brand among the others: a rival that leads is #1', () => {
  const row = (name, status, mentions, own = false) => ({ key: name.toLowerCase(), name, status, mentions, own });
  const ordered = ui.withPending([row('Hedgehog', 'discovered', 321), row('NP Digital', 'tracked', 307), row('Conversion', 'tracked', 781, true), row('Mestre', 'tracked', 338)], {});
  assert.deepEqual(ordered.map((item) => item.name), ['Conversion', 'Mestre', 'Hedgehog', 'NP Digital']);
  // The QA project, 10/11/2026: Rival leads every metric and showed #2 under the own brand.
  const geo = ui.withPending([row('Preview GEO', 'tracked', 29, true), row('Rival', 'tracked', 30), row('Orbit', 'tracked', 9)], {});
  assert.deepEqual(geo.map((item) => item.name), ['Rival', 'Preview GEO', 'Orbit']);
});

test('every brand has a mention count, ranked by mentions, also when the period cannot be measured for discoveries', () => {
  const discovered = (name, responses, days = {}) => ({ key: name.toLowerCase(), name, status: 'discovered', responses, aliases: [], evidence: [], days });
  const overview = {
    analysis: { analyzed: 50 },
    rows: [discovered('Small', 3), discovered('Big', 40), { ...discovered('Gone', 7), status: 'rejected' }, discovered('Unknown', null)],
  };
  // No summary (a filter, a failed read): the discoveries show their saved answers of the last 90 days, marked as such.
  const rows = ui.buildBrandRows({ ...project, competitors: [{ name: 'Orbit', domain: 'orbit.example' }] }, report, overview);
  // Orbit, monitored, has no answer in the report: it ranks with no count, before only a brand with none either.
  assert.deepEqual(rows.map((row) => row.name), ['Big', 'Gone', project.name, 'Small', 'Orbit', 'Unknown']);
  const discoveries = rows.filter((row) => row.status !== 'tracked');
  assert.deepEqual(discoveries.map((row) => [row.mentions, row.mentionsSaved]), [[40, true], [7, true], [3, true], [null, false]]);
  assert.ok(rows.filter((row) => row.status === 'tracked').every((row) => !row.mentionsSaved));
});

test('discovered brands are measured from the report under any filter; only counted competitors get a share of voice', () => {
  // The analysis stored each answer's discoveries: the report counts them in its own period and filters, by group.
  const discovered = (name, status = 'discovered') => ({ key: name.toLowerCase(), name, status, responses: 99, aliases: [], evidence: [], days: {} });
  const overview = { analysis: { analyzed: 50 }, rows: [discovered('Nova'), discovered('Talvez'), discovered('Gone', 'rejected'), discovered('Quiet')] };
  const measured = {
    ...report,
    discovered: {
      nova: { mentions: 10, previous: 5, counted: true, weightedMentions: 10, weightedPrevious: 5 },
      talvez: { mentions: 4, previous: 0, counted: false, weightedMentions: 4, weightedPrevious: 0 },
      gone: { mentions: 2, previous: 2, counted: false, weightedMentions: 2, weightedPrevious: 2 },
    },
    totals: { responses: 40, mentions: 80, previousResponses: 20, previousMentions: 50, weightedResponses: 40, weightedMentions: 80, weightedPreviousResponses: 20, weightedPreviousMentions: 50, analysed: 40, previousAnalysed: 20 },
  };
  // The analysis read too little of the earlier period (under half the current one's answers): no comparison, never a change from 0.
  const thin = ui.buildBrandRows({ ...project, competitors: [] }, { ...measured, totals: { ...measured.totals, previousAnalysed: 19 } }, overview);
  assert.equal(thin.find((row) => row.name === 'Nova').previous, undefined);
  const rows = ui.buildBrandRows({ ...project, competitors: [] }, measured, overview);
  const by = Object.fromEntries(rows.map((row) => [row.name, row]));
  assert.deepEqual([by.Nova.mentions, by.Nova.visibility, by.Nova.shareOfVoice, by.Nova.mentionsSaved], [10, 25, 12.5, false]);
  assert.deepEqual([by.Nova.previous.visibility, by.Nova.previous.shareOfVoice], [25, 10]);
  assert.deepEqual([by.Talvez.visibility, by.Talvez.shareOfVoice], [10, null], 'a name in review has a visibility but no share');
  assert.deepEqual([by.Gone.mentions, by.Gone.shareOfVoice], [2, null]);
  assert.deepEqual([by.Quiet.mentions, by.Quiet.visibility, by.Quiet.mentionsSaved], [0, 0, false], 'no answer in the period is zero, not the saved count');
  assert.deepEqual(ui.brandSummary(rows.filter((row) => !row.own)), { mentions: 10 });
});

test('a brand just monitored keeps its place: the count it had as a discovery until the analysis measures it', () => {
  // A brand monitored from the list "disappeared": the monitored row had no count until the brand analysis relabelled the
  // answers, so it sank to the last page of the list.
  const discovered = (name, responses) => ({ key: name.toLowerCase(), name, status: 'discovered', responses, aliases: [], evidence: [], days: {} });
  const overview = { analysis: { analyzed: 50 }, rows: Array.from({ length: 30 }, (_, index) => discovered(`Agency ${index}`, 50 - index)) };
  const measured = {
    ...report,
    discovered: { 'hedgehog digital': { mentions: 40, previous: 0, counted: true, weightedMentions: 40, weightedPrevious: 0 } },
    totals: { responses: 100, mentions: 200, previousResponses: 0, previousMentions: 0, weightedResponses: 100, weightedMentions: 200, weightedPreviousResponses: 0, weightedPreviousMentions: 0 },
  };
  const project2 = { ...project, competitors: [{ name: 'Hedgehog Digital', domain: 'hedgehogdigital.co.uk', aliases: ['Hedgehog'] }] };
  const rows = ui.buildBrandRows(project2, measured, overview);
  const hedgehog = rows.find((row) => row.name === 'Hedgehog Digital');
  assert.deepEqual([hedgehog.status, hedgehog.mentions, hedgehog.visibility, hedgehog.shareOfVoice], ['tracked', 40, 40, 20]);
  assert.ok(rows.indexOf(hedgehog) < 25, 'on the first page, by its mentions');
  // Measured by the report (after the analysis), its own numbers win.
  const counted = ui.buildBrandRows(project2, { ...measured, platforms: [{ name: 'Hedgehog Digital', mentions: 7, responses: 100, visibility: 7, shareOfVoice: 3 }] }, overview);
  assert.equal(counted.find((row) => row.name === 'Hedgehog Digital').mentions, 7);
});

test('Monitor never blinks a brand out: the fresh list drops it before the project read adds it', () => {
  const hedgehog = { key: 'hedgehog digital', name: 'Hedgehog Digital', status: 'discovered', mentions: 40, mentionsSaved: true, visibility: null, answers: 40 };
  const own = { key: 'conversion', name: 'Conversion', status: 'tracked', mentions: 90, own: true };
  const pending = { 'hedgehog digital': { status: 'tracked', was: 'discovered', row: hedgehog } };
  // Neither list has it (the discoveries no longer, the project not yet): the row saved at the click stays, monitored.
  assert.deepEqual(ui.withPending([own], pending).map((row) => `${row.name}:${row.status}:${row.mentions}`), ['Conversion:tracked:90', 'Hedgehog Digital:tracked:40']);
  // The project has it, still unmeasured: one row, with the count it had.
  const fresh = { key: 'hedgehog digital', name: 'Hedgehog Digital', status: 'tracked', mentions: null };
  assert.deepEqual(ui.withPending([own, fresh], pending).map((row) => `${row.name}:${row.status}:${row.mentions}`), ['Conversion:tracked:90', 'Hedgehog Digital:tracked:40']);
});

test('Undo of a monitored brand shows it at once even before any list has it back', () => {
  const orbit = { key: 'orbit', name: 'Orbit', status: 'tracked', mentions: 9 };
  const netflix = { key: 'netflix', name: 'Netflix', status: 'tracked', mentions: 20 };
  const undone = ui.withPending([netflix], { orbit: { status: 'tracked', row: orbit } });
  assert.deepEqual(undone.map((row) => `${row.name}:${row.status}`), ['Netflix:tracked', 'Orbit:tracked']);
  assert.deepEqual(ui.withPending([netflix], { orbit: { status: 'rejected', row: orbit } }).map((row) => row.name), ['Netflix']);
  assert.equal(ui.withPending([netflix, orbit], { orbit: { status: 'tracked', row: orbit } }).length, 2);
});

for (const locale of ['en', 'pt-BR'])
  test(`table and Overview render identical aggregate scores and preserve historic measurements (${locale})`, () => {
    const props = setup(locale);
    for (const [distribution, scoreTotal] of [
      [{ positive: 3, neutral: 1, negative: 0 }, 352],
      [{ positive: 2, neutral: 1, negative: 1 }, 290],
      [{ positive: 0, neutral: 4, negative: 0 }, 200],
      [{ positive: 0, neutral: 0, negative: 4 }, 0],
    ]) {
      for (const enabled of [true, false])
        for (const partial of [0, 1]) {
          const measured = {
            ...research,
            configuration: { enabled },
            brands: [
              { ...row, distribution, scoreTotal, partial },
              { ...row, brand: 'Nova', distribution, scoreTotal, partial },
            ],
          };
          globalThis.brandsFixture.remote = { data: measured };
          const score = ui.sentimentScore(measured.brands[0]);
          const html = ui.brands(props);
          for (const brand of ['Netflix', 'Nova']) {
            const card = ui.card({
              brand,
              locale,
              demo: false,
              report: measured,
            });
            assert.match(card, new RegExp(`class="metric-number">${score}<`));
            assert.ok(
              html.includes(
                `${brand}: ${locale === 'en' ? 'sentiment' : 'sentimento'} ${score}.`,
              ),
            );
          }
          if (!enabled) {
            globalThis.brandsFixture.tab = 'sentiment';
            assert.match(ui.brands(props), /Settings|Configurações/);
            globalThis.brandsFixture.tab = 'brands';
          }
        }
    }
    assert.equal(ui.sentimentScore({ ...row, assessed: 0 }), null);
  });

test('one sentiment read uses the injected transport and retains every global filter except provider', () => {
  const props = setup();
  ui.brands(props);
  const reads = globalThis.brandsFixture.reads.filter((x) =>
    x.url?.includes('/brand-research'),
  );
  // One read (a render that keeps the last report may run twice, asking the same thing).
  assert.equal(new Set(reads.map((read) => read.url)).size, 1);
  assert.equal(reads[0].request, request);
  assert.equal(reads[0].refresh, 7);
  const query = new URL(reads[0].url, 'https://fixture.example').searchParams;
  for (const key of ['days', 'start', 'end', 'engine', 'topic', 'tags'])
    assert.equal(query.get(key), props.filters.get(key));
  assert.equal(query.has('provider'), false);
  globalThis.brandsFixture.reads = [];
  ui.brands({ ...props, demo: true });
  assert.match(
    globalThis.brandsFixture.reads.find((x) =>
      x.url?.includes('/brand-research'),
    ).url,
    /^\/api\/demo\/brand-research/,
  );
});

for (const locale of ['en', 'pt-BR'])
  test(`unmeasured states stay distinct and never invent zero (${locale})`, () => {
    const props = setup(locale);
    const cases = [
      // While sentiment loads the cell is a line of skeleton (its loaded height), never a status or an action that leaves after it.
      [{ loading: true }, /aria-busy="true"><span class="sr-only">(Loading…|Carregando…)<\/span><span data-slot="skeleton"/],
      [{ error: 'offline' }, /Unavailable|Indisponível/],
      [
        {
          data: { ...research, configuration: { enabled: false }, brands: [] },
        },
        /Not evaluated|Não avaliado/,
      ],
      [
        { data: { ...research, selectedChannels: 0 } },
        /No responses|Sem respostas/,
      ],
      [
        { data: { ...research, unread: ['Netflix'], brands: [] } },
        /No reading|Sem leitura/,
      ],
      [
        // Mentioned in the period, absent only from the latest answers sentiment reads: never "No mention".
        { data: { ...research, brands: [{ ...row, assessed: 0, absent: 4 }] } },
        /Not in the latest answers|Fora das últimas respostas/,
      ],
      [
        {
          data: {
            ...research,
            brands: [{ ...row, assessed: 0, prompts: 0, absent: 0 }],
          },
        },
        /No evaluations|Sem avaliação/,
      ],
      [{ data: { ...research, brands: [] } }, /No evaluations|Sem avaliação/],
    ];
    for (const [remote, expected] of cases) {
      globalThis.brandsFixture.remote = remote;
      const html = ui.brands(props);
      assert.match(html, expected);
      assert.doesNotMatch(
        html,
        /Netflix: (sentiment|sentimento) \d|NaN|Infinity/,
      );
    }
    globalThis.brandsFixture.remote = {
      data: {
        ...research,
        brands: [
          {
            ...row,
            pending: 1,
            failed: 1,
            partial: 1,
            ambiguous: 1,
            insufficient: 1,
          },
        ],
        truncated: true,
        outdated: 2,
      },
    };
    globalThis.brandsFixture.tab = 'sentiment';
    const html = ui.brands(props);
    assert.match(html, /Partial report|Relatório parcial/);
    // The column's definition: the criteria rule and the bands of the bar.
    assert.match(
      html,
      /Each answer starts at 50 and the evaluator answers yes or no to fixed criteria: recommended \+20[^"]*Promoters score 60–100|Cada resposta parte de 50 e o avaliador responde sim ou não a critérios fixos: recomendou \+20[^"]*Promotores têm nota 60–100/,
    );
    assert.doesNotMatch(
      html,
      /This is not a score of zero|Isto não é nota zero|previous configuration|outra configuração|Netflix: (Pending|Pendente)/,
    );
    // Server setup notes explain a missing score, never sit beside a saved one.
    const setupNote = /not enabled for this project|não está habilitada|not configured on this server|não está configurado/;
    for (const setup of [{ allowed: false }, { configured: false }]) {
      globalThis.brandsFixture.remote = { data: { ...research, ...setup } };
      assert.doesNotMatch(ui.brands(props), setupNote);
      globalThis.brandsFixture.remote = { data: { ...research, ...setup, brands: [{ ...row, assessed: 0, pending: 4 }] } };
      assert.match(ui.brands({ ...props, operator: true }), setupNote);
    }
    // Server setup is named only to the owner of an independent installation; a Cloud customer reads a neutral line.
    const cloud = ui.brands(props);
    assert.doesNotMatch(cloud, /not configured on this server|não está configurado/);
    assert.match(cloud, /Not evaluated yet|Ainda não avaliado/);
  });

test('discovered/rejected brands never borrow tracked sentiment', () => {
  const props = setup();
  globalThis.brandsFixture.overview = {
    analysis: { analyzed: 2, status: 'complete' },
    domainDiscovery: { pending: 0, paid: false, capped: false },
    events: [],
    rows: ['discovered', 'rejected'].map((status, index) => ({
      key: 'other' + index,
      name: 'Other' + index,
      status,
      domain: 'other.example',
      domainSuggested: false,
      review: true,
      reasons: [],
      role: 'client',
      responses: 1,
      aliases: [],
      sense: '',
      rejectEventId: null,
      evidence: [],
    })),
  };
  for (const view of ['discovered', 'rejected']) {
    const html = ui.brands({ ...props, view });
    // A discovery without a score offers monitoring in the sentiment column; a rejected brand has none.
    assert.match(html, view === 'discovered' ? /Monitor to measure/ : /<td[^>]*>—<\/td>/);
    const nameCell = html.match(/<td[^>]*data-mobile="title"[^>]*>([\s\S]*?)<\/td>/)[1];
    assert.match(nameCell, /Other/);
    // Status / review / role badges sit next to the name (same place as You).
    // The actions cell wraps so the buttons stay inside the mobile card.
    const reviewCell = html.match(/<td[^>]*data-mobile="actions"[^>]*>([\s\S]*?)<\/td>/)?.[1];
    if (reviewCell) assert.doesNotMatch(reviewCell, /flex-nowrap/);
    for (const label of [view === 'discovered' ? 'Discovered' : 'Rejected', 'To review', 'Client'])
      assert.ok(nameCell.includes(label));
    assert.doesNotMatch(html, /Other\d: sentiment \d/);
  }
});

test('fixed evidence never falls back to another brand, preserves model/date/excerpt and opens the matching run', () => {
  setup();
  let run;
  const details = ['Netflix', 'Nova'].map((brand, index) => ({
    brand,
    runId: 'run' + index,
    prompt: 'Question ' + index,
    engine: 'chat_gpt',
    date: '2026-10-15T09:00:00Z',
    sentiment: 'positive',
    state: 'assessed',
    evidence: [brand + ' excerpt'],
  }));
  const props = {
    project,
    report: {
      ...research,
      brands: [row, { ...row, brand: 'Nova' }],
      details,
      detailsTruncated: true,
    },
    onEvidence: (value) => {
      run = value;
    },
    label: (value) => value,
    evidenceBrand: 'Netflix',
  };
  let html = ui.evidence(props);
  // The brand under evaluation is marked in its excerpt (text marker); the rest compares the plain text.
  assert.match(html, /<mark class="live-answer-mark live-answer-mark-own">Netflix<\/mark> excerpt/);
  const plain = (value) => value.replace(/<[^>]+>/g, '');
  assert.match(plain(html), /Netflix excerpt/);
  assert.doesNotMatch(html, /Nova excerpt|Evidence brand|Sentiment comparison/);
  assert.match(html, /2026-10-15T09:00:00Z/);
  assert.match(html, /ChatGPT/);
  // The limit was reached (detailsTruncated): one plain sentence, never the technical wording; no count when nothing is filtered.
  assert.match(html, /Only the most recent answers are listed/);
  assert.doesNotMatch(html, /first 120|loaded details| of 1 answers/);
  globalThis.brandsFixture.buttons
    .find((x) => x.children === 'Open full response')
    .onClick();
  assert.equal(run, 'run0');
  html = ui.evidence({ ...props, evidenceBrand: 'Nova' });
  assert.match(plain(html), /Nova excerpt/);
  assert.doesNotMatch(plain(html), /Netflix excerpt/);
  html = ui.evidence({ ...props, evidenceBrand: 'Missing' });
  assert.doesNotMatch(plain(html), /Netflix excerpt|Nova excerpt/);
  assert.match(html, /No loaded answer details/);
  assert.doesNotThrow(() =>
    ui.evidence({ ...props, report: { ...research, details: undefined } }),
  );
  // An excerpt is a cut of the answer's markdown: it renders formatted (bold, links, lists), never as raw markers, and a
  // bold or link the cut left open at either end loses its marker instead of showing it.
  const formatted = (excerpt) => ui.evidence({ ...props, report: { ...research, details: [{ ...details[0], evidence: [excerpt] }] } });
  html = formatted('1. **Netflix** leads; see [the guide](https://example.com/g).\n2. **Max**');
  assert.match(html, /<strong><mark class="live-answer-mark live-answer-mark-own">Netflix<\/mark><\/strong>/);
  assert.match(html, /<a href="https:\/\/example.com\/g" target="_blank" rel="noopener noreferrer">the guide<\/a>/);
  assert.match(html, /<ol[ >]/);
  assert.doesNotMatch(plain(html), /\*\*|\]\(/);
  for (const cut of ['tflix** leads, then **Max', 'Netflix and [the guide](https://exam', 'the guide](https://example.com/g) by Netflix', 'de conteúdo` ), Netflix.[[1]]()[[2]](https://a.example/x)'])
    assert.doesNotMatch(plain(formatted(cut)), /\*\*|\]\(|\[the|`|\[\[|\[1\]/, cut);
  // Stored excerpts keep citations with an empty link and list items that only held one: no stray ")" or empty bullet.
  html = formatted('em escala.[[1]]( )[[2]]( )\n\n- **Netflix:** lidera.[[3]]( )\n- [[4]]( )\n- ');
  assert.doesNotMatch(plain(html), /\)|\[\[/);
  assert.equal((html.match(/<li>/g) ?? []).length, 1, 'only the item with text is a bullet');
  // Answers are untrusted: raw HTML stays text.
  assert.match(formatted('Netflix <img src=x onerror=alert(1)>'), /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('a brand literally named all stays fixed to its own evidence', () => {
  setup();
  const html = ui.evidence({project, evidenceBrand:'all', label:value=>value, onEvidence(){}, report:{...research,brands:[{...row,brand:'all'}],details:[{brand:'all',runId:'own',prompt:'Own question',engine:'chat_gpt',date:'2026-10-15',state:'assessed',sentiment:'positive',evidence:['Own excerpt']},{brand:'Nova',runId:'other',prompt:'Other question',engine:'chat_gpt',date:'2026-10-15',state:'assessed',sentiment:'positive',evidence:['Other excerpt']}]}});
  assert.match(html,/Own excerpt/);
  assert.doesNotMatch(html,/Other excerpt/);
});

const discovery = (name, role = 'competitor', extra = {}) => ({
  key: name.toLowerCase(),
  name,
  status: 'discovered',
  domain: `${name.toLowerCase()}.example`,
  domainSuggested: true,
  review: false,
  reasons: [],
  role,
  days: { '2026-10-02': 2, '2026-10-05': 1 },
  responses: 3,
  aliases: [],
  sense: '',
  rejectEventId: null,
  evidence: [],
  ...extra,
});
const withDiscoveries = (locale = 'en') => {
  const props = setup(locale);
  globalThis.brandsFixture.overview = {
    analysis: { analyzed: 10, status: 'complete' },
    domainDiscovery: { pending: 0, paid: false, capped: false },
    events: [],
    rows: [discovery('Orbit'), discovery('Zed', 'partner'), discovery('Forte', 'mention'), discovery('Go', 'competitor', { reasons: ['The decision model has not settled what this name is to the tracked brands; human review required.'] })],
  };
  globalThis.brandsFixture.remote = {
    data: { ...research, brands: [row, { ...row, brand: 'Orbit', discovered: true, distribution: { positive: 2, neutral: 0, negative: 2 }, scoreTotal: 200 }] },
    loading: false,
  };
  return props;
};
for (const locale of ['en', 'pt-BR'])
  test(`discoveries settled as competitor or partner have a score and a page link; doubtful ones neither (${locale})`, () => {
    const html = ui.brands({ ...withDiscoveries(locale), view: 'discovered' });
    const label = locale === 'en' ? 'Brand page' : 'Página da marca';
    assert.ok(html.includes(`Orbit: ${locale === 'en' ? 'sentiment' : 'sentimento'} 50.`));
    assert.ok(html.includes(`${label} Orbit`));
    assert.ok(html.includes(`${label} Zed`));
    assert.equal(html.includes(`${label} Forte`), false);
    assert.equal(html.includes(`${label} Go`), false);
    // Without a score (doubtful Forte and Go, Zed never mentioned in the period) the sentiment cell offers monitoring instead.
    assert.equal((html.match(locale === 'en' ? /Monitor to measure/g : /Monitorar para medir/g) || []).length, 3);
  });

test('a discovered brand page reads the last 90 days, has no share of voice and offers Monitor and Edit', () => {
  const html = ui.brands({ ...withDiscoveries(), page: 'orbit' });
  // The brand page leads with the app's one page title (PageHeading), not a heading of its own.
  assert.match(html, /<h1><span[^>]*>[\s\S]*?<span class="truncate">Orbit<\/span><\/span><\/h1>/);
  // Which answers it reads is said in the info balloon (rule 8), not under every card.
  assert.match(html, /Saved answers of the last 90 days that mention the brand/);
  assert.doesNotMatch(html, /Last 90 days of answers/);
  assert.match(html, /Mentions per day since it was discovered/);
  assert.match(html, /First seen/);
  assert.doesNotMatch(html, /<span>Share of voice<\/span>/);
  assert.match(html, /Monitor<\/button>/);
  assert.match(html, /Edit<\/button>/);
  assert.doesNotMatch(html, /All brands/);
  assert.doesNotMatch(html, /not from the selected period/);
});

test('a monitored brand page reads the selected period and the demo page cannot edit', () => {
  const props = withDiscoveries();
  const html = ui.brands({ ...props, page: 'nova' });
  assert.match(html, /<h1><span[^>]*>[\s\S]*?<span class="truncate">Nova<\/span><\/span><\/h1>/);
  assert.match(html, /<span>Share of voice<\/span>/);
  // 10/11/2026: no "Selected period" line under every card.
  assert.doesNotMatch(html, /Selected period/);
  assert.doesNotMatch(html, /Monitor<\/button>/);
  const demo = ui.brands({ ...props, demo: true, page: 'orbit' });
  assert.doesNotMatch(demo, /Edit<\/button>/);
  assert.match(ui.brands({ ...props, page: 'missing' }), /This brand is not on the list/);
});



test('brand summary adds the measured mentions share of voice counts, leaves overlapping percentages blank and ignores the rest', () => {
  // Monitored brands and counted discovered competitors add up; a name in review, a rejected brand or a saved
  // 90-day count (another window) does not.
  assert.deepEqual(
    ui.brandSummary([{ counted: true, mentions: 4 }, { counted: true, mentions: null }, { counted: true, mentions: 8 }, { counted: true, mentions: 30 }, { counted: false, mentions: 9 }, { counted: true, mentionsSaved: true, mentions: 50 }]),
    { mentions: 42 },
  );
  assert.deepEqual(ui.brandSummary([{ counted: true, mentions: null }]), { mentions: null });
  assert.deepEqual(ui.brandSummary([{ counted: false, mentions: 9 }]), { mentions: null });
  assert.deepEqual(ui.brandSummary([]), { mentions: null });
  assert.deepEqual(ui.brandSummary([{ counted: true, mentions: 0 }]), { mentions: 0 });
  const props = setup();
  const html = ui.brands(props);
  const footer = html.match(/<tfoot[\s\S]*?<\/tfoot>/)?.[0];
  assert.ok(footer);
  assert.match(footer, /Summary \(2\)/);
  assert.match(footer, />4<\/td>/);
  assert.doesNotMatch(footer, /%|NaN|Infinity/);
  assert.match(html, /data-fill="true"/);
  assert.match(footer, /compact-pagination/);
});

test('a running analysis stays in the background, Monitor is an outline button in the brand cell, loading keeps the header', () => {
  const props = setup();
  globalThis.brandsToast.statuses.length = 0;
  globalThis.brandsFixture.overview = {
    analysis: { analyzed: 3, status: 'running', stale: true, processed: 40, total: 1356 },
    domainDiscovery: { pending: 0, paid: false, capped: false },
    events: [],
    undoable: null,
    rows: [
      { key: 'rival', name: 'Rival', status: 'discovered', domain: 'rival.example', domainSuggested: false, review: false, reasons: [], role: 'competitor', responses: 3, aliases: [], sense: '', rejectEventId: null, evidence: [] },
    ],
  };
  const html = ui.brands(props);
  // A screen with a result keeps it: no toast, no processing state, no tabs.
  assert.doesNotMatch(html, /Updating|Analyzing saved answers|Competitor-only questions/);
  assert.equal(globalThis.brandsToast.statuses.length, 0);
  // The CTA sits in the sentiment column (no score yet), a quiet link; the brand cell has the compact Monitor that shows on
  // the row's hover or focus; the menu column has none.
  const at = html.indexOf('Monitor brand Rival');
  const cells = html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at)).split('<td').slice(1);
  assert.match(cells[2], /aria-label="Monitor brand Rival"[^>]*>Monitor to measure/);
  // A white compact button (outline, xs), text only (docs/design/shell.md section 11), at the end of the brand cell.
  assert.match(cells[1], /<button reveal="row" class="ms-auto[^"]*" aria-label="Monitor Rival">Monitor<\/button><\/div>/);
  assert.match(readFileSync(new URL('../components/analytics/brands-screen.tsx', import.meta.url), 'utf8'), /size="xs"\s+variant="outline"\s+reveal="row"\s+className="ms-auto/);
  assert.doesNotMatch(cells.at(-1), /Monitor/);
  // At the competitor limit, both say why instead of showing the brand monitored and taking it back: one action.
  globalThis.brandsFixture.overview = { ...globalThis.brandsFixture.overview, maxCompetitors: props.project.competitors.length };
  for (const name of ['Monitor brand Rival', 'Monitor Rival']) {
    globalThis.brandsFixture.buttons.length = 0;
    globalThis.brandsToast.adds.length = 0;
    let posted = false;
    ui.brands({ ...props, request: async () => { posted = true; return {}; } });
    globalThis.brandsFixture.buttons.find((button) => button.props?.['aria-label'] === name).onClick();
    assert.equal(posted, false, name);
    assert.match(globalThis.brandsToast.adds.at(-1)?.opts?.title ?? '', /already monitor \d+ competitors\. Stop monitoring one to add Rival/, name);
  }
  // A report read again (a brand was just monitored) keeps the rows on screen; only the first read shows the skeleton.
  props.loading = true;
  assert.match(ui.brands(props), /aria-label="Monitor brand Rival"/);
  props.report = null;
  const loading = ui.brands(props);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /<th[^>]*>[\s\S]*?Brand/);
  assert.match(loading, /data-skeleton=""/);
});

test('the Brands table shows the numbers of the own, monitored and discovered rows; the demo waits for a running analysis too', () => {
  // The report's window: 1 to 20 October, 20 answers on the 2nd and 20 on the 5th (the monitored rows come from the same report).
  const summary = {
    comparison: { currentStart: '2026-10-01T00:00:00.000Z', end: '2026-10-21T00:00:00.000Z', comparable: false, hasPreviousData: false },
    metrics: {}, availability: { shareOfVoice: { current: null }, mentionPosition: { current: null } },
    daily: [{ date: '2026-09-20', responses: 50 }, { date: '2026-10-02', responses: 20 }, { date: '2026-10-05', responses: 20 }],
  };
  const props = {
    ...setup(),
    filters: new URLSearchParams('days=28&start=2026-10-01&end=2026-10-20'),
    summary,
    demo: true,
    report: {
      platforms: [
        { name: 'Netflix', mentions: 29, responses: 43, visibility: 67.44, shareOfVoice: 42.64 },
        { name: 'Nova', mentions: 9, responses: 43, visibility: 20.93, shareOfVoice: 13.24 },
      ],
      competitorOnly: [],
    },
  };
  globalThis.brandsToast.statuses.length = 0;
  globalThis.brandsFixture.overview = {
    analysis: { analyzed: 43, status: 'complete' },
    domainDiscovery: { pending: 0, paid: false, capped: false },
    // 14 answers of the last 90 days mention it, 6 of them inside the window.
    rows: [{ key: 'zenith cloud', name: 'Zenith Cloud', status: 'discovered', domain: null, domainSuggested: false, review: false, reasons: [], role: 'competitor', responses: 14, aliases: [], sense: '', rejectEventId: null, evidence: [], days: { '2026-09-20': 8, '2026-10-02': 4, '2026-10-05': 2 } }],
  };
  const html = ui.brands(props);
  const text = (value) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const cells = (name) => {
    const at = html.indexOf(`>${name}<`);
    return text(html.slice(html.lastIndexOf('<tr', at), html.indexOf('</tr>', at)));
  };
  assert.match(cells('Netflix'), /67\.4%.*42\.6%.*29/);
  assert.match(cells('Nova'), /20\.9%.*13\.2%.*9/);
  // Its visibility and mentions are of the report's window, like the monitored rows: 6 of 40 answers, not 14 of the 43 analyzed.
  assert.match(cells('Zenith Cloud'), /15\.0%.* 6 /);
  assert.doesNotMatch(cells('Zenith Cloud'), /32\.6%|14/);
  assert.match(text(html), /Discovered brands 1 /);
  // The Summary adds only the monitored brands' mentions (29 + 9).
  assert.match(text(html.match(/<tfoot[\s\S]*?<\/tfoot>/)[0]), / 38 /);
  // A model, topic, tag or text filter cannot be applied to it: every brand still shows a count, its answers of the last 90
  // days, said as such; its visibility stays out, with the reason. Its page still reads the last 90 days.
  for (const filter of ['engine=chat_gpt', 'topic=a', 'tags=b', 'query=x']) {
    const filtered = ui.brands({ ...props, filters: new URLSearchParams(`days=28&${filter}`) });
    const at = filtered.indexOf('>Zenith Cloud<');
    const row = filtered.slice(filtered.lastIndexOf('<tr', at), filtered.indexOf('</tr>', at));
    assert.doesNotMatch(text(row), /%|\b6\b/, filter);
    assert.match(text(row), / 14 , Answers of the last 90 days that mention it/, filter);
    assert.match(row, /clear the model, topic, tag and text filters/, filter);
  }
  const page = text(ui.brands({ ...props, page: 'zenith cloud' }));
  assert.match(page, /Mentions 14 /);
  assert.match(page, /32\.6%/);
  assert.equal(globalThis.brandsToast.statuses.length, 0);
  // Drill down: each row's visibility, share of voice and mentions open the answers that name that brand (a discovered one by
  // its key); the brand page's cards too.
  const link = (to) => ({ href: '/app?' + new URLSearchParams(Object.entries(to).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)])), onClick() {} });
  const drilled = ui.brands({ ...props, link });
  const hrefs = (name) => {
    const at = drilled.indexOf(`>${name}<`);
    return [...drilled.slice(drilled.lastIndexOf('<tr', at), drilled.indexOf('</tr>', at)).matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll('&amp;', '&'));
  };
  assert.equal(hrefs('Netflix').filter((href) => href === '/app?tab=responses&mention=mentioned').length, 3);
  assert.equal(hrefs('Nova').filter((href) => href === '/app?tab=responses&brand=Nova&mention=mentioned').length, 3);
  // A discovered brand by its key (a renamed one keeps it), its name for the filter's label.
  assert.ok(hrefs('Zenith Cloud').includes('/app?tab=responses&brand=zenith+cloud&brandLabel=Zenith+Cloud&mention=mentioned'));
  assert.match(ui.brands({ ...props, link, page: 'zenith cloud' }), /href="\/app\?tab=responses&amp;brand=zenith\+cloud&amp;brandLabel=Zenith\+Cloud&amp;mention=mentioned"/);
  // A preview's first visit starts the demo's analysis: with nothing to show yet, the screen shows the processing state.
  globalThis.brandsFixture.overview = { ...globalThis.brandsFixture.overview, rows: [], analysis: { analyzed: 0, status: 'running', processed: 5, total: 10 } };
  const updating = ui.brands({ ...props, report: { platforms: [], competitorOnly: [] } });
  assert.match(updating, /data-testid="brands-updating"/);
  assert.match(updating, /Updating brands/);
});

test('the server last list paints at once and is read again as it is now; a fresh list is not', () => {
  const props = setup();
  const list = { analysis: { analyzed: 3, status: 'complete', processed: 3, total: 3 }, domainDiscovery: { pending: 0, paid: false, capped: false }, undoable: null, rows: [] };
  globalThis.brandsFixture.overview = { ...list, cachedAt: '2026-10-27T12:00:00.000Z' };
  ui.brands(props);
  const lists = () => globalThis.brandsFixture.reads.map((read) => read.url).filter((url) => /\/brands(\?|$)/.test(url ?? ''));
  assert.deepEqual([...new Set(lists())], ['/api/projects/isolated/brands', '/api/projects/isolated/brands?fresh=1']);
  globalThis.brandsFixture.reads = [];
  globalThis.brandsFixture.overview = list;
  ui.brands(props);
  assert.deepEqual([...new Set(lists())], ['/api/projects/isolated/brands']);
});

test('the brand cell Monitor confirms the discovery like the sentiment CTA; monitored and own rows have none', async () => {
  const props = setup('pt-BR');
  globalThis.brandsFixture.overview = {
    analysis: { analyzed: 3, status: 'complete', processed: 3, total: 3 },
    domainDiscovery: { pending: 0, paid: false, capped: false },
    rows: [
      { key: 'rival', name: 'Rival', status: 'discovered', domain: 'rival.example', domainSuggested: false, review: false, reasons: [], role: 'competitor', responses: 3, aliases: [], sense: '', rejectEventId: null, evidence: [] },
    ],
  };
  const posts = [];
  props.request = async (_url, method, body) => {
    posts.push(body);
    return { id: 'evt-confirm' };
  };
  globalThis.brandsFixture.buttons.length = 0;
  globalThis.brandsToast.adds.length = 0;
  const html = ui.brands(props);
  assert.equal((html.match(/aria-label="Monitorar (Rival|Netflix|Nova)"/g) || []).join(), 'aria-label="Monitorar Rival"');
  await globalThis.brandsFixture.buttons.find((button) => button.props?.['aria-label'] === 'Monitorar Rival').onClick();
  assert.deepEqual([posts[0]?.action, posts[0]?.key, posts[0]?.domain], ['confirm', 'rival', 'rival.example']);
  assert.match(globalThis.brandsToast.adds[0]?.opts?.title ?? '', /Rival, Confirmada e agora monitorada/);
  // The demo cannot monitor: no CTA.
  assert.doesNotMatch(ui.brands({ ...props, demo: true }), /aria-label="Monitorar Rival"/);
});

test('a metric cell change is one text step smaller than its figure', () => {
  const props = setup();
  props.report = {
    platforms: [{ name: 'Netflix', mentions: 4, responses: 4, visibility: 60, shareOfVoice: 50, previous: { responses: 4, mentions: 2, visibility: 51.4, shareOfVoice: 40 } }],
    competitorOnly: [],
  };
  globalThis.brandsFixture.overview = undefined;
  const html = ui.brands({ ...props, summary: { comparison: { comparable: true, hasPreviousData: true }, availability: { shareOfVoice: { current: 4 }, mentionPosition: { current: null } }, metrics: { shareOfVoice: 50 } } });
  const at = html.indexOf('>60.0%<');
  const cell = html.slice(html.lastIndexOf('<td', at), html.indexOf('</td>', at));
  assert.match(cell, /class="with-change[^"]*"[\s\S]*>60\.0%<[\s\S]*class="metric-change positive"[\s\S]*8\.6/);
  const css = readFileSync(root + 'packages/core/components/analytics/overview-presentation.css', 'utf8');
  assert.match(css, /\.with-change \.metric-change \{\s*font-size: var\(--text-caption\);/);
  assert.match(css, /\.metric-change \{[^}]*font-size: var\(--text-body\);/);
});

test('nothing sits under the Brands table: the legend and coverage notes live in the column headers', () => {
  for (const locale of ['en', 'pt-BR']) {
    const props = setup(locale);
    globalThis.brandsFixture.overview = {
      analysis: { analyzed: 3, status: 'complete', processed: 3, total: 3 },
      domainDiscovery: { pending: 0, paid: false, capped: false },
      rows: [],
    };
    const html = ui.brands(props);
    const after = html.slice(html.lastIndexOf('</table>'));
    assert.doesNotMatch(after, /<p|<ul|live-brands-sentiment/, locale);
    const header = (name) => html.slice(html.indexOf(`>${name}<`), html.indexOf('</th>', html.indexOf(`>${name}<`)));
    const en = locale === 'en';
    assert.match(header(en ? 'Sentiment' : 'Sentimento'), en ? /aria-label="Sentiment index from 0 to 100[^"]*the bar beside the index shows their shares in green, yellow and red\."/ : /aria-label="Índice de sentimento de 0 a 100[^"]*a barra ao lado do índice mostra a parcela de cada um em verde, amarelo e vermelho\."/);
    assert.match(header(en ? 'Mentions' : 'Menções'), en ? /Discoveries: found in the answers of the last 90 days/ : /Descobertas: encontradas nas respostas dos últimos 90 dias/);
  }
});

for (const locale of ['en', 'pt-BR']) {
  test(`a discovery that may be a monitored brand offers the existing merge with it, until the person decides (${locale})`, () => {
    const props = setup(locale);
    const t = props.t;
    const discovered = (name, sameAs) => ({ key: name.toLowerCase(), name, status: 'discovered', domain: '', domainSuggested: false, review: false, reasons: [], role: 'competitor', responses: 3, aliases: [], sense: '', rejectEventId: null, evidence: [], sameAs });
    globalThis.brandsFixture.overview = {
      analysis: { analyzed: 3, status: 'complete', processed: 3, total: 3 },
      domainDiscovery: { pending: 0, paid: false, capped: false },
      rows: [{ ...discovered('Nova Plus', 'Nova'), domainReview: true }, { ...discovered('Peer', null), domainReview: true }, discovered('Gone One', 'Gone'), discovered('Other', null), { ...discovered('Nova Old', 'Nova'), status: 'rejected' }],
    };
    const html = ui.brands(props);
    const merges = (markup) => (markup.match(new RegExp(t('Merge with [^?<]+\\?', 'Mesclar com [^?<]+\\?'), 'g')) || []);
    // Only while the brand is still monitored and the discovery still open: one hint in place of its status, one menu merge.
    assert.deepEqual(merges(html), [t('Merge with Nova?', 'Mesclar com Nova?')]);
    assert.equal((html.match(new RegExp(t('Same brand\\?', 'Mesma marca\\?'), 'g')) || []).length, 1);
    // The hint is never cut: on its row Review domain moves to the menu; a row without the hint keeps it inline.
    const review = t('Review domain', 'Revisar domínio');
    assert.ok(!html.includes(`aria-label="${review} Nova Plus"`) && html.includes(`aria-label="${review} Peer"`));
    assert.equal(globalThis.brandsFixture.buttons.filter((button) => [].concat(button.children).includes(review)).length, 1);
    // Never in the demo.
    assert.deepEqual(merges(ui.brands({ ...props, demo: true })), []);
  });
}
