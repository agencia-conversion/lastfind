'use client';

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { requestJson } from '@/lib/client';
import { ENGINE_LABELS, type Engine } from '@/lib/engines';
import { HEAT_BANDS, WIN_RATE_BANDS, heatCell } from '@/lib/semantic-perception';
import type { ComparisonReport, comparisonSettings } from '@/lib/server/comparison';
import { MetricCard, MetricGrid, MetricGridSkeleton } from '@/components/lastfind/presentation/metric-card';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable, DataTableScreen, DataTableToolbar, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { PageFilters } from '@/components/lastfind/presentation/page-heading';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import { BrandName, Change, EmptyState, FilterSelect, SearchField, useCopy, useNumbers } from './shared';
import { HeatScale, SwipeHint, phoneColumns } from './semantic-association-report';
import { DrillLink, ViewAllAction, type Linker } from './drill-link';
import { ComparisonPage } from './comparison-editor';
import { ComparisonDetailPage, ComparisonDetailSkeleton } from './comparison-product';

type Translate = (en: string, pt: string) => string;
export type ComparisonSettings = Awaited<ReturnType<typeof comparisonSettings>>;
type Row = { name: string; options: number; placed: number; winRate: number | null; position: number | null; score: number | null };

/**
 * Comparison's four pages, sub-items of Comparison in the sidebar (`comparisonView` in the address): its overview, then the
 * products, the attribute library and the personas it asks about.
 */
export type ComparisonSection = 'overview' | 'products' | 'attributes' | 'personas';
/** The pages with a drill down: a product's, an attribute's or a persona's (`comparisonView` = `<section>/<id>`). */
export type ComparisonDetail = { section: Exclude<ComparisonSection, 'overview'>; id: string };
export const COMPARISON_SECTIONS: Record<ComparisonSection, { page: string | null; label: [string, string] }> = {
  overview: { page: null, label: ['Overview', 'Visão geral'] },
  products: { page: 'products', label: ['Products', 'Produtos'] },
  attributes: { page: 'attributes', label: ['Attributes', 'Atributos'] },
  personas: { page: 'personas', label: ['Personas', 'Personas'] },
};
/** A drill down's page in the address (`comparisonView` = `products/<id>`, `attributes/<id>`, `personas/<id>`), else null. */
export const comparisonDetailOf = (view: string | null | undefined): ComparisonDetail | null => {
  const found = /^(products|attributes|personas)\/(.+)$/.exec(view ?? '');
  return found ? { section: found[1] as ComparisonDetail['section'], id: found[2]! } : null;
};
export const comparisonSection = (view: string | null | undefined): ComparisonSection =>
  view === 'products' || view === 'attributes' || view === 'personas' ? view : comparisonDetailOf(view)?.section ?? 'overview';
/** Where a product's, an attribute's or a persona's page is. */
export const detailPage = (section: ComparisonDetail['section'], id: string) => ({ comparisonView: `${section}/${id}` });

/** Why an AI the project monitors is not asked a comparison (the report's and the settings' `left`). */
export const leftReason = (t: Translate, reason: string) =>
  reason === 'instructions'
    ? t("answers a search and can't follow a comparison question", 'responde a uma busca e não segue uma pergunta de comparação')
    : t("not available in the project's country", 'indisponível no país do projeto');
const engineList = (engines: readonly Engine[]) => engines.map((engine) => ENGINE_LABELS[engine]).join(', ');
/** The AIs asked and those left out, with why: a metric's or a state's explanation. */
export function enginesText(t: Translate, engines: readonly Engine[], left: readonly { engine: Engine; reason: string }[]) {
  const asked = engines.length ? t(`Asked on ${engineList(engines)}.`, `Perguntado em ${engineList(engines)}.`) : '';
  const out = left.map((item) => `${ENGINE_LABELS[item.engine]} ${leftReason(t, item.reason)}`).join('; ');
  return [asked, out && t(`Not asked: ${out}.`, `Não perguntado: ${out}.`)].filter(Boolean).join(' ');
}
export const cadenceText = (t: Translate, cadence: string) => (cadence === 'daily' ? t('Collected every day', 'Coletado todo dia') : t('Collected every week', 'Coletado toda semana'));

/** A missing figure: a dash, its reason in the balloon (never a zero). */
export function Missing({ reason, label }: { reason: string; label?: string }) {
  return (
    <Hint text={reason}>
      <button type="button" className="text-muted-foreground" aria-label={label ? `${label}: ${reason}` : reason}>—</button>
    </Hint>
  );
}

/**
 * Comparison (12/11/2026): for each product the brand sells and each persona, the AIs that take instructions are asked which
 * option is best (the brand and that product's competitors), overall and per attribute; the report is the share of answers each
 * brand wins and its mean place. One settings read (the configuration, the plan's bound, the AIs asked) serves the four pages;
 * the overview and the products read the report in the header's period and AIs.
 */
export function ComparisonView({
  projectId,
  view,
  detail = null,
  onTitle,
  filters,
  canEdit,
  demo = false,
  link,
}: {
  projectId: string;
  view: ComparisonSection;
  /** A product's, an attribute's or a persona's page, under its section. */
  detail?: ComparisonDetail | null;
  /** The drill down's name, for the top bar's path. */
  onTitle?: (title: string | null) => void;
  filters: URLSearchParams;
  canEdit: boolean;
  demo?: boolean;
  link: Linker;
}) {
  const t = useCopy();
  const base = `/api/projects/${encodeURIComponent(projectId)}/comparison`;
  const [settings, setSettings] = useState<{ data: ComparisonSettings | null; failed: boolean } | null>(null);
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const [product, setProduct] = useState('all');
  const [persona, setPersona] = useState('all');
  const query = new URLSearchParams();
  for (const key of ['days', 'start', 'end', 'compareStart', 'compareEnd', 'engine']) {
    const value = filters.get(key);
    if (value) query.set(key, value);
  }
  // The product and persona filters are the overview's own; the products page reads every product.
  if (view === 'overview' && product !== 'all') query.set('product', product);
  if (view === 'overview' && persona !== 'all') query.set('persona', persona);
  const reportPath = `${base}?${query}`;
  const needsReport = !detail && (view === 'overview' || view === 'products');
  const [found, setFound] = useState<{ path: string; data: ComparisonReport | null; failed: boolean } | null>(null);
  const [reportAttempt, setReportAttempt] = useState(0);
  const reloadReport = useCallback(() => setReportAttempt((value) => value + 1), []);
  const reloadSettings = useCallback(() => setSettingsAttempt((value) => value + 1), []);
  useEffect(() => {
    if (demo) return;
    let active = true;
    requestJson<ComparisonSettings>(`${base}?view=settings`)
      .then((data) => active && setSettings({ data, failed: false }))
      .catch((error) => active && error?.name !== 'AbortError' && setSettings((current) => ({ data: current?.data ?? null, failed: true })));
    return () => {
      active = false;
    };
  }, [base, settingsAttempt, demo]);
  useEffect(() => {
    if (demo || !needsReport) return;
    let active = true;
    requestJson<ComparisonReport>(reportPath)
      .then((data) => active && setFound({ path: reportPath, data, failed: false }))
      .catch((error) => active && error?.name !== 'AbortError' && setFound({ path: reportPath, data: null, failed: true }));
    return () => {
      active = false;
    };
  }, [reportPath, reportAttempt, needsReport, demo]);

  if (demo)
    return (
      <EmptyState
        title={t('Comparison is not part of the demo', 'A Comparação não faz parte da demo')}
        description={t('In your project, Comparison shows how often the AIs recommend your brand when asked to compare it with your competitors.', 'No seu projeto, a Comparação mostra com que frequência as IAs recomendam a sua marca quando pedem para compará-la com os concorrentes.')}
      />
    );
  // The report of these filters, else the last one while the next loads (nothing jumps), else none.
  const current = found?.path === reportPath ? found : null;
  const report = current?.data ?? (found && !found.failed ? found.data : null);
  const reportFailed = !!current?.failed;
  const save = async (config: ComparisonSettings['config']) => {
    if (!settings?.data) return;
    try {
      const next = await requestJson<ComparisonSettings>(base, 'PATCH', { config, expectedRevision: settings.data.revision });
      setSettings({ data: next, failed: false });
      reloadReport();
    } catch (error) {
      // Someone saved in between: read the new revision, so the next save goes on top of it.
      if ((error as { status?: number }).status === 409) reloadSettings();
      throw error;
    }
  };

  if (view === 'overview') {
    if (reportFailed && !report) return <EmptyState tone="error" title={t('The report did not load.', 'O relatório não carregou.')} onRetry={reloadReport} />;
    if (!report) return <ComparisonSkeleton view="overview" />;
    return (
      <ComparisonOverview
        report={report}
        settings={settings?.data ?? null}
        canEdit={canEdit}
        link={link}
        product={product}
        persona={persona}
        onProduct={setProduct}
        onPersona={setPersona}
      />
    );
  }
  if (settings?.failed && !settings.data) {
    const failed = <EmptyState tone="error" title={t('Comparison did not load.', 'A Comparação não carregou.')} onRetry={reloadSettings} />;
    // A list page keeps its list screen's frame, as Brands' load error; a drill down's page is a page.
    return detail ? failed : <DataTableScreen>{failed}</DataTableScreen>;
  }
  if (!settings?.data) return <ComparisonSkeleton view={view} detail={!!detail} />;
  if (detail) return <ComparisonDetailPage key={`${detail.section}/${detail.id}`} base={base} detail={detail} settings={settings.data} filters={query} link={link} onTitle={onTitle} />;
  return <ComparisonPage view={view} settings={settings.data} report={report} canEdit={canEdit} onSave={save} projectId={projectId} link={link} />;
}

/** Why answers were discarded, by reason, for the info balloon of their count; a Lastfind admin also reads the scores capped (`capped`). */
export function discardText(t: Translate, discarded: ComparisonReport['discarded'], number: (value: number) => string, capped: number | null = null) {
  const reasons = [
    discarded.order ? t(`${number(discarded.order)} ranked the options on an attribute against their own scores`, `${number(discarded.order)} ordenaram as opções de um atributo contra as próprias notas`) : '',
    discarded.evidence ? t(`${number(discarded.evidence)} gave a fact for almost none of their scores`, `${number(discarded.evidence)} deram fato para quase nenhuma das notas`) : '',
    discarded.scores ? t(`${number(discarded.scores)} gave no score at all`, `${number(discarded.scores)} não deram nenhuma nota`) : '',
  ].filter(Boolean);
  return `${t(
    'Answers read and left out of every figure, so the scores, the places and the wins never contradict each other. They are never counted as a zero.',
    'Respostas lidas e deixadas fora de todos os números, para as notas, os lugares e as vitórias nunca se contradizerem. Nunca contam como zero.',
  )}${reasons.length ? ` ${reasons.join('; ')}.` : ''}${capped === null ? '' : ` ${t(
    `Admin: ${number(capped)} scores of 60 or more without a fact counted as 59 in the answers counted.`,
    `Admin: ${number(capped)} notas 60 ou mais sem fato contaram como 59 nas respostas contadas.`,
  )}`}`;
}

/** A brand's name with its site's icon: the project's brand and every option of the configuration. */
export function useBrandCell(settings: ComparisonSettings | null) {
  const domains = new Map<string, string>();
  if (settings) for (const option of [settings.brand, ...settings.competitors, ...settings.config.products.flatMap((item) => item.competitors)]) if (option.domain && !domains.has(option.name.toLowerCase())) domains.set(option.name.toLowerCase(), option.domain);
  return (name: string, own: boolean) => <BrandName name={name} domain={domains.get(name.toLowerCase()) ?? ''} own={own} />;
}

/** Why a brand has no overall score: no answer scored it on half of the attributes asked. */
export const notScoredText = (t: Translate) => t('No answer scored it on at least half of the attributes asked', 'Nenhuma resposta lhe deu nota em pelo menos metade dos atributos perguntados');
/** How the win rate is counted, for its info icons (the KPI, the ranking, the lists). */
export const winRateText = (t: Translate) => t(
  'Win rate: of the answers where the brand was an option and some option could be scored, the share in which it has the highest overall score. A tie at the top is shared: two leaders take half a win each. Discarded answers count in no figure, and a score of 60 or more without a fact counts as 59.',
  'Taxa de vitória: das respostas em que a marca foi opção e alguma opção pôde receber nota, a parcela em que ela tem a maior nota geral. Empate no topo é dividido: dois líderes levam meia vitória cada. Respostas descartadas não entram em nenhum número, e nota 60 ou mais sem fato conta como 59.',
);

/** The KPI strip of the overview and of a drill down's page: the brand's score, win rate, average position and the discarded answers. */
export function ComparisonKpis({ report, attribute = false }: { report: ComparisonReport; /** An attribute's page: its score, not an overall. */ attribute?: boolean }) {
  const t = useCopy();
  const { number, percent } = useNumbers();
  const { own, previous, discarded } = report;
  const engines = enginesText(t, report.engines, report.left);
  const notPlaced = notScoredText(t);
  const notAsked = t('Not an option in any answer of this period and filter that could be decided', 'Não foi opção em nenhuma resposta deste período e filtro que pôde ser decidida');
  const read = report.answers + discarded.total;
  const coverage = own.cellsAsked
    ? t(
        ` The answers counted gave your brand ${number(own.cells)} of the ${number(own.cellsAsked)} attribute scores they were asked for (${percent((own.cells / own.cellsAsked) * 100, 0)}).`,
        ` As respostas contadas deram à sua marca ${number(own.cells)} das ${number(own.cellsAsked)} notas por atributo pedidas (${percent((own.cells / own.cellsAsked) * 100, 0)}).`,
      )
    : '';
  const ties = [
    report.ties ? t(`${number(report.ties)} answers have a tie at the top.`, `${number(report.ties)} respostas têm empate no topo.`) : '',
    report.undecided ? t(`${number(report.undecided)} scored no option on half of its attributes and are left out.`, `${number(report.undecided)} não deram nota a nenhuma opção em metade dos atributos e ficam de fora.`) : '',
  ].filter(Boolean).join(' ');
  const wins = number(own.wins, Number.isInteger(own.wins) ? 0 : 1);
  return (
    <MetricGrid columns={4} mobilePairs label={t('Comparison metrics', 'Métricas de comparação')}>
      <MetricCard
        label={attribute ? t('Attribute score', 'Nota no atributo') : t('Overall score', 'Nota geral')}
        definition={`${t(
          'Your brand’s mean score from 0 to 100, on the Semantic Branding scale: in each answer, the mean of its scores on the attributes it was scored on, when that is at least half of those asked (else it has no overall there, never a zero). A score of 60 or more needs a fact behind it; without one it counts as 59.',
          'A nota média da sua marca de 0 a 100, na escala do Semantic Branding: em cada resposta, a média das notas nos atributos em que recebeu nota, quando são pelo menos metade dos perguntados (senão ela não tem nota geral ali, nunca zero). Nota 60 ou mais precisa de um fato que a sustente; sem ele, conta como 59.',
        )}${coverage} ${engines}`}
        value={own.score == null ? <Missing reason={notPlaced} /> : number(own.score, 0)}
        delta={own.score != null && previous?.own.score != null ? <Change value={own.score - previous.own.score} /> : undefined}
        description={t(`Scored in ${number(own.placed)} answers`, `Com nota em ${number(own.placed)} respostas`)}
      />
      <MetricCard
        label={t('Win rate', 'Taxa de vitória')}
        definition={[winRateText(t), ties].filter(Boolean).join(' ')}
        value={own.winRate == null ? <Missing reason={notAsked} /> : percent(own.winRate * 100, 0)}
        delta={own.winRate != null && previous?.own.winRate != null ? <Change value={(own.winRate - previous.own.winRate) * 100} unit=" pp" /> : undefined}
        description={t(`Won ${wins} of ${number(own.decided)} answers`, `Venceu ${wins} de ${number(own.decided)} respostas`)}
      />
      <MetricCard
        label={t('Average position', 'Posição média')}
        definition={t('Your brand’s mean place by overall score in the answers that gave it one; 1 is first, options with the same score share a place.', 'O lugar médio da sua marca pela nota geral nas respostas que lhe deram uma; 1 é o primeiro, opções com a mesma nota dividem o lugar.')}
        value={own.position == null ? <Missing reason={notPlaced} /> : number(own.position, 1)}
        delta={own.position != null && previous?.own.position != null ? <Change value={own.position - previous.own.position} invert /> : undefined}
        description={cadenceText(t, report.cadence)}
      />
      <MetricCard
        label={t('Discarded answers', 'Respostas descartadas')}
        definition={discardText(t, discarded, number, report.capped)}
        value={number(discarded.total)}
        description={t(`Of ${number(read)} answers read`, `De ${number(read)} respostas lidas`)}
      />
    </MetricGrid>
  );
}

/** Comparison's overview: the KPIs, the brand ranking, the score by attribute, the products and the personas. */
function ComparisonOverview({
  report,
  settings,
  canEdit,
  link,
  product,
  persona,
  onProduct,
  onPersona,
}: {
  report: ComparisonReport;
  settings: ComparisonSettings | null;
  canEdit: boolean;
  link: Linker;
  product: string;
  persona: string;
  onProduct: (value: string) => void;
  onPersona: (value: string) => void;
}) {
  const t = useCopy();
  const { number, percent } = useNumbers();
  const engines = enginesText(t, report.engines, report.left);
  const brandOf = useBrandCell(settings);
  const filters = report.filters.products.length > 0 && (
    <PageFilters>
      <FilterSelect
        multiple={false}
        label={t('Product', 'Produto')}
        value={product}
        onChange={onProduct}
        options={[{ value: 'all', label: t('All products', 'Todos os produtos') }, ...report.filters.products.map((item) => ({ value: item.id, label: item.name }))]}
      />
      <FilterSelect
        multiple={false}
        label={t('Persona', 'Persona')}
        value={persona}
        onChange={onPersona}
        options={[{ value: 'all', label: t('All personas', 'Todas as personas') }, ...report.filters.personas.map((item) => ({ value: item.id, label: item.name }))]}
      />
    </PageFilters>
  );
  const setUp = canEdit ? (
    <Button nativeButton={false} render={<a {...link({ comparisonView: COMPARISON_SECTIONS.products.page })} aria-label={t('Set up Comparison', 'Configurar Comparação')} />}>{t('Set up Comparison', 'Configurar Comparação')}</Button>
  ) : undefined;
  if (!report.engines.length)
    return (
      <EmptyState
        title={t('None of this project’s AIs can be asked to compare', 'Nenhuma IA deste projeto pode ser perguntada para comparar')}
        description={`${t('Comparison asks ChatGPT, Gemini and AI Mode, the AIs that follow a question with instructions.', 'A Comparação pergunta ao ChatGPT, ao Gemini e ao AI Mode, as IAs que seguem uma pergunta com instruções.')} ${engines}`}
      />
    );
  if (report.status === 'unconfigured')
    return (
      <EmptyState
        title={t('Comparison is not set up yet', 'A Comparação ainda não está configurada')}
        description={t(
          'Choose the products you sell, the competitors and attributes to compare them on, and the personas who buy. The AIs then score every option on each attribute, with a fact behind each score.',
          'Escolha os produtos que você vende, os concorrentes e atributos para compará-los e as personas que compram. Depois as IAs dão nota a cada opção em cada atributo, com um fato por trás de cada nota.',
        )}
        action={setUp}
      />
    );
  if (report.status === 'waiting') return <>{filters}<ComparisonWaiting report={report} filtered={product !== 'all' || persona !== 'all'} onClear={() => { onProduct('all'); onPersona('all'); }} /></>;
  // Your brand first, then the others as ranked: the heatmap's rows.
  const rows = [...report.brands.filter((row) => row.own), ...report.brands.filter((row) => !row.own)];
  const notAsked = t('Not an option in any answer of this period and filter that could be decided', 'Não foi opção em nenhuma resposta deste período e filtro que pôde ser decidida');
  const notScored = notScoredText(t);
  const scoreCell = (row: { score: number | null }, label: string) => (row.score == null ? <Missing reason={notScored} label={label} /> : number(row.score, 0));
  const rateCell = (row: { winRate: number | null }, label: string) => (row.winRate == null ? <Missing reason={notAsked} label={label} /> : percent(row.winRate * 100, 0));
  const positionCell = (row: { position: number | null }, label: string) => (row.position == null ? <Missing reason={notScored} label={label} /> : number(row.position, 1));
  // The cards beside each other (products, personas) keep their room for the name, whole at 1280: the answers are left to the brand
  // ranking and the KPI strip, and the figures take only what they need.
  const listColumns = (first: string, answers = true, name?: (row: Row & { id?: string }) => ReactNode): DataColumn<Row & { id?: string; answers?: number }>[] => [
    { key: 'name', header: first, mobile: 'title', cell: (row) => name?.(row) ?? <span className="min-w-0 truncate">{row.name}</span>, hint: (row) => row.name },
    { key: 'score', header: t('Score', 'Nota'), label: t('Score', 'Nota'), align: 'end', width: '5rem', cell: (row) => scoreCell(row, row.name) },
    // A phone keeps the name, the score and the win rate (the place is in the KPI strip): the card's table fits 390px.
    { key: 'winRate', header: t('Win rate', 'Taxa de vitória'), label: t('Win rate', 'Taxa de vitória'), align: 'end', width: '7.5rem', cell: (row) => rateCell(row, row.name) },
    { key: 'position', header: t('Position', 'Posição'), label: t('Position', 'Posição'), align: 'end', width: '5.5rem', mobile: 'hide', cell: (row) => positionCell(row, row.name) },
    ...(answers ? [{ key: 'answers', header: t('Answers', 'Respostas'), label: t('Answers', 'Respostas'), align: 'end' as const, width: '6.5rem', mobile: 'hide' as const, cell: (row: Row & { answers?: number }) => number(row.answers ?? row.options) }] : []),
  ];
  return (
    <>
      {filters}
      <ComparisonKpis report={report} />
      <SectionCard
        className="mb-5"
        title={t('Brand ranking', 'Ranking de marcas')}
        info={`${t(
          'Every option asked, by overall score: in each answer, the mean of its scores on the attributes it was scored on, from half of those asked up.',
          'Todas as opções perguntadas, pela nota geral: em cada resposta, a média das notas nos atributos em que recebeu nota, a partir de metade dos perguntados.',
        )} ${winRateText(t)} ${t('Position: its mean place by score. Answers: those where it was an option.', 'Posição: o lugar médio pela nota. Respostas: aquelas em que foi opção.')}`}
      >
        {report.brands.length ? <DataTable
          singleLine
          minWidth={0}
          compact
          ariaLabel={t('Brand ranking', 'Ranking de marcas')}
          rows={report.brands.map((row) => ({ ...row, name: row.brand }))}
          rowKey={(row) => row.name}
          columns={[
            { key: 'rank', header: '#', align: 'center', width: '3rem', mobile: 'hide', cell: (_, index) => number(index + 1) },
            { key: 'brand', header: t('Brand', 'Marca'), mobile: 'title', cell: (row) => brandOf(row.name, row.own) },
            ...listColumns(t('Brand', 'Marca')).slice(1),
          ]}
        /> : <EmptyState frame="bare" title={t('No answer of this period and filter was counted.', 'Nenhuma resposta deste período e filtro foi contada.')} description={t('Every answer read was discarded: see why in Discarded answers.', 'Todas as respostas lidas foram descartadas: veja o motivo em Respostas descartadas.')} />}
      </SectionCard>
      <SectionCard
        className="mb-5"
        title={t('Score by attribute', 'Nota por atributo')}
        info={t(
          'For each brand and attribute, its mean score from 0 to 100 in the answers of this period and filter, each score backed by a fact; your brand first. Overall: its overall score, the mean of the attributes scored in each answer (half of those asked at least). 🏆 marks the highest score of each column; a tie marks every leader.',
          'Para cada marca e atributo, a nota média de 0 a 100 nas respostas deste período e filtro, cada nota sustentada por um fato; sua marca primeiro. Geral: a nota geral, a média dos atributos com nota em cada resposta (pelo menos metade dos perguntados). 🏆 marca a maior nota de cada coluna; num empate, todos os líderes.',
        )}
      >
        <ComparisonHeatmap
          brands={rows.map((row) => ({ name: row.brand, own: row.own, overall: row.score, cells: Object.fromEntries(report.attributes.map((attribute) => [attribute.id, attribute.brands.find((cell) => cell.brand === row.brand)?.score ?? null])) }))}
          attributes={report.attributes.map((attribute) => ({ id: attribute.id, name: attribute.name }))}
          brandCell={(row) => brandOf(row.name, row.own)}
          empty={t('No score on that attribute in this period and filter', 'Sem nota nesse atributo neste período e filtro')}
        />
      </SectionCard>
      <div className="overview-grid">
        <SectionCard
          title={t('Products by score', 'Produtos por nota')}
          info={t('Your brand’s score, win rate and position in each product, the highest score first. Open a product for its scores against each competitor, their evolution and the facts behind them.', 'A nota, a taxa de vitória e a posição da sua marca em cada produto, a maior nota primeiro. Abra um produto para ver as notas contra cada concorrente, a evolução e os fatos por trás delas.')}
          action={<ViewAllAction link={link} to={{ comparisonView: COMPARISON_SECTIONS.products.page }}>{t('View all', 'Ver todos')}</ViewAllAction>}
        >
          <DataTable
            singleLine
            minWidth={0}
            compact
            ariaLabel={t('Products', 'Produtos')}
            rows={report.products.slice(0, 5)}
            rowKey={(row) => row.id}
            columns={listColumns(t('Product', 'Produto'), false, (row) => <DrillLink link={link} to={detailPage('products', row.id!)} className="min-w-0 truncate">{row.name}</DrillLink>)}
          />
        </SectionCard>
        <SectionCard
          title={t('Personas', 'Personas')}
          info={t('Your brand’s score, win rate and position for each persona the AIs were asked about. Open a persona for its scores against each competitor, their evolution and the facts behind them.', 'A nota, a taxa de vitória e a posição da sua marca para cada persona perguntada às IAs. Abra uma persona para ver as notas contra cada concorrente, a evolução e os fatos por trás delas.')}
          action={<ViewAllAction link={link} to={{ comparisonView: COMPARISON_SECTIONS.personas.page }}>{t('View all', 'Ver todas')}</ViewAllAction>}
        >
          <DataTable singleLine minWidth={0} compact ariaLabel={t('Personas', 'Personas')} rows={[...report.personas].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 5)} rowKey={(row) => row.id} columns={listColumns(t('Persona', 'Persona'), false, (row) => <DrillLink link={link} to={detailPage('personas', row.id!)} className="min-w-0 truncate">{row.name}</DrillLink>)} />
        </SectionCard>
      </div>
    </>
  );
}

/** Configured, nothing read in this period and filter: why, and what comes next. */
export function ComparisonWaiting({ report, filtered, onClear }: { report: ComparisonReport; filtered: boolean; onClear?: () => void }) {
  const t = useCopy();
  const { number } = useNumbers();
  if (filtered)
    return (
      <EmptyState
        title={t('No answers match these filters', 'Nenhuma resposta corresponde a estes filtros')}
        description={t('No answer for this product and persona was read in this period.', 'Nenhuma resposta para este produto e esta persona foi lida neste período.')}
        action={onClear && <Button variant="outline" onClick={onClear}>{t('Clear filters', 'Limpar filtros')}</Button>}
      />
    );
  if (!report.collecting)
    return (
      <EmptyState
        title={t('Comparison is not collected in this installation', 'A Comparação não é coletada nesta instalação')}
        description={t('Its questions are not sent to the AIs here, so no answers arrive. The configuration is kept.', 'As perguntas não são enviadas às IAs aqui, então nenhuma resposta chega. A configuração fica guardada.')}
      />
    );
  return (
    <EmptyState
      tone="progress"
      title={t('The first answers arrive after the next collection', 'As primeiras respostas chegam depois da próxima coleta')}
      description={[
        report.inFlight ? t(`${number(report.inFlight)} questions are on their way to the AIs.`, `${number(report.inFlight)} perguntas estão a caminho das IAs.`) : t('No answer was read in this period and filter yet.', 'Nenhuma resposta foi lida neste período e filtro ainda.'),
        `${cadenceText(t, report.cadence)}.`,
        enginesText(t, report.engines, report.left),
      ].join(' ')}
    />
  );
}

type HeatRow = { name: string; own: boolean; overall: number | null; cells: Record<string, number | null> };
/**
 * The comparison heatmap (Semantic Branding's heatmap): brands by attribute (or by product, on an attribute's page), each cell a brand's
 * mean score on the Semantic Branding scale in its band's tint (HEAT_BANDS), or (`kind="winRate"`) its win rate in WIN_RATE_BANDS; a dash
 * with its reason where it has none. A trophy marks each column's leader as shown (every brand level with it), unless all are level.
 * Shown in /design-system too.
 */
export function ComparisonHeatmap({ brands, attributes, brandCell, empty, kind = 'score', label }: {
  brands: HeatRow[];
  attributes: { id: string; name: string }[];
  brandCell: (row: HeatRow) => ReactNode;
  empty: string;
  kind?: 'score' | 'winRate';
  label?: string;
}) {
  const l = useCopy();
  const { number, percent } = useNumbers();
  const bands = kind === 'score' ? HEAT_BANDS : WIN_RATE_BANDS;
  const shown = (value: number) => (kind === 'score' ? number(value, 0) : percent(value * 100, 0));
  const level = (value: number) => Math.round(kind === 'score' ? value : value * 100);
  // Each column's leader as shown: its highest value, every brand level with it marked, when some brand is below it.
  const valueOf = (row: HeatRow, column: string) => (column === 'overall' ? row.overall : row.cells[column] ?? null);
  const tops = new Map(['overall', ...attributes.map((attribute) => attribute.id)].map((column) => {
    const levels = brands.flatMap((row) => { const value = valueOf(row, column); return value == null ? [] : [level(value)]; });
    const top = Math.max(...levels);
    return [column, levels.some((value) => value < top) ? top : null];
  }));
  const trophy = l('Highest score of the column', 'Maior nota da coluna');
  const cell = (row: HeatRow, column: string, name: string) => {
    const value = valueOf(row, column);
    if (value == null) return <Missing reason={empty} label={`${row.name}, ${name}`} />;
    return tops.get(column) === level(value) ? <>{shown(value)} <span aria-hidden="true">🏆</span><span className="sr-only">{trophy}</span></> : shown(value);
  };
  const style = (value: number | null) => (value == null ? undefined : heatCell(kind === 'score' ? value : value * 100, bands));
  // Phone: as many attribute columns as fit with the longest word of a header whole (as Semantic Branding's).
  const visible = phoneColumns(attributes.map((attribute) => attribute.name));
  const name = label ?? (kind === 'score' ? l('Score by attribute', 'Nota por atributo') : l('Win rate by attribute', 'Taxa de vitória por atributo'));
  if (!attributes.length) return <EmptyState frame="bare" title={l('No attribute was asked in this period and filter.', 'Nenhum atributo foi perguntado neste período e filtro.')} />;
  return (
    <>
      <DataTable
        singleLine
        ariaLabel={name}
        className="semantic-association-panel"
        style={{ '--attributes': attributes.length, '--visible': visible } as CSSProperties}
        containerProps={{ className: 'semantic-association-scroll', role: 'region', tabIndex: 0, 'aria-label': name }}
        rows={brands}
        rowKey={(row) => row.name}
        columns={[
          { key: 'brand', header: l('Brand', 'Marca'), rowHeader: true, cell: brandCell },
          { key: 'overall', header: l('Overall', 'Geral'), align: 'center', cellStyle: (row) => style(row.overall), cell: (row) => cell(row, 'overall', l('Overall', 'Geral')) },
          ...attributes.map((attribute): DataColumn<HeatRow> => ({
            key: attribute.id,
            header: attribute.name,
            align: 'center',
            cellStyle: (row) => style(row.cells[attribute.id] ?? null),
            cell: (row) => cell(row, attribute.id, attribute.name),
          })),
        ]}
      />
      <SwipeHint attributes={attributes.map((attribute) => attribute.name)} />
      <div className="semantic-heatmap-legend">
        <HeatScale bands={bands} />
        <span>{kind === 'score' ? l('—: no score on that attribute in this period, never a zero', '—: sem nota naquele atributo neste período, nunca zero') : l('—: not an option on that attribute in this period, never a zero', '—: não foi opção naquele atributo neste período, nunca zero')}</span>
        <span>{l('🏆: the highest of the column; a tie marks every leader', '🏆: a maior da coluna; num empate, todos os líderes')}</span>
      </div>
    </>
  );
}

/**
 * Comparison while its data loads (shell.md section 9): the overview's strip, cards and tables, a drill down's page, or a page's toolbar
 * and table with its own columns, in their loading state.
 */
export function ComparisonSkeleton({ view = 'overview', detail = false }: { view?: ComparisonSection; detail?: boolean }) {
  const l = useCopy();
  const label = l('Loading comparison…', 'Carregando comparação…');
  const head = (key: string, en: string, pt: string, align?: 'end') => ({ key, header: l(en, pt), align, cell: () => null });
  const list = [head('name', 'Name', 'Nome'), head('score', 'Score', 'Nota', 'end'), head('winRate', 'Win rate', 'Taxa de vitória', 'end'), head('position', 'Position', 'Posição', 'end'), head('answers', 'Answers', 'Respostas', 'end')];
  if (detail) return <ComparisonDetailSkeleton />;
  if (view !== 'overview') {
    const columns = {
      products: [head('product', 'Product', 'Produto'), head('competitors', 'Competitors', 'Concorrentes'), head('attributes', 'Attributes', 'Atributos'), head('score', 'Score', 'Nota', 'end'), head('winRate', 'Win rate', 'Taxa de vitória', 'end'), head('answers', 'Answers', 'Respostas', 'end')],
      attributes: [head('attribute', 'Attribute', 'Atributo'), head('group', 'Group', 'Grupo'), head('description', 'Description', 'Descrição'), head('products', 'Products', 'Produtos', 'end')],
      personas: [head('persona', 'Persona', 'Persona'), head('description', 'Description', 'Descrição')],
    }[view];
    const search = { products: ['Search products, competitors or attributes', 'Buscar produtos, concorrentes ou atributos'], attributes: ['Search attributes or groups', 'Buscar atributos ou grupos'], personas: ['Search personas', 'Buscar personas'] }[view] as [string, string];
    // As BrandsSkeleton: the toolbar with its search, then the table's own columns, so nothing moves when the list arrives.
    return (
      <DataTableScreen>
        <DataTableToolbar label={label}>
          <SearchField value="" onChange={() => {}} placeholder={l(...search)} />
        </DataTableToolbar>
        <DataTable fill singleLine="wide" loading ariaLabel={label} rows={[]} rowKey={String} columns={columns} />
      </DataTableScreen>
    );
  }
  return (
    <div aria-busy="true" aria-label={label} data-screen-skeleton="">
      <MetricGridSkeleton count={4} label={label} description />
      <SectionCard className="mb-5" title={l('Brand ranking', 'Ranking de marcas')}>
        {/* The ranking's own layout: the rank (hidden on a phone) and the brand that takes the rest, as it loads. */}
        <DataTable singleLine minWidth={0} compact loading={5} rows={[]} rowKey={String} columns={[{ ...head('rank', '#', '#'), align: 'center' as const, width: '3rem', mobile: 'hide' as const }, { ...list[0]!, mobile: 'title' as const }, ...list.slice(1)]} />
      </SectionCard>
      <SectionCard className="mb-5" title={l('Score by attribute', 'Nota por atributo')} loading lines={4} />
      <div className="overview-grid">
        <SectionCard title={l('Products by score', 'Produtos por nota')}>
          <DataTable singleLine minWidth={0} compact loading={5} rows={[]} rowKey={String} columns={list.slice(0, 4)} />
        </SectionCard>
        <SectionCard title={l('Personas', 'Personas')}>
          <DataTable singleLine minWidth={0} compact loading={5} rows={[]} rowKey={String} columns={list.slice(0, 4)} />
        </SectionCard>
      </div>
    </div>
  );
}
