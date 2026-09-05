'use client';
import { useI18n } from '@/lib/i18n';
import { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { Run } from '@/lib/types';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
export function VisibilityChart({
  runs,
  brandName,
  competitors,
  points,
}: {
  runs: Run[];
  brandName: string;
  competitors: string[];
  points?: Record<string, string | number>[];
}) {
  const { t, locale } = useI18n();
  const data = useMemo(() => {
    if (points)
      return points.map((point) => ({
        ...point,
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(point.date))
          ? new Date(`${point.date}T12:00:00Z`).toLocaleDateString(locale, {
              day: '2-digit',
              month: 'short',
              timeZone: 'UTC',
            })
          : point.date,
      }));
    const days = new Map<string, Run[]>();
    for (const r of runs.filter(
      (x) => x.status === 'complete' && x.response_available !== false,
    )) {
      const date = r.created_at.slice(0, 10);
      days.set(date, [...(days.get(date) ?? []), r]);
    }
    return [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rs]) => ({
        date: new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, {
          day: '2-digit',
          month: 'short',
          timeZone: 'UTC',
        }),
        brand: Math.round(
          (rs.filter((r) => r.mentions[r.brand_name]).length / rs.length) * 100,
        ),
        ...Object.fromEntries(
          competitors.map((c, i) => [
            `c${i}`,
            Math.round(
              (rs.filter((r) => r.mentions[c]).length / rs.length) * 100,
            ),
          ]),
        ),
      }));
  }, [runs, competitors, points, locale]);
  if (!data.length)
    return (
      <Empty className="chart-empty">
        <EmptyHeader>
          <EmptyTitle>
            {t('Sua primeira resposta começa uma história.')}
          </EmptyTitle>
          <EmptyDescription>
            {t(
              'Suas respostas aparecerão automaticamente. O gráfico cresce a cada atualização.',
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <figure
      className="live-chart"
      aria-label={
        locale === 'en'
          ? `Daily visibility of ${brandName} and competitors. Percentage of answers mentioning each brand.`
          : `Visibilidade diária de ${brandName} e concorrentes. Percentual de respostas em que cada marca foi mencionada.`
      }
    >
      <ResponsiveContainer width="100%" height={285}>
        <AreaChart
          data={data}
          margin={{ top: 15, right: 12, left: 0, bottom: 5 }}
        >
          <defs>
            <linearGradient id="liveArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="4 5"
            vertical={false}
            stroke="var(--border)"
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            minTickGap={35}
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            dy={8}
          />
          <YAxis
            width={44}
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          />
          <Tooltip
            contentStyle={{
              border: '1px solid var(--border)',
              background: 'var(--popover)',
              color: 'var(--popover-foreground)',
              borderRadius: 8,
              fontSize: 13,
            }}
            formatter={(value) => [`${typeof value === 'number' ? value : 0}%`]}
          />
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ fontSize: 12, paddingTop: 20 }}
          />
          <Area
            type="monotone"
            dataKey="brand"
            name={brandName}
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            fill="url(#liveArea)"
            dot={data.length === 1}
            isAnimationActive={false}
          />
          {competitors.map((name, i) => (
            <Area
              key={name}
              type="monotone"
              dataKey={`c${i}`}
              name={name}
              stroke={`var(--chart-${(i % 4) + 2})`}
              strokeDasharray={['6 4', '2 4', '10 3 2 3', '4 2'][i % 4]}
              fill="transparent"
              strokeWidth={1.5}
              dot={data.length === 1}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
