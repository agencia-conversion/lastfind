import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { demoSources, type DemoPrompt, type DemoResponse } from './demo-data';
import {
  FilterSelect,
  ModelMark,
  SiteFavicon,
  useCopy,
  useNumbers,
} from './shared';
import { seriesColorVar } from '@/lib/chart-series';
import { ENGINE_LABELS, isEngine } from '@/lib/engines';
import type { SemanticAssociationReport as Report } from './semantic-association-data';
import './semantic-branding.css';
import './semantic-association-report.css';

type Props = {
  report: Report;
  prompts: Pick<DemoPrompt, 'id' | 'text'>[];
  responses: DemoResponse[];
  onOpenChat?: (response: DemoResponse) => void;
  language?: 'en-US' | 'pt-BR';
  idPrefix?: string;
  shareSectionLinks?: boolean;
  publicReport?: boolean;
  onConfigure?: () => void;
  explanations?:
    | ReactNode
    | ((selection: { brandId: string; attributeId: string }) => ReactNode);
  onEvidenceSelectionChange?: () => void;
};
const color = (id: string, report: Report) =>
  seriesColorVar(
    id,
    report.own?.entity.id ?? '',
    report.brands.filter((brand) => brand.entity.id !== report.own?.entity.id)
      .map((brand) => brand.entity.id),
  );

export function SemanticAssociationReport({
  report,
  prompts,
  responses,
  onOpenChat,
  language,
  idPrefix = 'semantic-association',
  shareSectionLinks = true,
  publicReport = false,
  onConfigure,
  explanations,
  onEvidenceSelectionChange,
}: Props) {
  const l = useCopy();
  const { number, locale } = useNumbers();
  const id = idPrefix;
  const [activeSection, setActiveSection] = useState('summary');
  const navigationRef = useRef<HTMLElement>(null);
  const [hiddenBrands, setHiddenBrands] = useState<string[]>([]);
  const [attributeId, setAttributeId] = useState(
    report.configuration.attributes[0]?.id ?? '',
  );
  const [expandedRanking, setExpandedRanking] = useState(false);
  const [brandId, setBrandId] = useState('all');
  useEffect(() => {
    onEvidenceSelectionChange?.();
  }, [attributeId, brandId, onEvidenceSelectionChange]);
  const attribute =
    report.configuration.attributes.find((item) => item.id === attributeId) ??
    report.configuration.attributes[0];
  const points = (value: number | null | undefined) =>
    value == null ? '—' : number(value, 1);
  const date = report.date
    ? new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(report.date))
    : '—';
  const headings = [
    l('Summary', 'Resumo'),
    l('Score', 'Score'),
    l('Radar', 'Radar'),
    l('Top attributes', 'Top atributos'),
    l('Heatmap', 'Mapa de calor'),
    l(publicReport ? 'Details' : 'Explanations', publicReport ? 'Detalhes' : 'Justificativas'),
  ];
  const sections = [
    'summary',
    'score',
    'radar',
    'top',
    'heatmap',
    'explanations',
  ];
  useEffect(() => {
    if (!report.configuration.enabled) return;
    const sectionIds = [
      'summary',
      'score',
      'radar',
      'top',
      'heatmap',
      'explanations',
    ];
    let frame = 0;
    const update = () => {
      const nav = navigationRef.current;
      const offset =
        nav && getComputedStyle(nav).flexDirection === 'row'
          ? nav.getBoundingClientRect().bottom + 24
          : (document
              .querySelector('.analytics-topbar')
              ?.getBoundingClientRect().bottom ?? 80) + 32;
      let current = sectionIds[0];
      for (const section of sectionIds) {
        const element = document.getElementById(`${id}-${section}`);
        if (element && element.getBoundingClientRect().top <= offset)
          current = section;
      }
      const last = document.getElementById(`${id}-explanations`);
      if (last && current !== 'explanations') {
        let scrollParent = last.parentElement;
        while (
          scrollParent &&
          !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY)
        )
          scrollParent = scrollParent.parentElement;
        const scroller = scrollParent ?? document.scrollingElement;
        if (scroller) {
          const viewportBottom = scrollParent
            ? scrollParent.getBoundingClientRect().top +
              scrollParent.clientTop +
              scrollParent.clientHeight
            : window.innerHeight;
          const remaining =
            scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
          const rect = last.getBoundingClientRect();
          // A short final section cannot reach the heading offset when its
          // scroll container is already at the bottom. Keep manual scrolling
          // authoritative, including inside the snapshot dialog.
          if (
            scroller.scrollHeight > scroller.clientHeight + 1 &&
            remaining <= 1 &&
            rect.top < viewportBottom &&
            rect.bottom > offset
          )
            current = 'explanations';
        }
      }
      setActiveSection(current);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    // Capture also observes the independently scrolling snapshot dialog.
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [id, report.configuration.enabled]);
  useEffect(() => {
    if (!shareSectionLinks || !report.configuration.enabled) return;
    const restoreSection = () => {
      const section = [
        'summary',
        'score',
        'radar',
        'top',
        'heatmap',
        'explanations',
      ].find((value) => window.location.hash === `#${id}-${value}`);
      if (!section) return;
      document.getElementById(`${id}-${section}`)?.scrollIntoView({
        behavior: 'instant',
        block: 'start',
      });
      setActiveSection(section);
    };
    const frame = requestAnimationFrame(restoreSection);
    window.addEventListener('hashchange', restoreSection);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', restoreSection);
    };
  }, [id, report.configuration.enabled, shareSectionLinks]);
  const navigateSection = (section: string) => {
    setActiveSection(section);
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
  const selectedBrands = report.brands.filter(
    (brand) => !hiddenBrands.includes(brand.entity.id),
  );
  const observedBrands = report.brands.filter((brand) =>
    brand.attributes.some((cell) => cell.observedValue !== null),
  );
  const ownObserved = report.own?.attributes.filter(
    (cell) => cell.observedValue !== null,
  ) ?? [];
  const byAttribute = report.brands
    .map((brand) => ({
      brand,
      cell: brand.attributes.find(
        (item) => item.attribute.id === attribute?.id,
      ),
    }))
    .filter((item) => item.cell?.value != null)
    .sort((a, b) => b.cell!.value! - a.cell!.value!);
  const selectEvidence = (nextAttribute: string, nextBrand = 'all') => {
    setAttributeId(nextAttribute);
    setBrandId(nextBrand);
    navigateSection('explanations');
  };
  return (
    <div className="semantic-association-report">
      <div
        className={`semantic-association-layout${report.configuration.enabled ? '' : ' semantic-association-layout-empty'}`}
      >
        {report.configuration.enabled && (
          <nav
            ref={navigationRef}
            className="semantic-report-nav"
            aria-label={l(
              'Association report sections',
              'Seções do relatório de associação',
            )}
          >
            {sections.map((section, index) => (
              <a
                key={section}
                href={`#${id}-${section}`}
                aria-current={
                  activeSection === section ? 'location' : undefined
                }
                onClick={(event) => {
                  if (
                    event.button ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  navigateSection(section);
                }}
              >
                {headings[index]}
              </a>
            ))}
          </nav>
        )}
        <div className="semantic-association-content">
          {!report.configuration.enabled ? (
            <section className="analytics-panel semantic-association-empty">
              <h2>
                {l(
                  'Choose the associations that matter',
                  'Escolha as associações que importam',
                )}
              </h2>
              <p>
                {l(
                  'Semantic branding is not enabled in this configuration. Choose the attributes you want your brand to be known for when you are ready.',
                  'Branding semântico não está ativado nesta configuração. Escolha os atributos pelos quais sua marca quer ser reconhecida quando quiser começar.',
                )}
              </p>
              {onConfigure && (
                <Button variant="outline" size="sm" onClick={onConfigure}>
                  {l('Configure attributes', 'Configurar atributos')}
                </Button>
              )}
            </section>
          ) : (
            <>
              <section
                id={`${id}-summary`}
                className="semantic-association-section"
              >
                <div className="semantic-association-intro">
                  <h2>
                    {l(
                      'How AI connects your brand to its attributes',
                      'Como a IA conecta sua marca aos seus atributos',
                    )}
                  </h2>
                  <p>
                    {l(
                      publicReport ? 'Explore observed associations, sample counts and comparable coverage across brands.' : 'Understand the associations, compare competitors and inspect the reasoning behind each grade.',
                      publicReport ? 'Explore associações observadas, contagens de amostras e cobertura comparável entre marcas.' : 'Entenda as associações, compare concorrentes e investigue a justificativa de cada nota.',
                    )}
                  </p>
                </div>
                <div className="semantic-summary">
                  {report.own?.score != null ? (
                    <>
                      <div className="semantic-score">
                        <div>
                          <span>
                            {l(
                              'Semantic association score',
                              'Score de associação semântica',
                            )}
                          </span>
                          <Info size={14} aria-hidden="true" />
                        </div>
                        <strong>
                          {points(report.own?.score)}
                          <small>/ 100</small>
                        </strong>
                        <p>
                          {l(
                            report.own?.score == null
                              ? 'Overall score unavailable: comparable coverage is incomplete.'
                              : 'Simple mean of configured attributes',
                            report.own?.score == null
                              ? 'Score geral indisponível: cobertura comparável incompleta.'
                              : 'Média simples dos atributos configurados',
                          )}
                        </p>
                      </div>
                      {report.reference && (
                        <SummaryMetric
                          label={l('Reference brand', 'Marca de referência')}
                          value={report.reference?.entity.name ?? '—'}
                          note={`${points(report.reference?.score)} / 100 · ${report.leader?.entity.id === report.own?.entity.id ? l('second place', 'segunda posição') : l('leader', 'líder')}`}
                        />
                      )}
                      {report.gap != null && (
                        <SummaryMetric
                          label={l('Your difference', 'Sua diferença')}
                          value={
                            report.gap == null
                              ? '—'
                              : `${report.gap > 0 ? '+' : ''}${points(report.gap)}`
                          }
                          note={l(
                            'points against the reference',
                            'pontos em relação à referência',
                          )}
                        />
                      )}
                      <SummaryMetric
                        label={l('Brands evaluated', 'Marcas avaliadas')}
                        value={`${number(report.ranking.length)} / ${number(report.brands.length)}`}
                        note={l(
                          'with a comparable complete score',
                          'com score completo comparável',
                        )}
                      />
                    </>
                  ) : (
                    <>
                      <SummaryMetric
                        label={l(
                          'Your observed attributes',
                          'Seus atributos observados',
                        )}
                        value={`${number(ownObserved.length)} / ${number(report.configuration.attributes.length)}`}
                        note={l(
                          'with assessed evidence',
                          'com evidências avaliadas',
                        )}
                      />
                      <SummaryMetric
                        label={l(
                          'Brands with observations',
                          'Marcas com observações',
                        )}
                        value={`${number(observedBrands.length)} / ${number(report.brands.length)}`}
                        note={l(
                          'with at least one assessed attribute',
                          'com pelo menos um atributo avaliado',
                        )}
                      />
                      <SummaryMetric
                        label={l(
                          'Comparable attributes',
                          'Atributos comparáveis',
                        )}
                        value={`${number(report.comparableAttributes)} / ${number(report.configuration.attributes.length)}`}
                        note={l(
                          'with a shared sample between brands',
                          'com amostra comum entre marcas',
                        )}
                      />
                      <SummaryMetric
                        label={l('Report coverage', 'Cobertura do relatório')}
                        value={l(
                          observedBrands.length ? 'Partial' : 'Not assessed',
                          observedBrands.length ? 'Parcial' : 'Não avaliado',
                        )}
                        note={l(
                          observedBrands.length
                            ? 'Observed data available; overall comparison needs complete shared coverage.'
                            : 'No assessed evidence in this selected context.',
                          observedBrands.length
                            ? 'Dados observados disponíveis; a comparação geral exige cobertura comum completa.'
                            : 'Sem evidência avaliada neste contexto selecionado.',
                        )}
                      />
                    </>
                  )}
                </div>
                {ownObserved.length > 0 && (
                  <div className="semantic-association-highlights">
                    <SummaryMetric
                      label={l('Strongest attribute', 'Atributo mais forte')}
                      value={report.strongest?.attribute.name ?? '—'}
                      note={`${points(report.strongest?.observedValue)} / 100 · ${number(report.strongest?.observedDenominator ?? 0)} ${l(report.strongest?.observedDenominator === 1 ? 'evaluation' : 'evaluations', report.strongest?.observedDenominator === 1 ? 'avaliação' : 'avaliações')}`}
                    />
                    <SummaryMetric
                      label={l(
                        'Attribute to develop',
                        'Atributo a desenvolver',
                      )}
                      value={report.priority?.attribute.name ?? '—'}
                      note={`${points(report.priority?.observedValue)} / 100 · ${number(report.priority?.observedDenominator ?? 0)} ${l(report.priority?.observedDenominator === 1 ? 'evaluation' : 'evaluations', report.priority?.observedDenominator === 1 ? 'avaliação' : 'avaliações')}`}
                    />
                    <SummaryMetric
                      label={l('Selected context', 'Contexto selecionado')}
                      value={`${number(report.prompts)} ${l('base prompts', 'prompts base')}`}
                      note={`${report.date ? date + ' · ' : ''}${report.models.map((engine) => (isEngine(engine) ? ENGINE_LABELS[engine] : engine)).join(', ') || l('No evaluations', 'Sem avaliações')}`}
                    />
                  </div>
                )}
                <p className="semantic-association-note">
                  <Info size={14} aria-hidden="true" />
                  {l(
                    'Radar, heatmap and highlights show observed attribute means from each brand’s available evaluations. Samples may differ between brands; these values are not a competitive ranking. Overall scores, ranks and differences require complete comparable coverage. Missing evaluations are never zero.',
                    'Radar, mapa de calor e destaques mostram médias observadas dos atributos nas avaliações disponíveis de cada marca. As amostras podem diferir entre marcas; esses valores não são um ranking competitivo. Scores gerais, posições e diferenças exigem cobertura comparável completa. Avaliações ausentes nunca são zero.',
                  )}
                </p>
              </section>
              <ReportSection
                id={`${id}-score`}
                title={l(
                  'A fair comparison, attribute by attribute',
                  'Uma comparação justa, atributo por atributo',
                )}
                description={l(
                  'Each configured attribute has the same weight. A total requires every attribute and the same model/context cohort across ranked brands.',
                  'Cada atributo configurado tem o mesmo peso. O total exige todos os atributos e a mesma amostra de modelo/contexto entre as marcas do ranking.',
                )}
              >
                {!report.ranking.length ? (
                  <>
                    <p className="semantic-association-note">
                      {l(
                        observedBrands.length
                          ? 'No overall ranking yet: the brands do not share assessed samples across every configured attribute. Available observations are shown below and in the radar and heatmap.'
                          : 'No assessed evidence in this selected context. Overall comparison is unavailable.',
                        observedBrands.length
                          ? 'Ainda não há ranking geral: as marcas não compartilham amostras avaliadas em todos os atributos configurados. As observações disponíveis aparecem abaixo e no radar e no mapa de calor.'
                          : 'Sem evidência avaliada neste contexto selecionado. A comparação geral está indisponível.',
                      )}
                    </p>
                    <div className="semantic-brand-ranking">
                      {observedBrands.map((brand) => (
                        <div
                          className="semantic-attribute-rank"
                          key={brand.entity.id}
                        >
                          <span className="semantic-site">
                            <SiteFavicon
                              domain={brand.entity.domain}
                              name={brand.entity.name}
                            />
                            {brand.entity.name}
                          </span>
                          <span>
                            {number(
                              brand.attributes.filter(
                                (cell) => cell.observedValue !== null,
                              ).length,
                            )}{' '}
                            / {number(report.configuration.attributes.length)}{' '}
                            {l('observed attributes', 'atributos observados')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="semantic-brand-ranking">
                    {report.ranking.map((brand) => (
                      <div
                        className="semantic-brand-rank"
                        key={brand.entity.id}
                      >
                        <span className="semantic-rank-position">
                          {brand.score == null
                            ? '—'
                            : number(
                                report.ranking.findIndex(
                                  (row) => row.entity.id === brand.entity.id,
                                ) + 1,
                              )}
                        </span>
                        <div className="semantic-rank-brand">
                          <SiteFavicon
                            domain={brand.entity.domain}
                            name={brand.entity.name}
                          />
                          <div>
                            <strong>
                              {brand.entity.name}
                              {brand.entity.id === report.own?.entity.id && (
                                <OwnBrandBadge />
                              )}
                            </strong>
                            <small>{brand.entity.domain}</small>
                          </div>
                        </div>
                        <div className="semantic-rank-bar">
                          <i
                            style={{
                              width: `${brand.score ?? 0}%`,
                              backgroundColor: color(brand.entity.id, report),
                            }}
                          />
                        </div>
                        <strong className="semantic-rank-score">
                          {points(brand.score)}
                          <small>/ 100</small>
                        </strong>
                        <span className="semantic-rank-count">
                          {number(brand.assessedAttributes)}/
                          {number(report.configuration.attributes.length)}{' '}
                          {l('attributes', 'atributos')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <details className="semantic-association-method">
                  <summary>
                    {l(
                      'How to read the score and missing data',
                      'Como ler o score e os dados ausentes',
                    )}
                  </summary>
                  <p>
                    {l(
                      'First, average valid 0–100 evaluations within each attribute and the shared cohort. Then take the simple mean across all configured attributes. Zero is a valid observed grade; absence is never zero. An incomplete brand has no overall rank. Merging brand identities keeps the original evidence and requires a new association evaluation.',
                      'Primeiro, calcule a média das avaliações válidas de 0–100 de cada atributo na amostra comum. Depois, calcule a média simples de todos os atributos configurados. Zero é uma nota observada válida; ausência nunca é zero. Uma marca incompleta não recebe posição geral. Unir identidades preserva as evidências originais e exige uma nova avaliação de associação.',
                    )}
                  </p>
                </details>
              </ReportSection>
              <ReportSection
                id={`${id}-radar`}
                title={l('Your semantic territory', 'Seu território semântico')}
                description={l(
                  'Observed attribute scores, 0–100, with each brand’s own samples. The legend changes the displayed brands without recalculating scores or rankings.',
                  'Notas observadas dos atributos, de 0–100, com as amostras de cada marca. A legenda altera as marcas exibidas, sem recalcular notas ou posições.',
                )}
              >
                <div className="semantic-radar-legend">
                  {report.brands.map((brand) => (
                    <label key={brand.entity.id}>
                      <Checkbox
                        checked={!hiddenBrands.includes(brand.entity.id)}
                        onCheckedChange={(checked) =>
                          setHiddenBrands((current) =>
                            checked
                              ? current.filter(
                                  (value) => value !== brand.entity.id,
                                )
                              : [...current, brand.entity.id],
                          )
                        }
                      />
                      <i
                        style={{
                          backgroundColor: color(brand.entity.id, report),
                        }}
                      />
                      <span>{brand.entity.name}</span>
                    </label>
                  ))}
                </div>
                {report.configuration.attributes.length >= 3 ? (
                  <SemanticRadar report={report} brands={selectedBrands} />
                ) : (
                  <p className="semantic-association-note">
                    {l(
                      'A radar needs at least three attributes. Compare your selected attributes in the table below.',
                      'Um radar precisa de pelo menos três atributos. Compare os atributos selecionados na tabela abaixo.',
                    )}
                  </p>
                )}
                {!selectedBrands.length && (
                  <output className="semantic-association-note">
                    {l(
                      'Select a brand in the legend to display it.',
                      'Selecione uma marca na legenda para exibi-la.',
                    )}
                  </output>
                )}
                <AttributeTable report={report} brands={selectedBrands} />
              </ReportSection>
              <ReportSection
                id={`${id}-top`}
                title={l(
                  'Who leads each association',
                  'Quem lidera cada associação',
                )}
                description={l(
                  'Choose an attribute to compare only brands with a shared assessed sample. Observed readings remain available in the radar and heatmap.',
                  'Escolha um atributo para comparar somente marcas com uma amostra avaliada comum. As leituras observadas continuam disponíveis no radar e no mapa de calor.',
                )}
              >
                <div className="semantic-association-controls">
                  <FilterSelect
                    value={attribute?.id ?? ''}
                    onChange={setAttributeId}
                    options={report.configuration.attributes.map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                    label={l('Attribute', 'Atributo')}
                  />
                </div>
                {!byAttribute.length && (
                  <p className="semantic-association-note">
                    {l(
                      `No comparable sample for ${attribute?.name ?? ''}. Observed evaluations are available for ${report.brands.filter((brand) => brand.attributes.some((cell) => cell.attribute.id === attribute?.id && cell.observedValue !== null)).length} brands; inspect them in the radar, heatmap or ${publicReport ? 'details' : 'explanations'}.`,
                      `Não há amostra comparável para ${attribute?.name ?? ''}. Há avaliações observadas para ${report.brands.filter((brand) => brand.attributes.some((cell) => cell.attribute.id === attribute?.id && cell.observedValue !== null)).length} marcas; consulte-as no radar, mapa de calor ou ${publicReport ? 'detalhes' : 'justificativas'}.`,
                    )}
                  </p>
                )}
                <div className="semantic-brand-ranking">
                  {byAttribute
                    .slice(0, expandedRanking ? undefined : 5)
                    .map(({ brand, cell }) => (
                      <button
                        key={brand.entity.id}
                        className="semantic-attribute-rank"
                        onClick={() =>
                          attribute &&
                          selectEvidence(attribute.id, brand.entity.id)
                        }
                      >
                        <span className="semantic-rank-brand">
                          <SiteFavicon
                            domain={brand.entity.domain}
                            name={brand.entity.name}
                          />
                          <span className="semantic-rank-identity">
                            <strong>
                              {brand.entity.name}
                              {brand.entity.id === report.own?.entity.id && (
                                <OwnBrandBadge />
                              )}
                            </strong>
                            <small>{brand.entity.domain}</small>
                          </span>
                        </span>
                        <span>{points(cell?.value)} / 100</span>
                        <small>
                          {number(cell?.denominator ?? 0)}{' '}
                          {l(cell?.denominator === 1 ? 'evaluation' : 'evaluations', cell?.denominator === 1 ? 'avaliação' : 'avaliações')}
                        </small>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                </div>
                {byAttribute.length > 5 && (
                  <Button
                    className="semantic-association-more"
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedRanking((value) => !value)}
                  >
                    {expandedRanking
                      ? l('Show less', 'Mostrar menos')
                      : l('Show all brands', 'Mostrar todas as marcas')}
                    <ChevronDown size={14} />
                  </Button>
                )}
              </ReportSection>
              <ReportSection
                id={`${id}-heatmap`}
                title={l(
                  'The full association map',
                  'O mapa completo de associações',
                )}
                description={l(
                  publicReport ? 'Darker cells show a stronger observed association. Select a cell to inspect its aggregate score, sample counts and coverage.' : 'Darker cells show a stronger association. Every value is readable without relying on color; select one to inspect its evidence.',
                  publicReport ? 'Células mais escuras indicam associação observada mais forte. Selecione uma célula para consultar sua nota agregada, contagens de amostras e cobertura.' : 'Células mais escuras indicam associação mais forte. Os valores são legíveis sem depender da cor; selecione um para investigar suas evidências.',
                )}
              >
                <AttributeTable
                  report={report}
                  brands={report.brands}
                  onSelect={selectEvidence}
                  heatmap
                />
                <div className="semantic-heatmap-legend">
                  <span>0</span>
                  <i aria-hidden="true" />
                  <span>100</span>
                  <span>{l('Not assessed: no assessed evidence', 'Não avaliado: sem evidência avaliada')}</span>
                </div>
              </ReportSection>
              <ReportSection
                id={`${id}-explanations`}
                title={l(
                  publicReport ? 'Evaluation details' : 'The reasoning behind the grade',
                  publicReport ? 'Detalhes da avaliação' : 'A justificativa por trás da nota',
                )}
                description={l(
                  publicReport ? 'Inspect aggregate scores, sample counts and assessed coverage. Individual quotes and evaluation reasoning remain private.' : 'Inspect the evaluation prompt, model and context. Aggregated links are a separate evidence layer and do not verify a grade.',
                  publicReport ? 'Consulte notas agregadas, contagens de amostras e cobertura avaliada. Citações individuais e justificativas das avaliações permanecem privadas.' : 'Investigue o prompt de avaliação, o modelo e o contexto. Links agregados são uma camada separada de evidência e não comprovam uma nota.',
                )}
              >
                <div className="semantic-association-controls">
                  <FilterSelect
                    value={attribute?.id ?? ''}
                    onChange={setAttributeId}
                    options={report.configuration.attributes.map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                    label={l('Attribute', 'Atributo')}
                  />
                  <FilterSelect
                    value={brandId}
                    onChange={setBrandId}
                    options={[
                      {
                        value: 'all',
                        label: l('All brands', 'Todas as marcas'),
                      },
                      ...report.brands.map((brand) => ({
                        value: brand.entity.id,
                        label: brand.entity.name,
                      })),
                    ]}
                    label={l('Brand', 'Marca')}
                  />
                </div>
                {attribute && (
                  <div className="semantic-attribute-intent">
                    <strong>{attribute.name}</strong>
                    <p>
                      {attribute.description ||
                        l(
                          'Association measured in the available evaluations.',
                          'Associação medida nas avaliações disponíveis.',
                        )}
                    </p>
                  </div>
                )}
                <div className="semantic-explanation-list">
                  {(typeof explanations === 'function'
                    ? explanations({
                        brandId,
                        attributeId: attribute?.id ?? '',
                      })
                    : explanations) ??
                    report.brands
                    .filter(
                      (brand) =>
                        brandId === 'all' || brand.entity.id === brandId,
                    )
                    .map((brand) => {
                      const cell = brand.attributes.find(
                        (item) => item.attribute.id === attribute?.id,
                      );
                      return (
                        <details
                          key={`${attribute?.id}/${brand.entity.id}`}
                          className="semantic-explanation"
                          open={
                            brandId === brand.entity.id ||
                            (brandId === 'all' &&
                              brand.entity.id === report.own?.entity.id) ||
                            undefined
                          }
                        >
                          <summary>
                            <span className="semantic-rank-brand">
                              <SiteFavicon
                                domain={brand.entity.domain}
                                name={brand.entity.name}
                              />
                              <span className="semantic-rank-identity">
                                <strong>
                                  {brand.entity.name}
                                  {brand.entity.id ===
                                    report.own?.entity.id && <OwnBrandBadge />}
                                </strong>
                                <small>{brand.entity.domain}</small>
                              </span>
                            </span>
                            <span>{points(cell?.value)} / 100</span>
                          </summary>
                          <p>
                            {l(
                              `${number(cell?.denominator ?? 0)} valid evaluations in the selected context.`,
                              `${number(cell?.denominator ?? 0)} avaliações válidas no contexto selecionado.`,
                            )}
                          </p>
                          {cell?.inconclusive.map((item) => (
                            <p
                              className="semantic-association-note"
                              key={item.id}
                            >
                              <strong>
                                {item.status === 'ambiguous'
                                  ? l(
                                      'Ambiguous identity',
                                      'Identidade ambígua',
                                    )
                                  : l(
                                      'Insufficient evidence',
                                      'Evidência insuficiente',
                                    )}
                              </strong>{' '}
                              · {item.model} ·{' '}
                              {locale === 'pt-BR'
                                ? item.explanation.pt
                                : item.explanation.en}
                            </p>
                          ))}
                          {!cell?.evidence.length ? (
                            <p>
                              {l(
                                'There is no compatible assessment for this brand and attribute. No grade or explanation has been inferred.',
                                'Não há avaliação compatível para esta marca e este atributo. Nenhuma nota ou justificativa foi inferida.',
                              )}
                            </p>
                          ) : (
                            report.models.map((model) => {
                              const evidence = cell.evidence
                                .filter((item) => item.model === model)
                                .sort((a, b) => b.date.localeCompare(a.date));
                              const sample = evidence[0];
                              if (!sample) return null;
                              const context = prompts.find(
                                (prompt) =>
                                  prompt.id === sample.contextPromptId,
                              );
                              const response = responses.find(
                                (item) => item.id === sample.cohortId,
                              );
                              const pt = language
                                ? language === 'pt-BR'
                                : locale === 'pt-BR';
                              return (
                                <div
                                  className="semantic-assessment-evidence"
                                  key={model}
                                >
                                  <div>
                                    <ModelMark model={model} />
                                    <span>
                                      {points(
                                        evidence.reduce(
                                          (sum, row) => sum + row.score!,
                                          0,
                                        ) / evidence.length,
                                      )}{' '}
                                      / 100 · {number(evidence.length)}{' '}
                                      {l('evaluations', 'avaliações')}
                                    </span>
                                  </div>
                                  <p>
                                    {pt
                                      ? sample.explanation.pt
                                      : sample.explanation.en}
                                  </p>
                                  <details>
                                    <summary>
                                      {l(
                                        'View evaluation prompt and context',
                                        'Ver prompt de avaliação e contexto',
                                      )}
                                    </summary>
                                    <dl>
                                      <dt>
                                        {l(
                                          'AI evaluation prompt',
                                          'Prompt de avaliação da IA',
                                        )}
                                      </dt>
                                      <dd>
                                        {pt
                                          ? sample.prompt.pt
                                          : sample.prompt.en}
                                      </dd>
                                      <dt>
                                        {l(
                                          'Base context prompt',
                                          'Prompt base do contexto',
                                        )}
                                      </dt>
                                      <dd>
                                        {context?.text ??
                                          sample.contextPromptId}
                                      </dd>
                                      <dt>
                                        {l('Example date', 'Data do exemplo')}
                                      </dt>
                                      <dd>
                                        {new Intl.DateTimeFormat(locale, {
                                          dateStyle: 'medium',
                                          timeZone: 'UTC',
                                        }).format(new Date(sample.date))}
                                      </dd>
                                    </dl>
                                    <p>
                                      {l(
                                        'Illustrative evaluation; no collection was submitted.',
                                        'Avaliação ilustrativa; nenhuma coleta foi enviada.',
                                      )}
                                    </p>
                                    {response && onOpenChat && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => onOpenChat(response)}
                                      >
                                        {l(
                                          'Open context response',
                                          'Abrir resposta de contexto',
                                        )}
                                        <ArrowUpRight size={14} />
                                      </Button>
                                    )}
                                  </details>
                                  <div className="semantic-contextual-sources">
                                    <strong>
                                      {l(
                                        'Aggregated contextual sources',
                                        'Fontes agregadas de contexto',
                                      )}
                                    </strong>
                                    <p>
                                      {l(
                                        'Links from the context response; they do not determine the grade.',
                                        'Links da resposta de contexto; não determinam a nota.',
                                      )}
                                    </p>
                                    {sample.sourceUrls.length ? (
                                      sample.sourceUrls.map((url) => (
                                        <a
                                          key={url}
                                          href={url}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          {demoSources.find(
                                            (source) => source.url === url,
                                          )?.title ?? new URL(url).hostname}
                                          <ArrowUpRight size={12} />
                                        </a>
                                      ))
                                    ) : (
                                      <span>
                                        {l(
                                          'No contextual links available.',
                                          'Nenhum link contextual disponível.',
                                        )}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </details>
                      );
                    })}
                </div>
              </ReportSection>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OwnBrandBadge() {
  const l = useCopy();
  return (
    <span className="semantic-own-brand">{l('your brand', 'sua marca')}</span>
  );
}

function SummaryMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="semantic-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  );
}
function ReportSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="analytics-panel semantic-association-section">
      <header className="semantic-panel-heading">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function AttributeTable({
  report,
  brands,
  onSelect,
  heatmap = false,
}: {
  report: Report;
  brands: Report['brands'];
  onSelect?: (attribute: string, brand: string) => void;
  heatmap?: boolean;
}) {
  const l = useCopy();
  const { number } = useNumbers();
  // Keyboard users must be able to scroll the complete comparison at narrow widths.
  /* eslint-disable jsx-a11y/no-noninteractive-tabindex */
  return (
    <Table
      className={`semantic-table semantic-association-table${heatmap ? ' semantic-association-heatmap' : ''}`}
      containerClassName="semantic-table-scroll semantic-association-table-scroll"
      containerProps={{
        role: 'region',
        tabIndex: 0,
        'aria-label': l(
          'Attribute comparison table',
          'Tabela comparativa de atributos',
        ),
      }}
    >
        <caption>
          {l(
            'Observed association grades, 0–100; evaluation counts in parentheses. Samples may differ between brands. Not assessed means no assessed evidence.',
            'Notas observadas de associação de 0–100; contagens de avaliações entre parênteses. As amostras podem diferir entre marcas. Não avaliado indica ausência de evidência avaliada.',
          )}
        </caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{l('Brand', 'Marca')}</TableHead>
            {report.configuration.attributes.map((attribute) => (
              <TableHead key={attribute.id} scope="col">
                {attribute.name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {brands.map((brand) => (
            <TableRow key={brand.entity.id}>
              <TableHead scope="row">
                <span className="semantic-site">
                  <SiteFavicon
                    domain={brand.entity.domain}
                    name={brand.entity.name}
                  />
                  {brand.entity.name}
                </span>
              </TableHead>
              {brand.attributes.map((cell) => (
                <TableCell
                  key={cell.attribute.id}
                  style={
                    heatmap && cell.observedValue != null
                      ? {
                          backgroundColor: `color-mix(in srgb, var(--primary) ${8 + cell.observedValue * 0.6}%, var(--background))`,
                          color: '#111827',
                        }
                      : undefined
                  }
                >
                  {onSelect ? (
                    <button
                      aria-label={`${brand.entity.name}: ${cell.attribute.name}, ${cell.observedValue == null ? l('No assessed evidence', 'Sem evidência avaliada') : `${number(cell.observedValue, 1)} / 100 · ${number(cell.observedDenominator)} ${l(cell?.observedDenominator === 1 ? 'evaluation' : 'evaluations', cell?.observedDenominator === 1 ? 'avaliação' : 'avaliações')}`}`}
                      onClick={() => onSelect(cell.attribute.id, brand.entity.id)}
                    >
                      {cell.observedValue == null
                        ? l('Not assessed', 'Não avaliado')
                        : `${number(cell.observedValue, 1)} (${number(cell.observedDenominator)})`}
                    </button>
                  ) : cell.observedValue == null ? (
                    l('Not assessed', 'Não avaliado')
                  ) : (
                    `${number(cell.observedValue, 1)} (${number(cell.observedDenominator)})`
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
    </Table>
  );
}

/* eslint-enable jsx-a11y/no-noninteractive-tabindex */
// SVG requires ARIA roles: HTML buttons/fieldsets are not valid SVG children.
/* eslint-disable jsx-a11y/prefer-tag-over-role */
function SemanticRadar({
  report,
  brands,
}: {
  report: Report;
  brands: Report['brands'];
}) {
  const l = useCopy();
  const { number } = useNumbers();
  const tooltipId = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const [activeAttribute, setActiveAttribute] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ left: 12, top: 12 });
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
    const anchor = point(index, 75);
    const x =
      clientX == null ? (anchor.x / 540) * bounds.width : clientX - bounds.left;
    const y =
      clientY == null ? (anchor.y / 540) * bounds.width : clientY - bounds.top;
    const tooltipWidth = Math.min(260, bounds.width - 24);
    setTooltipPosition({
      left: Math.max(12, Math.min(x + 14, bounds.width - tooltipWidth - 12)),
      top: Math.max(
        12,
        Math.min(y - 40, bounds.height - (70 + brands.length * 27)),
      ),
    });
    setActiveAttribute(index);
  };
  const active = activeAttribute == null ? null : attributes[activeAttribute];
  return (
    <div
      className="semantic-radar"
      ref={chartRef}
      onPointerLeave={() => {
        if (!chartRef.current?.contains(document.activeElement))
          setActiveAttribute(null);
      }}
    >
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
              <text
                x={center.x + 5}
                y={center.y - (radius * value) / 100 - 3}
                className="semantic-radar-tick"
              >
                {value}
              </text>
            </g>
          ))}
          {attributes.map((attribute, index) => {
            const end = point(index, 100);
            const label = point(index, 122);
            const lines: string[] = [];
            for (const word of attribute.name.split(' ')) {
              if (!lines.length || lines.at(-1)!.length + word.length > 18)
                lines.push(word);
              else lines[lines.length - 1] += ` ${word}`;
            }
            return (
              <g key={attribute.id}>
                <line
                  x1={center.x}
                  y1={center.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="var(--border)"
                />
                <text
                  className="semantic-radar-label"
                  x={label.x}
                  y={label.y}
                  textAnchor={
                    Math.abs(label.x - center.x) < 5
                      ? 'middle'
                      : label.x < center.x
                        ? 'end'
                        : 'start'
                  }
                >
                  {lines.map((line, lineIndex) => (
                    <tspan key={lineIndex} x={label.x} dy={lineIndex ? 15 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
                <text
                  className="semantic-radar-mobile-label"
                  x={label.x}
                  y={label.y}
                  textAnchor="middle"
                >
                  {index + 1}
                </text>
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
                fill={color(brand.entity.id, report)}
                fillOpacity=".045"
                stroke={color(brand.entity.id, report)}
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
                  fill={color(brand.entity.id, report)}
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
      {active && (
        <div
          id={tooltipId}
          role="tooltip"
          className="semantic-radar-tooltip"
          style={tooltipPosition}
        >
          <strong>{active.name}</strong>
          {brands.length ? (
            <ul>
              {brands.map((brand) => {
                const cell = brand.attributes.find(
                  (cell) => cell.attribute.id === active.id,
                );
                const value = cell?.observedValue;
                return (
                  <li key={brand.entity.id}>
                    <i
                      style={{
                        backgroundColor: color(brand.entity.id, report),
                      }}
                    />
                    <span>{brand.entity.name}</span>
                    <b>
                      {value == null
                        ? l('No evaluation', 'Sem avaliação')
                        : `${number(value, 1)} / 100 · ${number(cell?.observedDenominator ?? 0)} ${l(cell?.observedDenominator === 1 ? 'evaluation' : 'evaluations', cell?.observedDenominator === 1 ? 'avaliação' : 'avaliações')}`}
                    </b>
                  </li>
                );
              })}
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
