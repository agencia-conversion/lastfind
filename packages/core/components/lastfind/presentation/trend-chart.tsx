'use client';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';

export type TrendSeries = { id: string; key: string; name: string; color: string; primary?: boolean };

const CAPTION_PX = 12;
const BODY_PX = 14;
const dateFormat = (locale: string, options: Intl.DateTimeFormatOptions) => (date: unknown) =>
  new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

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
}) {
  const order = new Map(series.map((item, index) => [item.key, index]));
  const names = new Map(series.map((item) => [item.key, item.name]));
  const single = new Set(series.filter((item) => data.filter((row) => row[item.key] != null).length === 1).map((item) => item.key));
  return (
    <figure className="trend-chart" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 233 }}>
        <ComposedChart data={data} margin={{ top: 15, right: 12, bottom: 5, left: -18 }}>
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
            allowDecimals={reversed}
            tick={{ fontSize: CAPTION_PX, fill: 'var(--muted-foreground)' }}
            tickFormatter={(value) => formatTick(Number(value))}
          />
          <Tooltip
            itemSorter={(item) => order.get(String(item.dataKey)) ?? Infinity}
            labelFormatter={dateFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
            contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: BODY_PX }}
            formatter={(value, name) => [formatValue(Number(value)), names.get(String(name)) ?? name]}
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
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}

// Legend in the same order as the chart; each entry toggles its series.
export function SeriesLegend({
  series,
  hidden,
  onToggle,
  className,
}: {
  series: TrendSeries[];
  hidden: string[];
  onToggle: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('chart-legend', className)}>
      {series.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={!hidden.includes(item.id)}
          className={hidden.includes(item.id) ? 'muted-series' : ''}
          onClick={() => onToggle(item.id)}
        >
          <i style={{ background: item.color }} />
          {item.name}
        </button>
      ))}
    </div>
  );
}
