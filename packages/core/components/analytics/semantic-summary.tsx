'use client';
// The top of the Semantic Branding report, built like the Overview: a row of KPI cards (score, rank, strongest and weakest attribute,
// AIs behind it), then the evolution as the Overview lays it out, the line chart beside the ranking of the period, then Score by AI.
import type { CSSProperties, MouseEvent } from 'react';
import { Bot, Gauge, ThumbsDown, ThumbsUp } from 'lucide-react';
import { MetricCard, MetricGrid, MetricGridSkeleton } from '@/components/lastfind/presentation/metric-card';
import { DataTable, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { Hint } from '@/components/ui/tooltip';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { TrendCard } from '@/components/lastfind/presentation/trend-chart';
import { brandKey } from '@/lib/brand-decisions';
import { seriesColorVar } from '@/lib/chart-series';
import { ENGINE_LABELS, type Engine } from '@/lib/engines';
import { heatCell } from '@/lib/semantic-perception';
import { BrandName, Change, EmptyState, ModelMark, useCopy, useNumbers } from './shared';
import type { Linker } from './drill-link';
import { missingReason, type Perception, type Score } from './semantic-perception';
import { NextCollection, SemanticSectionTabs, LeaderMark } from './semantic-association-report';

type Attribute = Score['attributes'][number];

/** A heat cell's style: the band of its note; none without one. */
const scoreStyle = (value: number | null | undefined) => (value == null ? undefined : heatCell(value));
/** A note in a heat cell, named for a screen reader. */
function ScoreValue({ value, label }: { value: number; label: string }) {
  const { number } = useNumbers();
  return <span aria-label={`${label}: ${number(value, 0)}`}>{number(value, 0)}</span>;
}

/** Why Semantic Branding leaves out an AI the project monitors, in words: the AI is not offered in the project's country. */
export function leftOutReason(left: { engine: Engine; reason: 'country' }, l: (en: string, pt: string) => string) {
  const name = ENGINE_LABELS[left.engine];
  return l(`${name} cannot be collected in this project's country.`, `O ${name} não pode ser coletado no país deste projeto.`);
}
/** The AIs the project monitors that Semantic Branding leaves out, as one sentence for a card's information; empty when none. */
export function leftOutNote(left: Perception['left'], l: (en: string, pt: string) => string) {
  return left.map((item) => ` ${leftOutReason(item, l)}`).join('');
}

/** A score's change against the previous period: the arrow when it clears the margin of both periods, a muted figure when it does not. */
export function ScoreChange({ change, margin }: { change: Score['change']; /** 0 in a table: the margin of error is for cards only. */ margin?: number }) {
  const l = useCopy();
  const { number } = useNumbers();
  if (!change) return null;
  if (change.significant) return <Change value={change.delta} period={false} margin={margin} />;
  // The Overview's change chip in its neutral tone, without an arrow: a figure inside the margin is no detectable change.
  return (
    <Hint text={l('Within the margin of the two periods: not a detectable change', 'Dentro da margem dos dois períodos: não é uma mudança detectável')}>
    <span className="metric-change neutral">
      {change.delta >= 0 ? '+' : '−'}{number(Math.abs(change.delta), 1)}
      <span className="sr-only">{l(', not a detectable change', ', não é uma mudança detectável')}</span>
    </span>
    </Hint>
  );
}

/** The brand's attribute notes ranked, the leader of each attribute among the rivals, and the brands ranked by overall score. */
export function semanticStanding(data: Perception, own: Score) {
  const ranked = data.scores.filter((score) => score.score !== null).sort((a, b) => b.score! - a.score!);
  const reliable = own.attributes.filter((attribute) => attribute.reliable && attribute.score !== null).sort((a, b) => b.score! - a.score!);
  const leaderOf = (row: Attribute) => data.scores.filter((score) => score.name !== own.name)
    .map((score) => ({ name: score.name, cell: score.attributes.find((attribute) => attribute.attribute === row.attribute) }))
    .filter((item): item is { name: string; cell: Attribute } => Boolean(item.cell?.reliable && item.cell.score !== null))
    .sort((a, b) => b.cell.score! - a.cell.score!)[0] ?? null;
  return { ranked, strongest: reliable[0] ?? null, weakest: reliable.at(-1) ?? null, leaderOf };
}

export function SemanticKpis({ data, own, method, changeNote, collection, attributeName, onEvidence }: {
  /** Why the score has no change beside it; null when it has one. `collection`: the collection behind the notes. */
  data: Perception; own: Score; method: string; changeNote: string | null; collection: string; attributeName: (id: string) => string;
  /** Drill down: an attribute's note opens the justifications of your brand on it. */
  onEvidence?: (attribute: string) => void;
}) {
  const l = useCopy();
  const { number } = useNumbers();
  const { strongest, weakest, leaderOf } = semanticStanding(data, own);
  const whole = (value: number | null) => (value === null ? '—' : number(value, 0));
  const justified = (attribute: string, value: number | null) => onEvidence && value !== null ? (
    <button type="button" className="drill-link" onClick={() => onEvidence(attribute)}
      aria-label={`${attributeName(attribute)}: ${whole(value)}. ${l('Read the justifications', 'Ler as justificativas')}`}>
      {whole(value)}
    </button>
  ) : whole(value);
  const weakLeader = weakest && leaderOf(weakest);
  const total = data.configuration.attributes.length;
  return (
    <MetricGrid columns={4} mobilePairs label={l('Semantic Branding summary', 'Resumo do Semantic Branding')}>
      <MetricCard
        icon={<Gauge size={15} />}
        label={l('Overall score', 'Score geral')}
        definition={changeNote ? `${method} ${changeNote}.` : method}
        value={<span data-testid="perception-score">{whole(own.score)}<small>/100</small></span>}
        delta={own.change ? <ScoreChange change={own.change} /> : undefined}
        description={own.score === null ? l('Not enough evidence yet', 'Evidência ainda insuficiente')
          : [own.margin === null && own.units === 1 ? l('No margin: one AI', 'Sem margem: uma IA')
            : own.margin !== null ? l(`±${number(own.margin, 1)} margin`, `margem de ±${number(own.margin, 1)}`) : null,
          // The period's own score beside the steadied one (SMOOTHING), when they differ as shown.
          own.daily != null && Math.round(own.daily) !== Math.round(own.score) ? (data.frequency === 'daily' ? l(`${whole(own.daily)} on the day`, `${whole(own.daily)} no dia`) : l(`${whole(own.daily)} in the period`, `${whole(own.daily)} no período`)) : null,
          ].filter(Boolean).join(', ') || undefined}
      />
      <MetricCard
        icon={<ThumbsUp size={15} />}
        label={l('Strength', 'Ponto forte')}
        definition={l('The attribute the AIs associate most with your brand (highest mean note with enough AIs).', 'O atributo que as IAs mais associam à sua marca (maior média com IAs suficientes).')}
        value={strongest ? justified(strongest.attribute, strongest.score) : whole(null)}
        description={strongest ? attributeName(strongest.attribute) : l('No attribute with enough AIs', 'Nenhum atributo com IAs suficientes')}
      />
      <MetricCard
        icon={<ThumbsDown size={15} />}
        label={l('Weakness', 'Ponto fraco')}
        definition={l('The attribute with the lowest mean note for your brand, and the rival that leads it.', 'O atributo com a menor média da sua marca, e o concorrente que lidera nele.')}
        value={weakest && weakest !== strongest ? justified(weakest.attribute, weakest.score) : whole(null)}
        description={!weakest || weakest === strongest ? l('Needs two attributes with enough AIs', 'Precisa de dois atributos com IAs suficientes')
          : <>{attributeName(weakest.attribute)}{weakLeader && weakLeader.cell.score! > weakest.score! ? l(`; ${weakLeader.name} leads with ${whole(weakLeader.cell.score)}`, `; ${weakLeader.name} lidera com ${whole(weakLeader.cell.score)}`) : ''}</>}
      />
      <MetricCard
        icon={<Bot size={15} />}
        label={l('AIs with notes', 'IAs com notas')}
        definition={`${l('AIs that gave notes in this collection, out of those asked. One is enough for a score; the margin needs two or more.', 'IAs que deram notas nesta coleta, entre as consultadas. Uma basta para o score; a margem precisa de duas ou mais.')} ${collection}`}
        value={data.round ? <span>{number(data.answered.length)}<small>/{number(data.round.queries.length)}</small></span> : '—'}
        description={l(`${number(own.reliableAttributes)} of ${number(total)} attributes with enough evidence`, `${number(own.reliableAttributes)} de ${number(total)} atributos com evidência suficiente`)}
      />
    </MetricGrid>
  );
}

/**
 * The report while it loads, in the place and shape it takes once loaded (the title and the cards no longer jump): the section tabs,
 * the KPI cards, the chart beside the ranking, then Score by AI.
 */
export function SemanticSkeleton({ label }: { label: string }) {
  const l = useCopy();
  const header = (key: string, text: string, align?: 'center' | 'end') => ({ key, header: text, align, cell: () => null });
  return (
    <div className="semantic-association-report" aria-busy="true" aria-label={label} data-screen-skeleton="">
      <SemanticSectionTabs disabled />
      <div className="perception">
        <MetricGridSkeleton count={4} label={label} description={2} />
        <div className="overview-grid semantic-evolution">
          <TrendCard loading className="trend-panel" title={l('Evolution', 'Evolução')} data={[]} series={[]} scale={{ domain: [0, 100], ticks: [0, 100] }} locale="en" formatValue={String} formatTick={String} />
          <SectionCard className="ranking-panel semantic-ranking" title={l('Score ranking', 'Ranking de score')}>
            <DataTable singleLine minWidth={0} loading={6} rows={[]} rowKey={String} ariaLabel={label}
              columns={[header('rank', '#', 'center'), header('brand', l('Brand', 'Marca')), header('score', l('Score', 'Score')), header('change', l('Change', 'Variação'), 'end')]} />
          </SectionCard>
        </div>
        <SectionCard title={l('Score by AI', 'Score por IA')} loading lines={6} />
      </div>
    </div>
  );
}

/** The catalog's brand cell (shared.tsx), re-exported for the report's other files. */
export { BrandName };

/** Score bar, one pixel per point: proportional to the score at any width. */
export function ScoreBar({ score }: { score: number }) {
  const { number } = useNumbers();
  return <span className="perception-bar"><i style={{ '--score': score } as CSSProperties} /><b>{number(score, 0)}</b></span>;
}

/**
 * The evolution as on the Overview: the overall score by period beside the ranking of the period shown. The same TrendCard as
 * the Overview's Brand trend: its legend, your brand and the 4 best scored at first, each brand turned on and off there.
 * A brand's line and its row in the ranking open its page.
 */
export function SemanticEvolution({ data, own, frequencyName, link }: { data: Perception; own: Score; frequencyName: string; link?: Linker }) {
  const l = useCopy();
  const { number, locale } = useNumbers();
  const { ranked } = semanticStanding(data, own);
  const roster = data.scores.filter((score) => score.name !== data.ownBrand).map((score) => score.name);
  const withNotes = data.trend.filter((point) => data.scores.some((score) => typeof point[score.name] === 'number'));
  // One scale for every brand, so turning one on or off never rescales the others.
  const values = withNotes.flatMap((point) => data.scores.map((score) => point[score.name]).filter((value): value is number => typeof value === 'number'));
  const low = values.length ? Math.max(0, Math.floor((Math.min(...values) - 5) / 10) * 10) : 0;
  const high = values.length ? Math.min(100, Math.ceil((Math.max(...values) + 5) / 10) * 10) : 100;
  const scale = { domain: [low, high], ticks: Array.from({ length: (high - low) / 10 + 1 }, (_, index) => low + index * 10) };
  // The brand first, then the others by score, as the legend and the lines are drawn.
  const series = [...data.scores].sort((a, b) => Number(b.name === data.ownBrand) - Number(a.name === data.ownBrand) || (b.score ?? -1) - (a.score ?? -1))
    .map((score) => ({ id: score.name, key: score.name, name: score.name, color: seriesColorVar(score.name, data.ownBrand, roster), primary: score.name === data.ownBrand }));
  const scoreOf = new Map(data.scores.map((score) => [score.name, score.score ?? -1]));
  const unranked = data.scores.filter((score) => score.score === null);
  const page = (name: string) => link?.({ tab: 'competitors', brandPage: brandKey(name) });
  return (
    <div className="overview-grid semantic-evolution">
      <TrendCard className="trend-panel" title={l('Evolution', 'Evolução')}
        info={`${l(`Overall score, ${frequencyName.toLowerCase()} collection, in the period of the header.`, `Score geral, coleta ${frequencyName.toLowerCase()}, no período do cabeçalho.`)}`}
        empty={withNotes.length ? undefined : <EmptyState frame="bare" title={l('No overall score in this period', 'Sem score geral neste período')} />}
        data={data.trend} series={series} total={(item) => scoreOf.get(item.id) ?? -1} scale={scale} locale={locale}
        monthly={data.frequency === 'monthly'} formatValue={(value) => number(value, 0)} formatTick={(value) => number(value, 0)}
        label={l('Overall perception score of every tracked brand by period', 'Score geral de percepção de cada marca acompanhada por período')}
        onSelectSeries={link ? (_date, line, event) => page(line.name)!.onClick(event as unknown as MouseEvent<HTMLAnchorElement>) : undefined} />
      <SectionCard className="ranking-panel semantic-ranking" title={l('Score ranking', 'Ranking de score')}
        info={`${l('Overall score of each brand in the latest collection of the period.', 'Score geral de cada marca na última coleta do período.')}${unranked.length
          ? ` ${l(`Without enough evidence for a score: ${unranked.map((score) => score.name).join(', ')}.`, `Sem evidência suficiente para um score: ${unranked.map((score) => score.name).join(', ')}.`)}` : ''}`}>
        <DataTable
          singleLine
          minWidth={0}
          rows={ranked}
          rowKey={(score) => score.name}
          rowLink={link ? (score) => page(score.name) : undefined}
          ariaLabel={l('Score ranking', 'Ranking de score')}
          columns={[
            { key: 'rank', header: '#', width: 44, align: 'center', mobile: 'hide', cell: (_, index) => number(index + 1) },
            { key: 'brand', header: l('Brand', 'Marca'), mobile: 'title', cell: (score) => <BrandName name={score.name} domain={score.domain} own={score.name === own.name} /> },
            { key: 'score', header: l('Score', 'Score'), label: l('Score', 'Score'), width: 140, mobile: 'wide', cell: (score) => <ScoreBar score={score.score!} /> },
            { key: 'change', header: l('Change', 'Variação'), label: l('Change', 'Variação'), width: 88, align: 'end', cell: (score) => (score.change
              ? <ScoreChange change={score.change} margin={0} />
              : <Hint text={l('No previous period to compare', 'Sem período anterior para comparar')}><span className="text-muted-foreground">—</span></Hint>) },
          ]}
        />
      </SectionCard>
    </div>
  );
}

/**
 * The AI models screen's Semantic Branding column: the project's brand's overall score inside each AI (0–100), from the Semantic
 * Branding collection of that AI, kept apart from the Prompts columns beside it. Absent is a dash with its reason, never a zero.
 */
export function semanticModelColumn<T extends { key: Engine }>(report: { data: Perception | null; state: 'loading' | 'ready' | 'failed' }, l: (en: string, pt: string) => string): DataColumn<T> {
  const label = l('Semantic Branding score', 'Score do Semantic Branding');
  const why = (engine: Engine) => {
    if (report.state === 'loading') return l('Loading Semantic Branding…', 'Carregando o Semantic Branding…');
    if (report.state === 'failed') return l('Semantic Branding could not be loaded', 'Não foi possível carregar o Semantic Branding');
    const data = report.data;
    if (!data || data.status === 'disabled') return l('Semantic Branding is off for this project', 'O Semantic Branding está desligado neste projeto');
    const left = data.left.find((item) => item.engine === engine);
    if (left) return leftOutReason(left, l);
    if (!data.byAssistant) return l('Semantic Branding has no collection in this period yet', 'O Semantic Branding ainda não tem coleta neste período');
    if (!data.byAssistant.columns.some((column) => column.engine === engine)) return l('Semantic Branding does not ask this AI', 'O Semantic Branding não pergunta a esta IA');
    return l('This AI scored fewer than 60% of the attributes for your brand', 'Esta IA deu nota a menos de 60% dos atributos da sua marca');
  };
  const scoreOf = (engine: Engine) => {
    const table = report.data?.byAssistant;
    const at = table ? table.brands.indexOf(report.data!.ownBrand) : -1;
    const value = at >= 0 ? table!.columns.find((column) => column.engine === engine)?.scores[at] : null;
    return value ?? null;
  };
  return {
    key: 'semantic', width: 170, header: label, label, align: 'end',
    info: l("Your brand's overall Semantic Branding score inside each AI (0–100), from the Semantic Branding collection, which asks each AI the way the daily collection does, not from the Prompts.",
      'O score geral da sua marca no Semantic Branding dentro de cada IA (0–100), da coleta do Semantic Branding, que pergunta a cada IA do mesmo jeito que a coleta diária, não dos Prompts.'),
    sortValue: (item) => scoreOf(item.key),
    cellStyle: (item) => scoreStyle(scoreOf(item.key)),
    cell: (item) => {
      const value = scoreOf(item.key);
      if (value != null) return <ScoreValue value={value} label={`${ENGINE_LABELS[item.key]}, ${label}`} />;
      return <Hint text={why(item.key)}><span className="text-muted-foreground" aria-label={`${ENGINE_LABELS[item.key]}, ${label}: ${why(item.key)}`}>—</span></Hint>;
    },
  };
}

/**
 * "Score by AI": the brands (rows) by each AI (columns), each cell the brand's overall score inside that AI, in the colors of
 * the heatmap. One AI has no margin; a missing cell is a dash with its reason, never a zero; a brand added since the collection says it
 * enters the next one. Used on Semantic Branding and on the Overview.
 */
export function SemanticAssistantTable({ data }: { data: Pick<Perception, 'byAssistant' | 'ownBrand' | 'scores' | 'added' | 'left'> }) {
  const l = useCopy();
  const table = data.byAssistant;
  if (!table?.columns.length) return null;
  const domain = new Map(data.scores.map((score) => [score.name, score.domain]));
  const overall = new Map(data.scores.map((score) => [score.name, score.score]));
  const added = new Set(data.added);
  // Best overall score first, as the ranking; a brand without one goes last.
  const rows = table.brands.map((brand, index) => ({ brand, index })).sort((a, b) => (overall.get(b.brand) ?? -1) - (overall.get(a.brand) ?? -1));
  const columns: DataColumn<(typeof rows)[number]>[] = [
    {
      // No phone card (`mobile`): on a phone the table stays a table, the brand column fixed and three AIs to a screen
      // (semantic-association-report.css); as cards, the names broke mid-word over the AIs' labels (13/11/2026).
      key: 'brand', header: l('Brand', 'Marca'), rowHeader: true,
      cell: ({ brand }) => <BrandName name={brand} domain={domain.get(brand) ?? ''} own={brand === data.ownBrand} />,
    },
    ...table.columns.map((column): DataColumn<(typeof rows)[number]> => {
      const label = ENGINE_LABELS[column.engine];
      // A column without a note in this collection says why in its header, not only in each cell (an empty column is never left unexplained).
      const missing = column.readings ? null : missingReason(column, l);
      // The leader of this AI gets the trophy, as the heatmap's best mean: the highest score as shown (whole points), so two
      // brands that read the same are both marked.
      const scored = column.scores.filter((value): value is number => value != null).map(Math.round);
      const best = scored.length ? Math.max(...scored) : null;
      return {
        key: column.engine, label, align: 'center',
        header: (
          <span className="semantic-assistant-head">
            <ModelMark model={column.engine} />
            {missing && <Hint text={missing}><span className="text-caption text-muted-foreground">{l('no data this round', 'sem dados nesta rodada')}<span className="sr-only">: {missing}</span></span></Hint>}
          </span>
        ),
        cellStyle: ({ index }) => scoreStyle(column.scores[index]),
        cell: ({ brand, index }) => {
          const value = column.scores[index];
          if (value != null)
            return (
              <>
                <ScoreValue value={value} label={`${brand}, ${label}`} />
                {Math.round(value) === best && <LeaderMark label={l(`highest score in ${label}`, `maior score no ${label}`)} />}
              </>
            );
          if (added.has(brand)) return <NextCollection />;
          const why = missing ?? l('This AI scored fewer than 60% of the attributes for this brand', 'Esta IA deu nota a menos de 60% dos atributos desta marca');
          return <Hint text={why}><span className="text-muted-foreground" aria-label={`${brand}, ${label}: ${why}`}>—</span></Hint>;
        },
      };
    }),
    // An AI the project monitors that Semantic Branding leaves out (not in this country): its
    // column says so in its header and its cells, never an empty column or a zero.
    ...data.left.map((item): DataColumn<(typeof rows)[number]> => {
      const label = ENGINE_LABELS[item.engine];
      const why = leftOutReason(item, l);
      return {
        key: `left:${item.engine}`, label, align: 'center',
        header: (
          <span className="semantic-assistant-head">
            <ModelMark model={item.engine} />
            <Hint text={why}><span className="text-caption text-muted-foreground">{l('not collected', 'não coletada')}<span className="sr-only">: {why}</span></span></Hint>
          </span>
        ),
        cell: ({ brand }) => <span className="text-muted-foreground" aria-label={`${brand}, ${label}: ${why}`}>—</span>,
      };
    }),
  ];
  return (
    <DataTable
      singleLine
      className="semantic-by-ai"
      style={{ '--columns': columns.length - 1 } as CSSProperties}
      containerProps={{ className: 'semantic-association-scroll', role: 'region', tabIndex: 0, 'aria-label': l('Score by AI', 'Score por IA') }}
      ariaLabel={l('Overall score of each brand inside each AI', 'Score geral de cada marca dentro de cada IA')}
      rows={rows}
      rowKey={({ brand }) => brand}
      columns={columns}
    />
  );
}
