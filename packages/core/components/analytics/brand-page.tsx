'use client';
import type { MouseEvent, ReactNode } from 'react';
import type { requestJson } from '@/lib/client';
import { useReport } from '@/hooks/use-report';
import type { HistoryPage, SummaryReport } from '@/lib/report-types';
import { ROLE_LABELS } from '@/lib/brand-roles';
import type { Project } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricCard, MetricGrid, MetricGridSkeleton, MetricValueSkeleton } from '@/components/lastfind/presentation/metric-card';
import { PageHeading } from '@/components/lastfind/presentation/page-heading';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { TrendCard } from '@/components/lastfind/presentation/trend-chart';
import type { BrandResearchReport } from './brand-research-panel';
import { BrandSentimentAnalysis, SentimentBar, sentimentLabel } from './brand-sentiment-analysis';
import { sentimentIndexDefinition, sentimentScore } from './overview-sentiment-card';
import { DrillLink, ViewAllAction, type DrillTarget, type Linker } from './drill-link';
import { trendRange } from '@/lib/report-trend';
import { ResponsesTable } from './source-entity-page';
import { Change, EmptyState, SiteFavicon, useComparison, useCopy, useNumbers } from './shared';
import { noComparisonNote, summaryComparable } from './overview-kpis';
import type { BrandPageRow } from './brands-screen';

/** Recent answers shown before the link to the whole list. */
const RECENT_RESPONSES = 5;

/** The brand page while its row loads: the same heading, cards and sections, each in its loading state (shell.md section 9). */
export function BrandPageSkeleton() {
  const l = useCopy();
  const label = l('Loading the brand…', 'Carregando a marca…');
  return (
    <div className="st-entity" aria-busy="true" aria-label={label} data-screen-skeleton="">
      <PageHeading title={<Skeleton inline className="h-lh w-48 max-w-full align-top" />} description={<Skeleton inline className="h-lh w-64 max-w-full align-top" />} />
      <MetricGridSkeleton count={4} label={label} />
      <TrendCard loading title={l('Mentions per day', 'Menções por dia')} data={[]} series={[]} scale={{ domain: [0, 1], ticks: [0, 1] }} locale="en" formatValue={String} formatTick={String} />
      <SectionCard title={l('Sentiment', 'Sentimento')} loading />
      <SectionCard title={l('Responses that mention it', 'Respostas que mencionam a marca')} loading />
    </div>
  );
}

/**
 * One page for every evaluated brand, monitored or discovered, in the mould of the source page. A monitored brand reads the
 * report of the selected period; a discovered one reads the saved answers of the last 90 days, and the page says which is which.
 */
export function BrandPage({
  row,
  project,
  api,
  filters,
  request,
  refresh,
  t,
  link,
  demo,
  analyzed,
  research,
  sentimentStatus,
  metricsLoading = false,
  editable,
  busy,
  onEdit,
  onMonitor,
  onEvidence,
}: {
  row: BrandPageRow | null;
  project: Project;
  api: string;
  filters: URLSearchParams;
  request?: typeof requestJson;
  refresh: number | string;
  t: (en: string, pt: string) => string;
  link: Linker;
  demo: boolean;
  /** Answers the discovered brands were counted in (their 90-day base). */
  analyzed: number;
  research: { data?: BrandResearchReport; loading: boolean; error?: string };
  /** Why this brand has no score, or null when it has one. */
  sentimentStatus: string | null;
  /** The period's metrics are still loading: their values are placeholders, never a dash. */
  metricsLoading?: boolean;
  editable: boolean;
  busy: boolean;
  onEdit: () => void;
  onMonitor: () => void;
  onEvidence: (runId: string) => void;
}) {
  const { locale, number, percent } = useNumbers();
  const tracked = row?.status === 'tracked';
  const query = new URLSearchParams(filters);
  query.delete('provider');
  const summary = useReport<SummaryReport>(tracked ? `${api}/reports?${query}&view=summary` : null, refresh, request);
  const recentQuery = new URLSearchParams(query);
  recentQuery.set('view', 'history');
  recentQuery.set('brand', row?.name ?? '');
  recentQuery.set('mention', 'mentioned');
  const recent = useReport<HistoryPage>(row ? `${api}/reports?${recentQuery}` : null, refresh, request);
  const comparison = useComparison(t);
  if (!row)
    return (
      <div className="st-entity">
        <EmptyState title={t('This brand is not on the list.', 'Esta marca não está na lista.')} description={t('It may have been rejected, merged or renamed. Go back to Brands.', 'Ela pode ter sido rejeitada, unida ou renomeada. Volte para Marcas.')} />
      </div>
    );
  const index = project.competitors.findIndex((item) => item.name === row.name);
  const mentionKey = row.own ? 'mentions' : `mentionsC${index}`;
  const trend = tracked
    ? (summary.data?.daily ?? []).map((day) => ({ date: String(day.date), mentions: Number(day[mentionKey] ?? 0), responses: Number(day.responses ?? 0) })).filter((day) => day.responses > 0)
    : Object.entries(row.days).sort(([a], [b]) => a.localeCompare(b)).map(([date, mentions]) => ({ date, mentions }));
  const peak = Math.max(1, ...trend.map((day) => day.mentions));
  const first = Object.keys(row.days).sort()[0];
  const reading = research.data?.brands.find((item) => item.brand === row.name);
  const score = reading ? sentimentScore(reading) : null;
  const label = (value: string) => sentimentLabel(value, t);
  const day = (date: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  // The change beside each figure, by the Brands list's rule (the row's `previous`: absent when the earlier period measured
  // too few answers, lib/period-coverage); why there is none goes in the info balloon, as on the Overview.
  const previous = tracked && !comparison.off ? row.previous : undefined;
  const sharesCompared = !!summary.data?.comparison?.comparable;
  const why = (definition: string, shown: boolean) =>
    shown || comparison.off || !tracked
      ? definition
      : `${definition} ${summary.data ? (summaryComparable(summary.data, 'visibility') ? t(`Not measured in ${comparison.period}.`, `Não medido no ${comparison.period}.`) : noComparisonNote(summary.data, locale, t, comparison.period)) : ''}`.trim();
  const visibilityChange = previous && row.visibility != null ? <Change value={row.visibility - previous.visibility} unit=" pp" locale={locale} /> : undefined;
  const sovChange = previous?.shareOfVoice != null && row.shareOfVoice != null && sharesCompared ? <Change value={row.shareOfVoice - previous.shareOfVoice} unit=" pp" locale={locale} /> : undefined;
  const mentionsChange = previous && row.mentions != null ? <Change value={row.mentions - previous.mentions} locale={locale} margin={0} /> : undefined;
  // Drill down: each figure opens the responses that name the brand, with the header's filters.
  // A discovered brand by its key (a renamed one keeps it), shown by its name.
  const answers: DrillTarget = { tab: 'responses', brand: row.own ? null : tracked ? row.name : row.key, brandLabel: tracked ? null : row.name, sentiment: null, mention: 'mentioned', cites: null, run: null };
  // A sentiment band's answers: the drill already holds only answers that mention the brand (the effective mention), so the
  // mention filter does not ride along (a discovered brand merged into another would lose answers to it).
  const bandAnswers = (band: 'positive' | 'neutral' | 'negative'): DrillTarget => ({ ...answers, sentiment: band, mention: 'all' });
  const drill = (value: ReactNode, label: string) => (
    <DrillLink link={link} to={answers} aria-label={`${label}. ${t('Open the responses that name the brand', 'Abrir as respostas que citam a marca')}`}>{value}</DrillLink>
  );
  return (
    <div className="st-entity">
      <PageHeading
        title={<span className="inline-flex min-w-0 max-w-full items-center gap-2"><SiteFavicon domain={row.domain} name={row.name} /><span className="truncate">{row.name}</span></span>}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{row.domain || t('Domain not confirmed', 'Domínio não confirmado')}</span>
            <TagBadge tone={tracked ? 'primary' : 'neutral'}>{row.own ? t('You', 'Você') : tracked ? t('Monitored', 'Monitorada') : t('Discovered', 'Descoberta')}</TagBadge>
            {row.role !== 'competitor' && <TagBadge tone="quiet">{t(...ROLE_LABELS[row.role])}</TagBadge>}
          </span>
        }
        actions={editable && (row.status === 'discovered' || !row.own) ? (
          <>
            {row.status === 'discovered' && (
              <Button disabled={busy} onClick={onMonitor}>
                {t('Monitor', 'Monitorar')}
              </Button>
            )}
            {!row.own && (
              <Button variant="outline" onClick={onEdit}>
                {t('Edit', 'Editar')}
              </Button>
            )}
          </>
        ) : undefined}
      />
      <MetricGrid columns={4} mobilePairs>
        {tracked ? (
          <>
            <MetricCard label={t('Visibility', 'Visibilidade')} value={metricsLoading ? <MetricValueSkeleton /> : row.visibility != null ? drill(percent(row.visibility), `${t('Visibility', 'Visibilidade')} ${percent(row.visibility)}`) : '—'} delta={metricsLoading ? undefined : visibilityChange} definition={why(t('Share of the responses of the period that mention the brand.', 'Parcela das respostas do período que mencionam a marca.'), !!visibilityChange)} />
            <MetricCard label="Share of voice" value={metricsLoading ? <MetricValueSkeleton /> : row.shareOfVoice != null ? drill(percent(row.shareOfVoice), `Share of voice ${percent(row.shareOfVoice)}`) : '—'} delta={metricsLoading ? undefined : sovChange} definition={why(t('Mentions of the brand over the mentions of every identified brand, monitored and discovered.', 'Menções da marca sobre as menções de todas as marcas identificadas, monitoradas e descobertas.'), !!sovChange)} />
            <MetricCard
              label={t('Mentions', 'Menções')}
              value={metricsLoading ? <MetricValueSkeleton /> : row.mentions != null ? drill(number(row.mentions), `${t('Mentions', 'Menções')} ${number(row.mentions)}`) : '—'}
              delta={metricsLoading ? undefined : mentionsChange}
              definition={why(t('Responses of the period that mention the brand.', 'Respostas do período que mencionam a marca.'), !!mentionsChange)}
            />
          </>
        ) : (
          <>
            <MetricCard label={t('Mentions', 'Menções')} value={row.answers != null ? drill(number(row.answers), `${t('Mentions', 'Menções')} ${number(row.answers)}`) : '—'} definition={t('Saved answers of the last 90 days that mention the brand, whatever the period of the filter.', 'Respostas salvas dos últimos 90 dias que mencionam a marca, qualquer que seja o período do filtro.')} />
            <MetricCard
              label={t('Visibility', 'Visibilidade')}
              value={row.answers != null && analyzed ? percent((row.answers / analyzed) * 100) : '—'}
              definition={`${t('Share of the analyzed answers of the last 90 days that mention the brand.', 'Parcela das respostas analisadas dos últimos 90 dias que mencionam a marca.')}${analyzed ? ` ${number(row.answers ?? 0)} / ${number(analyzed)} ${t('answers', 'respostas')}.` : ''}`}
            />
            <MetricCard label={t('First seen', 'Vista pela primeira vez')} value={first ? day(first) : '—'} definition={t('First day with a mention in the analyzed answers. There is no earlier history.', 'Primeiro dia com menção nas respostas analisadas. Não há histórico anterior.')} />
          </>
        )}
        <MetricCard
          label={t('Sentiment', 'Sentimento')}
          value={
            research.loading && !research.data ? (
              <MetricValueSkeleton />
            ) : reading && score != null && !sentimentStatus ? (
              <>
                {number(score)}
                <SentimentBar distribution={reading.distribution} assessed={reading.assessed} locale={locale} t={t} shares link={demo ? undefined : link} band={bandAnswers} />
              </>
            ) : (
              '—'
            )
          }
          definition={sentimentStatus && !(research.loading && !research.data) ? `${sentimentIndexDefinition(t)} ${sentimentStatus}` : sentimentIndexDefinition(t)}
        />
      </MetricGrid>
      <TrendCard
        title={tracked ? t('Mentions per day', 'Menções por dia') : t('Mentions per day since it was discovered', 'Menções por dia desde a descoberta')}
        loading={tracked && summary.loading}
        empty={trend.length ? undefined : summary.error
          ? <EmptyState frame="bare" tone="error" title={t('The trend could not be loaded.', 'Não foi possível carregar a tendência.')} />
          : <EmptyState frame="bare" title={t('No mentions on the days analyzed.', 'Sem menções nos dias analisados.')} />}
        data={trend}
        series={[{ id: 'mentions', key: 'mentions', name: t('Mentions', 'Menções'), color: 'var(--chart-1)', primary: true }]}
        scale={{ domain: [0, peak], ticks: [0, peak] }}
        locale={locale}
        formatValue={number}
        formatTick={number}
        label={t('Mentions per day', 'Menções por dia')}
        onSelectDate={(date, event) => link({ ...answers, range: trendRange(date, 'day') }).onClick(event as unknown as MouseEvent<HTMLAnchorElement>)}
      />
      {/* The readings sit inside the card's inset, as the Brands screen's evidence card; the empty and error states are bare. */}
      <SectionCard title={t('Sentiment', 'Sentimento')} loading={research.loading} inset={!research.error && research.data && reading && reading.assessed > 0 ? 'padded' : undefined}>
        {research.error ? (
          <EmptyState frame="bare" tone="error" title={t('Could not load sentiment.', 'Não foi possível carregar o sentimento.')} />
        ) : research.data && reading && reading.assessed > 0 ? (
          demo ? (
            <>
              <p className="text-body text-muted-foreground">{t('The public demo shows only the sentiment aggregate. Private evaluations and answer excerpts are not exposed here.', 'A demo pública mostra somente o agregado de sentimento. Avaliações privadas e trechos das respostas não são expostos aqui.')}</p>
              <SentimentBar distribution={reading.distribution} assessed={reading.assessed} locale={locale} t={t} shares className="mt-3" />
            </>
          ) : (
            <BrandSentimentAnalysis key={row.name} evidenceBrand={row.name} report={research.data} project={project} onEvidence={onEvidence} label={label} link={link} answersOf={bandAnswers} />
          )
        ) : (
          <EmptyState frame="bare" title={sentimentStatus ?? t('No evaluated questions in this period. This is not a score of zero.', 'Sem perguntas avaliadas neste período. Isto não é nota zero.')} />
        )}
      </SectionCard>
      <SectionCard
        title={t('Responses that mention it', 'Respostas que mencionam a marca')}
        loading={recent.loading}
        action={<ViewAllAction link={link} to={{ ...answers, mention: 'mentioned' }}>{t('View all', 'Ver todas')}</ViewAllAction>}
      >
        {recent.data?.runs?.length ? (
          <ResponsesTable runs={recent.data.runs.slice(0, RECENT_RESPONSES)} link={link} t={t} locale={locale} />
        ) : recent.error ? (
          <EmptyState frame="bare" tone="error" title={t('The responses could not be loaded.', 'Não foi possível carregar as respostas.')} />
        ) : (
          <EmptyState frame="bare" title={t('No response of this period mentions the brand.', 'Nenhuma resposta deste período menciona a marca.')} />
        )}
      </SectionCard>
    </div>
  );
}
