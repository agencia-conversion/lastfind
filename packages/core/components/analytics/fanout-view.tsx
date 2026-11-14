'use client';

import { useEffect, useImperativeHandle, useMemo, useState, type ReactNode, type Ref } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { requestJson } from '@/lib/client';
import { ENGINES, ENGINE_LABELS, type Engine } from '@/lib/engines';
import { addedWords, normalizeQuery, stem, termKey } from '@/lib/fanout';
import { orderSeriesByTotal } from '@/lib/chart-series';
import { numberLocale } from '@/lib/number-format';
import type {
  FanoutDetail,
  FanoutIntentRow,
  FanoutQueryRow,
  FanoutReport,
} from '@/lib/report-types';
import { ENTITY_LABELS } from '@/lib/fanout-intents';
import type { FanoutNavigation } from '@/lib/fanout-navigation';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CompactEngineIcons,
  EngineIcon,
} from '@/components/lastfind/identity-icons';
import {
  MetricCard,
  MetricGrid,
} from '@/components/lastfind/presentation/metric-card';
import {
  ColumnPicker,
  DataTable,
  DataTableScreen,
  DataTableToolbar,
  skeletonColumns,
  sortRows,
  type DataSort,
  type DataColumn,
} from '@/components/lastfind/presentation/data-table';
import { TrendCard } from '@/components/lastfind/presentation/trend-chart';
import { useTableColumns, visibleColumns } from '@/hooks/use-table-columns';
import './fanout-view.css';
import { Note } from '@/components/lastfind/presentation/note';
import { InfoHint } from '@/components/lastfind/presentation/info-hint';
import { MetricGridSkeleton } from '@/components/lastfind/presentation/metric-card';
import { PageHeading } from '@/components/lastfind/presentation/page-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { BarList } from '@/components/lastfind/presentation/bar-list';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import {
  CompactPagination,
  EmptyState,
  FilterSelect,
  SearchField,
  SiteFavicon,
  useCollectionPage,
  useComparison,
  useCopy,
} from './shared';
import { DrillLink, ViewAllAction, type Linker } from './drill-link';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Queries opens with six data columns (shell.md section 8): Prompts and AIs wait in the Columns menu until the account shows them.
const FANOUT_HIDDEN_COLUMNS = ['prompts', 'engines'];

type Translate = (en: string, pt: string) => string;
const engineColor = (engine: Engine) =>
  `var(--chart-${ENGINES.indexOf(engine) + 1})`;
const csvCell = (value: string | number) => {
  const text = String(value);
  let start = 0;
  while (
    start < text.length &&
    (text.charCodeAt(start) <= 32 || /\s/.test(text[start]))
  )
    start++;
  const safe =
    /^[=+@-]/.test(text.slice(start)) || text.charCodeAt(0) < 32
      ? `'${text}`
      : text;
  return `"${safe.replaceAll('"', '""')}"`;
};

// The sortable columns of the queries table, ordered over the whole loaded list before it is paged.
const QUERY_SORT = {
  query: (row: FanoutQueryRow) => row.text,
  topic: (row: FanoutQueryRow) => row.topic,
  engines: (row: FanoutQueryRow) => row.engines.length,
  occurrences: (row: FanoutQueryRow) => row.occurrences,
  prompts: (row: FanoutQueryRow) => row.prompts,
  mentioned: (row: FanoutQueryRow) => row.mentionedRate,
  cited: (row: FanoutQueryRow) => row.citedRate,
};
const QUERY_SORT_COLUMNS = Object.entries(QUERY_SORT).map(
  ([key, sortValue]) => ({ key, sortValue }),
);

export function FanoutView({
  navigation,
  onNavigation,
  ref,
  report,
  loading,
  failed,
  onRetry,
  api,
  request,
  filters,
  refresh,
  locale,
  t,
  link,
}: {
  ref?: Ref<() => void>;
  navigation: FanoutNavigation;
  onNavigation: (state: FanoutNavigation) => void;
  report: FanoutReport | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  api: string;
  request: typeof requestJson;
  filters: string;
  refresh: number;
  locale: string;
  t: Translate;
  link: Linker;
}) {
  const { search, kind, selected } = navigation;
  const setSearch = (search: string) =>
    onNavigation({ ...navigation, search, page: 1 });
  const setKind = (kind: string) =>
    onNavigation({ ...navigation, kind, page: 1 });
  const setSelected = (selected: string | null) =>
    onNavigation({ ...navigation, selected });
  const setTerm = (term: string | null) =>
    onNavigation({ ...navigation, term });
  const [termView, setTermView] = useState<TermKind | 'trend'>(() => {
    const listed = navigation.term && (report?.phrases ?? []).find((row) => termKey(row.term) === termKey(navigation.term!));
    return navigation.term && !listed ? 'trend' : listed && listed.words === 1 ? 'words' : 'phrases';
  });
  // The table narrows to the searches with the selected word. The server lists them all, not only the
  // most frequent ones the report carries, so it is asked on demand and the rest of the screen stays put.
  const [termQueries, setTermQueries] = useState<{
    term: string;
    queries: FanoutReport['queries'];
    trend?: FanoutReport['termTrend'][number];
    failed: boolean;
  } | null>(null);
  const [termAttempt, setTermAttempt] = useState(0);
  // One name for "channel" and "channels" (and for "São Paulo" and "sao paulo"): the URL may carry either, the chart, the
  // chip and the table use this.
  const activeTerm = navigation.term ? termKey(navigation.term) || null : null;
  useEffect(() => {
    if (!activeTerm) return;
    let active = true;
    const params = new URLSearchParams(filters);
    params.set('view', 'fanout');
    params.set('term', activeTerm);
    request<FanoutReport>(`${api}/reports?${params}`)
      .then(
        (data) =>
          active &&
          setTermQueries({
            term: activeTerm,
            queries: data.queries,
            trend: data.termTrend.find((row) => termKey(row.term) === activeTerm),
            failed: false,
          }),
      )
      .catch((cause) => {
        if (active && cause?.name !== 'AbortError')
          setTermQueries({ term: activeTerm, queries: [], failed: true });
      });
    return () => {
      active = false;
    };
  }, [api, filters, activeTerm, request, refresh, termAttempt]);
  const termReady =
    !activeTerm || (termQueries?.term === activeTerm && !termQueries.failed);
  const termFailed =
    Boolean(activeTerm) &&
    termQueries?.term === activeTerm &&
    termQueries.failed;
  const number = useMemo(
    () => new Intl.NumberFormat(numberLocale(locale)),
    [locale],
  );
  const decimal = useMemo(
    () =>
      new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 1 }),
    [locale],
  );
  const rows = useMemo(
    () =>
      (activeTerm
        ? termReady
          ? termQueries!.queries
          : []
        : (report?.queries ?? [])
      ).filter(
        (row) =>
          (kind === 'all' || kind.split(',').includes(row.kind)) &&
          (!search || row.key.includes(search.trim().toLowerCase())),
      ),
    [report, kind, search, activeTerm, termReady, termQueries],
  );
  // Intents first: the needs behind the searches, each with its searches inside. Until a search of the period has
  // an intent, the screen opens on the queries and says why (an empty first tab would hide data that is there).
  const [chosenView, setView] = useState<string | null>(null);
  const view = chosenView ?? (report?.intents?.length ? 'intents' : 'queries');
  const [intentSearch, setIntentSearch] = useState('');
  const intentName = useMemo(() => new Map((report?.intents ?? []).map((intent) => [intent.id, intent.name])), [report]);
  const pendingIntents = report?.unassigned?.pending ?? 0;
  const columnsPref = useTableColumns('fanout', api === '/api/demo', FANOUT_HIDDEN_COLUMNS);
  const comparison = useComparison(t);
  const [sort, setSort] = useState<DataSort>();
  const ordered = useMemo(
    () => sortRows(rows, QUERY_SORT_COLUMNS, sort),
    [rows, sort],
  );
  const page = useCollectionPage(
    ordered,
    `${filters}|${search}|${kind}|${activeTerm ?? ''}`,
    25,
    t,
    '',
    {
      page: navigation.page,
      onPage: (page) => onNavigation({ ...navigation, page }),
    },
  );
  useImperativeHandle(ref, () => {
    return () => {
      if (selected || loading || failed || !report?.withFanout || !termReady) return;
      const lines = [
        [
          'query',
          'type',
          'topic',
          'occurrences',
          'prompts',
          'ais',
          'brand_mentioned_pct',
          'brand_domain_cited_pct',
          'intent',
        ].join(','),
        ...rows.map((row) =>
          [
            row.text,
            row.kind,
            row.topic,
            row.occurrences,
            row.prompts,
            row.engines.map((e) => ENGINE_LABELS[e]).join('|'),
            decimal.format(row.mentionedRate),
            decimal.format(row.citedRate),
            row.intent ? (intentName.get(row.intent) ?? '') : '',
          ]
            .map(csvCell)
            .join(','),
        ),
      ];
      const url = URL.createObjectURL(
        new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'query-fan-out.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    };
  }, [selected, loading, failed, report, termReady, rows, decimal, intentName]);
  if (selected)
    return (
      <FanoutQuery
        key={selected}
        api={api}
        request={request}
        filters={filters}
        refresh={refresh}
        locale={locale}
        t={t}
        link={link}
        queryKey={selected}
        onBack={() => setSelected(null)}
      />
    );
  if (failed)
    return (
      <EmptyState
        tone="error"
        title={t('The report did not load.', 'O relatório não carregou.')}
        onRetry={onRetry}
      />
    );
  if (loading || !report) return <FanoutSkeleton />;
  if (!report.responses)
    return (
      <EmptyState
        title={t(
          'No responses in this period yet',
          'Ainda não há respostas neste período',
        )}
        description={t(
          'Query fan-out uses the searches returned with collected AI responses. There are no responses in this selection yet. Try another period or wait for the first collection.',
          'Query fan-out usa as buscas devolvidas com as respostas coletadas das IAs. Ainda não há respostas neste recorte. Tente outro período ou aguarde a primeira coleta.',
        )}
      />
    );
  if (!report.withFanout)
    return (
      <EmptyState
        title={t('Searches not returned', 'Buscas não informadas')}
        description={t(
          `${number.format(report.responses)} responses were collected, but none includes searches in this selection. Not returned does not mean zero searches.`,
          `${number.format(report.responses)} respostas foram coletadas, mas nenhuma inclui buscas neste recorte. Não informado não significa zero buscas.`,
        )}
      />
    );
  const coverage = (report.withFanout / report.responses) * 100;
  const covered = orderSeriesByTotal(
    report.engines.filter((row) => row.withFanout),
    (row) => row.occurrences,
  );
  const series = covered.map((row) => ({
    id: row.engine,
    key: row.engine,
    name: ENGINE_LABELS[row.engine],
    color: engineColor(row.engine),
  }));
  // The series of the chosen word: from the report, or from the word's own request when it is not among the most
  // frequent (an opportunity, a link). Until it arrives there is no chart: the general one would be a different word.
  const term = activeTerm
    ? (report.termTrend.find((row) => termKey(row.term) === activeTerm) ??
      (termReady
        ? (termQueries!.trend ?? {
            term: normalizeQuery(navigation.term!),
            count: 0,
            change: null,
            daily: [],
          })
        : undefined))
    : undefined;
  // What the screen calls the word: the form the searches use most, falling back to what the link carried.
  const shownTerm = term?.term ?? normalizeQuery(navigation.term ?? '');
  const chartPending = Boolean(activeTerm) && !term;
  const trendRows = report.termTrend
    .filter((row) => row.count > 1)
    .slice(0, 16);
  if (term?.count && !trendRows.some((row) => row.term === term.term))
    trendRows.push(term);
  const chartDays = term ? term.daily : report.daily;
  const chartTitle = term
    ? t(
        `Searches with “${term.term}”, per day, by AI`,
        `Buscas com “${term.term}”, por dia, por IA`,
      )
    : t('Searches per day, by AI', 'Buscas por dia, por IA');
  const daily = chartDays.map(({ date, counts }) => ({ date, ...counts }));
  const max = Math.max(
    1,
    ...chartDays.flatMap(({ counts }) => Object.values(counts)),
  );
  const step = Math.max(1, Math.ceil(max / 4));
  const scale = {
    domain: [0, step * 4],
    ticks: [0, step, step * 2, step * 3, step * 4],
  };
  const termDescription =
    termView !== 'trend'
      ? topTermsInfo(t)
      : comparison.off
          ? t(
              'Searches per word. Exact queries rarely repeat; words do. Select one to see it per day.',
              'Buscas por palavra. A busca exata quase não se repete; a palavra, sim. Selecione uma para vê-la por dia.',
            )
          : t(
            `Searches per word, and the change against ${comparison.period} (— when the word had no searches then). Exact queries rarely repeat; words do. Select one to see it per day.`,
            `Buscas por palavra, e a variação contra o ${comparison.period} (— quando a palavra não tinha buscas). A busca exata quase não se repete; a palavra, sim. Selecione uma para vê-la por dia.`,
          );
  const notReturned = (
    <TagBadge tone="quiet">{t('Not returned', 'Não informado')}</TagBadge>
  );
  const queryLink = (key: string) => {
    const [path, query] = link({ tab: 'fanout' }).href.split('?');
    const params = new URLSearchParams(query);
    params.set('fq', key);
    return {
      href: `${path}?${params}`,
      onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        setSelected(key);
      },
    };
  };
  const labelCount = t('Occurrences', 'Ocorrências');
  const queryColumns: DataColumn<FanoutQueryRow>[] = [
    {
      key: 'query',
      sortValue: QUERY_SORT.query,
      header: t('Query', 'Query'),
      info:
        !activeTerm && report.hasMoreQueries
          ? t(
              'Top 200 queries, CSV with the filtered list',
              '200 consultas mais frequentes, CSV com a lista filtrada',
            )
          : undefined,
      mobile: 'title',
      cellClassName: 'fanout-query-cell',
      width: 460,
      shrinkTo: '14rem',
      cell: (row) => (
        <Hint text={row.text}>
        <span className="block truncate">
          {row.text}
        </span>
        </Hint>
      ),
    },
    {
      key: 'topic',
      sortValue: QUERY_SORT.topic,
      header: t('Topic', 'Tópico'),
      label: t('Topic', 'Tópico'),
      cell: (row) =>
        row.topic ? (
          <DrillLink link={link} to={{ tab: 'fanout', topic: row.topic }}>
            {row.topic}
          </DrillLink>
        ) : (
          '—'
        ),
    },
    // Only once the period has intents: before that every row would say the same.
    ...(intentName.size ? [{
      key: 'intent',
      sortValue: (row: FanoutQueryRow) => (row.intent ? (intentName.get(row.intent) ?? '') : null),
      header: t('Intent', 'Intenção'),
      label: t('Intent', 'Intenção'),
      cell: (row: FanoutQueryRow) =>
        row.intent ? (
          <Hint text={intentName.get(row.intent) ?? ''}>
            <span className="block max-w-48 truncate">{intentName.get(row.intent)}</span>
          </Hint>
        ) : row.intent === null ? (
          <TagBadge tone="quiet">{t('Not classified yet', 'Ainda não classificada')}</TagBadge>
        ) : (
          <TagBadge tone="quiet">{t('No intent', 'Sem intenção')}</TagBadge>
        ),
    } satisfies DataColumn<FanoutQueryRow>] : []),
    {
      key: 'engines',
      sortValue: QUERY_SORT.engines,
      header: t('AIs', 'IAs'),
      label: t('AIs', 'IAs'),
      cell: (row) => <CompactEngineIcons engines={row.engines} />,
    },
    {
      key: 'occurrences',
      sortValue: QUERY_SORT.occurrences,
      header: labelCount,
      label: labelCount,
      align: 'end',
      cell: (row) => number.format(row.occurrences),
    },
    {
      key: 'prompts',
      sortValue: QUERY_SORT.prompts,
      header: t('Prompts', 'Prompts'),
      label: t('Prompts', 'Prompts'),
      info: t(
        'Distinct prompts per query. A prompt can produce several queries; these counts cannot be added.',
        'Prompts distintos por query. Um prompt pode gerar várias queries; essas contagens não podem ser somadas.',
      ),
      align: 'end',
      cell: (row) => number.format(row.prompts),
    },
    {
      key: 'mentioned',
      sortValue: QUERY_SORT.mentioned,
      info: t(
        'In the Summary: weighted by query occurrences in responses.',
        'No Resumo: ponderado pelas ocorrências de queries nas respostas.',
      ),
      header: t('Brand mentioned', 'Marca mencionada'),
      label: t('Brand mentioned', 'Marca mencionada'),
      align: 'end',
      cell: (row) => `${decimal.format(row.mentionedRate)}%`,
    },
    {
      key: 'cited',
      sortValue: QUERY_SORT.cited,
      info: t(
        'In the Summary: weighted by query occurrences in responses.',
        'No Resumo: ponderado pelas ocorrências de queries nas respostas.',
      ),
      header: t('Your domain cited', 'Seu domínio citado'),
      label: t('Your domain cited', 'Seu domínio citado'),
      align: 'end',
      cell: (row) => `${decimal.format(row.citedRate)}%`,
    },
  ];
  const occurrences = rows.reduce((sum, row) => sum + row.occurrences, 0);
  const rate = (key: 'mentionedRate' | 'citedRate') =>
    occurrences
      ? `${decimal.format(rows.reduce((sum, row) => sum + row[key] * row.occurrences, 0) / occurrences)}%`
      : '';
  return (
    <DataTableScreen className="fanout-layout" view={view} cards={<>
      <MetricGrid>
        <MetricCard
          label={t('Distinct queries', 'Queries distintas')}
          value={number.format(report.distinct)}
          description={t(
            'Different searches, ignoring case, accents and punctuation',
            'Buscas diferentes, ignorando caixa, acentos e pontuação',
          )}
        />
        <MetricCard
          label={labelCount}
          value={number.format(report.occurrences)}
          description={t(
            'Times a query appeared, once per response',
            'Vezes que uma query apareceu, uma por resposta',
          )}
        />
        <MetricCard
          label={t('Responses with fan-out', 'Respostas com fan-out')}
          value={`${decimal.format(coverage)}%`}
          description={t(
            `${number.format(report.withFanout)} of ${number.format(report.responses)}; the rest is data not returned`,
            `${number.format(report.withFanout)} de ${number.format(report.responses)}; o resto é dado não informado`,
          )}
        />
      </MetricGrid>
      {report.truncated && (
        <Note status>
          {t(
            'Large period: limited to the newest 5,000 responses with fan-out.',
            'Período grande: limitado às 5.000 respostas mais recentes com fan-out.',
          )}
        </Note>
      )}
      {!report.intents?.length && pendingIntents > 0 && (
        <Note status>
          {t(
            `Intents appear after the next collection is classified: ${number.format(pendingIntents)} searches of this period wait, in the background.`,
            `As intenções aparecem depois que a próxima coleta for classificada: ${number.format(pendingIntents)} buscas deste período aguardam, em segundo plano.`,
          )}
        </Note>
      )}
      </>}
      >
        <DataTableToolbar
          label={t('Query filters', 'Filtros de queries')}
          actions={
            view === 'queries' ? (
              <ColumnPicker
                label={t('Columns', 'Colunas')}
                columns={queryColumns.map((column) => ({
                  key: column.key,
                  label: column.label || String(column.header),
                }))}
                hidden={columnsPref.hidden}
                onChange={columnsPref.setHidden}
                required={['query']}
              />
            ) : undefined
          }
        >
          <Tabs value={view} onValueChange={setView}>
            <TabsList variant="line" aria-label={t('Query view', 'Visão de queries')}>
              <TabsTrigger value="intents">{t('Intents', 'Intenções')}</TabsTrigger>
              <TabsTrigger value="queries">{t('Queries', 'Queries')}</TabsTrigger>
              <TabsTrigger value="insights">{t('Insights', 'Análises')}</TabsTrigger>
            </TabsList>
          </Tabs>
          {view === 'intents' && (
            <SearchField
              value={intentSearch}
              onChange={setIntentSearch}
              placeholder={t('Search intents', 'Buscar intenções')}
            />
          )}
          {view === 'queries' && (
            <>
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder={t('Search queries', 'Buscar queries')}
              />
              <FilterSelect
                label={t('Query type', 'Tipo de query')}
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'all', label: t('All types', 'Todos os tipos') },
                  { value: 'search', label: t('Search', 'Busca') },
                  {
                    value: 'site',
                    label: t('Site search (site:)', 'Busca em site (site:)'),
                  },
                ]}
              />
              {activeTerm && (
                <Button
                  variant="outline"
                  onClick={() => setTerm(null)}
                >
                  {t(`Term: ${shownTerm}`, `Termo: ${shownTerm}`)}
                  <X size={14} aria-hidden="true" />
                  <span className="sr-only">
                    {t('Clear term', 'Limpar termo')}
                  </span>
                </Button>
              )}
            </>
          )}
        </DataTableToolbar>
        {view === 'intents' ? (
          <IntentList
            report={report}
            search={intentSearch}
            columns={visibleColumns(queryColumns.filter((column) => column.key !== 'intent'), columnsPref.hidden, ['query'])}
            queryLink={queryLink}
            onQueries={() => setView('queries')}
            api={api}
            request={request}
            filters={filters}
            refresh={refresh}
            number={number}
            decimal={decimal}
            t={t}
          />
        ) : view === 'insights' ? (
          <div className="fanout-insights">
            <TrendCard
              title={chartTitle}
              action={
                term && (
                  <Button variant="outline" onClick={() => setTerm(null)}>
                    {t(`Term: ${term.term}`, `Termo: ${term.term}`)}
                    <X size={14} aria-hidden="true" />
                    <span className="sr-only">
                      {t('Clear term', 'Limpar termo')}
                    </span>
                  </Button>
                )
              }
              loading={chartPending && !termFailed}
              empty={chartPending && termFailed ? (
                <EmptyState
                  frame="bare"
                  tone="error"
                  title={t('The chart did not load.', 'O gráfico não carregou.')}
                  onRetry={() => setTermAttempt((value) => value + 1)}
                />
              ) : undefined}
              data={daily}
              series={series}
              total={(row) => covered.find((item) => item.engine === row.id)?.occurrences ?? 0}
              scale={scale}
              locale={locale}
              formatValue={(value) => number.format(value)}
              formatTick={(value) => number.format(value)}
            />
            <SectionCard
              title={t('Common terms', 'Termos comuns')}
              info={termDescription}
              action={
                <Tabs value={termView} onValueChange={(value: typeof termView) => setTermView(value)}>
                  <TabsList variant="line" aria-label={t('Term view', 'Visão dos termos')}>
                    <TabsTrigger value="phrases">{t('Phrases', 'Frases')}</TabsTrigger>
                    <TabsTrigger value="words">{t('Words', 'Palavras')}</TabsTrigger>
                    <TabsTrigger value="trend">{t('Over time', 'No tempo')}</TabsTrigger>
                  </TabsList>
                </Tabs>
              }
            >
              {termView !== 'trend' ? (
                <TopTerms phrases={report.phrases ?? []} kind={termView} link={link} locale={locale} t={t} selected={activeTerm} />
              ) : (
                <RankedList
                  rows={trendRows.map((row) => ({
                    label: row.term,
                    count: row.count,
                    note: comparison.off
                      ? undefined
                      : row.change === null
                        ? '—'
                        : `${row.change > 0 ? '+' : ''}${decimal.format(row.change)}%`,
                    noteValue: comparison.off ? undefined : row.change,
                    selected: row.term === term?.term,
                    target: link({
                      tab: 'fanout',
                      fanoutTerm: row.term === term?.term ? null : row.term,
                    }),
                  }))}
                  noteHeader={comparison.off ? undefined : t('Change', 'Variação')}
                  number={number}
                  empty={t(
                    'No repeated terms yet.',
                    'Ainda não há termos repetidos.',
                  )}
                  t={t}
                />
              )}
            </SectionCard>
            <div className="st-columns">
              <SectionCard
                title={t('By AI', 'Por IA')}
                info={t(
                  'Largest first. Not returned means searches are unavailable in this selection.',
                  'Do maior para o menor. Não informado indica buscas indisponíveis neste recorte.',
                )}
              >
                <DataTable
                  singleLine
                  rows={report.engines}
                  rowKey={(row) => row.engine}
                  rowLink={(row) => link({ tab: 'fanout', engine: row.engine })}
                  columns={[
                    {
                      key: 'ai',
                      sortValue: (row) => ENGINE_LABELS[row.engine],
                      header: t('AI', 'IA'),
                      mobile: 'title',
                      cell: (row) => (
                        <span className="flex items-center gap-2">
                          <EngineIcon engine={row.engine} />
                          {ENGINE_LABELS[row.engine]}
                        </span>
                      ),
                    },
                    {
                      key: 'occurrences',
                      sortValue: (row) =>
                        row.withFanout ? row.occurrences : null,
                      header: labelCount,
                      label: labelCount,
                      align: 'end',
                      cell: (row) =>
                        row.withFanout
                          ? number.format(row.occurrences)
                          : notReturned,
                    },
                    {
                      key: 'average',
                      sortValue: (row) =>
                        row.withFanout
                          ? row.occurrences / row.withFanout
                          : null,
                      header: t('Per response', 'Por resposta'),
                      label: t('Per response', 'Por resposta'),
                      align: 'end',
                      cell: (row) =>
                        row.withFanout
                          ? decimal.format(row.occurrences / row.withFanout)
                          : notReturned,
                    },
                    {
                      key: 'coverage',
                      sortValue: (row) =>
                        row.withFanout ? row.withFanout / row.responses : null,
                      header: t('Coverage', 'Cobertura'),
                      label: t('Coverage', 'Cobertura'),
                      align: 'end',
                      cell: (row) =>
                        row.withFanout
                          ? `${decimal.format((row.withFanout / row.responses) * 100)}%`
                          : notReturned,
                    },
                  ]}
                />
              </SectionCard>
              <SectionCard
                title={t(
                  'Brands inside the searches',
                  'Marcas dentro das buscas',
                )}
                info={t(
                  'Tracked brands named in what the AI searched.',
                  'Marcas monitoradas mencionadas no que a IA buscou.',
                )}
              >
                <RankedList
                  rows={report.brands.map((b) => ({
                    label: b.name,
                    count: b.count,
                    mark: b.own ? t('You', 'Você') : '',
                  }))}
                  number={number}
                  empty={t(
                    'No tracked brand appears in the searches.',
                    'Nenhuma marca monitorada aparece nas buscas.',
                  )}
                  t={t}
                />
              </SectionCard>
            </div>
            {report.topics.length > 1 && (
              <SectionCard
                title={t('By topic', 'Por tópico')}
                info={t(
                  'The topic is the prompt tag. Distinct queries do not add up across topics: the same query can appear in more than one. Select a topic to filter the whole screen.',
                  'O tópico é a tag do prompt. As queries distintas não somam entre tópicos: a mesma query pode aparecer em mais de um. Selecione um tópico para filtrar a tela toda.',
                )}
              >
                <DataTable
                  singleLine
                  rows={report.topics}
                  rowKey={(row) => row.topic}
                  rowLink={(row) =>
                    link({ tab: 'fanout', topic: row.topic || null })
                  }
                  columns={[
                    {
                      key: 'topic',
                      sortValue: (row) => row.topic,
                      header: t('Topic', 'Tópico'),
                      mobile: 'title',
                      cell: (row) => row.topic || t('No topic', 'Sem tópico'),
                    },
                    {
                      key: 'occurrences',
                      sortValue: (row) => row.occurrences,
                      header: labelCount,
                      label: labelCount,
                      align: 'end',
                      cell: (row) => number.format(row.occurrences),
                    },
                    {
                      key: 'distinct',
                      sortValue: (row) => row.distinct,
                      header: t('Distinct queries', 'Queries distintas'),
                      label: t('Distinct queries', 'Queries distintas'),
                      align: 'end',
                      cell: (row) => number.format(row.distinct),
                    },
                    {
                      key: 'mentioned',
                      sortValue: (row) => row.mentionedRate,
                      header: t('Brand mentioned', 'Marca mencionada'),
                      label: t('Brand mentioned', 'Marca mencionada'),
                      align: 'end',
                      cell: (row) => `${decimal.format(row.mentionedRate)}%`,
                    },
                  ]}
                />
              </SectionCard>
            )}
            <SectionCard
              title={t('Sites searched directly', 'Sites buscados diretamente')}
              info={t(
                'Domains explicitly named with the site: operator.',
                'Domínios explicitamente mencionados com o operador site:.',
              )}
            >
              <RankedList
                rows={report.sites.map((site) => ({
                  label: site.site,
                  count: site.count,
                  domain: site.site,
                }))}
                number={number}
                empty={t(
                  'No site: searches were returned in this period.',
                  'Nenhuma busca com site: foi informada neste período.',
                )}
                t={t}
              />
            </SectionCard>{' '}
          </div>
        ) : (
          <>
            {activeTerm && termFailed ? (
              <EmptyState
                frame="bare"
                tone="error"
                title={t(
                  'The searches did not load.',
                  'As buscas não carregaram.',
                )}
                onRetry={() => setTermAttempt((value) => value + 1)}
              />
            ) : activeTerm && !termReady ? (
              <DataTable
                singleLine
                fill
                loading
                className="fanout-queries"
                ariaLabel={t('Loading searches…', 'Carregando buscas…')}
                rows={[]}
                rowKey={(row) => row.key}
                columns={visibleColumns(queryColumns, columnsPref.hidden, ['query'])}
              />
            ) : rows.length ? (
              <DataTable
                singleLine
                fill
                className="fanout-queries"
                summary={{
                  query: t(
                    `Summary (${number.format(rows.length)})`,
                    `Resumo (${number.format(rows.length)})`,
                  ),
                  occurrences: number.format(occurrences),
                  mentioned: rate('mentionedRate'),
                  cited: rate('citedRate'),
                }}
                summaryAside={
                  <CompactPagination
                    from={page.offset + 1}
                    to={page.offset + page.rows.length}
                    total={rows.length}
                    page={page.page}
                    pages={page.pages}
                    onPrevious={() =>
                      onNavigation({ ...navigation, page: page.page - 1 })
                    }
                    onNext={() =>
                      onNavigation({ ...navigation, page: page.page + 1 })
                    }
                    onPage={(page) => onNavigation({ ...navigation, page })}
                    previousLabel={t('Previous page', 'Página anterior')}
                    nextLabel={t('Next page', 'Próxima página')}
                    pageLabel={t('Page', 'Página')}
                    label={t('Query pages', 'Páginas de queries')}
                    rangeLabel={t(
                      `${number.format(page.offset + 1)} to ${number.format(page.offset + page.rows.length)} of ${number.format(rows.length)}`,
                      `${number.format(page.offset + 1)} a ${number.format(page.offset + page.rows.length)} de ${number.format(rows.length)}`,
                    )}
                  />
                }
                rows={page.rows}
                rowKey={(row) => row.key}
                rowLink={(row) => queryLink(row.key)}
                sort={sort}
                onSortChange={(next) => {
                  setSort(next);
                  onNavigation({ ...navigation, page: 1 });
                }}
                columns={visibleColumns(queryColumns, columnsPref.hidden, [
                  'query',
                ])}
              />
            ) : (
              <EmptyState
                frame="bare"
                title={t(
                  'No query matches this search.',
                  'Nenhuma query corresponde a esta busca.',
                )}
              />
            )}
          </>
        )}
    </DataTableScreen>
  );
}

/**
 * The period's intents, most occurrences first: each row opens in place to the searches inside it (asked for that intent
 * alone, so an intent's long tail is there too). Searches without an intent are counted under the table, never as zero.
 */
function IntentList({
  report,
  search,
  columns,
  queryLink,
  onQueries,
  api,
  request,
  filters,
  refresh,
  number,
  decimal,
  t,
}: {
  report: FanoutReport;
  search: string;
  columns: DataColumn<FanoutQueryRow>[];
  queryLink: (key: string) => ReturnType<Linker>;
  onQueries: () => void;
  api: string;
  request: typeof requestJson;
  filters: string;
  refresh: number;
  number: Intl.NumberFormat;
  decimal: Intl.NumberFormat;
  t: Translate;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const needle = search.trim().toLowerCase();
  const intents = report.intents ?? [];
  const rows = intents.filter(
    (intent) =>
      !needle ||
      [intent.name, intent.description, ...intent.entities.map((entity) => entity.value)].some((text) => text.toLowerCase().includes(needle)),
  );
  const { other, pending } = report.unassigned ?? { other: 0, pending: 0 };
  const unassigned = (other > 0 || pending > 0) && (
    <Note>
      {[
        other > 0 && t(`Searches that fit no intent: ${number.format(other)}.`, `Buscas sem intenção: ${number.format(other)}.`),
        pending > 0 &&
          t(
            `Waiting to be classified, in the background after each collection: ${number.format(pending)}.`,
            `Aguardando classificação, em segundo plano depois de cada coleta: ${number.format(pending)}.`,
          ),
      ]
        .filter(Boolean)
        .join(' ')}{' '}
      <Button variant="link" className="h-auto p-0" onClick={onQueries}>
        {t('See them in Queries', 'Ver em Queries')}
      </Button>
    </Note>
  );
  if (!intents.length)
    return (
      <EmptyState
        frame="bare"
        title={pending ? t('Intents are on their way', 'As intenções estão a caminho') : t('No intent in this period', 'Nenhuma intenção neste período')}
        description={
          pending
            ? t(
                `Intents appear after the next collection is classified: ${number.format(pending)} searches of this period wait for it. Meanwhile every search is in Queries.`,
                `As intenções aparecem depois que a próxima coleta for classificada: ${number.format(pending)} buscas deste período aguardam. Enquanto isso, todas as buscas estão em Queries.`,
              )
            : t('No search of this period fits an intent. Every search is in Queries.', 'Nenhuma busca deste período se encaixa numa intenção. Todas as buscas estão em Queries.')
        }
        action={<Button variant="outline" onClick={onQueries}>{t('See the queries', 'Ver as queries')}</Button>}
      />
    );
  const rate = (value: number) => `${decimal.format(value)}%`;
  const intentColumns: DataColumn<FanoutIntentRow>[] = [
    {
      key: 'intent',
      sortValue: (row) => row.name,
      header: t('Intent', 'Intenção'),
      mobile: 'title',
      width: 420,
      shrinkTo: '12rem',
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          {open === row.id ? <ChevronDown size={14} className="shrink-0" aria-hidden="true" /> : <ChevronRight size={14} className="shrink-0" aria-hidden="true" />}
          <Hint text={row.description}>
            <span className="min-w-0 truncate">{row.name}</span>
          </Hint>
          {row.entities.length > 0 && <EntityBadges entities={row.entities} t={t} className="min-w-0 flex-nowrap overflow-hidden" />}
        </span>
      ),
    },
    { key: 'queries', sortValue: (row) => row.queries, header: t('Queries', 'Queries'), label: t('Queries', 'Queries'), align: 'end', cell: (row) => number.format(row.queries) },
    { key: 'occurrences', sortValue: (row) => row.occurrences, header: t('Occurrences', 'Ocorrências'), label: t('Occurrences', 'Ocorrências'), align: 'end', cell: (row) => number.format(row.occurrences) },
    { key: 'engines', sortValue: (row) => row.engines.length, header: t('AIs', 'IAs'), label: t('AIs', 'IAs'), cell: (row) => <CompactEngineIcons engines={row.engines} /> },
    { key: 'prompts', sortValue: (row) => row.prompts, header: t('Prompts', 'Prompts'), label: t('Prompts', 'Prompts'), align: 'end', cell: (row) => number.format(row.prompts) },
    {
      key: 'mentioned',
      sortValue: (row) => row.mentionedRate,
      header: t('Brand mentioned', 'Marca mencionada'),
      label: t('Brand mentioned', 'Marca mencionada'),
      info: t('Weighted by the occurrences of its queries in responses.', 'Ponderado pelas ocorrências das suas queries nas respostas.'),
      align: 'end',
      cell: (row) => rate(row.mentionedRate),
    },
    { key: 'cited', sortValue: (row) => row.citedRate, header: t('Your domain cited', 'Seu domínio citado'), label: t('Your domain cited', 'Seu domínio citado'), align: 'end', cell: (row) => rate(row.citedRate) },
  ];
  return (
    <>
      {rows.length ? (
        <DataTable
          singleLine
          className="fanout-queries"
          ariaLabel={t('Search intents', 'Intenções de busca')}
          rows={rows}
          rowKey={(row) => row.id}
          onExpand={(row) => setOpen((current) => (current === row.id ? null : row.id))}
          expanded={(row) =>
            open === row.id ? (
              <IntentQueries intent={row} columns={columns} queryLink={queryLink} api={api} request={request} filters={filters} refresh={refresh} number={number} t={t} />
            ) : undefined
          }
          columns={intentColumns}
        />
      ) : (
        <EmptyState frame="bare" title={t('No intent matches this search.', 'Nenhuma intenção corresponde a esta busca.')} />
      )}
      {unassigned}
    </>
  );
}

/** An intent's entities, one badge each ("Location: São Paulo"). */
export function EntityBadges({ entities, t, className }: { entities: FanoutIntentRow['entities']; t: Translate; className?: string }) {
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {entities.map((entity) => (
        <TagBadge key={`${entity.type}:${entity.value}`} tone="quiet">
          {t(...ENTITY_LABELS[entity.type])}: {entity.value}
        </TagBadge>
      ))}
    </span>
  );
}

const INTENT_PREVIEW = 10;
/** The searches of one intent (every one of the period), the most frequent first; each opens its own page. */
function IntentQueries({
  intent,
  columns,
  queryLink,
  api,
  request,
  filters,
  refresh,
  number,
  t,
}: {
  intent: FanoutIntentRow;
  columns: DataColumn<FanoutQueryRow>[];
  queryLink: (key: string) => ReturnType<Linker>;
  api: string;
  request: typeof requestJson;
  filters: string;
  refresh: number;
  number: Intl.NumberFormat;
  t: Translate;
}) {
  const [rows, setRows] = useState<FanoutQueryRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(filters);
    params.set('view', 'fanout');
    params.set('intent', intent.id);
    queueMicrotask(() => active && setFailed(false));
    request<FanoutReport>(`${api}/reports?${params}`)
      .then((data) => active && setRows(data.queries))
      .catch((cause) => {
        if (active && cause?.name !== 'AbortError') setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api, filters, intent.id, request, refresh, attempt]);
  if (failed)
    return (
      <EmptyState
        frame="bare"
        tone="error"
        title={t('The searches did not load.', 'As buscas não carregaram.')}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  const shown = rows && !all ? rows.slice(0, INTENT_PREVIEW) : rows;
  return (
    <div className="flex flex-col gap-2">
      {intent.description && <p className="text-caption text-muted-foreground">{intent.description}</p>}
      <DataTable
        singleLine
        compact
        loading={rows ? undefined : 3}
        ariaLabel={rows ? t(`Searches of ${intent.name}`, `Buscas de ${intent.name}`) : t('Loading searches…', 'Carregando buscas…')}
        rows={shown ?? []}
        rowKey={(row) => row.key}
        rowLink={(row) => queryLink(row.key)}
        columns={columns}
      />
      {rows && rows.length > INTENT_PREVIEW && (
        <Button variant="outline" className="self-start" onClick={() => setAll((value) => !value)}>
          {all ? t('Show fewer', 'Mostrar menos') : t(`Show all ${number.format(rows.length)}`, `Mostrar todas as ${number.format(rows.length)}`)}
        </Button>
      )}
    </div>
  );
}

export type TermKind = 'phrases' | 'words';

/** Overview's Top terms: the first six phrases or words (a switch in the header) and the way to Query Fan Out. */
export function TopTermsCard({
  report,
  loading,
  failed,
  link,
  locale,
  t,
  selected,
}: {
  report: FanoutReport | null;
  loading: boolean;
  failed: boolean;
  link: Linker;
  locale: string;
  t: Translate;
  selected?: string | null;
}) {
  const [kind, setKind] = useState<TermKind>('phrases');
  return (
    <SectionCard
      title={t('Top terms', 'Principais termos')}
      info={topTermsInfo(t)}
      loading={loading}
      action={
        <div className="flex items-center gap-3">
          <ToggleGroup multiple={false} value={[kind]} onValueChange={(value) => { if (value[0]) setKind(value[0] as TermKind); }} size="sm" variant="outline" spacing={0} aria-label={t('Terms', 'Termos')}>
            <ToggleGroupItem value="phrases">{t('Phrases', 'Frases')}</ToggleGroupItem>
            <ToggleGroupItem value="words">{t('Words', 'Palavras')}</ToggleGroupItem>
          </ToggleGroup>
          <ViewAllAction link={link} to={{ tab: 'fanout' }}>{t('View all', 'Ver todos')}</ViewAllAction>
        </div>
      }
    >
      {failed ? (
        <EmptyState frame="bare" tone="error" title={t('Could not load the terms.', 'Não foi possível carregar os termos.')} />
      ) : (
        <TopTerms phrases={report?.phrases ?? []} kind={kind} link={link} locale={locale} t={t} limit={6} selected={selected} />
      )}
    </SectionCard>
  );
}

/** What Top terms shows, in its card's information icon (Overview and Query Fan Out). */
export const topTermsInfo = (t: Translate) =>
  t(
    'Phrases of two or three words, or single words, that the AI put in its searches and the prompt did not have, most searches first: the bar against the most searched, the figure in searches and their share of all searches. A word that almost only appears inside a longer phrase is listed as the phrase. Under each, the terms that appear with it in the same searches. Select one to see its searches.',
    'Frases de duas ou três palavras, ou palavras soltas, que a IA pôs nas buscas e o prompt não tinha, da mais buscada para a menos: a barra contra a mais buscada, o número em buscas e a parte delas no total. Uma palavra que quase só aparece dentro de uma frase maior entra como a frase. Embaixo de cada uma, os termos que aparecem com ela nas mesmas buscas. Selecione uma para ver as buscas.',
  );

/**
 * Top terms (Overview and Query Fan Out): the words and phrases the AI searches beyond the prompt, as search tools rank
 * keywords (a ranked list with frequency bars, Semrush's groups, Google Ads' n-grams), with what appears with each in the same
 * searches. A term opens Query Fan Out on it.
 */
export function TopTerms({
  phrases: all,
  kind,
  link,
  locale,
  t,
  limit,
  selected,
}: {
  phrases: FanoutReport['phrases'];
  /** Phrases of 2 or 3 words, or single words: two lists, as single words would always outrank the phrases. */
  kind: TermKind;
  link: Linker;
  locale: string;
  t: Translate;
  limit?: number;
  /** The term the screen is narrowed to (its `termKey`): marked, and its link clears it. */
  selected?: string | null;
}) {
  const phrases = all.filter((row) => (kind === 'words') === (row.words === 1));
  if (!phrases.length)
    return (
      <EmptyState
        frame="bare"
        title={kind === 'words' ? t('No repeated words in this period.', 'Sem palavras repetidas neste período.') : t('No repeated phrases in this period.', 'Sem frases repetidas neste período.')}
        description={t(
          'A term shows here once the AI searches it in two responses or more.',
          'Um termo aparece aqui quando a IA o busca em duas respostas ou mais.',
        )}
      />
    );
  const number = new Intl.NumberFormat(numberLocale(locale));
  const decimal = new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 1 });
  const shown = limit ? phrases.slice(0, limit) : phrases;
  const most = Math.max(1, ...shown.map((row) => row.count));
  return (
    <BarList
      label={t('Top terms', 'Principais termos')}
      rows={shown.map((row) => {
        const active = Boolean(selected) && termKey(row.term) === selected;
        const share = `${decimal.format(row.rate)}%`;
        const searches = t(
          `${number.format(row.count)} searches, ${share} of all searches`,
          `${number.format(row.count)} buscas, ${share} de todas as buscas`,
        );
        return {
          key: row.term,
          label: (
            <span className="flex min-w-0 items-center gap-2">
              <DrillLink link={link} to={{ tab: 'fanout', fanoutTerm: active ? null : row.term }} className="min-w-0 truncate">
                {row.term}
              </DrillLink>
              {active && <TagBadge tone="primary">{t('In the chart', 'No gráfico')}</TagBadge>}
            </span>
          ),
          value: (row.count / most) * 100,
          figure: `${number.format(row.count)} (${share})`,
          text: `${row.term}: ${searches}`,
          hint: `${row.term}: ${searches}`,
          detail: row.with.length ? (
            <>
              <span>{t('With', 'Com')}</span>
              {row.with.map((partner) => (
                <TagBadge
                  key={partner.term}
                  tone="quiet"
                  title={t(
                    `“${row.term}” and “${partner.term}” in ${number.format(partner.count)} searches`,
                    `“${row.term}” e “${partner.term}” em ${number.format(partner.count)} buscas`,
                  )}
                >
                  {partner.term}
                </TagBadge>
              ))}
            </>
          ) : undefined,
        };
      })}
    />
  );
}

function RankedList({
  rows,
  number,
  empty,
  t,
  noteHeader,
}: {
  rows: {
    label: string;
    count: number;
    mark?: string;
    domain?: string;
    note?: string;
    noteValue?: number | null;
    selected?: boolean;
    target?: ReturnType<Linker>;
  }[];
  noteHeader?: string;
  number: Intl.NumberFormat;
  empty: string;
  t: Translate;
}) {
  if (!rows.length) return <EmptyState frame="bare" title={empty} />;
  return (
    <DataTable
      singleLine
      rows={rows}
      rowKey={(row) => row.label}
      rowLink={(row) => row.target}
      rowState={(row) => (row.selected ? 'selected' : undefined)}
      columns={[
        {
          key: 'name',
          sortValue: (row) => row.label,
          header: t('Name', 'Nome'),
          mobile: 'title',
          shrinkTo: '12rem',
          cell: (row) => (
            <span className="flex min-w-0 items-center gap-2">
              {row.domain && (
                <SiteFavicon domain={row.domain} name={row.label} />
              )}
              <span className="min-w-0 truncate">{row.label}</span>
              {row.selected && (
                <TagBadge tone="primary">
                  {t('In the chart', 'No gráfico')}
                </TagBadge>
              )}
              {row.mark && <TagBadge tone="quiet">{row.mark}</TagBadge>}
            </span>
          ),
        },
        {
          key: 'count',
          sortValue: (row) => row.count,
          header: t('Occurrences', 'Ocorrências'),
          label: t('Occurrences', 'Ocorrências'),
          align: 'end',
          cell: (row) => number.format(row.count),
        },
        ...(noteHeader
          ? [
              {
                key: 'note',
                header: noteHeader,
                sortValue: (row: { noteValue?: number | null }) =>
                  row.noteValue,
                label: noteHeader,
                align: 'end' as const,
                cell: (row: { note?: string }) => row.note ?? '',
              },
            ]
          : []),
      ]}
    />
  );
}

function FanoutQuery({
  api,
  request,
  filters,
  refresh,
  locale,
  t,
  link,
  queryKey,
  onBack,
}: {
  api: string;
  request: typeof requestJson;
  filters: string;
  refresh: number;
  locale: string;
  t: Translate;
  link: Linker;
  queryKey: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<FanoutDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState('responses');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<DataSort>();
  const columnsPref = useTableColumns('fanout-detail', api === '/api/demo');
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(filters);
    params.set('view', 'fanout-detail');
    params.set('key', queryKey);
    queueMicrotask(() => active && setState('loading'));
    request<FanoutDetail>(`${api}/reports?${params}`)
      .then((data) => {
        if (active) {
          setDetail(data);
          setState('ready');
        }
      })
      .catch((cause) => {
        if (active && cause?.name !== 'AbortError') setState('failed');
      });
    return () => {
      active = false;
    };
  }, [api, filters, queryKey, request, refresh, attempt]);
  const number = new Intl.NumberFormat(numberLocale(locale));
  const when = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(value));
  // The way back to the list, as the page's action (the header's breadcrumb names the screen, not this query).
  const heading = (title: ReactNode, description?: ReactNode) => (
    <PageHeading
      title={title}
      description={description}
      actions={
        <Button variant="outline" onClick={onBack}>
          {t('All queries', 'Todas as queries')}
        </Button>
      }
    />
  );
  const columns: DataColumn<FanoutDetail['runs'][number]>[] = [
    {
      key: 'prompt',
      sortValue: (row) => row.prompt_text,
      header: t('Prompt', 'Prompt'),
      mobile: 'title',
      cellClassName: 'fanout-query-cell',
      width: 420,
      shrinkTo: '12rem',
      cell: (row) => (
        <Hint text={row.prompt_text}>
        <span className="block truncate">
          {row.prompt_text}
        </span>
        </Hint>
      ),
    },
    {
      key: 'search',
      sortValue: (row) => row.query_text,
      header: t('Search', 'Busca'),
      label: t('Search', 'Busca'),
      cellClassName: 'fanout-query-cell',
      width: 420,
      shrinkTo: '12rem',
      cell: (row) => (
        <Hint text={row.query_text}>
        <span className="block truncate">
          <HighlightedSearch prompt={row.prompt_text} query={row.query_text} />
        </span>
        </Hint>
      ),
    },
    {
      key: 'engine',
      sortValue: (row) => ENGINE_LABELS[row.engine],
      header: t('AI', 'IA'),
      label: t('AI', 'IA'),
      cell: (row) => <CompactEngineIcons engines={[row.engine]} />,
    },
    {
      key: 'date',
      sortValue: (row) => Date.parse(row.created_at),
      header: t('Date', 'Data'),
      label: t('Date', 'Data'),
      cell: (row) => when(row.created_at),
    },
    {
      key: 'brand',
      sortValue: (row) => Number(row.mentioned),
      header: t('Brand mentioned', 'Marca mencionada'),
      info: t(
        'In the Summary: share of the filtered responses mentioning your brand.',
        'No Resumo: percentual das respostas filtradas que mencionam sua marca.',
      ),
      label: t('Brand mentioned', 'Marca mencionada'),
      cell: (row) =>
        row.mentioned ? t('Mentioned', 'Mencionada') : t('Not mentioned', 'Não mencionada'),
    },
    {
      key: 'domain',
      sortValue: (row) => Number(row.cited),
      header: t('Your domain cited', 'Seu domínio citado'),
      info: t(
        'In the Summary: share of the filtered responses citing your domain.',
        'No Resumo: percentual das respostas filtradas que citam seu domínio.',
      ),
      label: t('Your domain cited', 'Seu domínio citado'),
      cell: (row) =>
        row.cited ? t('Cited', 'Citado') : t('Not cited', 'Não citado'),
    },
  ];
  const rows = (detail?.runs ?? []).filter((row) =>
    `${row.prompt_text} ${row.query_text}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const ordered = sortRows(rows, columns, sort);
  const [pageNumber, setPageNumber] = useState(1);
  const page = useCollectionPage(ordered, `${queryKey}|${search}`, 25, t, '', {
    page: pageNumber,
    onPage: setPageNumber,
  });
  if (state === 'loading') return <FanoutQuerySkeleton heading={heading(<Skeleton inline className="h-lh w-64 max-w-full align-top" />)} />;
  if (state === 'failed' || !detail)
    return (
      <div className="st-entity">
        {heading(t('Query details', 'Detalhes da query'))}
        <EmptyState
          tone="error"
          title={t(
            'The query details did not load.',
            'Os detalhes da query não carregaram.',
          )}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </div>
    );
  if (!detail.runs.length)
    return (
      <div className="st-entity">
        {heading(detail.variants[0] ?? detail.key)}
        <EmptyState
          title={t(
            'No responses for this search in this selection',
            'Nenhuma resposta para esta busca neste recorte',
          )}
          description={t(
            'Try another period or AI, or return to the query list.',
            'Tente outro período ou IA, ou volte à lista de queries.',
          )}
        />
      </div>
    );
  const mentioned = rows.filter((run) => run.mentioned).length;
  const cited = rows.filter((run) => run.cited).length;
  const mentionedAll = number.format(detail.runs.filter((run) => run.mentioned).length);
  const citedAll = number.format(detail.runs.filter((run) => run.cited).length);
  return (
    <DataTableScreen
      className="fanout-layout"
      view={view}
      cards={heading(
        detail.variants[0] ?? detail.key,
        detail.variants.length > 1
          ? t(
              `Also written as: ${detail.variants.slice(1, 4).join(', ')}`,
              `Também escrita como: ${detail.variants.slice(1, 4).join(', ')}`,
            )
          : undefined,
      )}
    >
        <DataTableToolbar
          label={t('Response filters', 'Filtros de respostas')}
          actions={
            view === 'responses' ? (
              <ColumnPicker
                label={t('Columns', 'Colunas')}
                columns={columns.map((column) => ({
                  key: column.key,
                  label: column.label || String(column.header),
                }))}
                hidden={columnsPref.hidden}
                onChange={columnsPref.setHidden}
                required={['prompt']}
              />
            ) : undefined
          }
        >
          <Tabs value={view} onValueChange={setView}>
            <TabsList variant="line" aria-label={t('Query details', 'Detalhes da query')}>
              <TabsTrigger value="responses">{t('Prompts and responses', 'Prompts e respostas')}</TabsTrigger>
              <TabsTrigger value="sources">{t('Sources', 'Fontes')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <InfoHint
            text={t(
              `Up to 50 matching responses shown (${number.format(detail.runs.length)}). Brand mentioned in ${mentionedAll}; brand domain cited in ${citedAll}. Sources belong to the same responses: they are not proof of URLs returned by this specific search.`,
              `Até 50 respostas correspondentes exibidas (${number.format(detail.runs.length)}). Marca mencionada em ${mentionedAll}; domínio da marca citado em ${citedAll}. As fontes pertencem às mesmas respostas: não comprovam quais URLs foram retornadas por esta busca específica.`,
            )}
          />
          {view === 'responses' && (
            <SearchField
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPageNumber(1);
              }}
              placeholder={t('Search responses', 'Buscar respostas')}
            />
          )}
        </DataTableToolbar>
        {view === 'responses' ? (
          <>
            <DataTable
              singleLine
              fill
              className="fanout-queries"
              sort={sort}
              onSortChange={(next) => {
                setSort(next);
                setPageNumber(1);
              }}
              summary={{
                prompt: t(
                  `Summary (${number.format(rows.length)})`,
                  `Resumo (${number.format(rows.length)})`,
                ),
                brand: rows.length
                  ? `${new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 1 }).format((mentioned / rows.length) * 100)}%`
                  : '',
                domain: rows.length
                  ? `${new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 1 }).format((cited / rows.length) * 100)}%`
                  : '',
              }}
              summaryAside={
                <CompactPagination
                  from={page.offset + 1}
                  to={page.offset + page.rows.length}
                  total={rows.length}
                  page={page.page}
                  pages={page.pages}
                  onPrevious={() => setPageNumber(page.page - 1)}
                  onNext={() => setPageNumber(page.page + 1)}
                  onPage={setPageNumber}
                  previousLabel={t('Previous page', 'Página anterior')}
                  nextLabel={t('Next page', 'Próxima página')}
                  pageLabel={t('Page', 'Página')}
                  label={t('Response pages', 'Páginas de respostas')}
                  rangeLabel={t(
                    `${number.format(page.offset + 1)} to ${number.format(page.offset + page.rows.length)} of ${number.format(rows.length)}`,
                    `${number.format(page.offset + 1)} a ${number.format(page.offset + page.rows.length)} de ${number.format(rows.length)}`,
                  )}
                />
              }
              rows={page.rows}
              rowKey={(row) => row.id}
              rowLink={(row) => link({ tab: 'responses', run: row.id })}
              columns={visibleColumns(columns, columnsPref.hidden, ['prompt'])}
            />
            {!rows.length && (
              <EmptyState
                frame="bare"
                title={t(
                  'No response matches this search.',
                  'Nenhuma resposta corresponde a esta busca.',
                )}
              />
            )}
          </>
        ) : (
          <div className="fanout-insights">
            <div className="st-columns">
              <SectionCard
                title={t(
                  'Cited in these responses',
                  'Citadas nestas respostas',
                )}
                info={t(
                  'Domains cited, counted once per response.',
                  'Domínios citados, contados uma vez por resposta.',
                )}
              >
                <RankedList
                  rows={detail.cited.map((row) => ({
                    label: row.domain,
                    count: row.count,
                    domain: row.domain,
                  }))}
                  number={number}
                  empty={t(
                    'These responses cite no sources.',
                    'Estas respostas não citam fontes.',
                  )}
                  t={t}
                />
              </SectionCard>
              <SectionCard
                title={t(
                  'Consulted in these responses',
                  'Consultadas nestas respostas',
                )}
                info={t(
                  'Domains retrieved, whether or not cited.',
                  'Domínios recuperados, citados ou não.',
                )}
              >
                {detail.consulted ? (
                  <RankedList
                    rows={detail.consulted.map((row) => ({
                      label: row.domain,
                      count: row.count,
                      domain: row.domain,
                    }))}
                    number={number}
                    empty={t(
                      'The returned source lists are empty.',
                      'As listas de fontes retornadas estão vazias.',
                    )}
                    t={t}
                  />
                ) : (
                  <EmptyState
                    frame="bare"
                    title={t(
                      'Consulted sources not returned',
                      'Fontes consultadas não informadas',
                    )}
                    description={t(
                      'These responses do not include consulted sources. Not returned does not mean zero.',
                      'Estas respostas não incluem fontes consultadas. Não informado não significa zero.',
                    )}
                  />
                )}
              </SectionCard>
            </div>
          </div>
        )}
    </DataTableScreen>
  );
}

/** Query fan-out while its report loads: the three metric cards, the toolbar with its tabs and search, and the intents table. */
export function FanoutSkeleton() {
  const l = useCopy();
  const label = l('Loading query fan-out…', 'Carregando query fan-out…');
  return (
    <DataTableScreen className="fanout-layout" cards={<MetricGridSkeleton count={3} label={label} description />}>
      <DataTableToolbar label={label}>
        <Skeleton className="h-(--control-height) w-56 max-w-full" />
        <Skeleton className="h-(--control-height) w-64 max-w-full" />
      </DataTableToolbar>
      <DataTable fill singleLine loading ariaLabel={label} rows={[]} rowKey={String} columns={skeletonColumns(7)} />
    </DataTableScreen>
  );
}

/** A search's page while it loads: its heading, the toolbar and the table of its responses. */
function FanoutQuerySkeleton({ heading }: { heading: ReactNode }) {
  const l = useCopy();
  return (
    <DataTableScreen className="fanout-layout" cards={heading}>
      <DataTableToolbar label={l('Loading query details…', 'Carregando detalhes da query…')}>
        <Skeleton className="h-(--control-height) w-64 max-w-full" />
      </DataTableToolbar>
      <DataTable fill singleLine loading rows={[]} rowKey={String} columns={skeletonColumns(6)} />
    </DataTableScreen>
  );
}

/** The search with the words that the prompt did not have marked, so the rewrite can be read at a glance. */
function HighlightedSearch({
  prompt,
  query,
}: {
  prompt: string;
  query: string;
}) {
  const added = useMemo(
    () => new Set(addedWords(prompt, query)),
    [prompt, query],
  );
  return (
    <span>
      {query.split(/\s+/).map((word, at) => (
        <span key={`${at}-${word}`}>
          {at > 0 && ' '}
          {added.has(stem(normalizeQuery(word))) ? (
            <mark className="rounded bg-primary/15 px-0.5 text-foreground">
              {word}
            </mark>
          ) : (
            word
          )}
        </span>
      ))}
    </span>
  );
}
