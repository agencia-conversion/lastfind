'use client';

import { useCallback, useEffect, useState } from 'react';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, ArrowUpRight, ExternalLink } from 'lucide-react';
import type { requestJson } from '@/lib/client';
import type { HistoryPage, SourceEntityDetail } from '@/lib/report-types';
import { ENGINE_LABELS } from '@/lib/engines';
import { relativeReportDate } from '@/lib/report-date';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EngineIcon } from '@/components/lastfind/identity-icons';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { AnalyticsSkeleton, SiteFavicon } from './shared';
import { ClassifierNotice, SourceTypeBadge } from './source-types-ui';
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
    <DrillLink link={link} to={{ tab: 'sources', entity: null }} className="st-back">
      <ArrowLeft size={14} aria-hidden="true" />
      {t('All sources', 'Todas as fontes')}
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
  const own = detail.ownership === 'own';
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
            {own && <Badge variant="secondary">{t('You', 'Você')}</Badge>}
            {detail.ownership === 'competitor' && <Badge variant="secondary">{t('Competitor', 'Concorrente')}</Badge>}
          </p>
        </div>
        {kind === 'domain' && (
          <DrillLink link={link} to={{ tab: 'sources', entity: null, group: 'url' }} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('View all URLs', 'Ver todas as URLs')}
            <ArrowUpRight size={13} />
          </DrillLink>
        )}
      </header>
      {detail.sourceType === 'unclassified' && detail.ownership === 'third-party' && (
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
      <div className="metric-strip st-metrics">
        {[
          [t('Citations', 'Citações'), number.format(detail.metrics.citing), t('Responses that cite this source', 'Respostas que citam esta fonte')],
          [t('Citation rate', 'Taxa de citação'), detail.metrics.total ? `${percent.format(detail.metrics.rate)}%` : '—', `${t('of', 'de')} ${number.format(detail.metrics.total)} ${t('responses in this period', 'respostas neste período')}`],
          kind === 'domain'
            ? [t('Pages cited', 'Páginas citadas'), number.format(detail.metrics.pages), t('Distinct URLs of this domain', 'URLs distintas deste domínio')]
            : [t('AI models', 'Modelos de IA'), number.format(detail.platforms.length), t('Models that cited this page', 'Modelos que citaram esta página')],
        ].map(([label, value, help]) => (
          <article className="metric-summary" key={label}>
            <div className="metric-label">
              <span>{label}</span>
            </div>
            <div className="metric-number">{value}</div>
            <p>{help}</p>
          </article>
        ))}
      </div>
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
                    contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}
                    formatter={(value) => [metric === 'rate' ? `${percent.format(Number(value))}%` : number.format(Number(value)), metric === 'rate' ? t('Share of responses', 'Participação nas respostas') : t('Citations', 'Citações')]}
                  />
                  <Line type="monotone" dataKey={metric} stroke="var(--chart-1)" strokeWidth={2.5} dot={trend.length <= 2} isAnimationActive={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </figure>
          </SectionCard>
          <div className="st-columns">
            <SectionCard title={t('By AI model', 'Por modelo de IA')}>
              <div className="live-table-scroll">
                <Table className="analytics-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Model', 'Modelo')}</TableHead>
                      <TableHead className="text-right">{t('Citations', 'Citações')}</TableHead>
                      <TableHead className="text-right">{t('Rate', 'Taxa')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.platforms.map((row) => (
                      <TableRow key={row.engine}>
                        <TableCell>
                          <DrillLink link={link} to={{ tab: 'responses', entity: null, engine: row.engine }} className="flex items-center gap-2">
                            <EngineIcon engine={row.engine} />
                            {ENGINE_LABELS[row.engine]}
                          </DrillLink>
                        </TableCell>
                        <TableCell className="text-right">{number.format(row.citing)}</TableCell>
                        <TableCell className="text-right">{row.total ? `${percent.format(row.rate)}%` : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
            <SectionCard title={t('Brands mentioned together', 'Marcas mencionadas junto')}>
              {detail.brands.length ? (
                <div className="live-table-scroll">
                  <Table className="analytics-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('Brand', 'Marca')}</TableHead>
                        <TableHead className="text-right">{t('Responses', 'Respostas')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.brands.map((brand) => (
                        <TableRow key={brand.name}>
                          <TableCell>
                            <DrillLink link={link} to={{ tab: 'responses', entity: null, run: null, brand: brand.name, mention: 'mentioned' }} className="flex items-center gap-2">
                              {brand.domain && <SiteFavicon domain={brand.domain} name={brand.name} />}
                              {brand.name}
                            </DrillLink>
                          </TableCell>
                          <TableCell className="text-right">{number.format(brand.responses)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="st-empty">{t('No tracked brand is mentioned in these responses.', 'Nenhuma marca monitorada é mencionada nestas respostas.')}</p>
              )}
            </SectionCard>
          </div>
          <SectionCard title={t('Prompts that cite it', 'Prompts que a citam')}>
            <div className="live-table-scroll">
              <Table className="analytics-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Prompt', 'Prompt')}</TableHead>
                    <TableHead>{t('Topic', 'Tópico')}</TableHead>
                    <TableHead className="text-right">{t('Responses', 'Respostas')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.prompts.map((row) => (
                    <TableRow key={row.prompt}>
                      <TableCell className="max-w-[420px] whitespace-normal">
                        <DrillLink link={link} to={{ tab: 'prompts', entity: null, run: null, prompt: row.prompt }} className="font-medium">
                          {row.text}
                        </DrillLink>
                      </TableCell>
                      <TableCell>{row.topic || '—'}</TableCell>
                      <TableCell className="text-right">{number.format(row.responses)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
          {kind === 'domain' && (
            <SectionCard
              title={t('Most cited URLs', 'URLs mais citadas')}
              description={t('Page types come from the same evaluator as source types.', 'Os tipos de página vêm do mesmo avaliador dos tipos de fonte.')}
            >
              <div className="live-table-scroll">
                <Table className="analytics-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>URL</TableHead>
                      <TableHead>{t('Page type', 'Tipo de página')}</TableHead>
                      <TableHead className="text-right">{t('Citations', 'Citações')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.urls.map((row) => (
                      <TableRow key={row.url}>
                        <TableCell className="max-w-[420px] whitespace-normal">
                          <DrillLink link={link} to={{ tab: 'sources', entity: { kind: 'url', key: row.url } }} className="font-medium">
                            {row.title}
                          </DrillLink>
                          <small className="st-url">{row.url}</small>
                        </TableCell>
                        <TableCell>
                          <SourceTypeBadge type={row.pageType} t={t} />
                        </TableCell>
                        <TableCell className="text-right">{number.format(row.responses)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          )}
          <SectionCard title={kind === 'url' ? t('Prompts and responses that cite this page', 'Prompts e respostas que citam esta página') : t('Responses that cite it', 'Respostas que a citam')}>
            <div className="live-table-scroll">
              <Table className="analytics-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Prompt', 'Prompt')}</TableHead>
                    <TableHead>{t('Model', 'Modelo')}</TableHead>
                    <TableHead>{t('Date', 'Data')}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t('Open response', 'Abrir resposta')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="max-w-[420px] whitespace-normal">{run.prompt_text}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <EngineIcon engine={run.engine} />
                          {ENGINE_LABELS[run.engine]}
                        </span>
                      </TableCell>
                      <TableCell>
                        <time dateTime={run.created_at}>{relativeReportDate(run.created_at, locale)}</time>
                      </TableCell>
                      <TableCell>
                        <DrillLink link={link} to={{ tab: 'responses', entity: null, run: run.id }} className={buttonVariants({ variant: 'ghost', size: 'sm' })} aria-label={`${t('Open response', 'Abrir resposta')}: ${run.prompt_text}`}>
                          {t('Open', 'Abrir')}
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </DrillLink>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
