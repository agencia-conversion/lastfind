'use client';
import { useCollectionPage } from './shared';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Download,
  FileText,
  GitMerge,
  History,
  Info,
  Layers3,
  Network,
  Plus,
  Sparkles,
  Split,
  Target,
  Trash2,
  SlidersHorizontal,
  Undo2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  demoModels,
  demoSources,
  exportDemoCsv,
  selectResponses,
  promptMatchesFilters,
  filterLabel,
  type DemoFilters,
  type DemoReport,
  type DemoResponse,
} from './demo-data';
import { dateKey, getDateRange } from './date-range';
import {
  EmptyState,
  FilterSelect,
  ModelMark,
  PrimaryMenuActions,
  SearchField,
  SiteFavicon,
  useCopy,
  useNumbers,
} from './shared';
import {
  createSemanticSnapshot,
  parseSemanticQuestions,
  semanticSnapshotRows,
  evidenceExcerpt,
  initialBrandEntities,
  mergeBrandEntities,
  reconcileSemanticProject,
  semanticPromptSuggestions,
  semanticSummary,
  splitBrandEntity,
  type BrandEntity,
  type LocalizedText,
  type SemanticSnapshot as Snapshot,
  type SemanticSessionState,
} from './semantic-data';
import type { DemoProject } from './workspace-data';
import './semantic-branding.css';
import {
  defaultSemanticConfiguration,
  validateSemanticConfiguration,
  type SemanticConfiguration,
} from './semantic-configuration';
import {
  semanticAssociationReport,
  semanticAssessmentFixture,
} from './semantic-association-data';
import { SemanticAssociationReport } from './semantic-association-report';
import { onboardingAttributeSuggestions } from './onboarding-data';

type Props = {
  project: DemoProject;
  report: DemoReport;
  filters: DemoFilters;
  onOpenChat: (response: DemoResponse) => void;
  onOpenSource: (domain: string) => void;
  readOnly?: boolean;
  section: string;
  onSectionChange: (section: string) => void;
  savedState?: SemanticSessionState;
  onSaveState: (state: SemanticSessionState) => void;
  onConfigure: (configuration: SemanticConfiguration) => boolean;
};

// Retained evidence presentation; the product route uses the full report below.
export function SemanticEvidenceView({
  project,
  report,
  filters,
  onOpenChat,
  onOpenSource,
  readOnly = false,
  onConfigure,
  section,
  onSectionChange,
}: Props) {
  const l = useCopy();
  const { number, locale } = useNumbers();
  const configuration =
    project.setup?.semantic ??
    (project.id === 'conversion-web'
      ? defaultSemanticConfiguration(locale)
      : { enabled: false, attributes: [] });
  const [notice, setNotice] = useState('');
  const prompts = project.prompts.filter((prompt) =>
    promptMatchesFilters(prompt, filters),
  );
  const answers = [...report.responses].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const answerPage = useCollectionPage(
    answers,
    `${project.id}|${JSON.stringify(filters)}`,
  );
  const sourceIds = new Set(answers.flatMap((answer) => answer.sourceIds));
  const range = getDateRange(filters);
  const exportEvidence = () =>
    exportDemoCsv('lastfind-brand-evidence.csv', [
      [
        'Dataset',
        'Response',
        'Date',
        'Model',
        'Prompt',
        'Brands mentioned',
        'Cited URLs',
        'Consulted URLs',
        'From',
        'To',
        'Models',
        'Countries',
        'Topics',
        'Tags',
        'Tag match',
      ],
      ...answers.map((answer) => [
        'DEMO',
        answer.id,
        answer.date,
        answer.model,
        project.prompts.find((prompt) => prompt.id === answer.promptId)?.text ??
          '',
        answer.brandIds
          .map(
            (id) => report.brands.find((brand) => brand.id === id)?.name ?? id,
          )
          .join(' | '),
        answer.sourceIds
          .map(
            (id) => demoSources.find((source) => source.id === id)?.url ?? id,
          )
          .join(' | '),
        answer.consultedSourceIds === null
          ? 'Not provided'
          : answer.consultedSourceIds
              .map(
                (id) =>
                  demoSources.find((source) => source.id === id)?.url ?? id,
              )
              .join(' | '),
        range.from,
        range.to,
        filters.models.join(' | '),
        filterLabel(filters.country),
        filterLabel(filters.topic),
        filterLabel(filters.tag),
        filters.tagMode ?? 'any',
      ]),
    ]);
  const goToSection = (next: string) => {
    onSectionChange(next);
    window.scrollTo({ top: 0 });
  };
  if (section === 'attributes') {
    return (
      <SemanticAttributeSettings
        configuration={configuration}
        researchLanguage={
          project.setup?.language ?? (locale === 'pt-BR' ? 'pt-BR' : 'en-US')
        }
        projectSegment={project.setup?.segment ?? ''}
        readOnly={readOnly}
        onBack={() => goToSection('associations')}
        onSave={(next) => {
          if (readOnly) return;
          const persisted = onConfigure(next);
          setNotice(
            persisted
              ? l(
                  'Brand attributes saved for this browser tab, including reloads. No collection has started.',
                  'Atributos da marca salvos nesta aba, inclusive ao recarregar. Nenhuma coleta foi iniciada.',
                )
              : l(
                  'Brand attributes updated. Browser storage is unavailable, so these changes will be lost when you reload.',
                  'Atributos da marca atualizados. O armazenamento do navegador está indisponível; estas alterações serão perdidas ao recarregar.',
                ),
          );
          goToSection('associations');
        }}
      />
    );
  }
  return (
    <div className="semantic-evidence-view space-y-5">
      {notice && (
        <output className="semantic-notice">
          <Check size={14} />
          {notice}
          <button
            onClick={() => setNotice('')}
            aria-label={l('Dismiss notice', 'Fechar aviso')}
          >
            ×
          </button>
        </output>
      )}
      <section className="analytics-panel">
        <div className="panel-heading">
          <div>
            <h2>
              {l(
                'Explore your brand in context',
                'Explore sua marca no contexto',
              )}
            </h2>
            <p>
              {l(
                'Define the qualities to investigate, then read the answers and their sources.',
                'Defina as qualidades a investigar e leia as respostas e suas fontes.',
              )}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={exportEvidence}
            disabled={!answers.length}
          >
            <Download />
            {l('Export evidence', 'Exportar evidências')}
          </Button>
        </div>
        <div className="semantic-evidence-summary">
          <div>
            <strong>{number(answers.length)}</strong>
            <span>
              {l('Responses in this selection', 'Respostas nesta seleção')}
            </span>
          </div>
          <div>
            <strong>
              {number(
                answers.filter((answer) =>
                  answer.brandIds.includes('conversion'),
                ).length,
              )}
            </strong>
            <span>
              {l(
                'Responses mentioning your brand',
                'Respostas com menção à sua marca',
              )}
            </span>
          </div>
          <div>
            <strong>{number(sourceIds.size)}</strong>
            <span>{l('Cited URLs', 'URLs citadas')}</span>
          </div>
        </div>
      </section>
      <section className="analytics-panel">
        <div className="panel-heading">
          <div>
            <h2>{l('Attributes to investigate', 'Atributos a investigar')}</h2>
            <p>
              {l(
                'These are your research questions, not automatically assigned brand ratings.',
                'São suas perguntas de pesquisa, sem notas automáticas atribuídas à marca.',
              )}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={() => goToSection('attributes')}
          >
            <SlidersHorizontal />
            {l('Edit attributes', 'Editar atributos')}
          </Button>
        </div>
        <div className="semantic-evidence-attributes">
          {configuration.enabled && configuration.attributes.length ? (
            configuration.attributes.map((attribute) => (
              <article key={attribute.id}>
                <h3>{attribute.name}</h3>
                {attribute.description && <p>{attribute.description}</p>}
              </article>
            ))
          ) : (
            <p>
              {l(
                'Add the qualities that matter to your customers.',
                'Adicione as qualidades que importam para seus clientes.',
              )}
            </p>
          )}
        </div>
      </section>
      <section className="analytics-panel">
        <div className="panel-heading">
          <div>
            <h2>{l('Questions and answers', 'Perguntas e respostas')}</h2>
            <p>
              {l(
                'Each count uses the models, dates and filters selected above.',
                'Cada contagem usa os modelos, as datas e os filtros selecionados acima.',
              )}
            </p>
          </div>
        </div>
        <div className="semantic-evidence-questions">
          {prompts.map((prompt) => (
            <div key={prompt.id}>
              <p>{prompt.text}</p>
              <span>
                {number(
                  answers.filter((answer) => answer.promptId === prompt.id)
                    .length,
                )}{' '}
                {l('responses', 'respostas')}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="analytics-panel">
        <div className="panel-heading">
          <div>
            <h2>{l('Answer evidence', 'Evidências nas respostas')}</h2>
            <p>
              {l(
                'Brands and citations shown together occurred in the same answer. This does not prove the source discusses the brand.',
                'Marcas e citações exibidas juntas estão na mesma resposta. Isso não prova que a fonte menciona a marca.',
              )}
            </p>
          </div>
        </div>
        {!answers.length ? (
          <EmptyState
            title={l(
              'No responses in this selection',
              'Nenhuma resposta nesta seleção',
            )}
            description={l(
              'Adjust the filters or prepare your project questions.',
              'Ajuste os filtros ou prepare as perguntas do projeto.',
            )}
          />
        ) : (
          <div className="semantic-evidence-answers">
            {answerPage.rows.map((answer) => (
              <article key={answer.id}>
                <div className="semantic-evidence-answer-meta">
                  <ModelMark model={answer.model} />
                  <time dateTime={answer.date}>
                    {new Intl.DateTimeFormat(locale, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'UTC',
                    }).format(new Date(answer.date))}
                  </time>
                </div>
                <h3>
                  {
                    project.prompts.find(
                      (prompt) => prompt.id === answer.promptId,
                    )?.text
                  }
                </h3>
                <p>
                  {l('Mentioned brands', 'Marcas mencionadas')}:{' '}
                  {answer.brandIds
                    .map(
                      (id) =>
                        report.brands.find((brand) => brand.id === id)?.name ??
                        id,
                    )
                    .join(', ') || l('None', 'Nenhuma')}
                </p>
                <div className="semantic-evidence-links">
                  <span>{l('Citations', 'Citações')}:</span>
                  {answer.sourceIds.map((id) => {
                    const source = demoSources.find((item) => item.id === id);
                    return source ? (
                      <Button
                        key={id}
                        variant="link"
                        onClick={() => onOpenSource(source.domain)}
                      >
                        {source.domain}
                      </Button>
                    ) : null;
                  })}
                </div>
                <p className="text-muted-foreground">
                  {l('Consulted sources', 'Fontes consultadas')}:{' '}
                  {answer.consultedSourceIds === null
                    ? l('Not provided', 'Não informado')
                    : number(answer.consultedSourceIds.length)}
                </p>
                <Button variant="outline" onClick={() => onOpenChat(answer)}>
                  {l('Read full answer', 'Ler resposta completa')}
                  <ArrowUpRight />
                </Button>
              </article>
            ))}
          </div>
        )}
        {answerPage.controls}
      </section>
    </div>
  );
}

// Canonical product entry: keep the complete report available from Semantic Branding.
export function SemanticBrandingView(props: Props) {
  const savedState = useMemo(
    () =>
      props.savedState
        ? reconcileSemanticProject(props.savedState, props.project)
        : undefined,
    [props.savedState, props.project],
  );
  return (
    <SemanticBrandingContent
      key={`${props.project.id}/${props.project.name}/${props.project.domain}`}
      {...props}
      savedState={savedState}
    />
  );
}

export { SemanticBrandingView as AdvancedSemanticBrandingView };

function SemanticBrandingContent({
  project,
  report,
  filters,
  onOpenChat,
  onOpenSource,
  readOnly = false,
  section,
  onSectionChange: setSection,
  savedState,
  onSaveState,
  onConfigure,
}: Props) {
  const l = useCopy();
  const { number, percent, locale } = useNumbers();
  const text = (copy: LocalizedText) => l(copy.en, copy.pt);
  const [initialEntities] = useState(() =>
    initialBrandEntities(
      project.name,
      project.domain,
      project.id === 'conversion-web'
        ? undefined
        : (project.setup?.competitors ?? []),
    ),
  );
  const state = savedState ?? {
    entities: initialEntities,
    snapshots: [],
    completed: [],
  };
  const { entities, snapshots, completed } = state;
  const setEntities = (next: BrandEntity[]) =>
    onSaveState({ ...state, entities: next });
  const setCompleted = (update: (items: string[]) => string[]) =>
    onSaveState({ ...state, completed: update(completed) });
  const [undo, setUndo] = useState<BrandEntity[][]>([]);
  const [selectedAttribute, setSelectedAttribute] = useState<string | null>(
    null,
  );
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('conversion');
  const [brandName, setBrandName] = useState('');
  const [brandDomain, setBrandDomain] = useState('');
  const [entityError, setEntityError] = useState('');
  const [search, setSearch] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [planStep, setPlanStep] = useState(1);
  const [segment, setSegment] = useState(project.setup?.segment ?? 'SEO');
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>(() =>
    project.prompts
      .filter((prompt) => prompt.status === 'active')
      .map((prompt) => prompt.id),
  );
  const [customPrompts, setCustomPrompts] = useState('');
  const [selectedModels, setSelectedModels] = useState<string[]>([
    ...filters.models,
  ]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(
    null,
  );
  const [notice, setNotice] = useState('');
  const summary = useMemo(
    () => semanticSummary(report.responses, entities),
    [report.responses, entities],
  );
  const previous = useMemo(
    () => semanticSummary(report.previous, entities),
    [report.previous, entities],
  );
  const semanticSetup = project.setup as
    | (NonNullable<DemoProject['setup']> & {
        semantic?: SemanticConfiguration;
        language?: 'en-US' | 'pt-BR';
      })
    | undefined;
  const configuration = useMemo(
    () =>
      semanticSetup?.semantic ??
      (project.id === 'conversion-web'
        ? defaultSemanticConfiguration(locale)
        : { enabled: false, attributes: [] }),
    [semanticSetup?.semantic, project.id, locale],
  );
  const researchLanguage =
    semanticSetup?.language ?? (locale === 'pt-BR' ? 'pt-BR' : 'en-US');
  const openConfiguration = () => {
    if (readOnly) return;
    setSection('attributes');
    window.scrollTo({ top: 0 });
  };
  const associationReport = semanticAssociationReport(
    configuration,
    entities,
    semanticAssessmentFixture(
      project.id,
      configuration,
      report.responses,
      project,
    ),
  );
  const range = getDateRange(filters);
  const attribute = summary.associations.find(
    (item) => item.id === selectedAttribute,
  );
  const classification = (value: string) =>
    ({
      Review: l('Review', 'Avaliação'),
      Corporate: l('Corporate', 'Corporativa'),
      Community: l('Community', 'Comunidade'),
      Editorial: l('Editorial', 'Editorial'),
      Reference: l('Reference', 'Referência'),
      Ranking: l('Ranking', 'Ranking'),
      Research: l('Research', 'Pesquisa'),
      Discussion: l('Discussion', 'Discussão'),
      Guide: l('Guide', 'Guia'),
      Comparison: l('Comparison', 'Comparativo'),
      'Service page': l('Service page', 'Página de serviço'),
      Definition: l('Definition', 'Definição'),
    })[value] ?? value;
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
  const periodSnapshots = useMemo(() => {
    const range = getDateRange(filters);
    const snapshotForPeriod = (previousPeriod = false) =>
      createSemanticSnapshot({
        id: previousPeriod ? 'previous-report' : 'selected-report',
        date: `${range.to}T12:00:00Z`,
        title: previousPeriod
          ? locale === 'pt-BR'
            ? 'Período anterior'
            : 'Previous period'
          : locale === 'pt-BR'
            ? 'Período selecionado'
            : 'Selected period',
        project: { id: project.id, name: project.name, domain: project.domain },
        from: previousPeriod
          ? dateKey(new Date(range.start - range.days * 86_400_000))
          : range.from,
        to: previousPeriod
          ? dateKey(new Date(range.start - 86_400_000))
          : range.to,
        filters,
        entities,
        semanticConfiguration: configuration,
        semanticLanguage: semanticSetup?.language,
        prompts: project.prompts.filter(
          (prompt) =>
            prompt.status === 'active' && promptMatchesFilters(prompt, filters),
        ),
        responses: previousPeriod ? report.previous : report.responses,
      });
    return [snapshotForPeriod(), snapshotForPeriod(true)];
  }, [
    project,
    filters,
    entities,
    report.responses,
    report.previous,
    locale,
    configuration,
    semanticSetup?.language,
  ]);
  const history: Snapshot[] = [...snapshots, ...periodSnapshots];
  const changeEntities = (next: BrandEntity[]) => {
    if (readOnly || next === entities) return;
    setUndo((items) => [...items, entities]);
    setEntities(next);
    setNotice(
      l(
        'Brand interpretation updated. Original evidence is preserved.',
        'Interpretação das marcas atualizada. Evidências originais preservadas.',
      ),
    );
  };
  const exportReport = (snapshot = periodSnapshots[0]) =>
    exportDemoCsv(
      `lastfind-semantic-${snapshot.from}-${snapshot.to}.csv`,
      semanticSnapshotRows(snapshot),
    );
  const opportunities = [...summary.associations]
    .filter((item) => item.eligible > 0)
    .sort((a, b) => b.gap - a.gap || a.value - b.value);
  const filteredOpportunities = opportunities.filter((item) =>
    text(item.label).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const opportunityPage = useCollectionPage(
    filteredOpportunities,
    `${project.id}|${search}|${JSON.stringify(filters)}`,
  );
  const historyPage = useCollectionPage(history, project.id);
  const selectedExisting = project.prompts.filter(
    (prompt) =>
      prompt.status === 'active' && selectedPrompts.includes(prompt.id),
  );
  const parsedQuestions = parseSemanticQuestions(
    customPrompts,
    selectedExisting,
  );
  const customLines = parsedQuestions.questions;
  const customError =
    parsedQuestions.error === 'limit'
      ? l(
          'Use up to 20 additional questions. Remove extra lines to continue.',
          'Use até 20 perguntas adicionais. Remova as linhas excedentes para continuar.',
        )
      : parsedQuestions.error === 'length'
        ? l(
            'Each additional question needs 5–1,000 characters.',
            'Cada pergunta adicional precisa de 5–1.000 caracteres.',
          )
        : '';
  const createPlan = () =>
    createSemanticSnapshot({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      title: `${project.name} · ${segment.trim()}`,
      project: { id: project.id, name: project.name, domain: project.domain },
      from: range.from,
      to: range.to,
      filters: { ...filters, models: selectedModels as DemoFilters['models'] },
      entities,
      semanticConfiguration: configuration,
      semanticLanguage: semanticSetup?.language,
      prompts: selectedExisting,
      customQuestions: customLines,
      responses:
        project.id === 'conversion-web'
          ? selectResponses(selectedExisting, {
              ...filters,
              models: selectedModels as DemoFilters['models'],
            })
          : [],
    });

  if (section === 'attributes') {
    const backToReport = () => {
      setSection('associations');
      window.scrollTo({ top: 0 });
    };
    return (
      <SemanticAttributeSettings
        configuration={configuration}
        researchLanguage={researchLanguage}
        projectSegment={project.setup?.segment ?? ''}
        readOnly={readOnly}
        onBack={backToReport}
        onSave={(next) => {
          if (readOnly) return;
          const persisted = onConfigure(next);
          setNotice(
            persisted
              ? l(
                  'Brand attributes saved for this browser tab, including reloads. No collection has started.',
                  'Atributos da marca salvos nesta aba, inclusive ao recarregar. Nenhuma coleta foi iniciada.',
                )
              : l(
                  'Brand attributes updated. Browser storage is unavailable, so these changes will be lost when you reload.',
                  'Atributos da marca atualizados. O armazenamento do navegador está indisponível; estas alterações serão perdidas ao recarregar.',
                ),
          );

          backToReport();
        }}
      />
    );
  }

  return (
    <div className="semantic-branding">
      {report.responses.length === 0 && (
        <section className="analytics-panel" aria-live="polite">
          <EmptyState
            title={
              project.id === 'conversion-web'
                ? l(
                    'No answers match this selection',
                    'Nenhuma resposta nesta seleção',
                  )
                : l(
                    'This project has no collected answers yet',
                    'Este projeto ainda não tem respostas coletadas',
                  )
            }
            description={
              project.id === 'conversion-web'
                ? l(
                    'Adjust the period or AI model filters to explore the sample.',
                    'Ajuste o período ou os modelos de IA para explorar a amostra.',
                  )
                : l(
                    'Your setup is ready for this session. No AI collection has started for this project. Reports become available when compatible answers are connected.',
                    'Sua configuração está pronta nesta sessão. Nenhuma coleta de IA foi iniciada para este projeto. Os relatórios ficam disponíveis quando respostas compatíveis são conectadas.',
                  )
            }
          />
        </section>
      )}
      <div className="semantic-toolbar">
        <div className="semantic-context">
          <SiteFavicon domain={project.domain} name={project.name} />
          <span>{project.name}</span>
          <span className="semantic-dot">·</span>
          <span>{l('Brand intelligence', 'Inteligência de marca')}</span>
        </div>
        <div className="semantic-actions">
          <PrimaryMenuActions
            label={l('More report actions', 'Mais ações do relatório')}
            action={
              <Button
                size="sm"
                disabled={readOnly}
                onClick={() => {
                  setPlanStep(1);
                  setSegment(project.setup?.segment ?? 'SEO');
                  setSelectedPrompts(
                    project.prompts
                      .filter((prompt) => prompt.status === 'active')
                      .map((prompt) => prompt.id),
                  );
                  setSelectedModels([...filters.models]);
                  setCustomPrompts('');
                  setPlanOpen(true);
                }}
              >
                <Plus />
                {l('New report', 'Novo relatório')}
              </Button>
            }
          >
            <DropdownMenuItem disabled={readOnly} onClick={openConfiguration}>
              <SlidersHorizontal />
              {l('Configure attributes', 'Configurar atributos')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportReport()}>
              <Download />
              {l('Export', 'Exportar')}
            </DropdownMenuItem>
          </PrimaryMenuActions>
        </div>
      </div>
      {section !== 'associations' && (
        <div className="semantic-summary">
          <div className="semantic-score">
            <div>
              <span>
                {l('Lastfind presence index', 'Índice de presença Lastfind')}
              </span>
              <button
                aria-label={l('Understand the score', 'Entenda o score')}
                onClick={() => setFormulaOpen(true)}
              >
                <Info size={14} />
              </button>
            </div>
            <strong>
              {report.responses.length ? number(summary.score.score) : '—'}
              <small>/ 100</small>
            </strong>
            <p>
              {l(
                'Transparent, weighted indicators',
                'Indicadores ponderados e transparentes',
              )}
            </p>
          </div>
          <Metric
            label={l('Brand association', 'Associação à marca')}
            value={
              report.responses.length
                ? percent(summary.score.parts[1].value)
                : '—'
            }
            note={l('across relevant attributes', 'nos atributos relevantes')}
          />
          <Metric
            label={l('Share of voice', 'Share of voice')}
            value={
              summary.canonicalMentions ? percent(summary.shareOfVoice) : '—'
            }
            note={l(
              'of canonical brand mentions',
              'das menções a marcas canônicas',
            )}
          />
          <Metric
            label={l('Text / linked domain', 'Texto / domínio citado')}
            value={`${number(summary.mentions.length)} / ${number(summary.linked)}`}
            note={l(
              'independent response counts',
              'contagens independentes de respostas',
            )}
          />
        </div>
      )}
      <p className="semantic-method">
        <Sparkles size={13} />
        {l(
          'Illustrative annotations on sample responses. Associations and classification confidence are simulated; they are not extracted findings about these companies.',
          'Anotações ilustrativas sobre respostas de exemplo. Associações e confiança das classificações são simuladas; não são conclusões extraídas sobre estas empresas.',
        )}
      </p>
      {notice && (
        <output className="semantic-notice">
          <Check size={14} />
          {notice}
          <button
            onClick={() => setNotice('')}
            aria-label={l('Dismiss notice', 'Fechar aviso')}
          >
            ×
          </button>
        </output>
      )}
      <Tabs value={section} onValueChange={setSection}>
        <TabsList className="semantic-tabs">
          <TabsTrigger value="associations">
            <Network />
            {l('Associations', 'Associações')}
          </TabsTrigger>
          <TabsTrigger value="engines">
            <Layers3 />
            {l('Engines', 'Modelos')}
          </TabsTrigger>
          <TabsTrigger value="sources">
            <FileText />
            {l('Sources & formats', 'Fontes e formatos')}
          </TabsTrigger>
          <TabsTrigger value="entities">
            <GitMerge />
            {l('Brand identities', 'Identidades')}
          </TabsTrigger>
          <TabsTrigger value="opportunities">
            <Target />
            {l('Opportunities', 'Oportunidades')}
          </TabsTrigger>
          <TabsTrigger value="reports">
            <History />
            {l('Reports', 'Relatórios')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="associations">
          <SemanticAssociationReport
            report={associationReport}
            prompts={project.prompts}
            responses={report.responses}
            onOpenChat={onOpenChat}
            language={semanticSetup?.language}
            onConfigure={readOnly ? undefined : openConfiguration}
          />
        </TabsContent>

        <TabsContent value="engines">
          <section className="analytics-panel">
            <Panel
              title={l(
                'Coverage, context and competitors',
                'Cobertura, contexto e concorrentes',
              )}
              description={l(
                'The same selection, separated by engine. Unselected models have no sample.',
                'A mesma seleção, separada por modelo. Modelos não selecionados ficam sem amostra.',
              )}
            />
            <Table className="semantic-table" containerClassName="semantic-table-scroll">
                <TableHeader>
                  <TableRow>
                    <TableHead>{l('Engine', 'Modelo')}</TableHead>
                    <TableHead>{l('Coverage', 'Cobertura')}</TableHead>
                    <TableHead>{l('Leader', 'Líder')}</TableHead>
                    <TableHead>{l('Gap', 'Lacuna')}</TableHead>
                    <TableHead>{l('Sentiment', 'Sentimento')}</TableHead>
                    <TableHead>{l('Position', 'Posição')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.engines.map((engine) => (
                    <TableRow key={engine.model}>
                      <TableCell>
                        <ModelMark model={engine.model} />
                        <small>
                          {number(engine.total)} {l('responses', 'respostas')}
                        </small>
                      </TableCell>
                      <TableCell>
                        <b>{engine.total ? percent(engine.coverage) : '—'}</b>
                        <small>
                          {number(engine.mentions)} / {number(engine.total)}
                        </small>
                      </TableCell>
                      <TableCell>
                        {engine.total && engine.leader ? (
                          <>
                            <span className="semantic-site">
                              <SiteFavicon
                                domain={engine.leader.domain}
                                name={engine.leader.name}
                              />
                              {engine.leader.name}
                            </span>
                            <small>{percent(engine.leader.value)}</small>
                          </>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {engine.total ? `${number(engine.gap, 1)} pp` : '—'}
                      </TableCell>
                      <TableCell
                        aria-label={l(
                          `Positive: ${number(engine.positive)}; neutral: ${number(engine.neutral)}; alert: ${number(engine.alert)}`,
                          `Positivo: ${number(engine.positive)}; neutro: ${number(engine.neutral)}; alerta: ${number(engine.alert)}`,
                        )}
                      >
                        <div className="semantic-sentiment">
                          <span
                            title={l('Positive', 'Positivo')}
                            className="semantic-positive"
                          >
                            {number(engine.positive)}
                          </span>
                          <span title={l('Neutral', 'Neutro')}>
                            {number(engine.neutral)}
                          </span>
                          <span
                            title={l('Alert', 'Alerta')}
                            className="semantic-alert"
                          >
                            {number(engine.alert)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {engine.mentions ? number(engine.position, 1) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            <div className="semantic-panel-foot">
              {l(
                'Sentiment counts: positive ≥ 85, neutral 75–84, alert < 75. These are the thresholds of the Lastfind classification method.',
                'Contagens de sentimento: positivo ≥ 85, neutro 75–84, alerta < 75. Estes são os limiares do método de classificação Lastfind.',
              )}
            </div>
          </section>
          <div className="semantic-evidence-strip">
            <Metric
              label={l('Brand mentioned', 'Marca mencionada')}
              value={number(summary.mentions.length)}
              note={l(
                'responses with a textual brand mention',
                'respostas com menção textual à marca',
              )}
            />
            <Metric
              label={l('Own domain cited', 'Domínio próprio citado')}
              value={number(summary.linked)}
              note={l(
                'responses linking a tracked brand domain',
                'respostas citando domínio da marca',
              )}
            />
            <Metric
              label={l('Own domain consulted', 'Domínio próprio consultado')}
              value={
                summary.consultedAvailable ? number(summary.consulted) : '—'
              }
              note={l(
                `${number(summary.consultedAvailable)} responses expose consulted evidence`,
                `${number(summary.consultedAvailable)} respostas informam evidência de consulta`,
              )}
            />
          </div>
        </TabsContent>

        <TabsContent value="sources">
          <section className="analytics-panel">
            <Panel
              title={l(
                'Sources that shape the narrative',
                'Fontes que formam a narrativa',
              )}
              description={l(
                'Co-occurrence connects a cited source and a brand in an answer; it does not prove the page mentions the brand.',
                'Coocorrência relaciona uma fonte citada e a marca na resposta; não prova que a página menciona a marca.',
              )}
            />
            <Table className="semantic-table" containerClassName="semantic-table-scroll">
                <TableHeader>
                  <TableRow>
                    <TableHead>{l('Source', 'Fonte')}</TableHead>
                    <TableHead>{l('Type / format', 'Tipo / formato')}</TableHead>
                    <TableHead>{l('Confidence', 'Confiança')}</TableHead>
                    <TableHead>{l('Cited / consulted', 'Citada / consultada')}</TableHead>
                    <TableHead>{l('With your brand', 'Com sua marca')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.sources.map((source) => (
                    <TableRow key={source.id}>
                      <TableCell>
                        <button
                          className="semantic-site"
                          onClick={() => onOpenSource(source.domain)}
                        >
                          <SiteFavicon domain={source.domain} />
                          {source.domain}
                          <ArrowUpRight size={12} />
                        </button>
                      </TableCell>
                      <TableCell>
                        {classification(source.type)}
                        <small>{classification(source.format)}</small>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {percent(source.confidence, 0)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {number(source.citations)} /{' '}
                        {summary.consultedAvailable
                          ? number(source.consulted)
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {source.citations ? percent(source.association) : '—'}
                        <small>
                          {number(source.associated)}{' '}
                          {l('co-occurrences', 'coocorrências')}
                        </small>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          </section>
          <section className="analytics-panel semantic-spaced">
            <Panel
              title={l(
                'Content formats by engine',
                'Formatos de conteúdo por modelo',
              )}
              description={l(
                'Citation occurrences in the selected sample. Classification confidence is illustrative.',
                'Ocorrências de citações na amostra selecionada. Confiança de classificação ilustrativa.',
              )}
            />
            <Table className="semantic-table" containerClassName="semantic-table-scroll">
                <TableHeader>
                  <TableRow>
                    <TableHead>{l('Format', 'Formato')}</TableHead>
                    {demoModels.map((model) => (
                      <TableHead key={model}>
                        <ModelMark model={model} />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.sources.map((source) => (
                    <TableRow key={source.id}>
                      <TableCell>{classification(source.format)}</TableCell>
                      {demoModels.map((model) => {
                        const total = summary.sources.reduce(
                          (sum, row) => sum + Number(row.engines[model] ?? 0),
                          0,
                        );
                        const value = total
                          ? (Number(source.engines[model]) / total) * 100
                          : 0;
                        return (
                          <TableCell key={model}>
                            <span
                              className="semantic-format-value"
                              style={{
                                background: value
                                  ? `color-mix(in srgb, var(--primary) ${Math.max(5, Math.round(value))}%, transparent)`
                                  : undefined,
                              }}
                            >
                              {total ? percent(value, 0) : '—'}
                            </span>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          </section>
        </TabsContent>

        <TabsContent value="entities">
          <section className="analytics-panel">
            <Panel
              title={l(
                'One identity for every brand',
                'Uma identidade para cada marca',
              )}
              description={l(
                'Merge identities, split a merged group or add a competitor. Changes affect the current interpretation and preserve the original evidence.',
                'Una identidades, separe um grupo unido ou adicione um concorrente. Alterações afetam a interpretação atual e preservam as evidências originais.',
              )}
            />
            <div className="semantic-entity-controls">
              <FilterSelect
                label={l('Identity to merge', 'Identidade para unir')}
                value={mergeSource}
                onChange={setMergeSource}
                options={[
                  {
                    value: '',
                    label: l('Choose an identity', 'Escolha uma identidade'),
                  },
                  ...entities.map((entity) => ({
                    value: entity.id,
                    label: entity.name,
                  })),
                ]}
              />
              <span>→</span>
              <FilterSelect
                label={l('Canonical identity', 'Identidade canônica')}
                value={mergeTarget}
                onChange={setMergeTarget}
                options={entities.map((entity) => ({
                  value: entity.id,
                  label: entity.name,
                }))}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={
                  readOnly ||
                  !entities.some((entity) => entity.id === mergeSource) ||
                  !entities.some((entity) => entity.id === mergeTarget) ||
                  mergeSource === mergeTarget
                }
                onClick={() => {
                  changeEntities(
                    mergeBrandEntities(entities, mergeTarget, mergeSource),
                  );
                  setMergeSource('');
                }}
              >
                <GitMerge />
                {l('Merge', 'Unir')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={readOnly || !undo.length}
                onClick={() => {
                  setEntities(undo.at(-1)!);
                  setUndo((items) => items.slice(0, -1));
                  setNotice(
                    l(
                      'Last identity change undone.',
                      'Última alteração de identidade desfeita.',
                    ),
                  );
                }}
              >
                <Undo2 />
                {l('Undo', 'Desfazer')}
              </Button>
            </div>
            <Table className="semantic-table" containerClassName="semantic-table-scroll">
                <TableHeader>
                  <TableRow>
                    <TableHead>{l('Canonical brand', 'Marca canônica')}</TableHead>
                    <TableHead>{l('Names and domains', 'Nomes e domínios')}</TableHead>
                    <TableHead>{l('Raw identities', 'Identidades originais')}</TableHead>
                    <TableHead>
                      <span className="sr-only">{l('Actions', 'Ações')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entities.map((entity) => (
                    <TableRow key={entity.id}>
                      <TableCell>
                        <span className="semantic-site">
                          <SiteFavicon
                            domain={entity.domain}
                            name={entity.name}
                          />
                          <b>{entity.name}</b>
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="semantic-aliases">
                          {entity.members
                            .flatMap((member) => member.aliases)
                            .map((alias, index) => (
                              <Badge
                                variant="outline"
                                key={`${alias}-${index}`}
                              >
                                {alias}
                              </Badge>
                            ))}
                        </div>
                      </TableCell>
                      <TableCell>{number(entity.members.length)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={readOnly || entity.members.length < 2}
                          onClick={() =>
                            changeEntities(
                              splitBrandEntity(entities, entity.id),
                            )
                          }
                        >
                          <Split />
                          {l('Split', 'Separar')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            <form
              className="semantic-add-brand"
              onSubmit={(event) => {
                event.preventDefault();
                if (readOnly) return;
                const domain = brandDomain
                  .trim()
                  .toLowerCase()
                  .replace(/^https?:\/\//, '')
                  .replace(/^www\./, '')
                  .split('/')[0];
                if (
                  !brandName.trim() ||
                  !/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}$/i.test(
                    domain,
                  ) ||
                  entities.some((entity) =>
                    entity.members.some(
                      (member) =>
                        member.aliases.some(
                          (alias) =>
                            alias.toLowerCase() ===
                            brandName.trim().toLowerCase(),
                        ) || member.domain === domain,
                    ),
                  )
                ) {
                  setEntityError(
                    l(
                      'Use a new brand name and a valid, unique domain.',
                      'Use um novo nome de marca e um domínio válido e único.',
                    ),
                  );
                  return;
                }
                const id = `custom-${crypto.randomUUID()}`;
                changeEntities([
                  ...entities,
                  {
                    id,
                    name: brandName.trim(),
                    domain,
                    members: [
                      {
                        id,
                        name: brandName.trim(),
                        domain,
                        aliases: [brandName.trim(), domain],
                      },
                    ],
                  },
                ]);
                setBrandName('');
                setBrandDomain('');
                setEntityError('');
              }}
            >
              <Input
                aria-label={l('Competitor name', 'Nome do concorrente')}
                placeholder={l('Competitor name', 'Nome do concorrente')}
                value={brandName}
                onChange={(event) => setBrandName(event.target.value)}
                maxLength={60}
                disabled={readOnly}
              />
              <Input
                aria-label={l('Competitor domain', 'Domínio do concorrente')}
                placeholder="example.com"
                value={brandDomain}
                onChange={(event) => setBrandDomain(event.target.value)}
                maxLength={253}
                disabled={readOnly}
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={readOnly}
              >
                <Plus />
                {l('Add competitor', 'Adicionar concorrente')}
              </Button>
              {entityError && <p role="alert">{entityError}</p>}
              <p>
                {l(
                  'New competitors have no historical evidence in this sample.',
                  'Novos concorrentes não possuem evidência histórica nesta amostra.',
                )}
              </p>
            </form>
          </section>
        </TabsContent>

        <TabsContent value="opportunities">
          <section className="analytics-panel">
            <Panel
              title={l(
                'Turn gaps into your next moves',
                'Transforme lacunas em próximos passos',
              )}
              description={l(
                'Ordered by the difference to the leading brand, then by association strength.',
                'Ordenadas pela diferença para a marca líder e, depois, pela força da associação.',
              )}
            />
            <div className="semantic-search">
              <SearchField
                value={search}
                onChange={setSearch}
                ariaLabel={l('Search opportunities', 'Buscar oportunidades')}
                placeholder={l('Search by attribute', 'Busque por atributo')}
              />
            </div>
            {opportunityPage.rows.map((item, index) => (
              <div className="semantic-opportunity" key={item.id}>
                <span className="semantic-priority">
                  {number(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3>
                    {l(
                      `Build stronger proof for ${text(item.label).toLowerCase()}`,
                      `Fortaleça as provas de ${text(item.label).toLowerCase()}`,
                    )}
                  </h3>
                  <p>
                    {item.gap > 0
                      ? l(
                          `${item.leader?.entity.name} leads this association by ${number(item.gap, 1)} pp. Review the answers and create a cited, expert-led comparison.`,
                          `${item.leader?.entity.name} lidera esta associação por ${number(item.gap, 1)} pp. Revise as respostas e prepare um comparativo com fontes e especialistas.`,
                        )
                      : l(
                          'Consolidate the association through original research, consistent language and independent references.',
                          'Consolide a associação com pesquisa original, linguagem consistente e referências independentes.',
                        )}
                  </p>
                  <button
                    className="semantic-text-link"
                    onClick={() => setSelectedAttribute(item.id)}
                  >
                    {l('Review evidence', 'Revisar evidências')}
                    <ArrowUpRight size={12} />
                  </button>
                </div>
                <Button
                  variant={
                    completed.includes(item.id) ? 'secondary' : 'outline'
                  }
                  size="sm"
                  disabled={readOnly}
                  onClick={() =>
                    setCompleted((items) =>
                      items.includes(item.id)
                        ? items.filter((id) => id !== item.id)
                        : [...items, item.id],
                    )
                  }
                >
                  {completed.includes(item.id) ? <Check /> : <Plus />}
                  {completed.includes(item.id)
                    ? l('Planned', 'Planejado')
                    : l('Add to plan', 'Planejar')}
                </Button>
              </div>
            ))}
            {opportunityPage.controls}
            {!filteredOpportunities.length && (
              <EmptyState
                title={l(
                  search.trim()
                    ? 'No opportunities match your search'
                    : 'No evidence in this selection',
                  search.trim()
                    ? 'Nenhuma oportunidade corresponde à busca'
                    : 'Sem evidência nesta seleção',
                )}
                description={l(
                  search.trim()
                    ? 'Try another attribute or clear the search.'
                    : 'Choose a period with sample responses to identify opportunities.',
                  search.trim()
                    ? 'Tente outro atributo ou limpe a busca.'
                    : 'Escolha um período com respostas de exemplo para identificar oportunidades.',
                )}
              />
            )}
          </section>
        </TabsContent>

        <TabsContent value="reports">
          <section className="analytics-panel">
            <Panel
              title={l('Report history', 'Histórico de relatórios')}
              description={l(
                'Reports stay in this browser session. The two baseline reports use the selected and preceding periods.',
                'Os relatórios ficam nesta sessão do navegador. Os dois relatórios iniciais usam o período selecionado e o anterior.',
              )}
            />
            <div className="semantic-report-comparison">
              <Metric
                label={l('Current presence index', 'Índice de presença atual')}
                value={
                  report.responses.length ? number(summary.score.score, 1) : '—'
                }
                note={`${date(range.from)} — ${date(range.to)}`}
              />
              <Metric
                label={l(
                  'Previous presence index',
                  'Índice de presença anterior',
                )}
                value={
                  report.previous.length ? number(previous.score.score, 1) : '—'
                }
                note={l(
                  'immediately preceding equal-length period',
                  'período imediatamente anterior de igual duração',
                )}
              />
              <Metric
                label={l('Change', 'Variação')}
                value={
                  report.responses.length && report.previous.length
                    ? `${summary.score.score >= previous.score.score ? '+' : ''}${number(summary.score.score - previous.score.score, 1)}`
                    : '—'
                }
                note={l(
                  'points in the Lastfind score',
                  'pontos no score Lastfind',
                )}
              />
            </div>
            {historyPage.rows.map((snapshot) => (
              <button
                className="semantic-report-row"
                key={snapshot.id}
                onClick={() => setSelectedSnapshot(snapshot)}
              >
                <FileText size={20} />
                <span>
                  <b>{snapshot.title}</b>
                  <small>
                    {date(snapshot.from)} — {date(snapshot.to)} ·{' '}
                    {number(snapshot.responses)} {l('responses', 'respostas')}
                  </small>
                </span>
                <Badge variant="outline">
                  {snapshot.pending > 0
                    ? l('Partial', 'Parcial')
                    : snapshot.responses
                      ? l('Ready', 'Pronto')
                      : l('No sample', 'Sem amostra')}
                </Badge>
                <strong>
                  {snapshot.responses ? number(snapshot.score, 1) : '—'}
                </strong>
                <ChevronRight size={15} />
              </button>
            ))}
            {historyPage.controls}
          </section>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!attribute}
        onOpenChange={(open) => {
          if (!open) setSelectedAttribute(null);
        }}
      >
        <DialogContent className="semantic-dialog">
          <DialogHeader>
            <DialogTitle>{attribute && text(attribute.label)}</DialogTitle>
            <DialogDescription>
              {l(
                'Illustrative semantic annotation. Open the original sample to inspect mentions and evidence.',
                'Anotação semântica ilustrativa. Abra a amostra original para investigar menções e evidências.',
              )}
            </DialogDescription>
          </DialogHeader>
          {attribute && (
            <>
              <div className="semantic-detail-stats">
                <Metric
                  label={l('Association', 'Associação')}
                  value={attribute.eligible ? percent(attribute.value) : '—'}
                  note={`${number(attribute.evidence.length)} / ${number(attribute.eligible)}`}
                />
                <Metric
                  label={l('Annotation confidence', 'Confiança da anotação')}
                  value={
                    attribute.evidence.length
                      ? percent(attribute.confidence, 0)
                      : '—'
                  }
                  note={l(
                    'illustrative classification',
                    'classificação ilustrativa',
                  )}
                />
              </div>
              {attribute.evidence.length ? (
                attribute.evidence
                  .slice(-5)
                  .reverse()
                  .map((response) => (
                    <div key={response.id} className="semantic-evidence">
                      <div>
                        <ModelMark model={response.model} />
                        <time>{date(response.date)}</time>
                      </div>
                      <p>
                        {text(
                          evidenceExcerpt(
                            response,
                            attribute,
                            project.name,
                            project.prompts,
                          ),
                        )}
                      </p>
                      <div className="semantic-evidence-links">
                        {response.sourceIds.map((id) => {
                          const source = demoSources.find(
                            (item) => item.id === id,
                          )!;
                          return (
                            <button
                              key={id}
                              onClick={() => {
                                setSelectedAttribute(null);
                                onOpenSource(source.domain);
                              }}
                            >
                              <SiteFavicon domain={source.domain} />
                              {source.domain}
                            </button>
                          );
                        })}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedAttribute(null);
                          onOpenChat(response);
                        }}
                      >
                        {l('Open sample response', 'Abrir resposta de exemplo')}
                        <ArrowUpRight />
                      </Button>
                    </div>
                  ))
              ) : (
                <EmptyState
                  title={l(
                    'No associations in this sample',
                    'Nenhuma associação nesta amostra',
                  )}
                  description={l(
                    'This does not prove that the brand lacks this attribute.',
                    'Isso não comprova que a marca não possui este atributo.',
                  )}
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={formulaOpen} onOpenChange={setFormulaOpen}>
        <DialogContent className="semantic-dialog">
          <DialogHeader>
            <DialogTitle>
              {l(
                'How the Lastfind presence index works',
                'Como funciona o índice de presença Lastfind',
              )}
            </DialogTitle>
            <DialogDescription>
              {l(
                'The Lastfind method combines coverage, associations, sentiment and sources. Review the weights and the available evidence.',
                'O método Lastfind combina cobertura, associações, sentimento e fontes. Confira os pesos e as evidências disponíveis.',
              )}
            </DialogDescription>
          </DialogHeader>
          {summary.score.parts.map((part) => (
            <div className="semantic-formula-row" key={part.id}>
              <span>
                {
                  {
                    coverage: l('Textual coverage', 'Cobertura textual'),
                    associations: l(
                      'Attribute associations',
                      'Associações a atributos',
                    ),
                    sentiment: l('Mention sentiment', 'Sentimento das menções'),
                    sourceDiversity: l(
                      'Source-type diversity',
                      'Diversidade de tipos de fonte',
                    ),
                  }[part.id]
                }
              </span>
              <b>{percent(part.weight * 100, 0)}</b>
              <span>× {number(part.value, 1)}</span>
              <strong>{number(part.value * part.weight, 1)}</strong>
            </div>
          ))}
          <p className="semantic-explainer">
            {l(
              'Source diversity counts up to five source types. Association averages only attributes with eligible responses. No responses means no score. Classifier accuracy and weights need validation before production use.',
              'Diversidade conta até cinco tipos de fonte. A associação considera apenas atributos com respostas elegíveis. Sem respostas, não há score. Acurácia dos classificadores e pesos precisam de validação antes do uso em produção.',
            )}
          </p>
        </DialogContent>
      </Dialog>

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="semantic-dialog">
          <DialogHeader>
            <DialogTitle>
              {l('Build a brand report', 'Prepare um relatório de marca')}
            </DialogTitle>
            <DialogDescription>
              {l(
                'Configure a sample report. No provider calls, email or external collection will run.',
                'Configure um relatório de exemplo. Não serão executadas chamadas a provedores, e-mails ou coletas externas.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="semantic-wizard-steps">
            {[
              l('Brand & engines', 'Marca e modelos'),
              l('Questions', 'Perguntas'),
              l('Review', 'Revisão'),
            ].map((label, index) => (
              <span
                className={planStep === index + 1 ? 'active' : ''}
                key={label}
              >
                {number(index + 1)}. {label}
              </span>
            ))}
          </div>
          {planStep === 1 && (
            <div className="semantic-form">
              <Label htmlFor="semantic-project-domain">
                {l('Project domain', 'Domínio do projeto')}
              </Label>
              <Input
                id="semantic-project-domain"
                value={project.domain}
                readOnly
              />
              <Label htmlFor="semantic-segment">
                {l('Segment', 'Segmento')}
              </Label>
              <Input
                id="semantic-segment"
                value={segment}
                onChange={(event) => setSegment(event.target.value)}
                maxLength={60}
              />
              <Label>
                {l(
                  'Engines in the same sample cycle',
                  'Modelos no mesmo ciclo da amostra',
                )}
              </Label>
              <div className="semantic-model-options">
                {demoModels.map((model) => (
                  <label
                    key={model}
                    htmlFor={`semantic-model-${model.replaceAll(' ', '-')}`}
                  >
                    <Checkbox
                      id={`semantic-model-${model.replaceAll(' ', '-')}`}
                      aria-label={model}
                      checked={selectedModels.includes(model)}
                      onCheckedChange={(checked) =>
                        setSelectedModels((items) =>
                          checked
                            ? [...items, model]
                            : items.filter((item) => item !== model),
                        )
                      }
                    />
                    <ModelMark model={model} />
                  </label>
                ))}
              </div>
            </div>
          )}
          {planStep === 2 && (
            <div className="semantic-form">
              <Label>{l('Existing prompts', 'Prompts existentes')}</Label>
              <div className="semantic-prompt-options">
                {project.prompts
                  .filter((prompt) => prompt.status === 'active')
                  .map((prompt) => (
                    <label key={prompt.id}>
                      <Checkbox
                        checked={selectedPrompts.includes(prompt.id)}
                        onCheckedChange={(checked) =>
                          setSelectedPrompts((items) =>
                            checked
                              ? [...items, prompt.id]
                              : items.filter((id) => id !== prompt.id),
                          )
                        }
                      />
                      <span>{prompt.text}</span>
                    </label>
                  ))}
              </div>
              <Label>{l('Curated suggestions', 'Sugestões curadas')}</Label>
              {semanticPromptSuggestions(segment).map((suggestion) => (
                <button
                  className="semantic-prompt-suggestion"
                  key={suggestion.en}
                  onClick={() =>
                    setCustomPrompts(
                      (value) =>
                        `${value}${value ? '\n' : ''}${text(suggestion)}`,
                    )
                  }
                >
                  <Plus size={13} />
                  {text(suggestion)}
                </button>
              ))}
              <Label htmlFor="semantic-custom-prompts">
                {l(
                  'Your questions · one per line',
                  'Suas perguntas · uma por linha',
                )}
              </Label>
              <Textarea
                id="semantic-custom-prompts"
                value={customPrompts}
                onChange={(event) => setCustomPrompts(event.target.value)}
                maxLength={4000}
              />
              {customError && (
                <p role="alert" className="semantic-validation">
                  {customError}
                </p>
              )}
              <p className="semantic-explainer">
                {l(
                  'Up to 20 additional questions. New questions are saved in this local plan and have no collected responses.',
                  'Até 20 perguntas adicionais. Novas perguntas ficam neste plano local e não possuem respostas coletadas.',
                )}
              </p>
            </div>
          )}
          {planStep === 3 && (
            <div className="semantic-review">
              <SiteFavicon domain={project.domain} name={project.name} />
              <h3>{project.name}</h3>
              <p>
                {segment} ·{' '}
                {number(selectedExisting.length + customLines.length)}{' '}
                {l('prompts', 'prompts')} · {number(selectedModels.length)}{' '}
                {l('engines', 'modelos')}
              </p>
              <p>
                {date(range.from)} — {date(range.to)}
              </p>
              <p className="semantic-explainer">
                {l(
                  'Country, topic and tag filters above also apply to this report. Questions without matching responses remain pending.',
                  'Os filtros de país, tema e tag acima também se aplicam ao relatório. Perguntas sem respostas correspondentes permanecem pendentes.',
                )}
              </p>
              <p className="semantic-explainer">
                {l(
                  'The report uses only matching existing responses. Additional prompts remain marked as awaiting data. Readiness appears here; no notification is sent.',
                  'O relatório usa somente respostas existentes e compatíveis. Prompts adicionais ficam aguardando dados. A conclusão aparece aqui; nenhuma notificação é enviada.',
                )}
              </p>
            </div>
          )}
          <div className="semantic-wizard-actions">
            <Button
              variant="outline"
              onClick={() =>
                planStep === 1
                  ? setPlanOpen(false)
                  : setPlanStep((step) => step - 1)
              }
            >
              {planStep === 1 ? l('Cancel', 'Cancelar') : l('Back', 'Voltar')}
            </Button>
            <Button
              disabled={
                readOnly ||
                !segment.trim() ||
                !selectedModels.length ||
                (planStep > 1 &&
                  (!!customError ||
                    (!selectedExisting.length && !customLines.length)))
              }
              onClick={() => {
                if (planStep < 3) {
                  setPlanStep((step) => step + 1);
                  return;
                }
                const snapshot = createPlan();
                onSaveState({ ...state, snapshots: [snapshot, ...snapshots] });
                setPlanOpen(false);
                setSection('reports');
                setNotice(
                  l(
                    'Your sample report is ready in this session.',
                    'Seu relatório de exemplo está pronto nesta sessão.',
                  ),
                );
              }}
            >
              {planStep < 3
                ? l('Continue', 'Continuar')
                : l('Prepare sample report', 'Preparar relatório de exemplo')}
              <ChevronRight />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedSnapshot}
        onOpenChange={(open) => {
          if (!open) setSelectedSnapshot(null);
        }}
      >
        <DialogContent className="semantic-dialog">
          <DialogHeader>
            <DialogTitle>{selectedSnapshot?.title}</DialogTitle>
            <DialogDescription>
              {l(
                'Local sample report snapshot.',
                'Snapshot local de relatório de exemplo.',
              )}
            </DialogDescription>
          </DialogHeader>
          {selectedSnapshot && (
            <>
              <div className="semantic-detail-stats">
                <Metric
                  label={l(
                    'Lastfind presence index',
                    'Índice de presença Lastfind',
                  )}
                  value={
                    selectedSnapshot.responses
                      ? number(selectedSnapshot.score, 1)
                      : '—'
                  }
                  note={`${date(selectedSnapshot.from)} — ${date(selectedSnapshot.to)}`}
                />
                <Metric
                  label={l('Responses', 'Respostas')}
                  value={number(selectedSnapshot.responses)}
                  note={selectedSnapshot.models.join(', ')}
                />
              </div>
              {selectedSnapshot.pending > 0 && (
                <p className="semantic-explainer">
                  {number(selectedSnapshot.pending)}{' '}
                  {l(
                    'questions have no matching data. No collection was submitted.',
                    'perguntas não têm dados correspondentes. Nenhuma coleta foi enviada.',
                  )}
                </p>
              )}
              <SemanticReportDocument snapshot={selectedSnapshot} />
              <Button
                variant="outline"
                onClick={() => exportReport(selectedSnapshot)}
              >
                <Download />
                {l('Export this report', 'Exportar este relatório')}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({
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
function Panel({ title, description }: { title: string; description: string }) {
  return (
    <div className="semantic-panel-heading">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function SemanticReportDocument({ snapshot }: { snapshot: Snapshot }) {
  const l = useCopy();
  const { number, percent } = useNumbers();
  const { summary, filters } = snapshot;
  const labels: Record<string, string> = {
    coverage: l('Textual coverage', 'Cobertura textual'),
    associations: l('Attribute associations', 'Associações a atributos'),
    sentiment: l('Mention sentiment', 'Sentimento das menções'),
    sourceDiversity: l('Source diversity', 'Diversidade das fontes'),
  };
  const sourceLabel = (value: string) =>
    ({
      Review: l('Review', 'Avaliação'),
      Corporate: l('Corporate', 'Corporativa'),
      Community: l('Community', 'Comunidade'),
      Editorial: l('Editorial', 'Editorial'),
      Reference: l('Reference', 'Referência'),
      Ranking: 'Ranking',
      Research: l('Research', 'Pesquisa'),
      Discussion: l('Discussion', 'Discussão'),
      Guide: l('Guide', 'Guia'),
      Comparison: l('Comparison', 'Comparativo'),
      'Service page': l('Service page', 'Página de serviço'),
      Definition: l('Definition', 'Definição'),
    })[value] ?? value;
  const competitors = useMemo(
    () =>
      snapshot.entities
        .map((entity) => ({
          entity,
          summary: semanticSummary(
            snapshot.evidence,
            snapshot.entities,
            entity.id,
          ),
        }))
        .sort((a, b) => b.summary.coverage - a.summary.coverage),
    [snapshot],
  );
  const snapshotFilterLabel = (selection: DemoFilters['country']) => {
    if (selection === 'all') return l('All', 'Todos');
    const values = Array.isArray(selection) ? selection : [selection];
    if (!values.length) return l('None selected', 'Nenhum selecionado');
    return values
      .map((value) =>
        value === 'Brazil'
          ? l('Brazil', 'Brasil')
          : value === 'United States'
            ? l('United States', 'Estados Unidos')
            : value,
      )
      .join(' · ');
  };
  return (
    <article className="semantic-report-document">
      {snapshot.association && (
        <SemanticAssociationReport
          report={snapshot.association}
          prompts={snapshot.questions}
          responses={snapshot.evidence}
          language={snapshot.semanticLanguage}
          idPrefix={`semantic-snapshot-${snapshot.id}`}
          shareSectionLinks={false}
        />
      )}
      <section>
        <h3>{l('Executive summary', 'Resumo executivo')}</h3>
        <p>
          {snapshot.responses
            ? l(
                `${snapshot.project.name} appears in ${number(summary.mentions.length)} of ${number(snapshot.responses)} selected sample responses (${percent(summary.coverage)}). Its separate Lastfind presence index is ${number(summary.score.score, 1)} out of 100.`,
                `${snapshot.project.name} aparece em ${number(summary.mentions.length)} de ${number(snapshot.responses)} respostas de exemplo selecionadas (${percent(summary.coverage)}). Seu índice separado de presença Lastfind é ${number(summary.score.score, 1)} de 100.`,
              )
            : l(
                'No matching responses are available. Brand visibility, competitive position and score cannot be assessed from this selection.',
                'Não há respostas correspondentes disponíveis. Visibilidade, posição competitiva e score não podem ser avaliados nesta seleção.',
              )}
        </p>
        <p>
          {l(
            `${number(snapshot.pending)} questions have no evidence in this period. Read the coverage and methodology before comparing this report with another selection.`,
            `${number(snapshot.pending)} perguntas não têm evidência neste período. Leia a cobertura e o método antes de comparar este relatório com outra seleção.`,
          )}
        </p>
      </section>
      <section>
        <h3>{l('Report scope', 'Escopo do relatório')}</h3>
        <p>
          {snapshot.project.name} · {snapshot.project.domain}
        </p>
        <dl className="semantic-report-filters">
          <div>
            <dt>{l('Period', 'Período')}</dt>
            <dd>
              {snapshot.from} — {snapshot.to}
            </dd>
          </div>
          <div>
            <dt>{l('Engines', 'Modelos')}</dt>
            <dd>{snapshot.models.join(', ') || '—'}</dd>
          </div>
          <div>
            <dt>{l('Country / topic / tag', 'País / tema / tag')}</dt>
            <dd>
              {[filters.country, filters.topic, filters.tag]
                .map(snapshotFilterLabel)
                .join(' / ')}
            </dd>
          </div>
          <div>
            <dt>{l('Tag matching', 'Combinação de tags')}</dt>
            <dd>
              {filters.tagMode === 'all'
                ? l('All selected tags', 'Todas as tags selecionadas')
                : l('Any selected tag', 'Qualquer tag selecionada')}
            </dd>
          </div>
        </dl>
        <p>
          {l(
            `${number(snapshot.questions.length)} questions; ${number(snapshot.responses)} matching responses. ${number(snapshot.missingPairs)} of ${number(snapshot.questions.length * snapshot.models.length)} question–engine pairs have no data in this period.`,
            `${number(snapshot.questions.length)} perguntas; ${number(snapshot.responses)} respostas correspondentes. ${number(snapshot.missingPairs)} de ${number(snapshot.questions.length * snapshot.models.length)} pares pergunta–modelo não têm dados neste período.`,
          )}
        </p>
        <p className="semantic-explainer">
          {l(
            'This snapshot retains its questions, filters, identity interpretation and evidence. Later edits do not change it. Reloading this page clears locally prepared reports. Export a copy to keep it.',
            'Este snapshot preserva perguntas, filtros, interpretação das identidades e evidências. Edições posteriores não o alteram. Recarregar esta página apaga os relatórios preparados localmente. Exporte uma cópia para guardá-la.',
          )}
        </p>
      </section>
      <section>
        <h3>
          {l(
            'Brand presence and competitors',
            'Presença da marca e concorrentes',
          )}
        </h3>
        <div className="semantic-detail-stats">
          <Metric
            label={l('Visibility', 'Visibilidade')}
            value={snapshot.responses ? percent(summary.coverage) : '—'}
            note={`${number(summary.mentions.length)} / ${number(snapshot.responses)} ${l('responses', 'respostas')}`}
          />
          <Metric
            label="Share of voice"
            value={
              summary.canonicalMentions ? percent(summary.shareOfVoice) : '—'
            }
            note={`${number(summary.mentions.length)} / ${number(summary.canonicalMentions)} ${l('canonical mentions', 'menções canônicas')}`}
          />
        </div>
        <p>
          {l(
            `Own domain cited in ${number(summary.linked)} of ${number(snapshot.responses)} responses. Consulted in ${number(summary.consulted)} of ${number(summary.consultedAvailable)} responses that expose consultation evidence.`,
            `Domínio próprio citado em ${number(summary.linked)} de ${number(snapshot.responses)} respostas. Consultado em ${number(summary.consulted)} de ${number(summary.consultedAvailable)} respostas que informam evidência de consulta.`,
          )}
        </p>
        <Table className="semantic-table" containerClassName="semantic-table-scroll">
            <TableHeader>
              <TableRow>
                <TableHead>{l('Brand', 'Marca')}</TableHead>
                <TableHead>{l('Visibility', 'Visibilidade')}</TableHead>
                <TableHead>Share of voice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {competitors.map((row) => (
                <TableRow key={row.entity.id}>
                  <TableCell>
                    {row.entity.name}
                    <small>
                      {row.entity.members
                        .map((member) => member.name)
                        .join(' + ')}
                    </small>
                  </TableCell>
                  <TableCell>
                    {snapshot.responses ? percent(row.summary.coverage) : '—'}
                    <small>
                      {number(row.summary.mentions.length)} /{' '}
                      {number(snapshot.responses)}
                    </small>
                  </TableCell>
                  <TableCell>
                    {row.summary.canonicalMentions
                      ? percent(row.summary.shareOfVoice)
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
      </section>
      <section>
        <h3>{l('Associations and priorities', 'Associações e prioridades')}</h3>
        <p>
          {l(
            'Association divides annotated responses mentioning the brand by responses eligible for that attribute. A gap is the difference to the leading canonical brand, in percentage points.',
            'Associação divide respostas anotadas com a marca pelas respostas elegíveis ao atributo. A lacuna é a diferença para a marca canônica líder, em pontos percentuais.',
          )}
        </p>
        <Table className="semantic-table" containerClassName="semantic-table-scroll">
            <TableHeader>
              <TableRow>
                <TableHead>{l('Attribute', 'Atributo')}</TableHead>
                <TableHead>{l('Association', 'Associação')}</TableHead>
                <TableHead>{l('Leader / gap', 'Líder / lacuna')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.associations.map((attribute) => (
                <TableRow key={attribute.id}>
                  <TableCell>
                    {l(attribute.label.en, attribute.label.pt)}
                    <small>
                      {l('Illustrative confidence', 'Confiança ilustrativa')}:{' '}
                      {attribute.evidence.length
                        ? percent(attribute.confidence, 0)
                        : '—'}
                    </small>
                  </TableCell>
                  <TableCell>
                    {attribute.eligible ? percent(attribute.value) : '—'}
                    <small>
                      {number(attribute.evidence.length)} /{' '}
                      {number(attribute.eligible)}
                    </small>
                  </TableCell>
                  <TableCell>
                    {attribute.eligible ? attribute.leader?.entity.name : '—'}
                    <small>
                      {attribute.eligible
                        ? `${number(attribute.gap, 1)} pp`
                        : '—'}
                    </small>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        {summary.associations
          .filter((item) => item.eligible > 0 && item.gap > 0)
          .sort((a, b) => b.gap - a.gap)
          .slice(0, 3)
          .map((item) => (
            <p key={item.id}>
              <strong>{l(item.label.en, item.label.pt)}:</strong>{' '}
              {l(
                `review the ${number(item.evidence.length)} annotated responses and supporting sources before prioritizing content. The ${number(item.gap, 1)} pp gap is descriptive, not a forecast.`,
                `revise as ${number(item.evidence.length)} respostas anotadas e suas fontes antes de priorizar conteúdo. A lacuna de ${number(item.gap, 1)} pp é descritiva, não uma previsão.`,
              )}
            </p>
          ))}
      </section>
      <section>
        <h3>{l('Coverage by engine', 'Cobertura por modelo')}</h3>
        <Table className="semantic-table" containerClassName="semantic-table-scroll">
            <TableHeader>
              <TableRow>
                <TableHead>{l('Engine', 'Modelo')}</TableHead>
                <TableHead>{l('Coverage', 'Cobertura')}</TableHead>
                <TableHead>{l('Position', 'Posição')}</TableHead>
                <TableHead>
                  {l(
                    'Positive / neutral / alert',
                    'Positivo / neutro / alerta',
                  )}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.engines
                .filter((engine) => snapshot.models.includes(engine.model))
                .map((engine) => (
                  <TableRow key={engine.model}>
                    <TableCell>
                      {engine.model}
                      <small>{engine.total ? engine.leader?.name : '—'}</small>
                    </TableCell>
                    <TableCell>
                      {engine.total ? percent(engine.coverage) : '—'}
                      <small>
                        {number(engine.mentions)} / {number(engine.total)}
                      </small>
                    </TableCell>
                    <TableCell>
                      {engine.mentions ? number(engine.position, 1) : '—'}
                    </TableCell>
                    <TableCell>
                      {number(engine.positive)} / {number(engine.neutral)} /{' '}
                      {number(engine.alert)}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        <p>
          {l(
            'Position averages the order of canonical brand appearance only in answers mentioning the brand. Sentiment counts those same answers: positive ≥ 85, neutral 75–84, alert < 75 in the synthetic score.',
            'Posição é a ordem média de aparição da marca canônica apenas nas respostas com menção. O sentimento conta essas mesmas respostas: positivo ≥ 85, neutro 75–84, alerta < 75 no score sintético.',
          )}
        </p>
      </section>
      <section>
        <h3>{l('Sources and formats', 'Fontes e formatos')}</h3>
        <p>
          {l(
            'Citations and consultations are independent evidence. Brand co-occurrence does not prove that the source page mentions the brand. Type, format and classification confidence are illustrative.',
            'Citação e consulta são evidências independentes. A coocorrência não prova que a página da fonte menciona a marca. Tipo, formato e confiança da classificação são ilustrativos.',
          )}
        </p>
        {summary.sources.length ? (
          <Table className="semantic-table" containerClassName="semantic-table-scroll">
              <TableHeader>
                <TableRow>
                  <TableHead>{l('Source', 'Fonte')}</TableHead>
                  <TableHead>{l('Cited / consulted', 'Citada / consultada')}</TableHead>
                  <TableHead>{l('With brand', 'Com a marca')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.domain}
                      </a>
                      <small>
                        {sourceLabel(source.type)} /{' '}
                        {sourceLabel(source.format)} ·{' '}
                        {percent(source.confidence, 0)}
                      </small>
                    </TableCell>
                    <TableCell>
                      {number(source.citations)} /{' '}
                      {summary.consultedAvailable
                        ? number(source.consulted)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {source.citations ? percent(source.association) : '—'}
                      <small>
                        {number(source.associated)} / {number(source.citations)}
                      </small>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        ) : (
          <p>
            {l(
              'No source evidence in this selection.',
              'Sem evidências de fontes nesta seleção.',
            )}
          </p>
        )}
      </section>
      <section>
        <h3>
          {l('Content formats by engine', 'Formatos de conteúdo por modelo')}
        </h3>
        <p>
          {l(
            'Share of citation occurrences within each engine. Several citations can occur in one answer; the denominator is citations, not responses.',
            'Participação nas ocorrências de citações de cada modelo. Uma resposta pode conter várias citações; o denominador é citações, não respostas.',
          )}
        </p>
        <Table className="semantic-table" containerClassName="semantic-table-scroll">
            <TableHeader>
              <TableRow>
                <TableHead>{l('Format', 'Formato')}</TableHead>
                {snapshot.models.map((model) => (
                  <TableHead key={model}>{model}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...new Set(summary.sources.map((source) => source.format))].map(
                (format) => (
                  <TableRow key={format}>
                    <TableCell>{sourceLabel(format)}</TableCell>
                    {snapshot.models.map((model) => {
                      const count = summary.sources
                        .filter((source) => source.format === format)
                        .reduce(
                          (sum, source) =>
                            sum + Number(source.engines[model] ?? 0),
                          0,
                        );
                      const total = summary.sources.reduce(
                        (sum, source) =>
                          sum + Number(source.engines[model] ?? 0),
                        0,
                      );
                      return (
                        <TableCell key={model}>
                          {total ? percent((count / total) * 100, 0) : '—'}
                          <small>
                            {number(count)} / {number(total)}
                          </small>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
      </section>
      <section>
        <h3>{l('Score method and limits', 'Método do score e limites')}</h3>
        <p>
          {l(
            'Lastfind method v1. Each input is bounded from 0 to 100 and multiplied by its weight.',
            'Método Lastfind v1. Cada indicador é limitado entre 0 e 100 e multiplicado pelo peso.',
          )}
        </p>
        {summary.score.parts.map((part) => (
          <div className="semantic-formula-row" key={part.id}>
            <span>{labels[part.id]}</span>
            <b>{percent(part.weight * 100, 0)}</b>
            <span>× {snapshot.responses ? number(part.value, 1) : '—'}</span>
            <strong>
              {snapshot.responses ? number(part.value * part.weight, 1) : '—'}
            </strong>
          </div>
        ))}
        <p>
          {l(
            `Association uses an unweighted mean of ${number(summary.eligibleAttributes)} eligible attributes. Source diversity counts ${number(summary.sourceTypes)} of five source types among answers mentioning the brand. Missing component inputs contribute zero; a period with no responses has no score.`,
            `Associação usa a média simples de ${number(summary.eligibleAttributes)} atributos elegíveis. Diversidade considera ${number(summary.sourceTypes)} de cinco tipos de fontes nas respostas com menção à marca. Indicadores sem dados contribuem zero; um período sem respostas não tem score.`,
          )}
        </p>
        <p className="semantic-explainer">
          {l(
            'Answers, annotations and confidence levels in this dataset are synthetic. They do not measure real brand equity or establish causal attribution. Changes in sample coverage can change the score.',
            'Respostas, anotações e níveis de confiança deste conjunto são sintéticos. Eles não medem valor real de marca nem estabelecem atribuição causal. Mudanças na cobertura da amostra podem alterar o score.',
          )}
        </p>
      </section>
      <section>
        <h3>
          {l(
            'Questions and evidence appendix',
            'Apêndice de perguntas e evidências',
          )}
        </h3>
        <p>
          {l(
            `${number(snapshot.questions.filter((question) => question.brandRequested).length)} questions explicitly request the brand. These measure prompted perception; they are not spontaneous category discovery.`,
            `${number(snapshot.questions.filter((question) => question.brandRequested).length)} perguntas solicitam explicitamente a marca. Elas medem percepção solicitada; não são descoberta espontânea da categoria.`,
          )}
        </p>
        {snapshot.questions.length ? (
          <div className="semantic-report-questions">
            {snapshot.questions.map((question) => (
              <details key={question.id}>
                <summary>
                  {question.text}
                  <small>
                    {number(question.responses)} {l('responses', 'respostas')} ·{' '}
                    {question.brandRequested
                      ? l(
                          'Brand explicitly requested',
                          'Marca solicitada explicitamente',
                        )
                      : l('Category question', 'Pergunta de categoria')}
                  </small>
                </summary>
                <p>
                  {question.missingModels.length
                    ? l(
                        `No data: ${question.missingModels.join(', ')}`,
                        `Sem dados: ${question.missingModels.join(', ')}`,
                      )
                    : l(
                        'All selected engines have at least one sample.',
                        'Todos os modelos selecionados têm ao menos uma amostra.',
                      )}
                </p>
                {snapshot.evidence
                  .filter((response) => response.promptId === question.id)
                  .slice(-3)
                  .reverse()
                  .map((response) => (
                    <div className="semantic-report-evidence" key={response.id}>
                      <b>
                        {response.model} · {response.date.slice(0, 10)}
                      </b>
                      <p>
                        {l('Response ID', 'ID da resposta')}: {response.id}
                        <br />
                        {l('Original brands', 'Marcas originais')}:{' '}
                        {response.brandIds
                          .map(
                            (id) =>
                              snapshot.entities
                                .flatMap((entity) => entity.members)
                                .find((member) => member.id === id)?.name ?? id,
                          )
                          .join(', ') || l('None', 'Nenhuma')}
                      </p>
                      <p>
                        {l('Cited', 'Citadas')}:{' '}
                        {response.sourceIds.length
                          ? response.sourceIds.map((id) => {
                              const source = demoSources.find(
                                (item) => item.id === id,
                              );
                              return (
                                <a
                                  key={id}
                                  href={source?.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {source?.domain ?? id}{' '}
                                </a>
                              );
                            })
                          : l('None', 'Nenhuma')}
                        <br />
                        {l('Consulted', 'Consultadas')}:{' '}
                        {response.consultedSourceIds === null
                          ? l('Unavailable', 'Indisponível')
                          : response.consultedSourceIds
                              .map(
                                (id) =>
                                  demoSources.find((source) => source.id === id)
                                    ?.url ?? id,
                              )
                              .join(' · ') ||
                            l('None recorded', 'Nenhuma registrada')}
                      </p>
                    </div>
                  ))}
              </details>
            ))}
          </div>
        ) : (
          <p>
            {l(
              'No eligible questions in this selection.',
              'Sem perguntas elegíveis nesta seleção.',
            )}
          </p>
        )}
        <p className="semantic-explainer">
          {l(
            'Each question previews up to three recent samples. The full CSV includes every matching response ID, original brand identity, citation, consultation record and attribute evidence mapping.',
            'Cada pergunta exibe até três amostras recentes. O CSV completo inclui todas as respostas correspondentes, identidades originais, citações, registros de consulta e vínculo com as evidências de cada atributo.',
          )}
        </p>
      </section>
    </article>
  );
}

function SemanticAttributeSettings({
  configuration,
  researchLanguage,
  projectSegment,
  readOnly,
  onSave,
  onBack,
}: {
  configuration: SemanticConfiguration;
  researchLanguage: 'en-US' | 'pt-BR';
  projectSegment: string;
  readOnly: boolean;
  onSave: (configuration: SemanticConfiguration) => void;
  onBack: () => void;
}) {
  const l = useCopy();
  const { number } = useNumbers();
  const [configurationDraft, setConfigurationDraft] =
    useState<SemanticConfiguration | null>(() => ({
      enabled: configuration.enabled,
      attributes: configuration.attributes.length
        ? configuration.attributes.map((item) => ({ ...item }))
        : onboardingAttributeSuggestions(projectSegment, researchLanguage),
    }));
  const [configurationError, setConfigurationError] =
    useState<ReturnType<typeof validateSemanticConfiguration>>(null);
  const configurationErrors = {
    count: l(
      'Keep 1–10 attributes, or turn Semantic Branding off.',
      'Mantenha de 1 a 10 atributos ou desative o Branding Semântico.',
    ),
    id: l(
      'Remove the invalid attribute and add it again.',
      'Remova o atributo inválido e adicione-o novamente.',
    ),
    name: l(
      'Name each attribute using 2–60 characters.',
      'Dê um nome de 2 a 60 caracteres a cada atributo.',
    ),
    duplicate: l(
      'Use a different name for each attribute.',
      'Use um nome diferente para cada atributo.',
    ),
    description: l(
      'Keep each description within 240 characters.',
      'Use até 240 caracteres em cada descrição.',
    ),
  };
  return (
    <section
      className="semantic-configuration-page"
      aria-label={l(
        'Brand attribute settings',
        'Configurações dos atributos da marca',
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        className="semantic-configuration-back"
        onClick={onBack}
      >
        <ArrowLeft size={14} />
        {l('Back to Semantic Branding', 'Voltar ao Semantic Branding')}
      </Button>
      <div className="analytics-panel semantic-configuration-panel">
        <header className="semantic-panel-heading">
          <h2>
            {l(
              'The attributes you want to be known for',
              'Os atributos pelos quais quer ser reconhecido',
            )}
          </h2>
          <p>
            {l(
              'Define the associations you want to explore. Saved settings stay in this browser tab across reloads; existing reports and prompts remain as they are.',
              'Defina as associações que quer explorar. As configurações salvas permanecem nesta aba ao recarregar; relatórios existentes e prompts permanecem como estão.',
            )}
          </p>
        </header>
        {readOnly && (
          <p className="semantic-association-note">
            {l(
              'Your role allows you to view these settings. An owner or admin can edit them.',
              'Seu perfil permite consultar estas configurações. Um proprietário ou administrador pode editá-las.',
            )}
          </p>
        )}
        {configurationDraft && (
          <form
            className="semantic-configuration-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (readOnly) return;
              const issue = validateSemanticConfiguration(configurationDraft);
              if (issue) {
                setConfigurationError(issue);
                return;
              }
              onSave({
                enabled: configurationDraft.enabled,
                attributes: configurationDraft.attributes.map((item) => ({
                  ...item,
                  name: item.name.trim(),
                  description: item.description.trim(),
                })),
              });
            }}
          >
            <label
              className="semantic-configuration-toggle"
              htmlFor="semantic-configuration-enabled"
            >
              <Checkbox
                id="semantic-configuration-enabled"
                checked={configurationDraft.enabled}
                disabled={readOnly}
                onCheckedChange={(enabled) =>
                  setConfigurationDraft(
                    (current) => current && { ...current, enabled },
                  )
                }
              />
              <span>
                {l('Enable Semantic Branding', 'Ativar Branding Semântico')}
              </span>
            </label>
            <p className="semantic-explainer">
              {l('Research language', 'Idioma da pesquisa')}:{' '}
              {researchLanguage === 'pt-BR' ? 'Português (Brasil)' : 'English'}
            </p>
            {configurationDraft.enabled ? (
              <>
                <p className="semantic-explainer">
                  {l(
                    'Keep 1–10 attributes that represent your positioning. Add context only when it helps clarify the meaning.',
                    'Mantenha de 1 a 10 atributos que representam seu posicionamento. Adicione contexto quando ele ajudar a esclarecer o significado.',
                  )}
                </p>
                <div className="semantic-configuration-attributes">
                  {configurationDraft.attributes.map((item, index) => (
                    <div
                      key={item.id}
                      className="semantic-configuration-attribute"
                    >
                      <div>
                        <Label htmlFor={`semantic-config-name-${item.id}`}>
                          {l('Attribute', 'Atributo')} {number(index + 1)}
                        </Label>
                        <Input
                          id={`semantic-config-name-${item.id}`}
                          value={item.name}
                          maxLength={60}
                          disabled={readOnly}
                          onChange={(event) =>
                            setConfigurationDraft(
                              (current) =>
                                current && {
                                  ...current,
                                  attributes: current.attributes.map(
                                    (attribute) =>
                                      attribute.id === item.id
                                        ? {
                                            ...attribute,
                                            name: event.target.value,
                                          }
                                        : attribute,
                                  ),
                                },
                            )
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={readOnly}
                        aria-label={l(
                          `Remove attribute ${index + 1}`,
                          `Remover atributo ${index + 1}`,
                        )}
                        onClick={() =>
                          setConfigurationDraft(
                            (current) =>
                              current && {
                                ...current,
                                attributes: current.attributes.filter(
                                  (attribute) => attribute.id !== item.id,
                                ),
                              },
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                      <details>
                        <summary>
                          {l('Context (optional)', 'Contexto (opcional)')}
                        </summary>
                        <div>
                          <Label
                            htmlFor={`semantic-config-description-${item.id}`}
                          >
                            {l(
                              'What does this mean for your brand?',
                              'O que isso significa para sua marca?',
                            )}
                          </Label>
                          <Textarea
                            id={`semantic-config-description-${item.id}`}
                            value={item.description}
                            maxLength={240}
                            disabled={readOnly}
                            onChange={(event) =>
                              setConfigurationDraft(
                                (current) =>
                                  current && {
                                    ...current,
                                    attributes: current.attributes.map(
                                      (attribute) =>
                                        attribute.id === item.id
                                          ? {
                                              ...attribute,
                                              description: event.target.value,
                                            }
                                          : attribute,
                                    ),
                                  },
                              )
                            }
                          />
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    readOnly || configurationDraft.attributes.length >= 10
                  }
                  onClick={() =>
                    setConfigurationDraft(
                      (current) =>
                        current && {
                          ...current,
                          attributes: [
                            ...current.attributes,
                            {
                              id: `attribute-${crypto.randomUUID()}`,
                              name: '',
                              description: '',
                            },
                          ],
                        },
                    )
                  }
                >
                  <Plus size={14} />
                  {l('Add attribute', 'Adicionar atributo')}
                </Button>
              </>
            ) : (
              <p className="semantic-explainer">
                {l(
                  'Your attributes are kept so you can enable them again later. Existing report snapshots keep their original configuration.',
                  'Seus atributos são mantidos para que você possa reativá-los depois. Relatórios já preparados conservam a configuração original.',
                )}
              </p>
            )}
            {configurationError && (
              <p role="alert" className="semantic-validation">
                {configurationErrors[configurationError]}
              </p>
            )}
            <div className="semantic-wizard-actions">
              <Button type="button" variant="outline" onClick={onBack}>
                {l('Cancel', 'Cancelar')}
              </Button>
              <Button type="submit" disabled={readOnly}>
                {l('Save attributes', 'Salvar atributos')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
