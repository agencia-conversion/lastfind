'use client';
import { useEffect, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { CartesianGrid, ComposedChart, Line, XAxis, YAxis, usePlotArea } from 'recharts';
import { cva } from 'class-variance-authority';
import { ChartTooltip as Tooltip } from '@/components/ui/chart';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Hint } from '@/components/ui/tooltip';
import { lastPointerType } from '@/lib/use-touch-dismiss';
import { useSeriesToggle } from '@/lib/chart-series';
import { cn } from '@/lib/utils';
import { SectionCard } from './section-card';
import './trend-chart.css';

export type TrendSeries = {
  id: string;
  key: string;
  name: string;
  color: string;
  primary?: boolean;
  /** Shown before the name in the tooltip (a brand's favicon). */
  icon?: ReactNode;
};

const CAPTION_PX = 12;
/**
 * The value axis' width, wide enough for its longest label ("2,5 mil", "100%"): Recharts' default 60 px, less the chart's
 * -18 px left margin, cut a label's first characters. Every trend chart takes it here.
 * ponytail: a label's width is estimated from its characters at the caption size; measure it if a font makes this wrong.
 */
export const yAxisWidth = (labels: string[]) => Math.max(60, 28 + Math.ceil(Math.max(0, ...labels.map((label) => label.length)) * CAPTION_PX * 0.6));
// Recharts can only flip a tooltip inside the plot when its width fits there.
function TrendTooltip(props: ComponentProps<typeof Tooltip>) {
  const plot = usePlotArea();
  return (
    <Tooltip
      {...props}
      wrapperStyle={{ maxWidth: plot?.width, zIndex: 1 }}
    />
  );
}

// One row per series at the hovered date, in the chart's order: colour dot, icon, name, value.
function TrendTooltipContent({
  active,
  payload,
  label,
  series,
  formatLabel,
  formatValue,
}: {
  active?: boolean;
  payload?: readonly { dataKey?: unknown; value?: unknown }[];
  label?: unknown;
  series: TrendSeries[];
  formatLabel: (date: unknown) => string;
  formatValue: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const shown = new Set(payload.filter((entry) => entry.value != null).map((entry) => String(entry.dataKey)));
  const values = new Map(payload.map((entry) => [String(entry.dataKey), Number(entry.value)]));
  return (
    <div className="trend-tooltip">
      <p>{formatLabel(label)}</p>
      <ul>
        {series.filter((item) => shown.has(item.key)).map((item) => (
          <li key={item.key}>
            <i style={{ background: item.color }} aria-hidden="true" />
            {item.icon}
            <span className="trend-tooltip-name">{item.name}</span>
            <span className="trend-tooltip-value">{formatValue(values.get(item.key)!)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const dateFormat = (locale: string, options: Intl.DateTimeFormatOptions) => (date: unknown) =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

// Chart size = size of its container. A full-page capture collapses the viewport to
// 1x1 for a moment: ResponsiveContainer would unmount the chart and
// the capture catches it blank, so measurements during that viewport collapse are ignored.
function useChartSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 500, height: 233 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (window.innerWidth > 1 && window.innerHeight > 1 && width > 1 && height > 1) setSize((last) => (last.width === width && last.height === height ? last : { width, height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

// The only multi-series line chart. `series` is already ordered (biggest period
// total first, see lib/chart-series.ts): drawing order, tooltip order and the
// legend all follow that one order, while each brand keeps its own colour.
export function TrendChart<Row extends Record<string, unknown>>({
  data,
  series,
  scale,
  locale,
  reversed,
  monthly,
  formatValue,
  formatTick,
  label,
  onSelectDate,
  onSelectSeries,
}: {
  data: Row[];
  series: TrendSeries[];
  scale: { domain: number[]; ticks: number[] };
  locale: string;
  reversed?: boolean;
  monthly?: boolean;
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  label: string;
  /** Drill down: a click on the chart opens what is behind that point (its date: the row's `date`). */
  onSelectDate?: (date: string, event: MouseEvent) => void;
  /** Drill down: a click on a series' point at the hovered date opens what is behind that series on that date. */
  onSelectSeries?: (date: string, series: TrendSeries, event: MouseEvent) => void;
}) {
  const { ref, size } = useChartSize();
  const single = new Set(series.filter((item) => data.filter((row) => row[item.key] != null).length === 1).map((item) => item.key));
  return (
    <figure className="trend-chart" aria-label={label}>
      <div ref={ref} className="trend-chart-canvas">
        <ComposedChart
          width={size.width}
          height={size.height}
          data={data}
          margin={{ top: 15, right: 12, bottom: 5, left: -18 }}
          style={onSelectDate ? { cursor: 'pointer' } : undefined}
          // A finger's tap shows the day's balloon (a phone has no hover); the day's answers open from a click.
          onClick={onSelectDate ? (state, event) => { if (state?.activeLabel != null && lastPointerType() === 'mouse') onSelectDate(String(state.activeLabel), event); } : undefined}
        >
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={38}
            tick={{ fontSize: CAPTION_PX, fill: 'var(--muted-foreground)' }}
            tickFormatter={dateFormat(locale, { day: monthly ? undefined : 'numeric', month: 'short' })}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            reversed={reversed}
            domain={scale.domain}
            ticks={scale.ticks}
            width={yAxisWidth(scale.ticks.map((tick) => formatTick(tick)))}
            allowDecimals={reversed}
            tick={{ fontSize: CAPTION_PX, fill: 'var(--muted-foreground)' }}
            tickFormatter={(value) => formatTick(Number(value))}
          />
          <TrendTooltip
            content={(props) => (
              <TrendTooltipContent
                {...props}
                series={series}
                formatLabel={dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                formatValue={formatValue}
              />
            )}
          />
          {series.map((item) => (
            <Line
              key={item.id}
              dataKey={item.key}
              name={item.key}
              type="monotone"
              stroke={item.color}
              strokeWidth={item.primary ? 2.5 : 1.5}
              dot={(props) => {
                const { cx, cy, payload, index } = props;
                if (payload?.[item.key] == null || !single.has(item.key)) return <g key={index} />;
                return <circle key={index} cx={cx} cy={cy} r={3} fill={item.color} />;
              }}
              activeDot={onSelectSeries ? (props) => (
                <circle
                  cx={props.cx}
                  cy={props.cy}
                  r={5}
                  fill={item.color}
                  stroke="var(--background)"
                  strokeWidth={2}
                  style={{ cursor: 'pointer' }}
                  onClick={(event) => {
                    // The point, not the whole date (the chart's own click).
                    event.stopPropagation();
                    onSelectSeries(String((props.payload as Record<string, unknown>)?.date), item, event);
                  }}
                />
              ) : { r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </ComposedChart>
      </div>
    </figure>
  );
}

const chartLegendVariants = cva('chart-legend', {
  variants: { interactive: { true: 'chart-legend-interactive', false: '' }, layout: { row: '', list: 'chart-legend-list' } },
  defaultVariants: { layout: 'row' },
});

export type LegendItem = Pick<TrendSeries, 'id' | 'name' | 'color'> & {
  /** `layout="list"`: the figure at the row's end (a share, a count). */
  value?: ReactNode;
  /** `layout="list"` with `onSelect`: a row that opens nothing (a sum of the rest) keeps its place without the arrow. */
  static?: boolean;
};

/**
 * The one chart legend (docs/design/shell.md section 7), in the chart's order: a dot and the name of each series.
 * `interactive` (several series) makes each entry a toggle (`aria-pressed`). The legend names only what the chart draws by
 * default: `folded` (the brands past the first ten, never turned on or off) wait behind a last "+N" whose menu turns one on,
 * so a chart of ten brands never reads as eleven. A brand the person turned off stays in place, struck out.
 * `layout="list"` (beside a donut): one row per slice with its figure at the end; with `onSelect` the whole row opens what it
 * names (`selectLabel` is its accessible name), an arrow at the end saying so.
 */
export function ChartLegend({
  series,
  hidden = [],
  onToggle,
  interactive = !!onToggle,
  folded = [],
  layout = 'row',
  onSelect,
  selectLabel,
  className,
}: {
  series: LegendItem[];
  hidden?: string[];
  onToggle?: (id: string) => void;
  interactive?: boolean;
  folded?: string[];
  layout?: 'row' | 'list';
  onSelect?: (id: string) => void;
  selectLabel?: (item: LegendItem) => string;
  className?: string;
}) {
  const dot = (item: Pick<TrendSeries, 'color'>) => <i className="size-2 shrink-0 rounded-full" style={{ background: item.color }} aria-hidden="true" />;
  if (layout === 'list')
    return (
      <ul className={cn(chartLegendVariants({ layout }), className)}>
        {series.map((item) => {
          const entry = (
            <>
              {dot(item)}
              <span className="chart-legend-name">{item.name}</span>
              <span className="chart-legend-value">{item.value}</span>
              {onSelect && (item.static ? <span aria-hidden="true" /> : <ArrowUpRight size={14} aria-hidden="true" />)}
            </>
          );
          return (
            <li key={item.id}>
              {onSelect && !item.static ? (
                <button type="button" className="chart-legend-row" aria-label={selectLabel?.(item)} onClick={() => onSelect(item.id)}>{entry}</button>
              ) : (
                <span className="chart-legend-row">{entry}</span>
              )}
            </li>
          );
        })}
      </ul>
    );
  const waiting = interactive && onToggle ? series.filter((item) => folded.includes(item.id)) : [];
  return (
    <div className={cn(chartLegendVariants({ interactive, layout }), className)}>
      {series.filter((item) => !waiting.includes(item)).map((item) => {
        const entry = (
          <>
            {dot(item)}
            <span>{item.name}</span>
          </>
        );
        return (
          <Hint key={item.id} text={item.name}>
            {interactive && onToggle ? (
              <button type="button" aria-pressed={!hidden.includes(item.id)} onClick={() => onToggle(item.id)}>
                {entry}
              </button>
            ) : (
              <span>{entry}</span>
            )}
          </Hint>
        );
      })}
      {waiting.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className="chart-legend-more">+{waiting.length}</DropdownMenuTrigger>
          <DropdownMenuContent className="analytics-menu" align="end">
            {waiting.map((item) => (
              <DropdownMenuItem key={item.id} onClick={() => onToggle!(item.id)}>
                {dot(item)}
                <span className="min-w-0 truncate">{item.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}


/**
 * The one trend card: a SectionCard with the TrendChart and its ChartLegend, always under it (one series too, as Brand trend).
 * The interactive legend starts on the primary series and the biggest totals (`total`, `useSeriesToggle`), or follows `hidden`
 * and `onToggle` when the screen keeps that state (its scale or ranking depends on what is shown). `loading` draws the same
 * card with a chart-sized placeholder; `empty` (an EmptyState) takes the chart's place when there is nothing to draw, and the
 * legend stays so a hidden brand can be turned back on.
 */
export function TrendCard<Row extends Record<string, unknown>>({
  title,
  info,
  action,
  className,
  loading,
  empty,
  total,
  series,
  hidden,
  folded,
  onToggle,
  ...chart
}: Omit<Parameters<typeof TrendChart<Row>>[0], 'label'> & {
  title: string;
  info?: string;
  action?: ReactNode;
  className?: string;
  loading?: boolean;
  empty?: ReactNode;
  total?: (series: TrendSeries) => number;
  label?: string;
  /** Controlled legend: the ids turned off, the ones of them left as drawn by default (`folded`), and the click on one. */
  hidden?: string[];
  folded?: string[];
  onToggle?: (id: string) => void;
}) {
  const own = useSeriesToggle(series, total);
  const toggle = hidden && onToggle ? { hidden, folded: folded ?? [], visible: series.filter((item) => !hidden.includes(item.id)), toggle: onToggle } : own;
  return (
    <SectionCard title={title} info={info} action={action} className={cn('trend-card', className)}>
      {loading ? (
        <div className="grid gap-4 px-5 pb-5" aria-busy="true" aria-label={title}>
          <Skeleton className="h-64 w-full" />
          <Skeleton inline className="mx-auto h-lh w-64 max-w-full" />
        </div>
      ) : (
        <>
          {empty ?? <TrendChart {...chart} label={chart.label ?? title} series={toggle.visible} />}
          {/* Always, also for one series, as the Overview's Brand trend: the reader sees whose line it is and can turn it off. */}
          {series.length > 0 && <ChartLegend series={series} hidden={toggle.hidden} folded={toggle.folded} onToggle={toggle.toggle} />}
        </>
      )}
    </SectionCard>
  );
}
