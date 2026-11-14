'use client';
import { formatNumber } from '@/lib/number-format';
import { Hint } from '@/components/ui/tooltip';

import { useCallback, useEffect, useState } from 'react';
import { TrendCard } from '@/components/lastfind/presentation/trend-chart';
import { PageHeading } from '@/components/lastfind/presentation/page-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { CITATION_DEFINITION, EVIDENCE_DEFINITION, SourceEvidence, presenceBase, presencePercent, presenceReach, stabilityMetric } from './sources-presence';
import { ArrowUpRight, ExternalLink } from 'lucide-react';
import type { requestJson } from '@/lib/client';
import type { HistoryPage, SourceEntityDetail } from '@/lib/report-types';
import { ENGINE_LABELS } from '@/lib/engines';
import { relativeReportDate } from '@/lib/report-date';
import { Button, buttonVariants } from '@/components/ui/button';
import { EngineIcon } from '@/components/lastfind/identity-icons';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable, skeletonColumns } from '@/components/lastfind/presentation/data-table';
import { MetricCard, MetricGrid, MetricGridSkeleton } from '@/components/lastfind/presentation/metric-card';
import { BrandName, EmptyState, SiteFavicon, useCopy } from './shared';
import { ClassifierNotice, OwnerBadge, SourceTypeBadge } from './source-types-ui';
import { DrillLink, ViewAllAction, type Linker } from './drill-link';
import { UrlCell } from './url-cell';

type Translate = (en: string, pt: string) => string;
type Request = typeof requestJson;


/** Prompt responses, each row opening its response; the entity pages (source, brand) list their answers the same way. */
export function ResponsesTable({ runs, link, t, locale }: { runs: HistoryPage['runs']; link: Linker; t: Translate; locale: string }) {
  return (
    <DataTable
      singleLine
      rows={runs}
      rowKey={(run) => run.id}
      rowLink={(run) => link({ tab: 'responses', entity: null, run: run.id })}
      columns={[
        { key: 'prompt', header: t('Prompt', 'Prompt'), mobile: 'title', shrinkTo: '12rem', width: '28rem', hint: (run) => run.prompt_text, cell: (run) => run.prompt_text },
        {
          key: 'model',
          header: t('Model', 'Modelo'),
          label: t('Model', 'Modelo'),
          cell: (run) => (
            <span className="flex items-center gap-2">
              <EngineIcon engine={run.engine} />
              {ENGINE_LABELS[run.engine]}
            </span>
          ),
        },
        { key: 'date', header: t('Date', 'Data'), label: t('Date', 'Data'), cell: (run) => <time dateTime={run.created_at}>{relativeReportDate(run.created_at, locale)}</time> },
      ]}
    />
  );
}

/**
 * Domain and URL detail. `filters` is the same query string as the list the user
 * came from, so the period, models, topic and tag filters are preserved.
 */
export function SourceEntityPage({
  api,
  request,
  filters,
  kind,
  keyValue,
  refresh,
  locale,
  t,
  link,
  busy,
  classifying,
  actionError,
  onClassify,
  onConfigure,
  listed = () => true,
}: {
  api: string;
  request: Request;
  filters: string;
  kind: 'domain' | 'url';
  keyValue: string;
  refresh: number;
  locale: string;
  t: Translate;
  link: Linker;
  busy?: boolean;
  classifying?: boolean;
  actionError?: string;
  onClassify?: (kind: 'domain' | 'url') => void;
  onConfigure?: () => void;
  /** The header's Brands filter: whether it lists a monitored brand, by name. */
  listed?: (name: string) => boolean;
}) {
  const [detail, setDetail] = useState<SourceEntityDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [more, setMore] = useState<HistoryPage['runs']>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const path = useCallback(
    (extra?: string) => {
      const params = new URLSearchParams(filters);
      params.set('view', kind === 'domain' ? 'domain-detail' : 'url-detail');
      params.set('key', keyValue);
      if (extra) params.set('cursor', extra);
      return `${api}/reports?${params}`;
    },
    [api, filters, kind, keyValue],
  );
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setState('loading');
      setMore([]);
    });
    request<SourceEntityDetail>(path())
      .then((data) => {
        if (!active) return;
        setDetail(data);
        setCursor(data.history.nextCursor);
        setState('ready');
      })
      .catch((cause) => {
        if (active && cause?.name !== 'AbortError') setState('failed');
      });
    return () => {
      active = false;
    };
  }, [path, request, refresh, attempt]);
  const number = (value: number) => formatNumber(locale, value);
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (state === 'loading') return <SourceEntitySkeleton kind={kind} />;
  if (state === 'failed' || !detail)
    return (
      <EmptyState
        tone="error"
        title={t('Source details could not be loaded.', 'Não foi possível carregar os detalhes da fonte.')}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  const runs = [...detail.history.runs, ...more];
  const empty = detail.metrics.citing === 0;
  // This page reads the citations of the source, or its consultations (a source never cited).
  const consulted = detail.sourceKind === 'consulted';
  const responsesWith = (count: number) =>
    consulted
      ? t(`${number(count)} ${count === 1 ? 'response consulted' : 'responses consulted'} it`, `${number(count)} ${count === 1 ? 'resposta a consultou' : 'respostas a consultaram'}`)
      : t(`${number(count)} ${count === 1 ? 'response cites' : 'responses cite'} it`, `${number(count)} ${count === 1 ? 'resposta a cita' : 'respostas a citam'}`);
  // A presence figure with the responses behind it in its balloon.
  const presenceCell = (row: { presence: number }, responses: number) => (
    <Hint text={responsesWith(responses)}>
      <button type="button" className="text-right" aria-label={`${presencePercent(row.presence, locale)}. ${responsesWith(responses)}`}>{presencePercent(row.presence, locale)}</button>
    </Hint>
  );
  const trend = detail.daily.filter((row) => row.total > 0);
  // Drill down: a cited domain's model and brand rows open the answers that cite it (Responses filters by a cited domain only).
  const cites = kind === 'domain' && !consulted && detail.domain ? detail.domain : null;
  const title = kind === 'domain' ? detail.domain : detail.title || detail.key;
  const heading = (
    <span className="inline-flex max-w-full items-center gap-2">
      <SiteFavicon domain={detail.domain || keyValue} name={detail.domain || keyValue} />
      <span className="min-w-0 break-words">{title || keyValue}</span>
    </span>
  );
  // No answer in the period and filters lists it (an unknown address, or one from another period): not found, never a page of zeros.
  if (empty)
    return (
      <div className="st-entity">
        <PageHeading title={heading} />
        <EmptyState
          title={kind === 'domain' ? t('Domain not found', 'Domínio não encontrado') : t('Page not found', 'Página não encontrada')}
          description={consulted
            ? t('No answer consulted it in the selected period and filters.', 'Nenhuma resposta a consultou no período e nos filtros selecionados.')
            : t('No answer cited it in the selected period and filters.', 'Nenhuma resposta a citou no período e nos filtros selecionados.')}
          action={
            <DrillLink link={link} to={{ tab: 'sources', entity: null }} plain className={buttonVariants({ variant: 'outline' })}>
              {t('Back to Sources', 'Voltar para Fontes')}
            </DrillLink>
          }
        />
      </div>
    );
  const stability = stabilityMetric(detail.presence, t, locale);
  return (
    <div className="st-entity">
      <PageHeading
        title={heading}
        description={
          <span className="st-entity-meta">
            {kind === 'url' && (
              <a className="st-entity-url" href={detail.key} target="_blank" rel="noopener noreferrer" aria-label={`${t('Open page', 'Abrir página')}: ${detail.key}`}>
                {detail.key}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
            <SourceTypeBadge type={detail.sourceType} t={t} />
            {kind === 'url' && (
              <DrillLink link={link} to={{ tab: 'sources', entity: { kind: 'domain', key: detail.domain } }}>
                <SourceTypeBadge type={detail.domainType} t={t} />
                <span className="sr-only"> {detail.domain}</span>
              </DrillLink>
            )}
            {kind === 'url' && detail.domain && (
              <DrillLink link={link} to={{ tab: 'sources', entity: { kind: 'domain', key: detail.domain } }} className="st-entity-domain">
                {detail.domain}
              </DrillLink>
            )}
            <OwnerBadge owner={detail.ownership} t={t} />
          </span>
        }
        actions={kind === 'domain' && (
          <DrillLink link={link} to={{ tab: 'sources', entity: null, group: 'url' }} plain className={buttonVariants({ variant: 'outline' })}>
            {t('View all content', 'Ver todos os conteúdos')}
            <ArrowUpRight size={14} aria-hidden="true" />
          </DrillLink>
        )}
      />
      {detail.sourceType === 'unclassified' && (
        <ClassifierNotice
          classifier={detail.classifier}
          unclassified={1}
          classifying={classifying || busy}
          onClassify={onClassify ? () => onClassify(kind) : undefined}
          onConfigure={onConfigure}
          t={t}
          noun={kind === 'domain' ? t('domains', 'domínios') : t('pages', 'páginas')}
        />
      )}
      {actionError && (
        <p role="alert" className="st-error">
          {actionError}
        </p>
      )}
      <MetricGrid>
        <MetricCard
          label={t('Presence', 'Presença')}
          value={detail.presence ? presencePercent(detail.presence.presence, locale) : '—'}
          definition={`${consulted
            ? t('Presence in consultations: each question × model counts once, weighted by the fraction of its collections that consulted the source.', 'Presença nas consultas: cada pergunta × modelo conta uma vez, ponderada pela fração das coletas que consultaram a fonte.')
            : t('Presence in citations: each question × model counts once, weighted by the fraction of its collections whose answer cited the source.', 'Presença nas citações: cada pergunta × modelo conta uma vez, ponderada pela fração das coletas cuja resposta citou a fonte.')} ${detail.presence ? presenceReach(detail.presence, detail.totals.slots, t, locale) : ''} ${responsesWith(detail.metrics.citing)}. ${detail.sourceKind === 'consulted'
            ? detail.totals.slots > 0
              ? t(`Consulted: the AI read the URL while preparing the answer. Base includes only ${number(detail.totals.models)} ${detail.totals.models === 1 ? 'model that returns' : 'models that return'} consulted URLs.`, `Consultada: a IA leu a URL ao montar a resposta. A base inclui só ${number(detail.totals.models)} ${detail.totals.models === 1 ? 'modelo que devolve' : 'modelos que devolvem'} URLs consultadas.`)
              : t('Consulted: the AI read the URL while preparing the answer.', 'Consultada: a IA leu a URL ao montar a resposta.')
            : t(...CITATION_DEFINITION)}`}
          description={detail.totals.slots ? presenceBase(detail.totals.slots, t, locale) : t('No eligible collections in this period.', 'Sem coletas elegíveis neste período.')}
        />
        <MetricCard label={t('Reach', 'Alcance')} value={detail.totals.questions ? `${number(detail.presence?.questions ?? 0)} / ${number(detail.totals.questions)}` : '—'} description={consulted ? t('Distinct questions whose answers consulted the source', 'Perguntas distintas cujas respostas consultaram a fonte') : t('Distinct questions whose answers cited the source', 'Perguntas distintas cujas respostas citaram a fonte')} />
        <MetricCard label={t('Stability', 'Estabilidade')} value={stability.value} description={stability.description} definition={stability.definition} />
      </MetricGrid>
        <>
          <TrendCard
            title={t('Presence over time', 'Presença ao longo do tempo')}
            data={trend}
            series={[{ id: 'presence', key: 'presence', name: t('Presence', 'Presença'), color: 'var(--chart-1)', primary: true }]}
            scale={{ domain: [0, 100], ticks: [0, 25, 50, 75, 100] }}
            locale={locale}
            formatValue={(value) => `${percent.format(value)}%`}
            formatTick={(value) => `${value}%`}
          />
          <div className="st-columns">
            {/* Two cards side by side: each table fits its card (minWidth 0) and grows to its rows, never a scroll box inside. */}
            <SectionCard title={t('By AI model', 'Por modelo de IA')}>
              <DataTable
                singleLine
                minWidth={0}
                rows={detail.platforms}
                rowKey={(row) => row.engine}
                columns={[
                  {
                    key: 'model',
                    header: t('Model', 'Modelo'),
                    mobile: 'title',
                    sortValue: (row) => ENGINE_LABELS[row.engine],
                    cell: (row) => (
                      <DrillLink link={link} to={{ tab: 'responses', entity: null, engine: row.engine, cites }} className="flex min-w-0 items-center gap-2">
                        <EngineIcon engine={row.engine} />
                        <span className="min-w-0 truncate">{ENGINE_LABELS[row.engine]}</span>
                      </DrillLink>
                    ),
                  },
                  { key: 'presence', header: t('Presence', 'Presença'), label: t('Presence', 'Presença'), align: 'end', width: '7rem', sortValue: (row) => row.presence, cell: (row) => presenceCell(row, row.citing) },
                  { key: 'questions', header: t('Reach', 'Alcance'), label: t('Questions', 'Perguntas'), align: 'end', width: '7rem', sortValue: (row) => row.questions, cell: (row) => number(row.questions) },
                ]}
              />
            </SectionCard>
            <SectionCard title={t('Brands mentioned together', 'Marcas mencionadas junto')}>
              {detail.brands.some((brand) => listed(brand.name)) ? (
                <DataTable
                  singleLine
                  minWidth={0}
                  rows={detail.brands.filter((brand) => listed(brand.name))}
                  rowKey={(brand) => brand.name}
                  rowLink={(brand) => link({ tab: 'responses', entity: null, run: null, brand: brand.name, mention: 'mentioned', cites })}
                  columns={[
                    { key: 'brand', header: t('Brand', 'Marca'), mobile: 'title', sortValue: (brand) => brand.name, cell: (brand) => <BrandName name={brand.name} domain={brand.domain} own={false} /> },
                    { key: 'responses', header: t('Responses', 'Respostas'), label: t('Responses', 'Respostas'), align: 'end', width: '7rem', sortValue: (brand) => brand.responses, cell: (brand) => number(brand.responses) },
                  ]}
                />
              ) : (
                <EmptyState frame="inline" title={detail.brands.length ? t('The Brands filter in the header hides the brands mentioned here.', 'O filtro Marcas no topo oculta as marcas mencionadas aqui.') : detail.origin === 'semantic-branding' ? t('Brand mentions from prompts are shown here. Read Semantic Branding scores and evidence in its report.', 'As menções de marcas nos prompts aparecem aqui. Leia notas e evidências do Semantic Branding no relatório.') : t('No tracked brand is mentioned in these responses.', 'Nenhuma marca monitorada é mencionada nestas respostas.')} />
              )}
            </SectionCard>
          </div>
          <SectionCard title={consulted ? t('Prompts whose answers consulted it', 'Prompts cujas respostas a consultaram') : t('Prompts whose answers cite it', 'Prompts cujas respostas a citam')}
            info={detail.origin !== 'prompts' ? t('Prompt evidence is listed below. Read Semantic Branding answers in its report.', 'As evidências dos prompts estão abaixo. Leia as respostas do Semantic Branding no relatório.') : undefined}
            action={detail.origin !== 'prompts' ? <ViewAllAction link={link} to={{ tab: 'semantic-branding', entity: null }}>{t('Semantic Branding answers', 'Respostas do Semantic Branding')}</ViewAllAction> : undefined}>
            <DataTable
              singleLine
              rows={detail.prompts}
              rowKey={(row) => row.prompt}
              rowLink={(row) => link({ tab: 'prompts', entity: null, run: null, prompt: row.prompt })}
              columns={[
                { key: 'prompt', header: t('Prompt', 'Prompt'), mobile: 'title', shrinkTo: '12rem', width: '28rem', sortValue: (row) => row.text, cell: (row) => row.text },
                { key: 'topic', header: t('Topic', 'Tópico'), label: t('Topic', 'Tópico'), maxWidth: '20rem', sortValue: (row) => row.topic, cell: (row) => row.topic || '—' },
                { key: 'presence', header: t('Presence', 'Presença'), label: t('Presence', 'Presença'), align: 'end', sortValue: (row) => row.presence, cell: (row) => presenceCell(row, row.responses) },
              ]}
            />
          </SectionCard>
          {kind === 'domain' && (
            <SectionCard
              title={t('Source URLs', 'URLs da fonte')}
              info={t('Content types come from the same evaluator as site types.', 'Os tipos de conteúdo vêm do mesmo avaliador dos tipos de site.')}
            >
              <DataTable
                singleLine
                rows={detail.urls}
                rowKey={(row) => row.url}
                columns={[
                  { key: 'url', header: 'URL', mobile: 'title', shrinkTo: '12rem', width: '28rem', hint: (row) => row.url, sortValue: (row) => row.title, cell: (row) => <UrlCell link={link} url={row.url} title={row.title} t={t} /> },
                  { key: 'evidence', header: t('Evidence', 'Evidência'), info: t(...EVIDENCE_DEFINITION), label: t('Evidence', 'Evidência'), sortValue: (row) => (row.cited ? 2 : 0) + (row.consulted ? 1 : 0), cell: (row) => <SourceEvidence cited={row.cited} consulted={row.consulted} t={t} /> },
                  { key: 'type', header: t('Content type', 'Tipo de conteúdo'), label: t('Content type', 'Tipo de conteúdo'), sortValue: (row) => row.pageType, cell: (row) => <SourceTypeBadge type={row.pageType} t={t} /> },
                  { key: 'presence', header: t('Presence', 'Presença'), label: t('Presence', 'Presença'), align: 'end', sortValue: (row) => row.presence, cell: (row) => presenceCell(row, row.responses) },
                ]}
              />
            </SectionCard>
          )}
          <SectionCard title={t('Prompt responses with this source', 'Respostas de prompts com esta fonte')}>
            <ResponsesTable runs={runs} link={link} t={t} locale={locale} />
            {cursor && (
              <div className="st-more">
                <Button
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => {
                    setLoadingMore(true);
                    request<SourceEntityDetail>(path(cursor))
                      .then((next) => {
                        setMore((current) => [...current, ...next.history.runs]);
                        setCursor(next.history.nextCursor);
                      })
                      .catch(() => setState('failed'))
                      .finally(() => setLoadingMore(false));
                  }}
                >
                  {loadingMore ? t('Loading…', 'Carregando…') : t('Show more responses', 'Mostrar mais respostas')}
                </Button>
              </div>
            )}
          </SectionCard>
        </>
    </div>
  );
}

/** The domain or URL page while it loads: its heading, metric cards, trend, the two tables and the lists, as they arrive. */
export function SourceEntitySkeleton({ kind = 'domain' }: { kind?: 'domain' | 'url' }) {
  const l = useCopy();
  const label = l('Loading source details…', 'Carregando detalhes da fonte…');
  return (
    <div className="st-entity" aria-busy="true" aria-label={label} data-screen-skeleton="">
      <PageHeading title={<Skeleton inline className="h-lh w-64 max-w-full align-top" />} description={<Skeleton inline className="h-lh w-40 max-w-full align-top" />} />
      <MetricGridSkeleton count={3} label={label} description />
      <TrendCard loading title={l('Presence over time', 'Presença ao longo do tempo')} data={[]} series={[]} scale={{ domain: [0, 100], ticks: [] }} locale="en" formatValue={String} formatTick={String} />
      <div className="st-columns">
        <SectionCard title={l('By AI model', 'Por modelo de IA')}><DataTable singleLine minWidth={0} loading={4} rows={[]} rowKey={String} columns={skeletonColumns(3)} /></SectionCard>
        <SectionCard title={l('Brands mentioned together', 'Marcas mencionadas junto')}><DataTable singleLine minWidth={0} loading={4} rows={[]} rowKey={String} columns={skeletonColumns(2)} /></SectionCard>
      </div>
      <SectionCard title={l('Prompts whose answers cite it', 'Prompts cujas respostas a citam')}><DataTable singleLine loading={5} rows={[]} rowKey={String} columns={skeletonColumns(3)} /></SectionCard>
      {kind === 'domain' && <SectionCard title={l('Source URLs', 'URLs da fonte')}><DataTable singleLine loading={5} rows={[]} rowKey={String} columns={skeletonColumns(4)} /></SectionCard>}
    </div>
  );
}
