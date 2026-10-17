'use client';
import { Eye, MessageSquare, ListOrdered } from 'lucide-react';
import {
  brandMetrics,
  type DemoReport,
} from './demo-data';
import { getTrendScale } from '@/lib/report-trend';
import { MetricCard, MetricGrid } from '@/components/lastfind/presentation/metric-card';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { BrandMark, Change, useCopy, useNumbers } from './shared';

type Metric = 'visibility' | 'shareOfVoice' | 'position';
// Shared by the interactive chart and its server-rendered public presentation.
export function getTrendPoints(report: DemoReport, metric: Metric) {
  return report.trend.map((point) => {
    const rows = report.responses.filter((r) => r.date.startsWith(point.date));
    if (!rows.length) return null;
    const totalMentions = rows.reduce(
      (sum, response) => sum + response.brandIds.length,
      0,
    );
    return {
      date: point.date,
      ...Object.fromEntries(
        report.brands.map((brand) => {
          const values = brandMetrics(rows, brand.id);
          const value =
            metric === 'shareOfVoice'
              ? totalMentions
                ? (values.mentions / totalMentions) * 100
                : null
              : !rows.length || (metric === 'position' && !values.mentions)
                ? null
                : values[metric];
          return [brand.id, value === null ? null : Number(value.toFixed(1))];
        }),
      ),
    };
  }).filter((point) => point !== null);
}
export function formatPositionTick(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    value,
  );
}

export { getTrendScale };

export function BrandRanking({
  report,
  onBrand,
  full = false,
}: {
  report: DemoReport;
  onBrand: (id: string) => void;
  full?: boolean;
}) {
  const l = useCopy();
  const { number, percent } = useNumbers();
  const hasResponses = report.responses.length > 0;
  return (
    <DataTable
      rows={report.brands}
      rowKey={(brand) => brand.id}
      rowClassName={(brand) => (brand.id === 'conversion' ? 'own-brand-row' : undefined)}
      columns={[
        { key: 'rank', header: '#', width: '2rem', mobile: 'hide', cell: (_, i) => <span className="text-muted-foreground">{number(i + 1)}</span> },
        {
          key: 'brand',
          header: l('Brand', 'Marca'),
          mobile: 'title',
          cell: (brand) => (
            <button type="button" className="brand-link" onClick={() => onBrand(brand.id)}>
              <BrandMark brand={brand} small />
              <span>{brand.name}</span>
              {brand.id === 'conversion' && <TagBadge tone="primary">{l('You', 'Você')}</TagBadge>}
            </button>
          ),
        },
        {
          key: 'visibility',
          header: l('Visibility', 'Visibilidade'),
          align: 'end',
          label: l('Visibility', 'Visibilidade'),
          cell: (brand) => (
            <div className="flex items-center justify-end gap-2">
              <span>{hasResponses ? percent(brand.visibility) : '—'}</span>
              {hasResponses && !!report.previous.length && <Change value={brand.change} />}
            </div>
          ),
        },
        { key: 'mentions', header: l('Mentions', 'Menções'), align: 'end', label: l('Mentions', 'Menções'), cell: (brand) => number(brand.mentions) },
        ...(full
          ? [{ key: 'position', header: l('Position', 'Posição'), align: 'end' as const, label: l('Position', 'Posição'), cell: (brand: DemoReport['brands'][number]) => (brand.mentions ? number(brand.position, 1) : '—') }]
          : []),
      ]}
    />
  );
}

export function OverviewMetrics({ report }: { report: DemoReport }) {
  const l = useCopy();
  const { number, percent } = useNumbers();
  const own = report.brands.find((b) => b.id === 'conversion')!;
  const stats = [
    {
      title: l('Visibility', 'Visibilidade'),
      value: report.responses.length ? percent(own.visibility) : '—',
      icon: Eye,
      change:
        report.responses.length && report.previous.length
          ? own.change
          : undefined,
      caption: l(
        'of AI responses mention your brand',
        'das respostas mencionam sua marca',
      ),
      help: l(
        `Responses mentioning ${own.name} ÷ all responses in this selection.`,
        `Respostas com ${own.name} ÷ todas as respostas desta seleção.`,
      ),
    },
    {
      title: l('Share of voice', 'Share of voice'),
      value: report.brands.some((brand) => brand.mentions > 0)
        ? percent(
            (own.mentions / report.brands.reduce((n, b) => n + b.mentions, 0)) *
              100,
          )
        : '—',
      icon: MessageSquare,
      caption: l(
        'of all tracked brand mentions',
        'de todas as menções às marcas',
      ),
      help: l(
        `${own.name} mentions ÷ mentions of all tracked brands.`,
        `Menções a ${own.name} ÷ menções a todas as marcas acompanhadas.`,
      ),
    },
    {
      title: l('Average position', 'Posição média'),
      value: own.mentions ? number(own.position, 1) : '—',
      icon: ListOrdered,
      caption: l('among brands in the answer', 'entre as marcas na resposta'),
      help: l(
        'Average order of appearance in an answer. Lower is better.',
        'Ordem média de aparição na resposta. Quanto menor, melhor.',
      ),
    },
  ];
  return (
    <MetricGrid>
      {stats.map((s, index) => (
        <MetricCard
          key={s.title}
          highlight={index === 0}
          icon={<s.icon size={15} />}
          label={s.title}
          definition={s.help}
          value={
            <>
              {s.value}
              {s.change !== undefined && <Change value={s.change} />}
            </>
          }
          description={s.caption}
        />
      ))}
    </MetricGrid>
  );
}
