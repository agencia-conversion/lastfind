import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { DataTable, type DataColumn } from '@/components/lastfind/presentation/data-table';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartLegend } from '@/components/lastfind/presentation/trend-chart';
import { FilterSelect, SiteFavicon, useCopy, useNumbers } from './shared';
import { Hint } from '@/components/ui/tooltip';
import { seriesColorVar, useSeriesToggle } from '@/lib/chart-series';
import { useTouchDismiss } from '@/lib/use-touch-dismiss';
import { HEAT_BANDS, heatCell, type HeatBand } from '@/lib/semantic-perception';
import type { SemanticAssociationReport as Report } from './semantic-association-data';
import './semantic-branding.css';
import './semantic-association-report.css';

type Props = {
  report: Report;
  idPrefix?: string;
  shareSectionLinks?: boolean;
  /** The overall score of each brand by name: the first column of the heatmap. */
  overall: Record<string, number | null>;
  /** Score and evolution, above the heatmap; given the selection, its figures can open their justifications. */
  lead: ReactNode | ((select: (attributeId: string, brandId?: string) => void) => ReactNode);
  /** What comes after the evidence (sources, method). */
  after: ReactNode;
  /** The evidence of the chosen attribute. */
  explanations: (selection: { brandId: string; attributeId: string }) => ReactNode;
  /** Brands added since the collection shown: their cells say they enter the next one, not "no evidence". */
  added?: string[];
};
/** What a brand added since the collection shows instead of a note (6/11/2026): it enters the next collection. */
export const nextCollectionText = (l: (en: string, pt: string) => string) => ({
  short: l('Next round', 'Próxima rodada'),
  long: l('Added after this collection: it enters the next one', 'Adicionada depois desta coleta: entra na próxima'),
});
/** A cell of a brand added since the collection, outside a button: the short text, with the reason in its balloon. */
export function NextCollection() {
  const text = nextCollectionText(useCopy());
  return <Hint text={text.long}><span className="semantic-no-evidence text-muted-foreground">{text.short}<span className="sr-only">: {text.long}</span></span></Hint>;
}
/** The leader of a column (the highest score or mean): the trophy emoji, never an icon, with its words for a screen reader. */
export function LeaderMark({ label }: { label: string }) {
  return (
    <>
      {' '}
      <span aria-hidden="true">🏆</span>
      <span className="sr-only">{label}</span>
    </>
  );
}
// The report is one page: score and evolution, the heatmap, the evidence of the chosen attribute, the sources.
const SECTIONS = ['summary', 'heatmap', 'radar', 'explanations', 'sources'];
/** A brand's series color in this report: the same as its line in the evolution and its bar on the Overview. */
export const brandColor = (id: string, report: Report) =>
  seriesColorVar(
    id,
    report.own?.entity.id ?? '',
    report.brands.filter((brand) => brand.entity.id !== report.own?.entity.id)
      .map((brand) => brand.entity.id),
  );

export function SemanticAssociationReport({
  report,
  idPrefix = 'semantic-association',
  shareSectionLinks = true,
  overall,
  lead,
  after,
  explanations,
  added = [],
}: Props) {
  const l = useCopy();
  const id = idPrefix;
  const tabsRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState('summary');
  const [attributeId, setAttributeId] = useState(report.strongest?.attribute.id || report.configuration.attributes[0]?.id || '');
  const [brandId, setBrandId] = useState('all');
  const attribute =
    report.configuration.attributes.find((item) => item.id === attributeId) ??
    report.configuration.attributes[0];
  useEffect(() => {
    if (!shareSectionLinks) return;
    const restoreSection = () => {
      // The section the address's hash names.
      const section = SECTIONS.find((value) => window.location.hash === `#${id}-${value}`);
      if (!section) return;
      setSection(section);
      document.getElementById(`${id}-${section}`)?.scrollIntoView({
        behavior: 'instant',
        block: 'start',
      });
    };
    const frame = requestAnimationFrame(restoreSection);
    window.addEventListener('hashchange', restoreSection);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', restoreSection);
    };
  }, [id, shareSectionLinks]);
  const navigateSection = (section: string) => {
    setSection(section);
    if (shareSectionLinks) {
      const destination = new URL(window.location.href);
      destination.hash = `${id}-${section}`;
      window.history.replaceState(window.history.state, '', destination);
    }
    document.getElementById(`${id}-${section}`)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
  };
  const panelBrands = panelOrder(report, overall);
  const hasRadar = report.configuration.attributes.length >= 3 && panelBrands.length > 0;
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    let frame = 0;
    const updateSection = () => {
      const sections = SECTIONS.map((value) => ({ value, element: document.getElementById(`${id}-${value}`) }))
        .filter(({ element }) => element && element.getClientRects().length);
      const top = parseFloat(getComputedStyle(tabs).top) + tabs.offsetHeight + 21;
      const current = sections.filter(({ element }) => element!.getBoundingClientRect().top <= top).at(-1) ?? sections[0];
      // The last section may be too short to reach the sticky tabs.
      const atEnd = window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
      setSection((atEnd ? sections.at(-1) : current)?.value ?? 'summary');
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateSection);
    };
    const resize = new ResizeObserver(() => {
      tabs.parentElement?.style.setProperty('--semantic-tabs-height', `${tabs.offsetHeight}px`);
      schedule();
    });
    resize.observe(tabs);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [id, hasRadar]);
  const selectEvidence = (nextAttribute: string, nextBrand = 'all') => {
    setAttributeId(nextAttribute);
    setBrandId(nextBrand);
    navigateSection('explanations');
  };
  return (
    <div className="semantic-association-report">
      <SemanticSectionTabs id={id} tabsRef={tabsRef} value={section} onValueChange={navigateSection} hasRadar={hasRadar} />
      <div className="semantic-association-layout">
        <div className="semantic-association-content">
          <div id={`${id}-summary`} role="tabpanel" aria-label={l('Summary', 'Resumo')} className="semantic-association-section">{typeof lead === 'function' ? lead(selectEvidence) : lead}</div>
          <ReportSection
            id={`${id}-heatmap`}
            title={l('Who is associated with what', 'Quem é associado a quê')}
            info={l(
              'Mean note of the AIs (0–100) for each brand and attribute; your brand first. Select a cell to read its justification below.',
              'Média das notas das IAs (0–100) para cada marca e atributo; sua marca primeiro. Selecione uma célula para ler a justificativa abaixo.',
            )}
          >
            <AttributeTable report={report} brands={panelBrands} onSelect={selectEvidence} overall={overall} attributeId={attribute?.id ?? ''} added={added} />
            <SwipeHint attributes={report.configuration.attributes.map((item) => item.name)} />
            <div className="semantic-heatmap-legend">
              <HeatScale />
              <span><span aria-hidden="true">🏆</span> {l('highest observed mean', 'maior média observada')}</span>
              <span>{l('No evidence: fewer AIs answered than needed, never a zero', 'Sem evidência: menos IAs responderam do que o necessário, nunca zero')}</span>
              {added.length > 0 && <span>{l('Next round: a brand added after this collection, asked in the next one', 'Próxima rodada: marca adicionada depois desta coleta, perguntada na próxima')}</span>}
            </div>
          </ReportSection>
          {hasRadar && (
            <ReportSection
              id={`${id}-radar`}
              className="semantic-radar-section"
              title={l('Radar', 'Radar')}
              info={l(
                'Observed mean of each brand on every attribute: your brand and every monitored competitor. Hover or focus an attribute to compare.',
                'Média observada de cada marca em cada atributo: sua marca e todos os concorrentes monitorados. Passe o cursor ou foque um atributo para comparar.',
              )}
            >
              <SemanticRadarChart report={report} brands={panelBrands} />
            </ReportSection>
          )}
          <ReportSection
            id={`${id}-explanations`}
            padded
            title={l('Score justifications', 'Justificativas das notas')}
            info={`${attribute?.description ? `${attribute.description} ` : ''}${l(
              'Each brand with its note on the attribute chosen beside the title; open one to read the justification and the evidence, and, in the details, the note of each AI, the sources the AIs cited and their full answers.',
              'Cada marca com a nota no atributo escolhido ao lado do título; abra uma para ler a justificativa e as evidências e, nos detalhes, a nota de cada IA, as fontes que as IAs citaram e as respostas completas.',
            )}`}
            action={
              <FilterSelect
                multiple={false}
                label={l('Attribute', 'Atributo')}
                value={attribute?.id ?? ''}
                onChange={(next) => { setAttributeId(next); setBrandId('all'); }}
                options={report.configuration.attributes.map((item) => ({ value: item.id, label: item.name }))}
              />
            }
          >
            {explanations({ brandId, attributeId: attribute?.id ?? '' })}
          </ReportSection>
          <div id={`${id}-sources`} role="tabpanel" aria-label={l('Sources cited by the AIs', 'Fontes citadas pelas IAs')} className="semantic-association-section">{after}</div>
        </div>
      </div>
    </div>
  );
}

/** Your brand first, then by overall score: the heatmap's rows and the radar's brands. */
export function panelOrder(report: Report, overall: Record<string, number | null>) {
  return [...report.brands].sort(
    (a, b) =>
      Number(b.entity.id === report.own?.entity.id) - Number(a.entity.id === report.own?.entity.id) ||
      (overall[b.entity.name] ?? -1) - (overall[a.entity.name] ?? -1),
  );
}

/**
 * The radar with its legend under it: the report's Radar section and the Overview's Semantic Branding row. It is given
 * every brand of the project in panel order (your brand first, then by score) and draws the first CHART_SERIES_COUNT (10),
 * as every brand chart; the legend (ChartLegend, interactive) names those ten and keeps the rest behind its "+N".
 */
export function SemanticRadarChart({ report, brands }: { report: Report; brands: Report['brands'] }) {
  const series = brands.map((brand, index) => ({ id: brand.entity.id, name: brand.entity.name, color: brandColor(brand.entity.id, report), primary: brand.entity.id === report.own?.entity.id, order: -index }));
  const { hidden, folded, toggle } = useSeriesToggle(series, (item) => item.order);
  return (
    <>
      <SemanticRadar report={report} brands={brands} hidden={hidden} />
      <ChartLegend series={series} hidden={hidden} folded={folded} onToggle={toggle} />
    </>
  );
}

/** The report's section tabs. The loading state draws the same bar (`disabled`), so nothing moves when the report arrives. */
export function SemanticSectionTabs({ id, tabsRef, value = 'summary', onValueChange, hasRadar = true, disabled = false }: {
  id?: string; tabsRef?: Ref<HTMLDivElement>; value?: string; onValueChange?: (value: string) => void; hasRadar?: boolean; disabled?: boolean;
}) {
  const l = useCopy();
  const controls = (section: string) => (id ? `${id}-${section}` : undefined);
  return (
    <Tabs ref={tabsRef} className="semantic-section-tabs" value={value} onValueChange={onValueChange}>
      <TabsList variant="line" aria-label={l('Report sections', 'Seções do relatório')}>
        <TabsTrigger value="summary" disabled={disabled} aria-controls={controls('summary')}>{l('Summary', 'Resumo')}</TabsTrigger>
        <TabsTrigger value="heatmap" disabled={disabled} aria-controls={controls('heatmap')}>{l('Associations', 'Associações')}</TabsTrigger>
        {hasRadar && <TabsTrigger className="semantic-radar-tab" value="radar" disabled={disabled} aria-controls={controls('radar')}>{l('Radar', 'Radar')}</TabsTrigger>}
        <TabsTrigger value="explanations" disabled={disabled} aria-controls={controls('explanations')}>{l('Justifications', 'Justificativas')}</TabsTrigger>
        <TabsTrigger value="sources" disabled={disabled} aria-controls={controls('sources')}>{l('Sources', 'Fontes')}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function ReportSection({
  id,
  title,
  info,
  action,
  className,
  padded,
  children,
}: {
  id: string;
  title: string;
  /** The explanation of the section, in the info icon beside the title (as on the Overview cards). */
  info: string;
  action?: ReactNode;
  className?: string;
  /** Text and lists inset like the header (SectionCard padded); tables and charts go edge to edge. */
  padded?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div id={id} role="tabpanel" aria-label={title} className={`semantic-association-section${className ? ` ${className}` : ''}`}>
      <SectionCard title={title} info={info} action={action} titleId={titleId} inset={padded ? 'padded' : undefined}>
        {children}
      </SectionCard>
    </div>
  );
}

/** A heatmap's legend bands (inside `.semantic-heatmap-legend`): Semantic Branding's notes by default, or another scale (Comparison's WIN_RATE_BANDS). */
/**
 * A heatmap's attribute columns on a phone: as many as fit the screen with the longest word of a header whole (3, 2 or 1), so no name
 * breaks mid-word. Fewer attributes than that fill the width (the CSS divides by the smaller of the two).
 */
export function phoneColumns(names: string[]) {
  const longest = Math.max(0, ...names.flatMap((name) => name.split(/\s+/).map((word) => word.length)));
  return longest <= 8 ? 3 : longest <= 13 ? 2 : 1;
}
/** Under a heatmap on a phone (the CSS shows it there only): the swipe hint, only when its attributes do not all fit. */
export function SwipeHint({ attributes }: { attributes: string[] }) {
  const l = useCopy();
  return attributes.length > phoneColumns(attributes) ? <p className="semantic-scroll-hint">{l('Swipe to see every attribute', 'Deslize para ver todos os atributos')}</p> : null;
}

export function HeatScale({ bands = HEAT_BANDS }: { bands?: readonly HeatBand[] }) {
  const l = useCopy();
  return (
    <>
      {bands.map((band) => (
        <span key={band.label} className="semantic-heatmap-band">
          <i aria-hidden="true" style={{ backgroundColor: band.color }} />
          {band.label} {l(band.name.en, band.name.pt)}
        </span>
      ))}
    </>
  );
}

function AttributeTable({
  report,
  brands,
  onSelect,
  overall,
  attributeId,
  added,
}: {
  report: Report;
  added: string[];
  brands: Report['brands'];
  onSelect: (attribute: string, brand: string) => void;
  /** The overall score by brand name: the "Overall score" column. */
  overall: Record<string, number | null>;
  /** The attribute the justifications show: a brand or its overall score opens the brand's on it. */
  attributeId: string;
}) {
  const l = useCopy();
  const { number } = useNumbers();
  // Wraps in a narrow column instead of being cut. A brand added after the round says it enters the next one (its whole row).
  const next = nextCollectionText(l);
  const isNew = (brand: Report['brands'][number]) => added.includes(brand.entity.name);
  const emptyFor = (brand: Report['brands'][number]) => <span className="semantic-no-evidence">{isNew(brand) ? next.short : l('No evidence', 'Sem evidência')}</span>;
  const emptyTextFor = (brand: Report['brands'][number]) => (isNew(brand) ? next.long : l('No evidence', 'Sem evidência'));
  // The highest mean of each column gets a trophy (the emoji, not an icon).
  const best = (values: (number | null | undefined)[]) => Math.max(...values.filter((value): value is number => value != null));
  const bestOverall = best(brands.map((brand) => overall[brand.entity.name]));
  const bestByAttribute = new Map(report.configuration.attributes.map((item) => [item.id, best(brands.map((brand) => brand.attributes.find((cell) => cell.attribute.id === item.id)?.observedValue))]));
  const visible = phoneColumns(report.configuration.attributes.map((attribute) => attribute.name));
  // Every cell in its band, however close to your brand's: the margin of error is for cards only (heatCell).
  const noteOf = (brand: Report['brands'][number] | undefined, attribute: string) => brand?.attributes.find((cell) => cell.attribute.id === attribute)?.observedValue;
  const trophy = <LeaderMark label={l('highest observed mean', 'maior média observada')} />;
  const columns: DataColumn<Report['brands'][number]>[] = [
    {
      key: 'brand', header: l('Brand', 'Marca'), rowHeader: true,
      // Your brand is the first row, in bold (the "You" label broke the line).
      cell: (brand) => (
        <button type="button" className={`semantic-site drill-link${brand.entity.id === report.own?.entity.id ? ' font-(--weight-strong)' : ''}`} onClick={() => onSelect(attributeId, brand.entity.id)}
          aria-label={`${brand.entity.name}. ${l('Read its justifications', 'Ler as justificativas')}`}>
          <SiteFavicon domain={brand.entity.domain} name={brand.entity.name} />{brand.entity.name}
        </button>
      ),
    },
    {
      key: 'overall', header: l('Overall score', 'Score geral'), align: 'center',
      cellStyle: (brand) => overall[brand.entity.name] != null ? heatCell(overall[brand.entity.name]!) : undefined,
      cell: (brand) => {
        const total = overall[brand.entity.name];
        return <button type="button" onClick={() => onSelect(attributeId, brand.entity.id)}
          aria-label={`${brand.entity.name}: ${l('Overall score', 'Score geral')} ${total == null ? emptyTextFor(brand) : number(total, 0)}. ${l('Read its justifications', 'Ler as justificativas')}`}>
          {total == null ? emptyFor(brand) : number(total, 0)}{total === bestOverall && trophy}
        </button>;
      },
    },
    ...report.configuration.attributes.map((attribute): DataColumn<Report['brands'][number]> => ({
      key: attribute.id, header: attribute.name, align: 'center',
      cellStyle: (brand) => {
        const value = noteOf(brand, attribute.id);
        return value != null ? heatCell(value) : undefined;
      },
      cell: (brand) => {
        const value = noteOf(brand, attribute.id);
        return <button
          aria-label={`${brand.entity.name}: ${attribute.name}, ${value == null ? (isNew(brand) ? next.long : l('No assessed evidence', 'Sem evidência avaliada')) : `${number(value, 1)} / 100`}`}
          onClick={() => onSelect(attribute.id, brand.entity.id)}
        >
          {value == null ? emptyFor(brand) : number(value, 1)}
          {value != null && value === bestByAttribute.get(attribute.id) && trophy}
        </button>;
      },
    })),
  ];
  return (
    <DataTable
      singleLine
      ariaLabel={l('Attribute comparison table', 'Tabela comparativa de atributos')}
      className="semantic-association-heatmap semantic-association-panel"
      style={{ '--attributes': report.configuration.attributes.length, '--visible': visible } as CSSProperties}
      containerProps={{
        className: 'semantic-association-scroll',
        role: 'region', tabIndex: 0,
        'aria-label': l('Attribute comparison table', 'Tabela comparativa de atributos'),
      }}
      rows={brands}
      rowKey={(brand) => brand.entity.id}
      columns={columns}
    />
  );
}

// SVG requires ARIA roles: HTML buttons/fieldsets are not valid SVG children.
/* eslint-disable jsx-a11y/prefer-tag-over-role */
function SemanticRadar({
  report,
  brands: every,
  hidden,
}: {
  report: Report;
  brands: Report['brands'];
  /** Brands the legend turned off: not drawn, not in the balloon. */
  hidden: string[];
}) {
  const brands = every.filter((brand) => !hidden.includes(brand.entity.id));
  const l = useCopy();
  const { number } = useNumbers();
  const tooltipId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [activeAttribute, setActiveAttribute] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 12, top: 12 });
  // The geometry is drawn in a 540×410 box and scaled to the container; the labels live in a second SVG over it, positioned in
  // percent so they keep the token font size at any width. Nothing is measured in JS (a measurement went stale in full-page
  // captures and blew the labels up); the narrow layout is a container query in the CSS.
  const pctX = (x: number) => `${(x / 540) * 100}%`;
  const pctY = (y: number) => `${(y / 410) * 100}%`;
  const attributes = report.configuration.attributes;
  const center = { x: 270, y: 205 };
  const radius = 130;
  const point = (index: number, value: number) => {
    const angle = (index * 2 * Math.PI) / attributes.length - Math.PI / 2;
    return {
      x: center.x + (Math.cos(angle) * radius * value) / 100,
      y: center.y + (Math.sin(angle) * radius * value) / 100,
    };
  };
  const polygon = (values: number[]) =>
    values
      .map((value, index) => {
        const p = point(index, value);
        return `${p.x},${p.y}`;
      })
      .join(' ');
  const showAttribute = (index: number, clientX?: number, clientY?: number) => {
    const bounds = chartRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const tip = point(index, 75);
    const x =
      clientX == null ? (tip.x / 540) * bounds.width : clientX - bounds.left;
    const y =
      clientY == null ? (tip.y / 540) * bounds.width : clientY - bounds.top;
    setAnchor({ x, y });
    setActiveAttribute(index);
  };
  // Place by real tooltip size; flip above the point when it would overflow the chart.
  useLayoutEffect(() => {
    if (activeAttribute == null || !anchor || !chartRef.current || !tooltipRef.current) return;
    const bounds = chartRef.current.getBoundingClientRect();
    const tipH = tooltipRef.current.offsetHeight;
    const tipW = tooltipRef.current.offsetWidth;
    const left = Math.max(12, Math.min(anchor.x + 14, bounds.width - tipW - 12));
    const below = anchor.y + 12;
    const top =
      below + tipH <= bounds.height - 12
        ? Math.max(12, below)
        : Math.max(12, anchor.y - tipH - 12);
    setTooltipPosition({ left, top });
  }, [activeAttribute, anchor, brands.length]);
  const active = activeAttribute == null ? null : attributes[activeAttribute];
  useTouchDismiss({
    root: () => chartRef.current,
    point: () => activeAttribute ?? undefined,
    close: () => {
      setActiveAttribute(null);
      setAnchor(null);
    },
  });
  return (
    <div
      className="semantic-radar"
      ref={chartRef}
      data-tooltip-open={active ? '' : undefined}
      onPointerLeave={() => {
        if (!chartRef.current?.contains(document.activeElement)) {
          setActiveAttribute(null);
          setAnchor(null);
        }
      }}
    >
      <div className="semantic-radar-plot">
      <div className="semantic-radar-frame">
      <svg
        viewBox="0 0 540 410"
        role="group"
        aria-label={l(
          'Attribute association radar. Hover or focus an attribute to compare grades.',
          'Radar de associação aos atributos. Passe o cursor ou foque um atributo para comparar as notas.',
        )}
      >
        <g aria-hidden="true" pointerEvents="none">
          {[25, 50, 75, 100].map((value) => (
            <g key={value}>
              <polygon
                points={polygon(attributes.map(() => value))}
                fill="none"
                stroke="var(--border)"
              />
            </g>
          ))}
          {attributes.map((attribute, index) => {
            const end = point(index, 100);
            return (
              <g key={attribute.id}>
                <line
                  x1={center.x}
                  y1={center.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="var(--border)"
                />
              </g>
            );
          })}
          {brands
            .filter((brand) =>
              brand.attributes.every((cell) => cell.observedValue !== null),
            )
            .map((brand) => (
              <polygon
                key={brand.entity.id}
                points={polygon(
                  brand.attributes.map((cell) => cell.observedValue!),
                )}
                fill={brandColor(brand.entity.id, report)}
                fillOpacity=".045"
                stroke={brandColor(brand.entity.id, report)}
                strokeWidth="2"
              />
            ))}
          {brands.flatMap((brand) =>
            brand.attributes.map((cell, index) => {
              if (cell.observedValue == null) return null;
              const position = point(index, cell.observedValue);
              return (
                <circle
                  key={`${brand.entity.id}/${cell.attribute.id}`}
                  cx={position.x}
                  cy={position.y}
                  r={activeAttribute === index ? 4 : 2.5}
                  fill={brandColor(brand.entity.id, report)}
                  stroke="var(--background)"
                  strokeWidth="1"
                />
              );
            }),
          )}
        </g>
        {attributes.map((attribute, index) => {
          const from = point(index - 0.5, 137);
          const to = point(index + 0.5, 137);
          const edge = point(index, 100);
          return (
            <g
              key={attribute.id}
              className="semantic-radar-target"
              role="button"
              tabIndex={0}
              aria-label={l(
                `Compare ${attribute.name}`,
                `Comparar ${attribute.name}`,
              )}
              aria-describedby={
                activeAttribute === index ? tooltipId : undefined
              }
              onPointerMove={(event) =>
                showAttribute(index, event.clientX, event.clientY)
              }
              onClick={() => showAttribute(index)}
              onFocus={() => showAttribute(index)}
              onBlur={() => setActiveAttribute(null)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setActiveAttribute(null);
                } else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  showAttribute(index);
                }
              }}
            >
              <path
                d={`M ${center.x} ${center.y} L ${from.x} ${from.y} A ${radius * 1.37} ${radius * 1.37} 0 0 1 ${to.x} ${to.y} Z`}
                fill="transparent"
              />
              <line
                className="semantic-radar-focus-axis"
                x1={center.x}
                y1={center.y}
                x2={edge.x}
                y2={edge.y}
                stroke="var(--foreground)"
                strokeDasharray="3 4"
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>
      <svg className="semantic-radar-text" aria-hidden="true">
        {[25, 50, 75, 100].map((value) => {
          // On a bisector, where each ring's edge is (never on an axis, so never under its label): the one nearest straight down,
          // since the top label grows upward and a bottom one downward. The bisector of the first two axes ran into the top label.
          const angle = ((Math.floor((attributes.length - 1) / 2) + 0.5) * 2 * Math.PI) / attributes.length - Math.PI / 2;
          const reach = (radius * value * Math.cos(Math.PI / attributes.length)) / 100;
          return (
            <text
              key={value}
              className={value % 50 ? 'semantic-radar-scale semantic-radar-scale-minor' : 'semantic-radar-scale'}
              x={pctX(center.x + Math.cos(angle) * reach + 4)}
              y={pctY(center.y + Math.sin(angle) * reach - 2)}
            >
              {value}
            </text>
          );
        })}
        {attributes.map((attribute, index) => {
          const label = point(index, 122);
          const lines: string[] = [];
          for (const word of attribute.name.split(' ')) {
            if (!lines.length || lines.at(-1)!.length + word.length > 18)
              lines.push(word);
            else lines[lines.length - 1] += ` ${word}`;
          }
          return (
            <g key={attribute.id}>
              <text
                className="semantic-radar-label"
                x={pctX(label.x)}
                y={pctY(label.y)}
                textAnchor={
                  Math.abs(label.x - center.x) < 5
                    ? 'middle'
                    : label.x < center.x
                      ? 'end'
                      : 'start'
                }
              >
                {/* A label above the radar grows upward and one beside it centres on its axis, so no line runs into the plot. */}
                {lines.map((line, lineIndex) => (
                  <tspan key={lineIndex} x={pctX(label.x)} dy={lineIndex ? '1.3em' : label.y < center.y - 5 ? `${-(lines.length - 1) * 1.3}em` : label.y <= center.y + 5 ? `${-(lines.length - 1) * 0.65}em` : 0}>
                    {line}
                  </tspan>
                ))}
              </text>
              <text
                className="semantic-radar-mobile-label"
                x={pctX(label.x)}
                y={pctY(label.y)}
                textAnchor="middle"
              >
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      </div>
      {active && (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          className="semantic-radar-tooltip"
          style={tooltipPosition}
        >
          <h3>{active.name}</h3>
          {brands.length ? (
            <ul>
              {brands
                .map((brand) => ({ brand, value: brand.attributes.find((cell) => cell.attribute.id === active.id)?.observedValue ?? null }))
                // Highest score first; a brand without a score last.
                .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
                .map(({ brand, value }) => (
                  <li key={brand.entity.id}>
                    <i
                      style={{
                        backgroundColor: brandColor(brand.entity.id, report),
                      }}
                    />
                    <span>{brand.entity.name}</span>
                    <span className="semantic-radar-value">
                      {value == null ? l('No evaluation', 'Sem avaliação') : `${number(value, 1)} / 100`}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p>
              {l(
                'Select a brand in the legend to display it.',
                'Selecione uma marca na legenda para exibi-la.',
              )}
            </p>
          )}
        </div>
      )}
      <ol className="semantic-radar-attribute-key" aria-hidden="true">
        {attributes.map((attribute) => (
          <li key={attribute.id}>{attribute.name}</li>
        ))}
      </ol>
    </div>
  );
}
/* eslint-enable jsx-a11y/prefer-tag-over-role */
