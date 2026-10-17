'use client';

import { useCallback, useEffect, useState } from 'react';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, ArrowUpRight, ExternalLink } from 'lucide-react';
import type { requestJson } from '@/lib/client';
import type { HistoryPage, SourceEntityDetail } from '@/lib/report-types';
import { ENGINE_LABELS } from '@/lib/engines';
import { relativeReportDate } from '@/lib/report-date';
import { Button, buttonVariants } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EngineIcon } from '@/components/lastfind/identity-icons';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { MetricCard, MetricGrid } from '@/components/lastfind/presentation/metric-card';
import { AnalyticsSkeleton, SiteFavicon } from './shared';
import { ClassifierNotice, OwnerBadge, SourceTypeBadge } from './source-types-ui';
import { DrillLink, type Linker } from './drill-link';

type Translate = (en: string, pt: string) => string;
type Request = typeof requestJson;

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
}) {
  const [detail, setDetail] = useState<SourceEntityDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [more, setMore] = useState<HistoryPage['runs']>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [metric, setMetric] = useState<'citing' | 'rate'>('citing');
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
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const day = (value: string) => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  const back = (
    <DrillLink link={link} to={{ tab: 'sources', entity: null, group: kind }} className="st-back">
      <ArrowLeft size={14} aria-hidden="true" />
      {kind === 'domain' ? t('All domains', 'Todos os domínios') : t('All content', 'Todos os conteúdos')}
    </DrillLink>
  );
  if (state === 'loading')
    return (
      <div className="st-entity">
        {back}
        <AnalyticsSkeleton label={t('Loading source details…', 'Carregando detalhes da fonte…')} rows={6} />
      </div>
    );
  if (state === 'failed' || !detail)
    return (
      <div className="st-entity">
        {back}
        <p className="live-card" role="alert">
          {t('Source details could not be loaded.', 'Não foi possível carregar os detalhes da fonte.')}{' '}
          <button type="button" className="st-link" onClick={() => setAttempt((value) => value + 1)}>
            {t('Retry', 'Tentar novamente')}
          </button>
        </p>
      </div>
    );
  const runs = [...detail.history.runs, ...more];
  const empty = detail.metrics.citing === 0;
  const trend = detail.daily.filter((row) => row.total > 0);
  const title = kind === 'domain' ? detail.domain : detail.title || detail.key;
  return (
    <div className="st-entity">
      {back}
      <header className="st-entity-head">
        <SiteFavicon domain={detail.domain || keyValue} name={detail.domain || keyValue} />
        <div className="min-w-0">
          <h2 className="st-entity-title">{title}</h2>
          {kind === 'url' && (
            <p className="st-entity-url">
              <a href={detail.key} target="_blank" rel="noopener noreferrer" aria-label={`${t('Open page', 'Abrir página')}: ${detail.key}`}>
                {detail.key}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            </p>
          )}
          <p className="st-entity-badges">
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
          </p>
        </div>
        {kind === 'domain' && (
          <DrillLink link={link} to={{ tab: 'sources', entity: null, group: 'url' }} plain className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('View all content', 'Ver todos os conteúdos')}
            <ArrowUpRight size={13} />
          </DrillLink>
        )}
      </header>
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
        {[
          [t('Citations', 'Citações'), number.format(detail.metrics.citing), t('Responses that cite this source', 'Respostas que citam esta fonte')],
          [t('Citation rate', 'Taxa de citação'), detail.metrics.total ? `${percent.format(detail.metrics.rate)}%` : '—', `${t('of', 'de')} ${number.format(detail.metrics.total)} ${t('responses in this period', 'respostas neste período')}`],
          kind === 'domain'
            ? [t('Pages cited', 'Páginas citadas'), number.format(detail.metrics.pages), t('Distinct URLs of this domain', 'URLs distintas deste domínio')]
            : [t('AI models', 'Modelos de IA'), number.format(detail.platforms.length), t('Models that cited this page', 'Modelos que citaram esta página')],
        ].map(([label, value, help]) => (
          <MetricCard key={label} label={label} value={value} description={help} />
        ))}
      </MetricGrid>
      {empty ? (
        <p className="live-card">{t('No responses cite this source in the selected period.', 'Nenhuma resposta cita esta fonte no período selecionado.')}</p>
      ) : (
        <>
          <SectionCard
            title={t('Citations over time', 'Citações ao longo do tempo')}
            action={
              <ToggleGroup multiple={false} value={[metric]} onValueChange={(value) => { if (value[0]) setMetric(value[0] as typeof metric); }} size="sm" variant="outline" spacing={0} aria-label={t('Chart metric', 'Métrica do gráfico')}>
                <ToggleGroupItem value="citing">{t('Citations', 'Citações')}</ToggleGroupItem>
                <ToggleGroupItem value="rate">{t('Share of responses', 'Participação nas respostas')}</ToggleGroupItem>
              </ToggleGroup>
            }
          >
            <figure className="st-trend" aria-label={t('Citations over time', 'Citações ao longo do tempo')}>
              <ResponsiveContainer width="100%" height={220} minWidth={0} initialDimension={{ width: 500, height: 220 }}>
                <ComposedChart data={trend} margin={{ top: 12, right: 12, bottom: 4, left: -12 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={32} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickFormatter={day} />
                  <YAxis axisLine={false} tickLine={false} allowDecimals={false} domain={metric === 'rate' ? [0, 100] : [0, 'auto']} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickFormatter={(value) => (metric === 'rate' ? `${value}%` : String(value))} />
                  <ChartTooltip
                    labelFormatter={(value) => day(String(value))}
                    contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 'var(--text-body)' }}
                    formatter={(value) => [metric === 'rate' ? `${percent.format(Number(value))}%` : number.format(Number(value)), metric === 'rate' ? t('Share of responses', 'Participação nas respostas') : t('Citations', 'Citações')]}
                  />
                  <Line type="monotone" dataKey={metric} stroke="var(--chart-1)" strokeWidth={2.5} dot={trend.length <= 2} isAnimationActive={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </figure>
          </SectionCard>
          <div className="st-columns">
            <SectionCard title={t('By AI model', 'Por modelo de IA')}>
              <DataTable
                rows={detail.platforms}
                rowKey={(row) => row.engine}
                columns={[
                  {
                    key: 'model',
                    header: t('Model', 'Modelo'),
                    mobile: 'title',
                    cell: (row) => (
                      <DrillLink link={link} to={{ tab: 'responses', entity: null, engine: row.engine }} className="flex items-center gap-2">
                        <EngineIcon engine={row.engine} />
                        {ENGINE_LABELS[row.engine]}
                      </DrillLink>
                    ),
                  },
                  { key: 'citations', header: t('Citations', 'Citações'), label: t('Citations', 'Citações'), align: 'end', cell: (row) => number.format(row.citing) },
                  { key: 'rate', header: t('Rate', 'Taxa'), label: t('Rate', 'Taxa'), align: 'end', cell: (row) => (row.total ? `${percent.format(row.rate)}%` : '—') },
                ]}
              />
            </SectionCard>
            <SectionCard title={t('Brands mentioned together', 'Marcas mencionadas junto')}>
              {detail.brands.length ? (
                <DataTable
                  rows={detail.brands}
                  rowKey={(brand) => brand.name}
                  columns={[
                    {
                      key: 'brand',
                      header: t('Brand', 'Marca'),
                      mobile: 'title',
                      cell: (brand) => (
                        <DrillLink link={link} to={{ tab: 'responses', entity: null, run: null, brand: brand.name, mention: 'mentioned' }} className="flex items-center gap-2">
                          {brand.domain && <SiteFavicon domain={brand.domain} name={brand.name} />}
                          {brand.name}
                        </DrillLink>
                      ),
                    },
                    { key: 'responses', header: t('Responses', 'Respostas'), label: t('Responses', 'Respostas'), align: 'end', cell: (brand) => number.format(brand.responses) },
                  ]}
                />
              ) : (
                <p className="st-empty">{t('No tracked brand is mentioned in these responses.', 'Nenhuma marca monitorada é mencionada nestas respostas.')}</p>
              )}
            </SectionCard>
          </div>
          <SectionCard title={t('Prompts that cite it', 'Prompts que a citam')}>
            <DataTable
              rows={detail.prompts}
              rowKey={(row) => row.prompt}
              columns={[
                {
                  key: 'prompt',
                  header: t('Prompt', 'Prompt'),
                  mobile: 'title',
                  cell: (row) => (
                    <DrillLink link={link} to={{ tab: 'prompts', entity: null, run: null, prompt: row.prompt }} className="block max-w-[420px] whitespace-normal">
                      {row.text}
                    </DrillLink>
                  ),
                },
                { key: 'topic', header: t('Topic', 'Tópico'), label: t('Topic', 'Tópico'), cell: (row) => row.topic || '—' },
                { key: 'responses', header: t('Responses', 'Respostas'), label: t('Responses', 'Respostas'), align: 'end', cell: (row) => number.format(row.responses) },
              ]}
            />
          </SectionCard>
          {kind === 'domain' && (
            <SectionCard
              title={t('Most cited URLs', 'URLs mais citadas')}
              description={t('Content types come from the same evaluator as site types.', 'Os tipos de conteúdo vêm do mesmo avaliador dos tipos de site.')}
            >
              <DataTable
                rows={detail.urls}
                rowKey={(row) => row.url}
                columns={[
                  {
                    key: 'url',
                    header: 'URL',
                    mobile: 'title',
                    cell: (row) => (
                      <span className="block max-w-[420px] whitespace-normal">
                        <DrillLink link={link} to={{ tab: 'sources', entity: { kind: 'url', key: row.url } }}>
                          {row.title}
                        </DrillLink>
                        <small className="st-url">{row.url}</small>
                      </span>
                    ),
                  },
                  { key: 'type', header: t('Content type', 'Tipo de conteúdo'), label: t('Content type', 'Tipo de conteúdo'), cell: (row) => <SourceTypeBadge type={row.pageType} t={t} /> },
                  { key: 'citations', header: t('Citations', 'Citações'), label: t('Citations', 'Citações'), align: 'end', cell: (row) => number.format(row.responses) },
                ]}
              />
            </SectionCard>
          )}
          <SectionCard title={kind === 'url' ? t('Prompts and responses that cite this page', 'Prompts e respostas que citam esta página') : t('Responses that cite it', 'Respostas que a citam')}>
            <DataTable
              rows={runs}
              rowKey={(run) => run.id}
              columns={[
                { key: 'prompt', header: t('Prompt', 'Prompt'), mobile: 'title', cell: (run) => <span className="block max-w-[420px] whitespace-normal">{run.prompt_text}</span> },
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
                {
                  key: 'open',
                  header: <span className="sr-only">{t('Open response', 'Abrir resposta')}</span>,
                  cell: (run) => (
                    <DrillLink link={link} to={{ tab: 'responses', entity: null, run: run.id }} plain className={buttonVariants({ variant: 'ghost', size: 'sm' })} aria-label={`${t('Open response', 'Abrir resposta')}: ${run.prompt_text}`}>
                      {t('Open', 'Abrir')}
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </DrillLink>
                  ),
                },
              ]}
            />
            {cursor && (
              <div className="st-more">
                <Button
                  variant="outline"
                  size="sm"
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
      )}
    </div>
  );
}
