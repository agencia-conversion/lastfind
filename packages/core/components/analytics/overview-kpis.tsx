'use client';
import { Children, type ReactNode } from 'react';
import {
  Eye,
  Link as LinkIcon,
  ListOrdered,
  MessageSquare,
} from 'lucide-react';
import { formatNumber } from '@/lib/number-format';
import { coveredPeriods, thinPeriodNote } from '@/lib/period-coverage';
import type { SummaryReport } from '@/lib/report-types';
import {
  MetricCard,
  MetricGrid,
} from '@/components/lastfind/presentation/metric-card';
import { ENGINE_LABELS } from '@/lib/engines';
import { EngineIcon } from '@/components/lastfind/identity-icons';
import { MetricGridSkeleton } from '@/components/lastfind/presentation/metric-card';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { TrendCard } from '@/components/lastfind/presentation/trend-chart';
import { BarListSkeleton } from '@/components/lastfind/presentation/bar-list';
import { DrillLink, type DrillTarget, type Linker } from './drill-link';
import { SemanticOverviewSkeleton } from './semantic-perception';
import { Change, useComparison, useCopy } from './shared';

type Translate = (en: string, pt: string) => string;

type SummaryKey = keyof SummaryReport['availability'];
/** Whether a summary metric shows its change: same monitored brands, an earlier period with enough answers (lib/period-coverage), measured in both. */
export function summaryComparable(summary: SummaryReport, key: SummaryKey) {
  return !!summary.comparison?.comparable && summary.comparison.hasPreviousData && Boolean(summary.availability?.[key]?.previous);
}
/** Why a summary metric shows no change, for its info balloon: one wording for every screen. */
export function noComparisonNote(summary: SummaryReport, locale: string, t: Translate, period: string) {
  const before = summary.comparison?.previous?.responses, now = summary.metrics?.responses;
  return !summary.samples?.previous
    ? t(`No complete responses in ${period}.`, `Sem respostas completas no ${period}.`)
    : !summary.comparison?.comparable
      ? t('Comparison unavailable: tracked brands changed between periods.', 'Comparação indisponível: as marcas monitoradas mudaram entre períodos.')
      : before != null && !coveredPeriods(before, now)
        ? thinPeriodNote(t, period, formatNumber(locale, before), formatNumber(locale, now))
        : t('Comparison unavailable: this metric was not measured in both periods.', 'Comparação indisponível: esta métrica não foi medida nos dois períodos.');
}

export function OverviewKpis({
  summary,
  locale,
  t,
  link,
  children,
  settling = false,
}: {
  summary: SummaryReport;
  locale: string;
  t: Translate;
  link: Linker;
  children?: ReactNode;
  /** A new project's first answers are still being processed (live-app.tsx): a figure not there yet is on its way, not missing. */
  settling?: boolean;
}) {
  const comparison = useComparison(t);
  // Drill down: each figure opens the responses it is measured on, with the header's filters. Citations: the
  // responses citing the brand's own domain; the others: the responses that name the brand.
  const cohort = (key: string): DrillTarget =>
    key === 'citationPresence'
      ? { tab: 'responses', brand: null, mention: 'all', cites: 'own', run: null }
      : { tab: 'responses', brand: null, mention: 'mentioned', cites: null, run: null };
  // Share of voice leads: the brand's share among every identified brand is the main metric.
  const definitions = [
    [
      'shareOfVoice',
      t('Share of voice', 'Share of voice'),
      MessageSquare,
      t(
        'Brand mentions ÷ mentions of every identified brand (monitored and discovered). Counted over the answers the brand analysis read (the 10,000 most recent of the last 90 days); a newer one counts once it is read.',
        'Menções à marca ÷ menções a todas as marcas identificadas (monitoradas e descobertas). Contado sobre as respostas que a análise de marcas leu (as 10.000 mais recentes dos últimos 90 dias); uma mais nova conta depois de lida.',
      ),
    ],
    [
      'mentionPosition',
      t('Average position', 'Posição média'),
      ListOrdered,
      t(
        'Average rank of the brand’s first mention among the competitors the answer names, monitored and discovered (1 = named first). Lower is better.',
        'Posição média da primeira menção à marca entre os concorrentes que a resposta cita, monitorados e descobertos (1 = citada primeiro). Quanto menor, melhor.',
      ),
    ],
    [
      'visibility',
      t('Visibility', 'Visibilidade'),
      Eye,
      t(
        'Responses mentioning the brand ÷ all responses in the period.',
        'Respostas com menção à marca ÷ todas as respostas do período.',
      ),
    ],
    [
      'citationPresence',
      t('Citations', 'Citações'),
      LinkIcon,
      t(
        'Responses that cite a registered brand domain as a source ÷ all responses in the period.',
        'Respostas que citam um domínio registrado da marca como fonte ÷ todas as respostas do período.',
      ),
    ],
  ] as const;
  return (
    <MetricGrid columns={definitions.length + Children.count(children)} mobilePairs>
      {definitions.map(([key, title, Icon, definition]) => {
        const available = Boolean(summary.availability[key]?.current);
        const comparable = available && summaryComparable(summary, key);
        const suffix = key === 'mentionPosition' ? '' : '%';
        const absence = settling
          ? t('The first answers are still being processed. This card updates on its own.', 'As primeiras respostas ainda estão sendo processadas. Este card se atualiza sozinho.')
          : !summary.metrics.responses
          ? t(
              'No complete responses in this period.',
              'Sem respostas completas neste período.',
            )
          : key === 'shareOfVoice'
            ? t(
                'No brand mentions in this period.',
                'Sem menções de marcas neste período.',
              )
            : t(
                'No measured brand mentions in this period.',
                'Sem menções à marca medidas neste período.',
              );
        // The card shows only the figure and its change; why there is no change goes in the info tooltip.
        const noComparison = comparable || comparison.off ? '' : noComparisonNote(summary, locale, t, comparison.period);
        return (
          <MetricCard
            key={key}
            icon={<Icon size={15} />}
            label={title}
            definition={available && noComparison ? `${definition} ${noComparison}` : definition}
            value={
              available ? (
                <DrillLink
                  link={link}
                  aria-label={`${title}: ${formatNumber(locale, summary.metrics[key], 1)}${suffix}. ${t('Open the responses behind it', 'Abrir as respostas por trás')}`}
                  to={cohort(key)}
                >
                  {formatNumber(locale, summary.metrics[key], 1)}
                  {suffix}
                </DrillLink>
              ) : (
                <span className="text-body">
                  {settling
                    ? t('Measuring…', 'Medindo…')
                    : summary.metrics.responses
                    ? t('Not measured', 'Não medido')
                    : t('No responses', 'Sem respostas')}
                </span>
              )
            }
            delta={comparable ? <Change value={summary.comparison.delta[key]} unit={suffix ? ' pp' : ''} locale={locale} invert={key === 'mentionPosition'} /> : undefined}
            description={available ? undefined : absence}
            rows={available ? summary.channels?.map((channel) => {
              const figure = channel[key];
              return {
                key: channel.engine,
                icon: <EngineIcon engine={channel.engine} size={14} />,
                label: ENGINE_LABELS[channel.engine],
                value: figure == null ? '—' : (
                  <DrillLink
                    link={link}
                    aria-label={`${title}, ${ENGINE_LABELS[channel.engine]}: ${formatNumber(locale, figure, 1)}${suffix}. ${t('Open the responses behind it', 'Abrir as respostas por trás')}`}
                    to={{ ...cohort(key), engine: channel.engine }}
                  >
                    {`${formatNumber(locale, figure, 1)}${suffix}`}
                  </DrillLink>
                ),
              };
            }) : undefined}
          />
        );
      })}
      {children}
    </MetricGrid>
  );
}

/**
 * The Brand ranking's columns that set its layout (live-app.tsx): the rank, then the brand (the rest of the card), then the
 * trend's metric, wide enough for its longest name with the sort arrow (EN and pt-BR). Its skeleton takes the same.
 */
export const RANKING_COLUMNS = { rank: { width: 44, mobile: 'hide' }, brand: { mobile: 'title' }, metric: { visibility: 120, shareOfVoice: 140, position: 156 } } as const;

/**
 * The Overview while the workspace loads (shell.md section 9), under live-app's heading: the KPI row, then each row of cards
 * with its real card, title and table columns in their loading state, so nothing moves when the reports arrive.
 */
export function OverviewSkeleton() {
  const l = useCopy();
  const label = l('Loading your workspace…', 'Carregando seu workspace…');
  const head = (key: string, header: string, align?: 'center' | 'end', layout?: Pick<DataColumn<number>, 'width' | 'mobile'>): DataColumn<number> => ({ key, header, align, cell: () => null, ...layout });
  const table = (columns: ReturnType<typeof head>[], rows = 5) => <DataTable singleLine minWidth={0} loading={rows} rows={[]} rowKey={String} ariaLabel={label} columns={columns} />;
  const pair = (left: ReactNode, right: ReactNode) => <div className="overview-grid overview-pair">{left}{right}</div>;
  return (
    <div className="overview-rows" aria-busy="true" aria-label={label} data-screen-skeleton="">
      {/* The KPI cards carry a line per AI model under the value: three lines keep their height. */}
      <MetricGridSkeleton count={5} label={label} description={3} />
      <div className="overview-grid">
        <TrendCard loading className="trend-panel" title={l('Brand trend', 'Evolução das marcas')} data={[]} series={[]} scale={{ domain: [0, 100], ticks: [0, 100] }} locale="en" formatValue={String} formatTick={String} />
        <SectionCard className="ranking-panel" title={l('Brand ranking', 'Ranking de marcas')}>
          {/* The ranking opens on Share of voice (live-app's overviewChart). */}
          {table([head('rank', '#', 'center', RANKING_COLUMNS.rank), head('brand', l('Brand', 'Marca'), undefined, RANKING_COLUMNS.brand), head('sov', l('Share of voice', 'Share of voice'), 'end', { width: RANKING_COLUMNS.metric.shareOfVoice })])}
        </SectionCard>
      </div>
      <SemanticOverviewSkeleton />
      {pair(
        <SectionCard title={l('Topic coverage', 'Cobertura de tópicos')}><BarListSkeleton rows={4} /></SectionCard>,
        <SectionCard title={l('SOV and visibility by AI', 'SOV e visibilidade por IA')}>{table([head('engine', l('AI model', 'Modelo de IA')), head('sov', l('Share of voice', 'Share of voice'), 'end'), head('visibility', l('Visibility', 'Visibilidade'), 'end')], 3)}</SectionCard>,
      )}
      {pair(<SectionCard loading lines={5} />, <SectionCard>{table([head('domain', l('Domain', 'Domínio')), head('presence', l('Presence', 'Presença'), 'end')])}</SectionCard>)}
      {pair(<SectionCard loading lines={5} />, <SectionCard>{table([head('page', l('Page', 'Página')), head('presence', l('Presence', 'Presença'), 'end')])}</SectionCard>)}
      {pair(<SectionCard loading lines={4} />, <SectionCard title="Query Fan Out">{table([head('query', l('Query', 'Consulta')), head('count', l('Occurrences', 'Ocorrências'), 'end')], 3)}</SectionCard>)}
      <SectionCard title={l('Recent responses', 'Respostas recentes')}>{table([head('prompt', 'Prompt'), head('model', l('Model', 'Modelo')), head('date', l('Date', 'Data'), 'end')])}</SectionCard>
    </div>
  );
}
