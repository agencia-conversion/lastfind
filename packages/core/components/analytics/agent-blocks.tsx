'use client';
// What the agent writes, drawn with the app's own pieces: Markdown (AnswerMarkdown), charts in the panel shell
// (SectionCard) with the app's series palette (a brand keeps its Overview colour), ranked rows as in Sources
// (`live-frequency`, AI models with their mark), lines with TrendChart, shares with the Sources donut, and key figures
// with MetricCard. Used by the chat, the artifacts and the public page of a shared artifact.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { liveChart, splitBlocks, tidy, type ChartSpec, type MetricSpec } from '@/lib/agent';
import { isLive, type LiveBlock, type LiveRow } from '@/lib/agent-blocks';
import { SOURCE_OWNER_LABELS, SOURCE_TYPE_DEFINITIONS, type SourceOwner, type SourceType } from '@/lib/source-types';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { Switch } from '@/components/ui/switch';
import { CHART_PALETTE_SIZE, seriesColorVar, useSeriesToggle } from '@/lib/chart-series';
import { ENGINE_LABELS, ENGINES } from '@/lib/engines';
import { formatNumber } from '@/lib/number-format';
import { ChartTooltip } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { ChartLegend, TrendChart, type TrendSeries } from '@/components/lastfind/presentation/trend-chart';
import { MetricCard, MetricGrid } from '@/components/lastfind/presentation/metric-card';
import { AnswerMarkdown } from './answer-markdown';
import { Change, ModelMark, useCopy, useNumbers } from './shared';
import './overview-presentation.css';

/** The project's brands, so a chart paints them as the Overview does (own brand first slot, competitors by roster). */
export type AgentBrands = { own: string; roster: string[] };
export const AgentBrandsContext = createContext<AgentBrands | null>(null);

const engineOf = (label: string) => ENGINES.find((engine) => ENGINE_LABELS[engine].toLowerCase() === label.trim().toLowerCase());

function useColors() {
  const brands = useContext(AgentBrandsContext);
  return (name: string, index: number) => {
    const known = brands && [brands.own, ...brands.roster].some((brand) => brand.toLowerCase() === name.trim().toLowerCase());
    if (known && brands) {
      const canonical = [brands.own, ...brands.roster].find((brand) => brand.toLowerCase() === name.trim().toLowerCase())!;
      return seriesColorVar(canonical, brands.own, brands.roster);
    }
    return `var(--chart-${(index % CHART_PALETTE_SIZE) + 1})`;
  };
}

/** A tidy axis: from 0 (or the lowest value below it) to a round top, five ticks. */
function scaleOf(values: number[]) {
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const raw = (max - min || 1) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power;
  const lower = Math.floor(min / step) * step;
  const upper = Math.ceil(max / step) * step || step;
  const ticks: number[] = [];
  for (let tick = lower; tick <= upper + step / 2; tick += step) ticks.push(Math.round(tick * 1e6) / 1e6);
  return { domain: [lower, upper], ticks };
}

function useFormat(unit: string) {
  const { locale } = useNumbers();
  return useMemo(() => {
    const value = (number: number) => `${formatNumber(locale, number, Number.isInteger(number) ? 0 : 1)}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
    return { locale, value, tick: (number: number) => `${formatNumber(locale, number)}${unit === '%' ? '%' : ''}` };
  }, [locale, unit]);
}

/** The tooltip of the app's charts (trend-tooltip): the category, then one row per series. */
function BarTooltip({ active, payload, label, series, value }: { active?: boolean; payload?: readonly { dataKey?: unknown; value?: unknown }[]; label?: unknown; series: TrendSeries[]; value: (number: number) => string }) {
  if (!active || !payload?.length) return null;
  const values = new Map(payload.map((entry) => [String(entry.dataKey), entry.value]));
  return (
    <div className="trend-tooltip">
      <p>{String(label)}</p>
      <ul>
        {series
          .filter((item) => typeof values.get(item.key) === 'number')
          .map((item) => (
            <li key={item.key}>
              <i style={{ background: item.color }} aria-hidden="true" />
              <span className="trend-tooltip-name">{item.name}</span>
              <span className="trend-tooltip-value">{value(values.get(item.key) as number)}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** One series compared across rows: the ranked rows of Sources (label, bar, value), AI models with their mark. */
function RankedRows({ chart }: { chart: ChartSpec }) {
  const format = useFormat(chart.unit);
  const color = useColors();
  const key = chart.series[0].key;
  const rows = chart.data.filter((row) => typeof row[key] === 'number');
  const top = Math.max(0.001, ...rows.map((row) => Math.abs(row[key] as number)));
  return (
    <div className="live-frequency agent-frequency">
      {chart.data.map((row, index) => {
        const value = row[key];
        const engine = engineOf(String(row.x));
        return (
          <div key={`${row.x}-${index}`}>
            <span className="agent-frequency-label">{engine ? <ModelMark model={engine} /> : <span className="truncate">{String(row.x)}</span>}</span>
            <i style={{ width: typeof value === 'number' ? `${(100 * Math.abs(value)) / top}%` : 0, background: engine ? undefined : color(String(row.x), 0) }} />
            <b>{typeof value === 'number' ? format.value(value) : '—'}</b>
          </div>
        );
      })}
    </div>
  );
}

export function AgentChart({ chart }: { chart: ChartSpec }) {
  const t = useCopy();
  const format = useFormat(chart.unit);
  const color = useColors();
  const series: TrendSeries[] = chart.series.map((item, index) => ({ id: item.key, key: item.key, name: item.label, color: color(item.label, index), primary: index === 0 }));
  // At most ten lines at first, as every chart (CHART_SERIES_COUNT, in the agent's order); the legend offers the rest.
  const { hidden, folded, visible: shown, toggle } = useSeriesToggle(series);
  const values = chart.data.flatMap((row) => shown.map((item) => row[item.key]).filter((value): value is number => typeof value === 'number'));
  const label = chart.title || t('Chart', 'Gráfico');
  const legend = series.length > 1 && (
    <ChartLegend series={series} hidden={hidden} folded={folded} onToggle={toggle} />
  );
  return (
    <SectionCard title={chart.title || undefined} className="agent-chart">
      <figure aria-label={label}>
        {chart.type === 'line' ? (
          <>
            <TrendChart
              data={chart.data.map((row) => ({ ...row, date: row.x }))}
              series={shown}
              scale={scaleOf(values)}
              locale={format.locale}
              formatValue={format.value}
              formatTick={format.tick}
              label={label}
            />
            {legend}
          </>
        ) : chart.type === 'bar' && chart.series.length === 1 ? (
          <RankedRows chart={chart} />
        ) : chart.type === 'bar' ? (
          <>
            <div className="agent-chart-bars" style={{ height: `calc(${chart.data.length} * var(--spacing) * ${4 + shown.length * 4} + var(--spacing) * 10)` }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 160 }}>
                <BarChart layout="vertical" data={chart.data} margin={{ top: 4, right: 16, bottom: 4, left: 4 }} barCategoryGap="24%">
                  <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 4" />
                  <XAxis type="number" domain={scaleOf(values).domain} ticks={scaleOf(values).ticks} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickFormatter={(value) => format.tick(Number(value))} />
                  <YAxis type="category" dataKey="x" width={128} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--foreground)' }} />
                  <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={(props) => <BarTooltip {...props} series={shown} value={format.value} />} />
                  {shown.map((item) => (
                    <Bar key={item.key} dataKey={item.key} fill={item.color} radius={[0, 3, 3, 0]} maxBarSize={7} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {legend}
          </>
        ) : (
          <div className="agent-chart-donut">
            <div className="agent-chart-ring" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 160 }}>
                <PieChart>
                  <Pie data={chart.data} dataKey="value" nameKey="x" innerRadius="62%" outerRadius="100%" paddingAngle={chart.data.length > 1 ? 1.5 : 0} stroke="none" isAnimationActive={false}>
                    {chart.data.map((row, index) => (
                      <Cell key={String(row.x)} fill={color(String(row.x), index)} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="agent-chart-legend">
              {chart.data.map((row, index) => (
                <li key={String(row.x)}>
                  <i style={{ background: color(String(row.x), index) }} aria-hidden="true" />
                  <span>{String(row.x)}</span>
                  <span className="tabular-nums">{typeof row.value === 'number' ? format.value(row.value) : '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </figure>
    </SectionCard>
  );
}

/** Key figures: the app's metric strip (short label, value, its change as the app's change chip, a note under it). */
export function AgentMetrics({ metrics }: { metrics: MetricSpec[] }) {
  return (
    <MetricGrid columns={metrics.length} mobilePairs>
      {metrics.map((metric) => (
        <MetricCard
          key={metric.label}
          label={metric.label}
          value={metric.value}
          description={metric.note}
          delta={metric.delta ? <span className={`metric-change ${/^[+]/.test(metric.delta) ? 'positive' : /^[-−]/.test(metric.delta) ? 'negative' : 'neutral'}`}>{metric.delta}</span> : undefined}
        />
      ))}
    </MetricGrid>
  );
}

// ---------------------------------------------------------------- data blocks bound to the project (lib/agent-blocks.ts)

/** The artifact's own setting: its blocks with no setting of their own follow it. */
export const ArtifactLiveContext = createContext(false);

const METRIC_LABELS: Record<string, [string, string]> = {
  visibility: ['Visibility', 'Visibilidade'],
  shareOfVoice: ['Share of voice', 'Share of voice'],
  citationPresence: ['Citation presence', 'Presença em citações'],
  mentionPosition: ['Mention position', 'Posição da menção'],
  citations: ['Citations', 'Citações'],
  responses: ['Answers', 'Respostas'],
  share: ['Share of citations', 'Participação nas citações'],
  sentiment_index: ['Sentiment index', 'Índice de sentimento'],
  score: ['Score', 'Score'],
  answers: ['Answers', 'Respostas'],
  occurrences: ['Searches', 'Buscas'],
};
/** Owners and site types as the Sources screen names them. */
const ownerLabel = (owner: unknown): [string, string] => SOURCE_OWNER_LABELS[owner as SourceOwner]?.label ?? [String(owner ?? ''), String(owner ?? '')];
const typeLabel = (type: unknown): [string, string] =>
  type === 'unclassified' ? ['Unclassified', 'Sem tipo'] : (SOURCE_TYPE_DEFINITIONS[type as SourceType]?.label ?? [String(type ?? ''), String(type ?? '')]);

/** The block's title: the one it was given, or what it shows. */
function liveTitle(block: LiveBlock, t: (en: string, pt: string) => string) {
  if (block.title) return block.title;
  if (block.data === 'report') return (block.series ?? []).map((item) => t(...(METRIC_LABELS[item.label] ?? [item.label, item.label]))).join(', ');
  const [en, pt] = METRIC_LABELS[block.metric ?? 'visibility'];
  if (block.data === 'overview') return block.shape === 'line' ? t(`${en} by day`, `${pt} por dia`) : block.metric ? t(en, pt) : t('Overview', 'Visão geral');
  if (block.data === 'models') return t(`${en} by AI model`, `${pt} por modelo de IA`);
  if (block.data === 'brands') return block.shape === 'table' ? t('Brand ranking', 'Ranking de marcas') : t(`${en} by brand`, `${pt} por marca`);
  if (block.data === 'prompts') return t('Prompts with the most visibility', 'Prompts com mais visibilidade');
  if (block.data === 'sources') return t('Most cited sources', 'Fontes mais citadas');
  return t('Cited sources by site type', 'Fontes citadas por tipo de site');
}

/**
 * A data block: its figures drawn with the app's pieces (key figures, chart, table), and under them when they are from
 * (updated now, or the date they were kept). In the editor it also switches between updating by itself and keeping them.
 */
export function LiveBlockView({ block, onMode }: { block: LiveBlock; onMode?: (mode: 'live' | 'frozen') => void }) {
  const t = useCopy();
  const { locale } = useNumbers();
  const live = isLive(block, useContext(ArtifactLiveContext));
  const title = liveTitle(block, t);
  const rows = block.snapshot ?? [];
  const metric = block.metric ?? (block.data === 'source-types' ? 'share' : 'visibility');
  const missing = t('Not measured', 'Não medido');
  const label = (key: string) => t(...(METRIC_LABELS[key] ?? [key, key]));
  const value = (key: string, number: unknown) =>
    typeof number !== 'number' ? missing : key === 'mentionPosition' ? formatNumber(locale, number, 1) : ['citations', 'responses'].includes(key) ? formatNumber(locale, number) : `${formatNumber(locale, number, 1)}%`;
  // In UTC, the day the project's periods are counted in (the agent's "last 28 days" end on the UTC day too), and the
  // same on the server and in every browser.
  const date = block.captured_at ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(block.captured_at)) : '';
  const unit = metric === 'mentionPosition' ? '' : '%';
  let body: ReactNode;
  // A report block: its own series, by label, in its own unit.
  const report = block.data === 'report';
  const series = report ? [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => key !== 'x')))] : [];
  const reported = (number: unknown) => (typeof number !== 'number' ? missing : `${formatNumber(locale, number, Number.isInteger(number) ? 0 : 1)}${block.unit === '%' ? '%' : block.unit ? ` ${block.unit}` : ''}`);
  if (!block.snapshot) body = <p className="text-caption text-muted-foreground">{t('Its figures appear when the artifact is saved.', 'Os números aparecem quando o artefato for salvo.')}</p>;
  else if (!rows.length) body = <p className="text-caption text-muted-foreground">{t('Nothing was measured in this period.', 'Nada foi medido neste período.')}</p>;
  else if (report && block.shape === 'metrics')
    body = (
      <MetricGrid columns={Math.min(rows.length, 4)} mobilePairs>
        {rows.slice(0, 4).map((row) => (
          <MetricCard key={String(row.x)} label={String(row.x)} value={reported(row[series[0]])} />
        ))}
      </MetricGrid>
    );
  else if (report && block.shape === 'table')
    body = (
      <SectionCard title={title} className="agent-chart">
        <DataTable
          rows={rows}
          rowKey={(_, index) => String(index)}
          columns={[
            { key: 'x', header: block.name ?? t('Name', 'Nome'), mobile: 'title' as const, cellClassName: 'whitespace-normal', cell: (row: LiveRow) => String(row.x ?? '') },
            ...series.map((key) => ({ key, header: label(key), label: label(key), align: 'end' as const, cell: (row: LiveRow) => reported(row[key]) })),
          ]}
        />
      </SectionCard>
    );
  else if (report) {
    const chart = liveChart(block, rows, title, label);
    body = chart ? <AgentChart chart={chart} /> : <p className="text-caption text-muted-foreground">{t('These figures cannot be drawn as this chart.', 'Estes números não podem ser desenhados neste gráfico.')}</p>;
  } else if (block.shape === 'metrics') {
    // The four key figures, or only the one the block names; the change as the Overview's cards show it (a lower mention
    // position is the better one).
    const shown = (block.metric ? rows.filter((row) => row.key === block.metric) : rows).slice(0, 4);
    body = (
      <MetricGrid columns={Math.max(shown.length, 1)} mobilePairs>
        {shown.map((row) => (
          <MetricCard
            key={String(row.key)}
            label={label(String(row.key))}
            value={value(String(row.key), row.value)}
            delta={typeof row.delta === 'number' ? <Change value={row.delta} unit={row.key === 'mentionPosition' ? '' : ' pp'} locale={locale} invert={row.key === 'mentionPosition'} period={false} /> : undefined}
          />
        ))}
      </MetricGrid>
    );
  } else if (block.shape === 'table') {
    const keys = Object.keys(rows[0]).filter((key) => key !== 'x');
    body = (
      <SectionCard title={title} className="agent-chart">
        <DataTable
          rows={rows}
          rowKey={(_, index) => String(index)}
          columns={[
            {
              key: 'x',
              header: block.data === 'models' ? t('AI model', 'Modelo de IA') : block.data === 'brands' ? t('Brand', 'Marca') : block.data === 'prompts' ? 'Prompt' : block.data === 'sources' ? t('Domain', 'Domínio') : t('Site type', 'Tipo de site'),
              mobile: 'title' as const,
              cellClassName: 'whitespace-normal',
              cell: (row: LiveRow) => (block.data === 'source-types' ? t(...typeLabel(row.x)) : String(row.x ?? '')),
            },
            ...keys.map((key) => ({
              key,
              header: key === 'topic' ? t('Topic', 'Tópico') : key === 'ownership' ? t('Owner', 'Origem') : label(key),
              label: key === 'topic' ? t('Topic', 'Tópico') : key === 'ownership' ? t('Owner', 'Origem') : label(key),
              align: key === 'topic' || key === 'ownership' ? undefined : ('end' as const),
              cell: (row: LiveRow) => (key === 'topic' ? (row.topic ?? '') : key === 'ownership' ? t(...ownerLabel(row.ownership)) : value(key, row[key])),
            })),
          ]}
        />
      </SectionCard>
    );
  } else {
    const named = (row: LiveRow) => (block.data === 'source-types' ? t(...typeLabel(row.x)) : String(row.x ?? ''));
    const chart: ChartSpec =
      block.shape === 'line'
        ? { type: 'line', title, unit, series: [{ key: 'value', label: label(metric) }], data: rows }
        : block.shape === 'donut'
          ? { type: 'donut', title, unit: '%', series: [], data: rows.map((row) => ({ x: named(row), value: typeof row[metric] === 'number' ? row[metric] : null })) }
          : { type: 'bar', title, unit, series: [{ key: metric, label: label(metric) }], data: rows.map((row) => ({ x: named(row), [metric]: row[metric] ?? null })) };
    body = <AgentChart chart={chart} />;
  }
  return (
    <div className="agent-live" data-live={live || undefined}>
      {(block.shape === 'metrics' || !rows.length) && <p className="agent-live-title">{title}</p>}
      {body}
      <div className="agent-live-foot text-caption text-muted-foreground">
        <span>{date ? (live ? t(`Updated ${date}`, `Atualizado em ${date}`) : t(`Figures from ${date}`, `Números de ${date}`)) : ''}</span>
        {onMode && (
          <label className="agent-live-toggle">
            <Switch size="sm" checked={live} onCheckedChange={(checked) => onMode(checked ? 'live' : 'frozen')} />
            {t('Update automatically', 'Atualizar automaticamente')}
          </label>
        )}
      </div>
    </div>
  );
}

/**
 * An answer or an artifact: its Markdown, charts and key figures in order (a block still arriving holds its place).
 * `document`: an artifact, with its headings on the document scale and at reading width, as its editor draws it (agent.css).
 */
export function AgentMarkdown({ text, document }: { text: string; document?: boolean }) {
  const t = useCopy();
  const blocks = useMemo(() => splitBlocks(tidy(text)), [text]);
  return (
    <div className="agent-markdown live-answer-markdown" data-document={document || undefined}>
      {blocks.map((block, index) =>
        block.kind === 'markdown' ? (
          <AnswerMarkdown key={index} text={block.text} headings={document} />
        ) : block.kind === 'chart' ? (
          <AgentChart key={index} chart={block.chart} />
        ) : block.kind === 'metrics' ? (
          <AgentMetrics key={index} metrics={block.metrics} />
        ) : block.kind === 'live' ? (
          <LiveBlockView key={index} block={block.block} />
        ) : (
          <div key={index} className="analytics-panel agent-chart-pending" aria-busy="true" aria-label={block.lang === 'chart' ? t('Drawing a chart', 'Desenhando um gráfico') : t('Gathering figures', 'Reunindo números')}>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-32 w-full" />
          </div>
        ),
      )}
    </div>
  );
}
