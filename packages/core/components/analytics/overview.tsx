'use client';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowUpRight,
  ChevronRight,
  Eye,
  Info,
  MessageSquare,
  ListOrdered,
  Globe,
  TrendingUp,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip as Hint,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  brandMetrics,
  demoSources,
  type DemoReport,
  type DemoPrompt,
  type DemoResponse,
} from './demo-data';
import { getTrendScale, rankTrendSeries } from '@/lib/report-trend';
import {
  BrandMark,
  Change,
  EmptyState,
  ModelMark,
  PanelHeading,
  SiteFavicon,
  useCopy,
  useNumbers,
} from './shared';

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
  return (
    <Table className="analytics-table">
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">#</TableHead>
          <TableHead>{l('Brand', 'Marca')}</TableHead>
          <TableHead className="text-right">
            {l('Visibility', 'Visibilidade')}
          </TableHead>
          <TableHead className="text-right">
            {l('Mentions', 'Menções')}
          </TableHead>
          {full && (
            <TableHead className="text-right">
              {l('Position', 'Posição')}
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.brands.map((b, i) => (
          <TableRow
            key={b.id}
            className={b.id === 'conversion' ? 'own-brand-row' : ''}
          >
            <TableCell className="text-muted-foreground">
              {number(i + 1)}
            </TableCell>
            <TableCell>
              <button className="brand-link" onClick={() => onBrand(b.id)}>
                <BrandMark brand={b} small />
                <span>{b.name}</span>
                {b.id === 'conversion' && (
                  <span className="you-tag">{l('You', 'Você')}</span>
                )}
              </button>
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-2">
                <span className="font-medium">
                  {report.responses.length ? percent(b.visibility) : '—'}
                </span>
                {!!report.responses.length && !!report.previous.length && (
                  <Change value={b.change} />
                )}
              </div>
            </TableCell>
            <TableCell className="text-right">{number(b.mentions)}</TableCell>
            {full && (
              <TableCell className="text-right">
                {b.mentions ? number(b.position, 1) : '—'}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TrendChart({
  report,
  metric,
}: {
  report: DemoReport;
  metric: Metric;
}) {
  const l = useCopy();
  const { number, percent, locale } = useNumbers();
  const chartDate = (date: string, full = false) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      ...(full ? { year: 'numeric' as const } : {}),
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`));
  const [hidden, setHidden] = useState<string[]>([]);
  const points = useMemo(
    () => getTrendPoints(report, metric),
    [report, metric],
  );
  // One scale for all brands, independent of legend toggles. Rounded bounds and
  // padding spread clustered lines without clipping extremes or changing ratios.
  const { domain, ticks } = getTrendScale(
    points,
    report.brands.filter((brand) => !hidden.includes(brand.id)).map((brand) => brand.id),
    metric,
  );
  const totalMentions = report.responses.reduce(
    (sum, response) => sum + response.brandIds.length,
    0,
  );
  const tooltipRank = new Map(rankTrendSeries(report.brands
    .map((brand) => {
      const values = brandMetrics(report.responses, brand.id);
      return {
        key: brand.id,
        name: brand.name,
        value:
          metric === 'shareOfVoice'
            ? totalMentions
              ? (values.mentions / totalMentions) * 100
              : null
            : metric === 'position'
              ? values.mentions
                ? values.position
                : null
              : report.responses.length
                ? values.visibility
                : null,
      };
    })));
  return (
    <>
      <figure
        className="trend-chart"
        aria-label={l(
          `Daily ${metric} trend for six brands. Exact values available in the brand table.`,
          'Evolução diária de seis marcas. Valores exatos disponíveis na tabela de marcas.',
        )}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={0}
          initialDimension={{ width: 500, height: 233 }}
        >
          <ComposedChart
            data={points}
            margin={{ top: 15, right: 12, bottom: 5, left: -18 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="3 4"
            />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              minTickGap={38}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              tickFormatter={(date) => chartDate(String(date))}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
              domain={domain}
              ticks={ticks}
              allowDecimals={metric === 'position'}
              reversed={metric === 'position'}
              tickFormatter={(n) =>
                metric === 'visibility' || metric === 'shareOfVoice'
                  ? percent(Number(n), 0)
                  : formatPositionTick(Number(n), locale)
              }
            />
            <Tooltip
              contentStyle={{
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 14,
              }}
              labelFormatter={(date) => chartDate(String(date), true)}
              itemSorter={(item) => tooltipRank.get(String(item.dataKey)) ?? Infinity}
              formatter={(value, name) => [
                metric === 'visibility' || metric === 'shareOfVoice'
                  ? percent(Number(value))
                  : number(Number(value), metric === 'position' ? 1 : 0),
                report.brands.find((b) => b.id === name)?.name ?? name,
              ]}
            />
            {report.brands.map(
              (b) =>
                !hidden.includes(b.id) && (
                  <Line
                    key={b.id}
                    dataKey={b.id}
                    type="monotone"
                    stroke={b.color}
                    strokeWidth={b.id === 'conversion' ? 2.5 : 1.5}
                    dot={(props) => {
                      if (props.payload?.[b.id] == null || points.filter((point) => (point as Record<string, unknown>)[b.id] != null).length !== 1) return <g key={props.index} />;
                      return <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill={b.color} />;
                    }}
                    connectNulls
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </figure>
      <div className="chart-legend">
        {report.brands.map((b) => (
          <button
            key={b.id}
            aria-pressed={!hidden.includes(b.id)}
            className={hidden.includes(b.id) ? 'muted-series' : ''}
            onClick={() =>
              setHidden((s) =>
                s.includes(b.id) ? s.filter((id) => id !== b.id) : [...s, b.id],
              )
            }
          >
            <i style={{ background: b.color }} />
            {b.name}
          </button>
        ))}
      </div>
    </>
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
    <div className="metric-strip">
      {stats.map((s) => (
        <div className="metric-summary" key={s.title}>
          <div className="metric-label">
            <s.icon size={15} />
            <span>{s.title}</span>
            <Hint>
              <TooltipTrigger
                render={<button aria-label={s.help} className="metric-help" />}
              >
                <Info size={12} />
              </TooltipTrigger>
              <TooltipContent className="max-w-60">{s.help}</TooltipContent>
            </Hint>
          </div>
          <div className="metric-number">
            {s.value}
            {s.change !== undefined && <Change value={s.change} />}
          </div>
          <p>{s.caption}</p>
        </div>
      ))}
    </div>
  );
}

export function Overview({
  report,
  prompts,
  onNavigate,
  onBrand,
  onOpenChat,
}: {
  report: DemoReport;
  prompts: DemoPrompt[];
  onNavigate: (tab: string) => void;
  onBrand: (id: string) => void;
  onOpenChat: (response: DemoResponse) => void;
}) {
  const l = useCopy();
  const { number, percent } = useNumbers();
  const [metric, setMetric] = useState<Metric>('visibility');
  const sources = demoSources
    .map((s) => ({
      ...s,
      count: report.responses.filter((r) => r.sourceIds.includes(s.id)).length,
    }))
    .sort((a, b) => b.count - a.count);
  const recent = [...report.responses]
    .reverse()
    .filter((_, index) => index % 5 === 0)
    .slice(0, 3);
  return (
    <div className="overview-view">
      <OverviewMetrics report={report} />
      {!report.responses.length ? (
        <div className="analytics-panel">
          <EmptyState
            title={l(
              'No responses match these filters',
              'Nenhuma resposta corresponde aos filtros',
            )}
            description={l(
              'Try a different model, topic, or country.',
              'Experimente outro modelo, tópico ou país.',
            )}
          />
        </div>
      ) : (
        <>
          <div className="overview-grid">
            <section className="analytics-panel trend-panel">
              <div className="panel-heading">
                <Tabs
                  value={metric}
                  onValueChange={(v) => setMetric(v as Metric)}
                >
                  <TabsList>
                    <TabsTrigger value="visibility">
                      <Eye />
                      {l('Visibility', 'Visibilidade')}
                    </TabsTrigger>
                    <TabsTrigger value="shareOfVoice">
                      <MessageSquare />
                      Share of voice
                    </TabsTrigger>
                    <TabsTrigger value="position">
                      <ListOrdered />
                      {l('Position', 'Posição')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <span className="chart-period">{l('Daily', 'Diário')}</span>
              </div>
              <TrendChart report={report} metric={metric} />
              <p className="panel-note">
                {metric === 'shareOfVoice'
                  ? l(
                      'Daily brand mentions ÷ all tracked brand mentions. Hiding a line keeps the denominator. Gaps mean no mentions to compare.',
                      'Menções diárias à marca ÷ todas as menções às marcas acompanhadas. Ocultar uma linha preserva o denominador. Lacunas indicam ausência de menções para comparar.',
                    )
                  : l(
                      'Daily evidence gaps stay visible. Position uses responses mentioning each brand; lower is better. The vertical scale fits all selected brands.',
                      'Lacunas indicam ausência de evidência diária. Posição usa respostas com menção à marca; menor é melhor. A escala vertical inclui todas as marcas selecionadas.',
                    )}
              </p>
            </section>
            <section className="analytics-panel ranking-panel">
              <PanelHeading
                title={l('Brand ranking', 'Ranking de marcas')}
                description={l(
                  'Your position in the competitive landscape',
                  'Sua posição entre os concorrentes',
                )}
                action={l('View all', 'Ver todas')}
                onAction={() => onNavigate('competitors')}
              />
              <BrandRanking report={report} onBrand={onBrand} />
              <div className="panel-note">
                <span className="status-dot" />
                {l(
                  'Compared with the previous period',
                  'Comparação com o período anterior',
                )}
              </div>
            </section>
          </div>
          <div className="overview-grid sources-grid">
            <section className="analytics-panel">
              <PanelHeading
                title={l('Top sources', 'Principais fontes')}
                description={l(
                  'The websites shaping AI answers',
                  'Os sites que influenciam as respostas de IA',
                )}
                action={l('View all', 'Ver todas')}
                onAction={() => onNavigate('sources')}
              />
              <Table className="analytics-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>{l('Domain', 'Domínio')}</TableHead>
                    <TableHead className="text-right">
                      {l('Cited in', 'Citado em')}
                    </TableHead>
                    <TableHead className="text-right">
                      {l('Citations', 'Citações')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.slice(0, 5).map((s, i) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-muted-foreground">
                        {number(i + 1)}
                      </TableCell>
                      <TableCell>
                        <button
                          className="brand-link"
                          onClick={() => onNavigate('sources')}
                        >
                          <SiteFavicon
                            domain={s.domain}
                            name={s.title}
                            className="source-mark"
                          />
                          {s.domain}
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        {percent((s.count / report.responses.length) * 100)}
                      </TableCell>
                      <TableCell className="text-right">
                        {number(s.count)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
            <section className="analytics-panel">
              <PanelHeading
                title={l('Citation frequency', 'Frequência de citação')}
                description={l(
                  'Responses citing each source',
                  'Respostas que citam cada fonte',
                )}
              />
              <div className="source-bars">
                {sources.slice(0, 5).map((source) => (
                  <div className="source-bar-row" key={source.id}>
                    <div>
                      <span>{source.domain}</span>
                      <strong>
                        {percent(
                          (source.count / report.responses.length) * 100,
                        )}
                      </strong>
                    </div>
                    <div className="source-bar-track">
                      <span
                        style={{
                          width: `${(source.count / report.responses.length) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
                <div className="source-bar-scale">
                  <span>0%</span>
                  <span>100%</span>
                </div>
              </div>
              <div className="panel-note">
                <Info size={13} />
                {l(
                  'Based on explicitly cited sources',
                  'Com base em fontes explicitamente citadas',
                )}
              </div>
            </section>
          </div>
          <section className="recent-section">
            <PanelHeading
              title={l('Recent chats', 'Respostas recentes')}
              description={l(
                'A closer look at what AI is saying',
                'Veja o que a IA está dizendo',
              )}
              action={l('View all chats', 'Ver todas as respostas')}
              onAction={() => onNavigate('chats')}
            />
            <div className="chat-card-grid">
              {recent.map((r) => (
                <button
                  className="chat-preview"
                  key={r.id}
                  onClick={() => onOpenChat(r)}
                >
                  <div className="chat-preview-meta">
                    <ModelMark model={r.model} />
                    <span>
                      Sep 9 <ArrowUpRight size={13} />
                    </span>
                  </div>
                  <h3>{prompts.find((p) => p.id === r.promptId)?.text}</h3>
                  <p>
                    {l(
                      'Explore the full response, brand mentions, and cited sources.',
                      'Explore a resposta completa, menções a marcas e fontes citadas.',
                    )}
                  </p>
                  <div className="chat-preview-footer">
                    <div className="brand-stack">
                      {r.brandIds.slice(0, 4).map((id) => (
                        <BrandMark
                          key={id}
                          brand={report.brands.find((b) => b.id === id)!}
                          small
                        />
                      ))}
                    </div>
                    <span>
                      {r.brandIds.includes('conversion') ? (
                        <>
                          <span className="status-dot" />
                          {l('Mentioned', 'Mencionada')}
                        </>
                      ) : (
                        l('Not mentioned', 'Não mencionada')
                      )}
                      <ChevronRight size={13} />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      <div className="analytics-footnote">
        <Globe size={12} />
        <span>
          {number(report.responses.length)}{' '}
          {l('sample responses', 'respostas de exemplo')} ·{' '}
          {l(
            'All metrics are calculated from demo data',
            'Todas as métricas são calculadas com dados de demonstração',
          )}
        </span>
        <TrendingUp size={12} />
      </div>
    </div>
  );
}
