'use client';
import { Hint } from '@/components/ui/tooltip';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { SOURCE_PICKER_COLUMNS, SOURCE_PAGE_SIZE, SourceCitationFilter, SourcesPresence, SourcesPresenceTable, sourceCitationFrom, type SourceCitation } from './sources-presence';
import { useReport } from '@/hooks/use-report';
import { filtersThatFit } from '@/lib/filter-fit';
import { formatNextCollection, scheduleOf } from '@/lib/scheduling';
import { useKeptReport } from '@/hooks/use-kept-report';
import { useTableColumns, visibleColumns } from '@/hooks/use-table-columns';

import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createAnalyticsRequest } from '@/lib/analytics-cache';
import {
  ACCOUNT_CHANGED_EVENT,
  announceSessionChange,
  requestJson,
  PUBLIC_SESSION_CHANGE_KEY,
  PUBLIC_SESSION_CHANNEL,
  setRequestWorkspace,
} from '@/lib/client';
import { LanguageSwitcher, useI18n } from '@/lib/i18n';
import type { AnswerBrand, Workspace, Run, Prompt, Project } from '@/lib/types';
import { LiveBrandSettings } from './live-brand-settings';
import { AdminSkeleton, SettingsBlock, SettingsSkeleton } from './settings-block';
import { LiveMonitoringSettings } from './live-monitoring-settings';
import { ArchivedProjects, DataRetention, ProjectDangerZone, ProjectDataSettings } from './project-settings-panels';
import { awaitingEvaluation, OverviewSentimentCard, sentimentScore, useOverviewSentiment } from './overview-sentiment-card';
import type { BrandResearchReport } from './brand-research-panel';
import { RecentResponsesTable } from './recent-responses-table';
import { ModelEvidenceNotice, modelEvidenceColumns, modelsSummaryValues } from './model-evidence';
import { formatNumber, formatPercent } from '@/lib/number-format';
import { AnswerMarkdown } from './answer-markdown';
import { BrandResearchPanel, researchPanelPath } from './brand-research-panel';
import { MentionBudget } from './mention-budget';
import { PromptAnswersByModel } from './prompt-answers-by-model';
import { PromptBrandRanking, promptRankingPath } from './prompt-brand-ranking';
import { parseBrandReportView, syncBrandReportView, type BrandReportView } from './brand-report-tabs';
import { BrandsScreen, BrandsSkeleton } from './brands-screen';
import { brandPathLabel, type BrandRow } from '@/lib/brand-decisions';
import { brandFilterActive, brandShown, readBrandFilter } from '@/lib/brand-filter';
import { BrandsFilter, type BrandChoice } from './brands-filter';
import { useBrandDiscoveries, type DiscoveredBrand } from './use-brand-discoveries';
import { LiveCompetitorSettings } from './live-competitor-settings';
import { CompactEngineIcons, EngineIcon } from '@/components/lastfind/identity-icons';
import { FilterTrigger } from './filter-trigger';
import { ModelFilter } from './model-filter';
import { MoreCompetitorsNote } from './more-competitors-note';
import { LastfindLogo } from '@/components/lastfind/lastfind-logo';
import { defaultTopic, promptSourcesEmptyText } from '@/lib/prompt-tools';
import { weightedMentionPosition, type MentionPositionRow } from '@/lib/prompt-summary-metrics';
import { availableEngines, ENGINE_LABELS } from '@/lib/engines';
import { countryFlag, countryName } from '@/lib/countries';
import { NewProjectWizard } from './new-project-wizard';
import { projectLabel } from '@/lib/new-project';
import {
  SiteFavicon,
  FaviconRouteProvider,
  SearchField,
  PrimaryMenuActions,
  useCollectionPage,
  useSortedPage,
  CollectionPagination,
  CompactPagination,
  NamesFilter,
  BrandName,
  RETRY_LABEL,
  FilterSelect,
  EmptyState,
  Change,
  ComparisonContext,
  comparisonCopy,
  WithChange,
} from './shared';
import { Checkbox } from '@/components/ui/checkbox';
import { SelectField } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ProfileAvatar, UserAvatar } from './user-avatar';
import { NavUser } from '@/components/lastfind/nav-user';
import { ProjectSwitcher } from '@/components/lastfind/project-switcher';
import { MembersSettings, PendingInvitations, openWorkspace, roleLabel } from './members-settings';
import { ApiAccessSettings } from './api-access-settings';
import { UsageMeterRow } from '@/components/lastfind/usage-meter-row';
import { PageHeading, PageFilters, FilterBar } from '@/components/lastfind/presentation/page-heading';
import { Note } from '@/components/lastfind/presentation/note';
import { blockLabel, blockRemedy } from './spend-labels';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { DetailBodySkeleton } from '@/components/lastfind/presentation/detail-page';
import { noComparisonNote, OverviewKpis, OverviewSkeleton, RANKING_COLUMNS, summaryComparable } from './overview-kpis';
import { coveredPeriods, thinPeriodNote } from '@/lib/period-coverage';
import { MetricCard, MetricGrid, MetricGridSkeleton } from '@/components/lastfind/presentation/metric-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useStatusToast } from '@/components/ui/toast';
import { ColumnPicker, DataTable, DataTableScreen, DataTableToolbar, skeletonColumns, sortRows, type DataColumn, type DataSort } from '@/components/lastfind/presentation/data-table';
import { TagBadge } from '@/components/lastfind/presentation/tag-badge';
import { TrendCard, TrendChart } from '@/components/lastfind/presentation/trend-chart';
import { byRankingValue, cutBrandRanking } from '@/lib/brand-ranking-cut';
import { parseDemoPromptImport } from './prompt-import';
import { DateRangePicker } from './date-range-picker';
import { comparisonRange, getDateRange, readComparison, writeComparison, type Comparison } from './date-range';
import { initialWorkspacePath, slugify } from './routes';
import { compactAppPath, expandAppPath, projectBySlug } from './app-routes';
import { AddressSettings, checkWorkspaceSlug } from './address-settings';
import { WorkspaceWizard } from './workspace-wizard';
import { ProjectHrefContext } from './agent-learning';
import { discoveriesReadPath, overviewReadPaths, reportFilterQuery, reportPath as reportViewPath, researchReadPath, screenReportPath } from './screen-reads';
import { SemanticOverviewRow, SemanticPerception, useSemanticReport } from './semantic-perception';
import { OverviewTopicCoverage, TopicsSkeleton } from './overview-topics';
import { relativeReportDate } from '@/lib/report-date';
import { SourceEntityPage, SourceEntitySkeleton } from './source-entity-page';
import { UrlCell } from './url-cell';
import { ExportMenuItem } from './export-button';
import { SectionMenuItem } from './section-sidebar';
import { FanoutSkeleton, FanoutView, TopTermsCard } from './fanout-view';
import { OpportunitiesSkeleton, OpportunitiesView } from './opportunities-view';
import { PRODUCT_SECTIONS, ProductsSkeleton, ProductsView, isProductDetail, productSection } from './products-view';
import { ProductPage, ProductPageSkeleton } from './product-page';
import { BrandPageSkeleton } from './brand-page';
import { readFanoutNavigation, writeFanoutNavigation, type FanoutNavigation } from '@/lib/fanout-navigation';
import { termKey } from '@/lib/fanout';
import { PromptDialog } from './prompt-dialog';
import { PromptFiltersButton } from './prompt-filters';
import { EMPTY_PROMPT_FILTERS, TOPIC_SEPARATOR, activeConditions, inHeaderFilters, matchesPromptFilters, readPromptFilters, writePromptFilters, type PromptFilters, type PromptStatus } from '@/lib/prompt-filters';
import { ClassifierNotice, ContentTypesPanel, OVERVIEW_TYPES_SHOWN, SourceTypesPanel, TopSourcesList, sourceOwnerLabel, sourceTypeLabel } from './source-types-ui';
import { DrillLink, ViewAllAction, type DrillTarget, type Linker } from './drill-link';
import { brandKey } from '@/lib/brand-decisions';
import { sentimentLabel } from './brand-sentiment-analysis';
import { DOMAIN_TYPES, PAGE_TYPES, SOURCE_OWNERS, UNCLASSIFIED, sourceFiltersFromQuery } from '@/lib/source-types';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { defaultShownSeries, orderSeriesByTotal, seriesColorVar } from '@/lib/chart-series';
import { voiceField, discoveredInPeriod, extraPeriodShare, getTrendScale, summaryTrend, trendRange, type TrendMetric, type TrendResolution } from '@/lib/report-trend';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Layers,
  Check,
  Plus,
  Tag,
  Globe2,
  CircleHelp,
  X,
  ListFilter,
  Pause,
  Play,
  Archive,
  ArrowUpRight,
  ArrowLeft,
  Pencil,
  Upload,
  Eye,
  MessageSquare,
  ListOrdered,
  EllipsisVertical,
  MoreVertical,
  Bot,
  TrendingUp,
  TrendingDown,
  MessagesSquare,
  CircleAlert,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  SidebarRail,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { navigation } from './analytics-sidebar';
import { adminIcons, navIcons, settingsIcons } from './nav-icons';
import type {
  SummaryReport,
  HistoryPage,
  PromptReport,
  SourcesPage,
  AnalysisReport,
  AnalysisRow,
  CompetitorsReport,
  PromptDetail,
  SourceDetail,
  SourceTypesReport,
  ContentTypesReport,
  FanoutReport,
  OpportunitiesReport,
  ProductsReport,
} from '@/lib/report-types';
import './live-app.css';
import { AgentArtifacts, AgentChat, AgentUnavailable, AgentUsageRow, ArtifactPageSkeleton, AskLastfind, prefetchConversations } from './agent-screen';
import { SemanticSkeleton, semanticModelColumn } from './semantic-summary';
import { AgentBrain, AgentContents, BrainSkeleton, AgentSettings, CreateContentButton, NEW_CONTENT_EVENT, type ContentMode } from './agent-contents';
import { AgentSkills } from './agent-skills';
import { AI_BOTS_SECTIONS, AiBotsSettings, AiBotsSkeleton, AiBotsView, aiBotsSection } from './ai-bots-view';
import { COMPARISON_SECTIONS, ComparisonSkeleton, ComparisonView, comparisonDetailOf, comparisonSection } from './comparison-view';

type Tab =
  | 'overview'
  | 'prompts'
  | 'topics'
  | 'responses'
  | 'sources'
  | 'products'
  | 'ai-bots'
  | 'comparison'
  | 'settings'
  | 'competitors'
  | 'models'
  | 'fanout'
  | 'semantic-branding'
  | 'agent'
  | 'contents'
  | 'artifacts'
  | 'brain'
  | 'skills'
  | 'opportunities'
  | 'admin';
const tabs: Tab[] = [
  'overview',
  'prompts',
  'topics',
  'responses',
  'sources',
  'products',
  'ai-bots',
  'comparison',
  'settings',
  'competitors',
  'models',
  'fanout',
  'semantic-branding',
  'agent',
  'contents',
  'artifacts',
  'brain',
  'skills',
  'opportunities',
  'admin',
];
const label: Record<Tab, [string, string]> = {
  overview: ['Overview', 'Visão geral'],
  prompts: ['Prompts', 'Prompts'],
  topics: ['Topics', 'Tópicos'],
  responses: ['Responses', 'Respostas'],
  sources: ['Sources', 'Fontes'],
  products: ['Shopping', 'Shopping'],
  'ai-bots': ['Traffic', 'Tráfego'],
  comparison: ['Comparison', 'Comparação'],
  settings: ['Settings', 'Configurações'],
  competitors: ['Brands', 'Marcas'],
  models: ['AI models', 'Modelos de IA'],
  fanout: ['Query Fan Out', 'Query Fan Out'],
  'semantic-branding': ['Semantic Branding', 'Semantic Branding'],
  agent: ['Chat', 'Chat'],
  contents: ['Contents', 'Conteúdos'],
  artifacts: ['Artifacts', 'Artefatos'],
  brain: ['Brain', 'Cérebro'],
  skills: ['Skills', 'Skills'],
  opportunities: ['Opportunities', 'Oportunidades'],
  admin: ['Admin', 'Admin'],
};
const description: Record<Tab, [string, string]> = {
  overview: ['Understand how AI sees your brand. Make your next move count.', 'Entenda como a IA vê sua marca. Dê o próximo passo com dados.',
  ],
  prompts: ['Track the questions that matter to your brand.', 'Acompanhe as perguntas que importam para sua marca.',
  ],
  topics: ['Organize the questions you monitor.', 'Organize as perguntas monitoradas.',
  ],
  responses: ['Every answer tells a story. Explore yours.', 'Cada resposta conta uma história. Explore a sua.',
  ],
  sources: ['Discover the sources behind your AI visibility.', 'Descubra as fontes por trás da sua visibilidade em IA.',
  ],
  products: ['The products the AIs show as cards in their answers: which brands, where to buy, at what price.', 'Os produtos que as IAs mostram em cartões nas respostas: de quais marcas, onde comprar e a que preço.'],
  'ai-bots': ['Which AIs read your site, what they read and the visits their answers send you.', 'Quais IAs leem o seu site, o que elas leem e as visitas que as respostas delas mandam para você.'],
  comparison: ['The score the AIs give your brand and each competitor on every attribute of your products, with a fact behind each score. The period and the AI filter apply here; topics, tags and brands do not.', 'A nota que as IAs dão à sua marca e a cada concorrente em cada atributo dos seus produtos, com um fato por trás de cada nota. Aqui valem o período e o filtro de IAs; tópicos, tags e marcas não.'],
  settings: ['Make this workspace your own.', 'Deixe este workspace com a sua cara.',
  ],
  competitors: ['See who stands out in AI answers, and where you stand.', 'Veja quem se destaca nas respostas de IA e onde sua marca está.',
  ],
  models: ['Your performance across the AI search landscape.', 'Seu desempenho nos principais modelos de busca com IA.',
  ],
  fanout: ['The searches the AIs run behind your prompts.', 'As buscas que as IAs fazem por trás dos seus prompts.',
  ],
  'semantic-branding': ['Understand the associations shaping your brand in AI. The period and the AI filter apply here; topics and tags do not: the AIs are asked about the brands themselves, not through your prompts.', 'Entenda as associações que formam sua marca na IA. Aqui valem o período e o filtro de IAs; tópicos e tags não: as IAs são perguntadas sobre as marcas em si, não pelos seus prompts.',
  ],
  agent: ['Ask about this project and get reports you can share.', 'Pergunte sobre este projeto e receba relatórios para compartilhar.'],
  contents: ['The articles, pages and posts written with the agent for this project, for everyone in the workspace.', 'Os artigos, páginas e posts escritos com o agente para este projeto, para todo o workspace.'],
  artifacts: ['The reports, tables and briefs the agent wrote for this project, for everyone in the workspace.', 'Os relatórios, tabelas e briefs que o agente escreveu para este projeto, para todo o workspace.'],
  brain: ['What the agent knows about this project: its tone of voice, audience, products and facts.', 'O que o agente sabe sobre este projeto: o tom de voz, o público, os produtos e os fatos.'],
  skills: ['How the agent does each kind of task, for every project of the workspace.', 'Como o agente faz cada tipo de tarefa, para todos os projetos do workspace.'],
  opportunities: ['Where AIs answer your market without you: the search intents your competitors win, and the content to make.', 'Onde as IAs respondem ao seu mercado sem você: as intenções de busca que seus concorrentes ganham, e o conteúdo a criar.'],
  admin: ['What runs behind every workspace. Only admins see this.', 'O que roda por trás de todos os workspaces. Só admins veem isto.'],
};

/**
 * Admin: its own navigation in the same shell (like Settings), one page per concern. The edition decides which
 * pages exist and renders them (`admin` prop); without any, the tab and the sidebar item do not exist.
 */
export type AdminPageId = keyof typeof adminIcons;
/** `list`: the page is a list screen (a full-bleed `DataTableScreen`, shell.md section 8): no heading, no column. */
export type AdminPage = { id: AdminPageId; content: ReactNode; list?: boolean };
const adminPageCopy: Record<AdminPageId, { label: [string, string]; description: [string, string] }> = {
  overview: { label: ['Overview', 'Visão geral'], description: ['Health of the scheduler, publication and providers, and what still needs setting up.', 'Saúde do agendador, da publicação e dos provedores, e o que ainda falta configurar.'] },
  providers: { label: ['Providers', 'Provedores'], description: ['The API credentials the platform uses. Values never come back to the browser.', 'As credenciais de API que a plataforma usa. Os valores nunca voltam ao navegador.'] },
  classifiers: { label: ['Classifiers', 'Classificadores'], description: ['The model each function runs, for every project. Model names appear only here.', 'O modelo que cada função usa, em todos os projetos. Nomes de modelos aparecem só aqui.'] },
  algorithms: { label: ['Algorithms', 'Algoritmos'], description: ['Every analysis module, its version and what can be reprocessed.', 'Cada módulo de análise, sua versão e o que pode ser reprocessado.'] },
  leads: { label: ['Leads', 'Leads'], description: ['Which new accounts qualify as leads and where they are sent.', 'Quais contas novas viram leads e para onde são enviadas.'] },
  workspaces: { label: ['Workspaces', 'Workspaces'], description: ['Every workspace, its owner, plan and projects. Read-only apart from the plan override.', 'Todos os workspaces, seu dono, plano e projetos. Só leitura, exceto o plano forçado.'] },
  usage: { label: ['Usage and costs', 'Uso e custos'], description: ['Where the money goes: every project, module and AI, next to its budget and the platform brake.', 'Para onde vai o dinheiro: cada projeto, módulo e IA, ao lado do orçamento e do freio da plataforma.'] },
  email: { label: ['Email', 'Email'], description: ['The outcome of every email the platform tried to send. Recipients are masked.', 'O resultado de cada email que a plataforma tentou enviar. Destinatários mascarados.'] },
};
const adminPageFor = (id: string | null, pages: AdminPage[]): AdminPageId =>
  pages.find((page) => page.id === id)?.id ?? pages[0]?.id ?? 'overview';

// Responses and Query Fan Out live under Prompts: one sidebar group with three sub-items. Their own `tab=` values (and old links) still open them.
const promptsTabs = ['prompts', 'responses', 'fanout'] as const satisfies readonly Tab[];
// Agent: one sidebar group, Chat, Contents, Artifacts, Opportunities, Brain and Skills (agent-screen.tsx, agent-contents.tsx, agent-skills.tsx,
// opportunities-view.tsx).
const agentTabs = ['agent', 'contents', 'artifacts', 'opportunities', 'brain', 'skills'] as const satisfies readonly Tab[];

type SettingsSection = 'workspace' | 'competitors' | 'monitoring' | 'semantic' | 'ai-bots' | 'agent' | 'data' | 'members' | 'projects' | 'connections' | 'profile';
type SettingsSectionGroup = {
  id: 'project' | 'workspace';
  label: [string, string];
  sections: { id: SettingsSection; label: [string, string] }[];
};
const settingsSectionGroups: SettingsSectionGroup[] = [
  {
    id: 'project',
    label: ['Project', 'Projeto'],
    sections: [
      { id: 'workspace', label: ['Brand and market', 'Marca e mercado'] },
      { id: 'competitors', label: ['Competitors', 'Concorrentes'] },
      { id: 'monitoring', label: ['Monitoring', 'Monitoramento'] },
      { id: 'semantic', label: ['Semantic Branding', 'Semantic Branding'] },
      { id: 'ai-bots', label: ['Traffic', 'Tráfego'] },
      { id: 'agent', label: ['Agent', 'Agente'] },
      { id: 'data', label: ['Project data', 'Dados do projeto'] },
    ],
  },
  {
    id: 'workspace',
    label: ['Workspace', 'Workspace'],
    sections: [
      { id: 'projects', label: ['Projects', 'Projetos'] },
      { id: 'members', label: ['Members', 'Membros'] },
      { id: 'connections', label: ['AI apps', 'Apps de IA'] },
    ],
  },
];
// My profile lives in the user menu, not in the Settings navigation; its address still opens it.
const profileSection = { id: 'profile', label: ['My profile', 'Meu perfil'] } satisfies SettingsSectionGroup['sections'][number];
const settingsSections = [...settingsSectionGroups.flatMap(({ sections }) => sections), profileSection];
/** The section an address names, or Brand and market. */
const settingsSectionFor = (id: string | null): SettingsSection =>
  settingsSections.find((section) => section.id === id)?.id ?? 'workspace';

type SourceEntity = { kind: 'domain' | 'url'; key: string };
// Every piece of navigation state that belongs in the address, so any screen can
// be reopened from its URL and a drill down link can be built without side effects.
type NavState = {
  fanout: FanoutNavigation;
  projectId: string | null;
  tab: Tab;
  days: string;
  startDate: string;
  endDate: string;
  comparison: Comparison;
  engineFilter: string;
  topicFilter: string;
  tagFilter: string;
  /** The header's Brands filter (lib/brand-filter.ts): which brands the reports list; '' every brand found. */
  brandsFilter: string;
  queryText: string;
  sourceKind: SourceCitation;
  sourceGroup: 'domain' | 'url';
  responseMention: 'all' | 'mentioned' | 'missing';
  settingsSection: SettingsSection;
  adminPage: AdminPageId;
  brandView: BrandReportView;
  promptRoute: string | null;
  promptListPage: number;
  listScroll: number;
  entity: SourceEntity | null;
  typeFilter: string;
  ownerFilter: string;
  sourceOrigin: 'all' | 'prompts' | 'semantic-branding';
  runRoute: string | null;
  brandFilter: string;
  /** Responses citing the brand's own domain ('own') or this domain; '' for every response. */
  responseCites: string;
  /** The display name of the Responses brand filter when it is a discovered brand's key. */
  brandLabel: string;
  /** Responses whose reading of the brand filter is in this sentiment band; '' for every response. */
  responseSentiment: string;
  brandPage: string | null;
  /** Products: its Brands or Products page (`brands`, `list`; none is the overview), a product's page (its slug) or a brand's (`brands/<slug>`). */
  productDetail: string | null;
  /** Comparison: its Products, Attributes or Personas page (`products`, `attributes`, `personas`; none is the overview). */
  comparisonView: string | null;
  /** Traffic (the AI bots section, 13/11/2026): its AI Bots or AI Traffic page with its drill down (`bots`, `ai?llm=chatgpt`; none is the overview). */
  aiBotsView: string | null;
  promptFilters: PromptFilters;
};
/** Response detail: the groups of brands an answer names, in this order. */
const ANSWER_BRAND_ROLES: [AnswerBrand['role'], [string, string]][] = [
  ['tracked', ['Monitored', 'Monitoradas']],
  ['competitor', ['Competitors', 'Concorrentes']],
  ['client', ['Clients', 'Clientes']],
  ['supplier', ['Suppliers and tools', 'Fornecedores e ferramentas']],
  ['partner', ['Partners', 'Parceiros']],
  ['ambiguous', ['To review', 'A revisar']],
  ['pending', ['Not classified yet', 'Ainda não classificadas']],
];
/** The fewest rows a fitted table shows beside its neighbour (docs/design/shell.md section 7). */
const ROWS_THAT_FIT_MIN = 5;
/**
 * Rows of a card's table that fit the height its neighbour gives the row (card-row harmony): beside the brand trend the table
 * takes no height of its own (`.rows-fit`, size containment) and shows the whole rows that fit what the row leaves it. Rows keep
 * their own height, never stretched to fill (14/11/2026); what is left, less than a row, stays under the last one. The count
 * comes from the rows as drawn (a brand icon makes a row a little taller than the token), read again whenever the table
 * changes, so a count from another moment (the page still laying out, a capture resizing the window) never cuts a row at
 * the card's foot. At least `ROWS_THAT_FIT_MIN` rows: the table holds their height, and the row grows to it evenly. In one
 * column (no neighbour) the containment is off and `fallback` rows show.
 */
function useRowsThatFit(fallback: number) {
  // The element in a ref too: the effect sets its min-height (a state value is never written to).
  const element = useRef<HTMLDivElement | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((value: HTMLDivElement | null) => {
    element.current = value;
    setNode(value);
  }, []);
  const [rows, setRows] = useState(fallback);
  useEffect(() => {
    const box = element.current;
    if (!node || !box) return;
    const fit = () => {
      if (!getComputedStyle(node).contain.includes('size')) {
        box.style.minHeight = '';
        return setRows(fallback);
      }
      const token = parseFloat(getComputedStyle(node).getPropertyValue('--table-row-height')) || 0;
      const head = node.querySelector('thead tr')?.getBoundingClientRect().height || token;
      const row = Math.max(token, ...[...node.querySelectorAll('tbody tr')].map((item) => item.getBoundingClientRect().height));
      if (!(row > 0)) return;
      box.style.minHeight = `${Math.ceil(head + row * ROWS_THAT_FIT_MIN)}px`;
      setRows(Math.max(ROWS_THAT_FIT_MIN, Math.floor((node.clientHeight - head + 0.5) / row)));
    };
    fit();
    // The container's size (the neighbour, the window) and its rows (new data, a row a little taller) both change the count.
    const resized = new ResizeObserver(fit);
    resized.observe(node);
    const changed = new MutationObserver(fit);
    changed.observe(node, { childList: true, subtree: true });
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [node, fallback]);
  return [attach, rows] as const;
}
function writeSearch(params: URLSearchParams, state: NavState) {
  const { tab } = state;
  writeFanoutNavigation(params, tab === 'fanout' ? state.fanout : null);
  // An agent conversation or artifact belongs to its project: another project starts without them.
  if (params.has('project') && params.get('project') !== state.projectId) {
    params.delete('conversation');
    params.delete('artifact');
  }
  if (state.projectId) params.set('project', state.projectId);
  else params.delete('project');
  params.set('tab', tab);
  syncBrandReportView(params, state.brandView, tab === 'competitors');
  if (tab === 'settings') params.set('section', state.settingsSection);
  else if (tab === 'admin') params.set('section', state.adminPage);
  else params.delete('section');
  params.set('days', state.days);
  if (state.startDate && state.endDate) {
    params.set('start', state.startDate);
    params.set('end', state.endDate);
  } else {
    params.delete('start');
    params.delete('end');
  }
  writeComparison(params, state.comparison);
  for (const [key, value] of [
    ['engine', state.engineFilter],
    ['tags', state.tagFilter],
    ['brands', state.brandsFilter],
    ['query', state.queryText],
    ['kind', state.sourceKind],
    ['group', state.sourceGroup],
    ['type', tab === 'sources' ? state.typeFilter : ''],
    ['owner', tab === 'sources' ? state.ownerFilter : ''],
    ['origin', tab === 'sources' ? state.sourceOrigin : ''],
    ['brand', tab === 'responses' ? state.brandFilter : ''],
    ['cites', tab === 'responses' ? state.responseCites : ''],
    ['brandName', tab === 'responses' && state.brandFilter ? state.brandLabel : ''],
    ['sentiment', tab === 'responses' ? state.responseSentiment : ''],
    ['run', tab === 'responses' ? state.runRoute ?? '' : ''],
    ['brandPage', tab === 'competitors' ? state.brandPage ?? '' : ''],
    ['productDetail', tab === 'products' ? state.productDetail ?? '' : ''],
    ['comparisonView', tab === 'comparison' ? state.comparisonView ?? '' : ''],
    ['aiBotsView', tab === 'ai-bots' ? state.aiBotsView ?? '' : ''],
    ['entity', tab === 'sources' ? state.entity?.kind ?? '' : ''],
    ['key', tab === 'sources' ? state.entity?.key ?? '' : ''],
  ]) {
    if (value && value !== 'all') params.set(key, value);
    else params.delete(key);
  }
  params.delete('topic');
  for (const topic of state.topicFilter.split(TOPIC_SEPARATOR).filter(Boolean)) params.append('topic', topic);
  if (tab === 'responses' && state.responseMention !== 'all') params.set('mention', state.responseMention);
  else params.delete('mention');
  if (state.promptRoute && (tab === 'prompts' || tab === 'responses')) params.set('prompt', state.promptRoute);
  else params.delete('prompt');
  // Agent > Chat keeps the open conversation and artifact in the address itself (agent-screen.tsx); Agent > Contents keeps
  // its wizard (`new`).
  if (tab !== 'agent') params.delete('conversation');
  if (tab !== 'agent' && tab !== 'artifacts' && tab !== 'contents') params.delete('artifact');
  if (tab !== 'contents') params.delete('new');
  // Agent > Opportunities keeps the open opportunity in the address itself (opportunities-view.tsx).
  if (tab !== 'opportunities') params.delete('opportunity');
  writePromptFilters(params, tab === 'prompts' ? state.promptFilters : null);
  if (tab === 'prompts') {
    params.set('listPage', String(state.promptListPage));
    params.set('listScroll', String(state.listScroll));
  }
}

const listNumber = (value: string | null, fallback: number) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= fallback ? number : fallback;
};

export function LiveAnalyticsApp({
  wizard,
  workspaceSlug,
  initialSearch = '',
  demoMode = false,
  request: transport = requestJson,
  exportDemo,
  resetDemo,
  billingPanel,
  admin: adminPages = [],
  notificationsPanel,
  profilePanel,
  sessionScope,
  initialWorkspace,
  sidebar,
}: {
  /** The address of a wizard: New project (`/app/<workspace>/onboarding`) or the workspace's (`/app/<workspace>/setup`). */
  wizard?: 'project' | 'workspace';
  /** Cloud: the slug of the workspace the address names (app-routes.ts); absent in the independent edition and the demo. */
  workspaceSlug?: string;
  /** The address in the app's long form (route-page.tsx reads it so); the demo's long query. */
  initialSearch?: string;
  demoMode?: boolean;
  request?: typeof requestJson;
  exportDemo?: (query: URLSearchParams) => void | Promise<void>;
  resetDemo?: () => void;
  billingPanel?: ReactNode;
  /** The Admin pages, for a platform admin only (decided on the server). Without any, Admin does not exist. */
  admin?: AdminPage[];
  /** The edition's email notification settings (Cloud). Without one, My profile says the installation sends no email. */
  notificationsPanel?: ReactNode;
  /** The edition's own profile cards (Cloud: about you, sign-in), under the photo in My profile. */
  profilePanel?: ReactNode;
  /** The signed-in account: its reads are kept in the tab, so a later visit paints at once (analytics-cache). */
  sessionScope?: string;
  /** The first workspace read, already under way on the server. */
  initialWorkspace?: { path: string; data: Promise<unknown>; reads?: Promise<{ path: string; data: Promise<unknown> }[]> };
  /** The sidebar as the person left it (its cookies, read with the page): collapsed or not, and its width. */
  sidebar?: { open: boolean; width?: number };
}) {
  // The seed and scope come with the page, so they stay the same while it is open.
  const cache = useMemo(
    () => createAnalyticsRequest(transport, Date.now, demoMode ? {} : { scope: sessionScope, seed: initialWorkspace }),
    [transport, demoMode, sessionScope, initialWorkspace],
  );
  const admin = adminPages.length > 0;
  const request = cache.request;
  const api = demoMode ? '/api/demo' : '/api';
  const pageBase = demoMode ? '/demo' : '/app';
  // The address in the app's long form (app-routes.ts): the project is its slug. The demo keeps the long query.
  const query = new URLSearchParams(initialSearch);
  // Cloud's addresses name the workspace; the independent edition's do not.
  const workspaced = workspaceSlug !== undefined;
  const readAddress = useCallback(
    () => expandAppPath(window.location.pathname.split('/').slice(2), window.location.search, workspaced) ?? new URLSearchParams(),
    [workspaced],
  );
  const initialProject = query.get('project');
  // A string, so the first read below does not run again on every render.
  const firstWorkspacePath = initialWorkspacePath(query.toString(), api);
  const initialTab = query.get('tab');
  const [projectId, setProjectId] = useState(initialProject);
  // The address named no project of this workspace (a typo, an old address, an archived project): none opens, not the first.
  const [missingProject, setMissingProject] = useState<string | null>(null);
  // Admin exists only for an admin: anyone else asking for it lands on the Overview, told why (`adminDenied`).
  const [tab, setTab] = useState<Tab>(
    tabs.includes(initialTab as Tab) && (initialTab !== 'admin' || admin) ? (initialTab as Tab) : 'overview',
  );
  const [adminDenied, setAdminDenied] = useState(initialTab === 'admin' && !admin);
  if (adminDenied && tab !== 'overview') setAdminDenied(false);
  // The app owns this state because opening a response unmounts FanoutView.
  // Entries are scoped to a project; browser history carries the same state.
  const [fanoutByProject, setFanoutByProject] = useState<Record<string, FanoutNavigation>>({});
  const fanoutNavigation = (projectId && fanoutByProject[projectId]) || readFanoutNavigation(new URLSearchParams());
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Filters that do not fit beside the path fold into the Filters button, as on a phone: never clipped.
  const topbarRef = useRef<HTMLElement>(null);
  const [foldedFilters, setFoldedFilters] = useState(0);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  // The workspace's slug in the addresses (Cloud): as the workspace read last says it (Settings may have just changed it),
  // else the page's.
  const workspaceAddress = workspace?.workspaces?.find((item) => item.current)?.slug ?? workspaceSlug ?? null;
  // Every request names the workspace this address shows (Cloud): set when the address changes, never back over a newer one
  // the workspace wizard or Settings just set (a renamed slug, a workspace just created).
  const requestAddress = useRef<string | null | undefined>(undefined);
  if (requestAddress.current !== workspaceAddress) {
    requestAddress.current = workspaceAddress;
    setRequestWorkspace(workspaceAddress);
  }
  // What comes before a project's slug in its address.
  const addressBase = workspaceAddress ? `/app/${encodeURIComponent(workspaceAddress)}/` : '/app/';
  // Back and forward read an address's project slug without waiting for a render.
  const projectsRef = useRef<Workspace['projects']>([]);
  useEffect(() => { projectsRef.current = workspace?.projects ?? []; }, [workspace]);
  // An invited person whose own workspace is empty opens the first workspace they belong to, until they pick one.
  useEffect(() => {
    if (demoMode || !workspace?.workspaces || workspace.projects.length || document.cookie.includes('lastfind_workspace=')) return;
    const other = workspace.workspaces.find((item) => !item.current);
    if (other) openWorkspace(other.id, `/app/${encodeURIComponent(other.slug)}`);
  }, [workspace, demoMode]);
  const [dataRevision, setDataRevision] = useState(0);
  // When the app opened: a project created since is in its first collection interval (firstInterval).
  const [openedAt] = useState(Date.now);
  const [report, setReport] = useState<
    | SummaryReport
    | PromptReport
    | HistoryPage
    | SourcesPage
    | AnalysisReport
    | CompetitorsReport
    | FanoutReport
    | OpportunitiesReport
    | ProductsReport
    | null
  >(null);
  const [reportKey, setReportKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [networkReportLoading, setReportLoading] = useState(false);
  // Path whose request has finished (loaded or failed): until then the report is still pending,
  // so the skeleton stays on screen through the render between "workspace ready" and "request sent".
  const [reportSettledPath, setReportSettledPath] = useState<string | null>(null);
  const [reportAttempt, setReportAttempt] = useState(0);
  const [overviewSourcesData, setOverviewSources] = useState<SourcesPage | null>(null);
  const [overviewContentData, setOverviewContent] = useState<SourcesPage | null>(null);
  const [overviewHistoryData, setOverviewHistory] = useState<HistoryPage | null>(null);
  const [overviewFanoutData, setOverviewFanout] = useState<FanoutReport | null>(null);
  const [overviewSourcesKey, setOverviewSourcesKey] = useState('');
  const [overviewContentKey, setOverviewContentKey] = useState('');
  const [overviewHistoryKey, setOverviewHistoryKey] = useState('');
  const [overviewFanoutKey, setOverviewFanoutKey] = useState('');
  const [overviewChart, setOverviewChart] = useState<'visibility' | 'shareOfVoice' | 'position'>('shareOfVoice');
  const [overviewResolution, setOverviewResolution] = useState<TrendResolution>('day');
  // The brands the person turned on or off in the Overview chart's legend; the rest follow the default (overviewShown).
  const [chartBrandChoices, setChartBrandChoices] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fanoutExport = useRef<(() => void) | null>(null);
  const [creatingProject, setCreatingProject] = useState(!!wizard);
  // New workspace (the switcher, Cloud): the workspace wizard creates one, or says why it cannot. The screens stay hidden as
  // while creating a project.
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  // The workspace wizard: asked by its address, or by a new workspace its owner has not named yet (below).
  const [settingUpWorkspace, setSettingUpWorkspace] = useState(wizard === 'workspace');
  const [workspaceNamed, setWorkspaceNamed] = useState(false);
  const [detail, setDetail] = useState<Run | null>(null);
  const [topic, setTopic] = useState('');
  const [days, setDays] = useState(query.get('days') || '28');
  const [startDate, setStartDate] = useState(query.get('start') || '');
  const [endDate, setEndDate] = useState(query.get('end') || '');
  const [comparison, setComparison] = useState(() => readComparison(query));
  const [engineFilter, setEngineFilter] = useState(
    query.get('engine') || 'all',
  );
  const [topicFilter, setTopicFilter] = useState(query.getAll('topic').join(TOPIC_SEPARATOR));
  const [tagFilter, setTagFilter] = useState(query.get('tags') || '');
  const [brandsFilter, setBrandsFilter] = useState(query.get('brands') || '');
  const [sourceKind, setSourceKind] = useState<SourceCitation>(sourceCitationFrom(query.get('kind')));
  const [sourceGroup, setSourceGroup] = useState<'domain' | 'url'>(
    query.get('group') === 'url' ? 'url' : 'domain',
  );
  const [entity, setEntity] = useState<SourceEntity | null>(() => {
    const kind = query.get('entity'),
      key = query.get('key');
    return initialTab === 'sources' && (kind === 'domain' || kind === 'url') && key ? { kind, key } : null;
  });
  const [typeFilter, setTypeFilter] = useState(initialTab === 'sources' ? sourceFiltersFromQuery(query).type : '');
  const [ownerFilter, setOwnerFilter] = useState(initialTab === 'sources' ? sourceFiltersFromQuery(query).owner : '');
  const [sourceOrigin, setSourceOrigin] = useState<NavState['sourceOrigin']>(initialTab === 'sources' && ['prompts','semantic-branding'].includes(query.get('origin') || '') ? query.get('origin') as NavState['sourceOrigin'] : 'all');
  const [runRoute, setRunRoute] = useState<string | null>(initialTab === 'responses' ? query.get('run') : null);
  const [brandFilter, setBrandFilter] = useState(initialTab === 'responses' ? query.get('brand') || '' : '');
  const [responseCites, setResponseCites] = useState(initialTab === 'responses' ? query.get('cites') || '' : '');
  const [brandLabel, setBrandLabel] = useState(initialTab === 'responses' ? query.get('brandName') || '' : '');
  const [responseSentiment, setResponseSentiment] = useState(initialTab === 'responses' ? query.get('sentiment') || '' : '');
  const [brandPage, setBrandPage] = useState<string | null>(initialTab === 'competitors' ? query.get('brandPage') : null);
  const [brandPageTitle, setBrandPageTitle] = useState<string | null>(null);
  const openingArtifact = (initialTab === 'artifacts' || initialTab === 'contents') && Boolean(query.get('artifact'));
  const [productDetail, setProductDetail] = useState<string | null>(initialTab === 'products' ? query.get('productDetail') : null);
  const [productTitle, setProductTitle] = useState<string | null>(null);
  const [comparisonTitle, setComparisonTitle] = useState<string | null>(null);
  const [comparisonView, setComparisonView] = useState<string | null>(initialTab === 'comparison' ? query.get('comparisonView') : null);
  const [aiBotsView, setAiBotsView] = useState<string | null>(initialTab === 'ai-bots' ? query.get('aiBotsView') : null);
  const [typesReport, setTypesReport] = useState<SourceTypesReport | null>(null);
  const [typesState, setTypesState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [classifying, setClassifying] = useState(false);
  const [classifyError, setClassifyError] = useState('');
  const [sourcePage, setSourcePage] = useState(1);
  // The sources list is paged by the server, so its column order is asked of the server too.
  const [sourceSort, setSourceSort] = useState<DataSort>();
  const promptTable = useRef<HTMLTableElement>(null);
  const [queryText, setQueryText] = useState(query.get('query') || '');
  // Sources search: draft updates on each keystroke; queryText (URL/API) waits briefly.
  const [sourceSearchDraft, setSourceSearchDraft] = useState(query.get('query') || '');
  const setQuery = (value: string) => {
    setQueryText(value);
    setSourceSearchDraft(value);
  };
  const [responseMention, setResponseMention] = useState<'all' | 'mentioned' | 'missing'>(initialTab === 'responses' && (query.get('mention') === 'mentioned' || query.get('mention') === 'missing') ? (query.get('mention') as 'mentioned' | 'missing')
      : 'all',
  );
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => settingsSectionFor(query.get('section')));
  const [adminPage, setAdminPage] = useState<AdminPageId>(() => adminPageFor(initialTab === 'admin' ? query.get('section') : null, adminPages));
  const [settingsDrafts, setSettingsDrafts] = useState<Record<string, boolean>>({});
  const settingsDirty = Object.values(settingsDrafts).some(Boolean);
  const clearSettingsDirty = useCallback(() => setSettingsDrafts({}), []);
  const reportSettingsDirty = useCallback((block: string, dirty: boolean) => {
    setSettingsDrafts((drafts) => drafts[block] === dirty ? drafts : { ...drafts, [block]: dirty });
  }, []);
  const settingsDirtyRef = useRef(false);
  const cancelledHistoryNavigation = useRef(false);
  useEffect(() => { settingsDirtyRef.current = settingsDirty; }, [settingsDirty]);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  // One sidebar for the whole app: entering Settings swaps its links, never its width (collapsed stays collapsed).
  const [sidebarOpen, setSidebarOpen] = useState(sidebar?.open ?? true);
  const [returnToApp, setReturnToApp] = useState('');
  const guardSettingsNavigation = (action: () => void) => {
    if (settingsDirty) setPendingNavigation(() => action);
    else action();
  };
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (settingsDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [settingsDirty]);
  const [brandView, setBrandView] = useState(() => parseBrandReportView(query.get('brandView')));
  const promptColumnsPref = useTableColumns('prompts', demoMode, ['country', 'channels']);
  const modelsColumnsPref = useTableColumns('models', demoMode);
  const responsesColumnsPref = useTableColumns('responses', demoMode);
  const sourcesColumnsPref = useTableColumns(
    sourceGroup === 'url' ? 'sources-url' : 'sources-domain',
    demoMode,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const importInput = useRef<HTMLInputElement>(null);
  // Status, competitors only (the server's `gap=competitor-only`) and the filter panel's conditions, kept in the URL (lib/prompt-filters.ts).
  const [promptFilters, setPromptFilters] = useState(() => (initialTab === 'prompts' ? readPromptFilters(query) : EMPTY_PROMPT_FILTERS));
  const statusFilter = promptFilters.status;
  const setStatusFilter = (status: PromptStatus) => setPromptFilters((current) => ({ ...current, status }));
  const promptGap = promptFilters.gap;
  const setPromptGap = (gap: boolean) => setPromptFilters((current) => ({ ...current, gap }));
  const [historyPages, setHistoryPages] = useState<HistoryPage[]>([]);
  const [responsePage, setResponsePage] = useState(1);
  const [promptRoute, setPromptRoute] = useState<string | null>(query.get('prompt'));
  const [promptListPage, setPromptListPage] = useState(
    listNumber(query.get('listPage'), 1),
  );
  const selectedPrompt = useMemo(
    () =>
      promptRoute && tab === 'prompts'
        ? (workspace?.prompts.find(
            (item) =>
              item.id === promptRoute || promptRoute.startsWith(`${item.id}-`),
          ) ?? null)
        : null,
    [workspace, promptRoute, tab],
  );
  const promptScopeRef = useRef<string | null>(null);
  const promptReturnScroll = useRef(listNumber(query.get('listScroll'), 0));
  const detailRequest = useRef(0);
  const workspaceRequest = useRef(0);
  const [detailHistoryCursors, setDetailHistoryCursors] = useState<string[]>([
    '',
  ]);
  const [detailHistoryPage, setDetailHistoryPage] = useState(1);
  const [detailSourceCursors, setDetailSourceCursors] = useState<string[]>([
    '',
  ]);
  const [detailSourcePage, setDetailSourcePage] = useState(1);
  const [detailReport, setDetailReport] = useState<
    PromptDetail | SourceDetail | null
  >(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const navigationReady = useRef(false);
  const restoringHistory = useRef(false);
  const { locale, setLocale } = useI18n();
  const t = useCallback(
    (en: string, pt: string) => (locale === 'pt-BR' ? pt : en),
    [locale],
  );

  useEffect(
    () =>
      cache.subscribe((path, data) => {
        if (path.startsWith(`${api}/workspace`)) {
          const fresh = data as Workspace;
          if (fresh.selectedProjectId === projectId) setWorkspace(fresh);
        }
        setDataRevision((value) => value + 1);
      }),
    [cache, api, projectId],
  );
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.live-app');
    const header = root?.querySelector<HTMLElement>('.analytics-topbar');
    if (!root || !header) return;
    const update = () => {
      const toolbar = root.querySelector<HTMLElement>('.live-prompt-toolbar');
      const headerHeight = `${header.offsetHeight}px`;
      const toolbarHeight = `${toolbar?.offsetHeight ?? 0}px`;
      if (root.style.getPropertyValue('--live-header-height') !== headerHeight) {
        root.style.setProperty('--live-header-height', headerHeight);
      }
      if (root.style.getPropertyValue('--live-toolbar-height') !== toolbarHeight) {
        root.style.setProperty('--live-toolbar-height', toolbarHeight);
      }
    };
    let updateFrame = 0;
    const scheduleUpdate = () => {
      if (updateFrame) return;
      updateFrame = window.requestAnimationFrame(() => {
        updateFrame = 0;
        update();
      });
    };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(header);
    const toolbar = root.querySelector<HTMLElement>('.live-prompt-toolbar');
    if (toolbar) observer.observe(toolbar);
    scheduleUpdate();
    return () => {
      observer.disconnect();
      if (updateFrame) window.cancelAnimationFrame(updateFrame);
    };
  }, [tab, locale, workspace]);
  const refresh = useCallback(
    async (selected: string | null, reloadReports = true) => {
      const version = ++workspaceRequest.current;
      const data = await request<Workspace>(
        `${api}/workspace${selected ? `?project=${encodeURIComponent(selected)}` : ''}`,
      );
      if (version !== workspaceRequest.current) return data;
      setWorkspace(data);
      setProjectId(data.selectedProjectId);
      setMissingProject(selected && !data.selectedProjectId ? selected : null);
      // Soft writes (settings, brands) keep other screens' last paint; session/demo still reload.
      if (reloadReports) setDataRevision((revision) => revision + 1);
      return data;
    },
    [api, request, setWorkspace, setProjectId, setMissingProject, setDataRevision],
  );
  // Another project starts clean: only the period and the AI models carry over; every other filter, search and open page
  // names this project's topics, tags, brands, prompts, sources or answers.
  const openProject = (id: string) => {
    clearSettingsDirty();
    setDetail(null);
    setTopicFilter('');
    setTagFilter('');
    setBrandsFilter('');
    setQuery('');
    setSourceKind('all');
    setEntity(null);
    setTypeFilter('');
    setOwnerFilter('');
    setSourceOrigin('all');
    setSourcePage(1);
    setRunRoute(null);
    setBrandFilter('');
    setResponseCites('');
    setBrandLabel('');
    setResponseSentiment('');
    setResponseMention('all');
    setBrandPage(null);
    setProductDetail(null);
    setPromptRoute(null);
    setPromptFilters(EMPTY_PROMPT_FILTERS);
    setChartBrandChoices({});
    return refresh(id);
  };
  useEffect(() => {
    if (demoMode) return;
    const changed = () => {
      cache.invalidate();
      setWorkspace(null);
      void refresh(projectId).catch((cause) =>
                    setError(cause.message),
                  );
    };
    const storage = (event: StorageEvent) => {
      if (event.key === PUBLIC_SESSION_CHANGE_KEY) changed();
    };
    window.addEventListener('storage', storage);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(PUBLIC_SESSION_CHANNEL);
      channel.onmessage = changed;
    } catch {}
    return () => {
      window.removeEventListener('storage', storage);
      channel?.close();
    };
  }, [demoMode, cache, projectId, refresh]);
  // An edition's profile card saved the person's name (Cloud's About you, `ACCOUNT_CHANGED_EVENT`): the sidebar and the
  // account menu read it again, the screen stays as it is.
  useEffect(() => {
    const changed = () => {
      cache.invalidate();
      void refresh(projectId, false).catch(() => undefined);
    };
    window.addEventListener(ACCOUNT_CHANGED_EVENT, changed);
    return () => window.removeEventListener(ACCOUNT_CHANGED_EVENT, changed);
  }, [cache, projectId, refresh]);
  useEffect(() => {
    let active = true;
    const version = ++workspaceRequest.current;
    request<Workspace>(firstWorkspacePath)
      .then(async (received) => {
        if (!active || workspaceRequest.current !== version) return;
        const match = projectBySlug(received.projects, initialProject);
        if (initialProject && !match) {
          setWorkspace(received);
          setProjectId(null);
          setMissingProject(initialProject);
          return;
        }
        const data =
          match && match.id !== received.selectedProjectId
            ? await request<Workspace>(
                `${api}/workspace?project=${encodeURIComponent(match.id)}`,
              )
            : received;
        if (!active || workspaceRequest.current !== version) return;
        setWorkspace(data);
        if (data.selectedProjectId) setFanoutByProject((states) => ({
          ...states,
          [data.selectedProjectId!]: states[data.selectedProjectId!] ?? readFanoutNavigation(new URLSearchParams(initialSearch)),
        }));
        setProjectId(data.selectedProjectId);
      })
      .catch((cause) => {
        if (active && cause.name !== 'AbortError') setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, firstWorkspacePath, initialProject, initialSearch, request]);
  const responseQuery = tab === 'responses' ? queryText : '';
  const sourceQuery = tab === 'sources' ? queryText : '';
  useEffect(() => {
    if (tab !== 'sources') return;
    // 150 ms: short enough to feel live while typing; measured ~300 ms round-trip saved vs 300 ms debounce on typical keystroke bursts.
    const wait = window.setTimeout(() => {
      if (sourceSearchDraft !== queryText) setQueryText(sourceSearchDraft);
    }, 150);
    return () => window.clearTimeout(wait);
  }, [sourceSearchDraft, tab, queryText]);
  useEffect(() => {
    queueMicrotask(() => {
      setSourcePage(1);
    });
  }, [
    projectId,
    days,
    startDate,
    endDate,
    engineFilter,
    topicFilter,
    tagFilter,
    responseQuery,
    sourceQuery,
    responseMention,
    brandFilter,
    responseCites,
    responseSentiment,
    promptRoute,
    demoMode,
    typeFilter,
    ownerFilter,
    sourceOrigin,
    tab,
  ]);
  // The header's period limits: the reports read up to 90 days ending today.
  const periodBounds = { lastDate: new Date().toISOString().slice(0, 10), firstDate: '2000-01-01', maxDays: 90 };
  const comparedRange = comparisonRange(getDateRange({ days, from: startDate, to: endDate }, periodBounds), comparison, periodBounds.maxDays);
  // Only chosen dates travel to the reports; without them they compare with the period right before.
  const [compareStart, compareEnd] = comparedRange?.custom ? [comparedRange.from, comparedRange.to] : ['', ''];
  // What every change on the screens compares with (shared.tsx Change): named by its dates, or off.
  const comparedDates = comparedRange
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).formatRange(new Date(`${comparedRange.from}T00:00:00Z`), new Date(`${comparedRange.to}T00:00:00Z`))
    : '';
  const comparisonValue = useMemo(
    () => ({ off: comparison.mode === 'none', custom: Boolean(comparedRange?.custom), dates: comparedDates }),
    [comparison.mode, comparedRange?.custom, comparedDates],
  );
  const compared = comparisonCopy(t, comparisonValue);
  // Site icons come from our server: the app's route, or the public demo's, which serves the demo's own sites alone.
  const faviconRoute = useMemo(
    () => (host: string) =>
      demoMode
        ? `/api/demo/favicon?${new URLSearchParams({ ...(projectId ? { project: projectId } : {}), domain: host })}`
        : `/api/favicon?domain=${encodeURIComponent(host)}`,
    [demoMode, projectId],
  );
  // Phones fold the header filters behind one button: it counts the ones applied (a period other than the default included).
  // Semantic Branding asks the AIs about the brands themselves: topics, tags and brands do not apply there and are not counted.
  const sbScreen = tab === 'semantic-branding' || tab === 'ai-bots' || tab === 'comparison';
  const appliedHeaderFilters = [startDate || days !== '28', tab !== 'ai-bots' && engineFilter !== 'all', !sbScreen && topicFilter, !sbScreen && tagFilter, !sbScreen && (brandsFilter || (tab === 'competitors' && brandView !== 'general'))].filter(Boolean).length;
  const filterQuery = useMemo(() => reportFilterQuery({
    projectId,
    days,
    startDate,
    endDate,
    compareStart,
    compareEnd,
    engine: engineFilter,
    topic: topicFilter,
    tags: tagFilter,
    query: responseQuery || sourceQuery,
    tab,
    mention: responseMention,
    brand: brandFilter,
    cites: responseCites,
    // The public demo has no answer readings: its Responses never filter by band.
    sentiment: demoMode ? undefined : responseSentiment,
    // Responses of one prompt (a drill down from Prompts): its unit.
    prompt: tab === 'responses' ? promptRoute ?? undefined : undefined,
    gap: promptGap,
    source: { kind: sourceKind, group: sourceGroup, page: sourcePage, type: typeFilter, owner: ownerFilter, origin: sourceOrigin, sort: sourceSort },
  }), [
    projectId,
    days,
    startDate,
    endDate,
    compareStart,
    compareEnd,
    engineFilter,
    topicFilter,
    tagFilter,
    responseQuery,
    sourceQuery,
    responseMention,
    tab,
    sourceKind,
    sourceGroup,
    sourcePage,
    sourceSort,
    brandFilter,
    responseCites,
    responseSentiment,
    promptRoute,
    demoMode,
    typeFilter,
    ownerFilter,
    sourceOrigin,
    promptGap,
  ]);
  const detailFilters = useMemo(() => {
    const params = new URLSearchParams(filterQuery);
    for (const key of ['page', 'kind', 'evidence', 'group', 'type', 'owner', 'query']) params.delete(key);
    return params.toString();
  }, [filterQuery]);
  const reportPath = useMemo(
    () => ((tab === 'prompts' && promptRoute) || (tab === 'sources' && entity) ? null : screenReportPath(api, tab, filterQuery)),
    [tab, promptRoute, entity, filterQuery, api],
  );
  const overviewPaths = useMemo(() => overviewReadPaths(api, filterQuery), [filterQuery, api]);
  const overviewSources = cache.peek<SourcesPage>(overviewPaths.sources) ?? (overviewSourcesKey === overviewPaths.sources ? overviewSourcesData : null);
  // null is both "still loading" and "failed"; the key says which: a settled key with no data is a failure.
  const overviewSourcesState = overviewSources ? 'ready' : overviewSourcesKey === overviewPaths.sources ? 'failed' : 'loading';
  const overviewContent = cache.peek<SourcesPage>(overviewPaths.content) ?? (overviewContentKey === overviewPaths.content ? overviewContentData : null);
  const overviewContentState = overviewContent ? 'ready' : overviewContentKey === overviewPaths.content ? 'failed' : 'loading';
  const overviewHistory = cache.peek<HistoryPage>(overviewPaths.history) ?? (overviewHistoryKey === overviewPaths.history ? overviewHistoryData : null);
  const overviewHistoryState = overviewHistory ? 'ready' : overviewHistoryKey === overviewPaths.history ? 'failed' : 'loading';
  const overviewFanout = cache.peek<FanoutReport>(overviewPaths.fanout) ?? (overviewFanoutKey === overviewPaths.fanout ? overviewFanoutData : null);
  const overviewFanoutState = overviewFanout ? 'ready' : overviewFanoutKey === overviewPaths.fanout ? 'failed' : 'loading';
  const cachedReport = reportPath ? cache.peek<NonNullable<typeof report>>(reportPath) : undefined;
  // The open project's screens are not read while the New project wizard covers them: nothing loads (or fails) behind it.
  const workspaceReady = Boolean(workspace) && !creatingProject;
  const reportLoading = (networkReportLoading || (workspaceReady && Boolean(reportPath) && reportSettledPath !== reportPath)) && !cachedReport;
  useEffect(() => {
    if (
      !workspaceReady ||
      !projectId ||
      (tab === 'prompts' && promptRoute) ||
      ![
        'overview',
        'prompts',
        'responses',
        'sources',
        'competitors',
        'models',
        'fanout',
        'opportunities',
        'products',
      ].includes(tab)
    ) {
      queueMicrotask(() => { setReport(null); setReportKey(null); });
      return;
    }
    if (!reportPath) return;
    let active = true;
    const cached = cache.peek(reportPath);
    queueMicrotask(() => {
      if (!active) return;
      setReportLoading(!cached);
      if (cached) {
        // The cache bounds request reuse, not the lifetime of the displayed
        // report. Keep the result when its TTL expires on a later UI render.
        setReport(cached as NonNullable<typeof report>);
        setReportKey(`${tab}|${filterQuery}`);
        setReportSettledPath(reportPath);
      }
      // Keep the previous report on screen while the next path loads (no layout jump).
      if (tab === 'responses') { setHistoryPages([]); setResponsePage(1); }
    });
    if (cached) {
      void request(reportPath).catch(() => {});
      return;
    }
    request<
      | SummaryReport
      | PromptReport
      | HistoryPage
      | SourcesPage
      | AnalysisReport
      | CompetitorsReport
      | FanoutReport
    >(reportPath)
      .then((data) => {
        if (active) { setReport(data); setReportKey(`${tab}|${filterQuery}`); }
      })
      .catch((cause) => {
        if (active && cause.name !== 'AbortError') setError(cause.message);
      })
      .finally(() => {
        if (active) { setReportLoading(false); setReportSettledPath(reportPath); }
      });
    return () => {
      active = false;
    };
  }, [
    workspaceReady,
    dataRevision,
    projectId,
    tab,
    filterQuery,
    api,
    request,
    promptRoute,
    reportPath,
    cache,
    reportAttempt,
  ]);
  useEffect(() => {
    if (!workspaceReady || !projectId || tab !== 'overview') return;
    let active = true;
    void request<SourcesPage>(overviewPaths.sources).then((data) => { if (active) { setOverviewSources(data); setOverviewSourcesKey(overviewPaths.sources); } }).catch(() => { if (active) { setOverviewSources(null); setOverviewSourcesKey(overviewPaths.sources); } });
    void request<SourcesPage>(overviewPaths.content).then((data) => { if (active) { setOverviewContent(data); setOverviewContentKey(overviewPaths.content); } }).catch(() => { if (active) { setOverviewContent(null); setOverviewContentKey(overviewPaths.content); } });
    void request<HistoryPage>(overviewPaths.history).then((data) => { if (active) { setOverviewHistory(data); setOverviewHistoryKey(overviewPaths.history); } }).catch(() => { if (active) { setOverviewHistory(null); setOverviewHistoryKey(overviewPaths.history); } });
    void request<FanoutReport>(overviewPaths.fanout).then((data) => { if (active) { setOverviewFanout(data); setOverviewFanoutKey(overviewPaths.fanout); } }).catch(() => { if (active) { setOverviewFanout(null); setOverviewFanoutKey(overviewPaths.fanout); } });
    return () => { active = false; };
  }, [workspaceReady, dataRevision, projectId, tab, overviewPaths, request]);
  const typesPath = overviewPaths.types;
  const [typesAttempt, setTypesAttempt] = useState(0);
  useEffect(() => {
    if (!workspaceReady || !projectId || tab !== 'overview') return;
    let active = true;
    queueMicrotask(() => {
      if (active) setTypesState(cache.peek(typesPath) ? 'ready' : 'loading');
    });
    request<SourceTypesReport>(typesPath)
      .then((data) => {
        if (!active) return;
        setTypesReport(data);
        setTypesState('ready');
      })
      .catch((cause) => {
        if (active && cause?.name !== 'AbortError') setTypesState('failed');
      });
    return () => {
      active = false;
    };
  }, [workspaceReady, dataRevision, projectId, tab, typesPath, request, cache, typesAttempt]);
  const contentPath = overviewPaths.contentTypes;
  const [contentReport, setContentReport] = useState<ContentTypesReport | null>(null);
  const [contentState, setContentState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [contentAttempt, setContentAttempt] = useState(0);
  useEffect(() => {
    if (!workspaceReady || !projectId || tab !== 'overview') return;
    let active = true;
    queueMicrotask(() => {
      if (active) setContentState(cache.peek(contentPath) ? 'ready' : 'loading');
    });
    request<ContentTypesReport>(contentPath)
      .then((data) => {
        if (!active) return;
        setContentReport(data);
        setContentState('ready');
      })
      .catch((cause) => {
        if (active && cause?.name !== 'AbortError') setContentState('failed');
      });
    return () => {
      active = false;
    };
  }, [workspaceReady, dataRevision, projectId, tab, contentPath, request, cache, contentAttempt]);
  const classifySources = async (kind: 'domain' | 'url') => {
    if (!projectId || demoMode) return;
    setClassifying(true);
    setClassifyError('');
    try {
      await request(`/api/projects/${encodeURIComponent(projectId)}/source-types?${filterQuery}`, 'POST', { kind });
      // Only the type cards on this screen; leave overview/workspace GETs alone.
      if (kind === 'domain') setTypesAttempt((value) => value + 1);
      else setContentAttempt((value) => value + 1);
    } catch (cause) {
      setClassifyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClassifying(false);
    }
  };
  useEffect(() => {
    const onPopState = () => {
      if (cancelledHistoryNavigation.current) { cancelledHistoryNavigation.current = false; return; }
      if (settingsDirtyRef.current && !window.confirm(t('Discard unsaved changes?', 'Descartar alterações não salvas?'))) { cancelledHistoryNavigation.current = true; window.history.forward(); return; }
      clearSettingsDirty();
      const next = demoMode
        ? new URLSearchParams(window.location.search)
        : readAddress();
      restoringHistory.current = true;
      // The address names the project by its slug; the app knows it by its id.
      const named = next.get('project');
      const nextProject = projectBySlug(projectsRef.current, named)?.id ?? named;
      if (nextProject && next.get('tab') === 'fanout') setFanoutByProject((states) => ({
        ...states,
        [nextProject]: readFanoutNavigation(next),
      }));
      if (nextProject && nextProject !== projectId)
        void refresh(nextProject).catch((cause) => setError(cause.message));
      setPromptRoute(next.get('prompt'));
      promptScopeRef.current = null;
      setPromptListPage(listNumber(next.get('listPage'), 1));
      promptReturnScroll.current = listNumber(next.get('listScroll'), 0);
      if (!next.get('prompt')) {
        const scroll = promptReturnScroll.current;
        requestAnimationFrame(() =>
          window.scrollTo({ top: scroll, behavior: 'instant' }),
        );
      }
      const nextTab = tabs.includes(next.get('tab') as Tab) && (next.get('tab') !== 'admin' || admin) ? (next.get('tab') as Tab)
        : 'overview';
      setTab(nextTab);
      setAdminDenied(next.get('tab') === 'admin' && !admin);
      setBrandView(parseBrandReportView(next.get('brandView')));
      const section = next.get('section');
      setSettingsSection(settingsSectionFor(nextTab === 'settings' ? section : null));
      setAdminPage(adminPageFor(nextTab === 'admin' ? section : null, adminPages));
      setDays(next.get('days') || '28');
      setStartDate(next.get('start') || '');
      setEndDate(next.get('end') || '');
      setComparison(readComparison(next));
      setEngineFilter(next.get('engine') || 'all');
      setTopicFilter(next.getAll('topic').join(TOPIC_SEPARATOR));
      setTagFilter(next.get('tags') || '');
      setBrandsFilter(next.get('brands') || '');
      setQuery(next.get('query') || '');
      setResponseMention(nextTab === 'responses' && (next.get('mention') === 'mentioned' || next.get('mention') === 'missing') ? (next.get('mention') as 'mentioned' | 'missing')
          : 'all',
      );
      setSourceKind(sourceCitationFrom(next.get('kind')));
      setSourceGroup(next.get('group') === 'url' ? 'url' : 'domain');
      const entityKind = next.get('entity'),
        entityKey = next.get('key');
      setEntity(nextTab === 'sources' && (entityKind === 'domain' || entityKind === 'url') && entityKey ? { kind: entityKind, key: entityKey } : null);
      setTypeFilter(nextTab === 'sources' ? sourceFiltersFromQuery(next).type : '');
      setOwnerFilter(nextTab === 'sources' ? sourceFiltersFromQuery(next).owner : '');
      setSourceOrigin(nextTab === 'sources' && ['prompts','semantic-branding'].includes(next.get('origin') || '') ? next.get('origin') as NavState['sourceOrigin'] : 'all');
      setRunRoute(nextTab === 'responses' ? next.get('run') : null);
      setBrandFilter(nextTab === 'responses' ? next.get('brand') || '' : '');
      setResponseCites(nextTab === 'responses' ? next.get('cites') || '' : '');
      setBrandLabel(nextTab === 'responses' ? next.get('brandName') || '' : '');
      setResponseSentiment(nextTab === 'responses' ? next.get('sentiment') || '' : '');
      setBrandPage(nextTab === 'competitors' ? next.get('brandPage') : null);
      setProductDetail(nextTab === 'products' ? next.get('productDetail') : null);
      setComparisonView(nextTab === 'comparison' ? next.get('comparisonView') : null);
      setAiBotsView(nextTab === 'ai-bots' ? next.get('aiBotsView') : null);
      setPromptFilters(nextTab === 'prompts' ? readPromptFilters(next) : EMPTY_PROMPT_FILTERS);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [admin, adminPages, clearSettingsDirty, projectId, refresh, t, demoMode, readAddress]);
  const navState: NavState = {
    fanout: fanoutNavigation,
    projectId,
    tab,
    days,
    startDate,
    endDate,
    comparison,
    engineFilter,
    topicFilter,
    tagFilter,
    brandsFilter,
    queryText,
    sourceKind,
    sourceGroup,
    responseMention,
    settingsSection,
    adminPage,
    brandView,
    promptRoute,
    promptListPage,
    listScroll: 0,
    entity,
    typeFilter,
    ownerFilter,
    sourceOrigin,
    runRoute,
    brandFilter,
    responseCites,
    brandLabel,
    responseSentiment,
    brandPage,
    productDetail,
    comparisonView,
    aiBotsView,
    promptFilters,
  };
  /**
   * The address of a state: the short one in the app (app-routes.ts, the workspace and project by their slugs), the long query in the public
   * demo. `keep` starts from the current address, so a parameter the app does not own (a billing return) stays.
   */
  const addressOf = useCallback((state: NavState, keep = false) => {
    const params = !keep
      ? new URLSearchParams()
      : demoMode
        ? new URLSearchParams(window.location.search)
        : readAddress();
    // The address names the project by its slug: read as its id, so the same project keeps its open conversation.
    const named = projectBySlug(workspace?.projects ?? [], params.get('project'));
    if (named) params.set('project', named.id);
    writeSearch(params, state);
    if (demoMode) return `${pageBase}?${params}`;
    const project = workspace?.projects.find((item) => item.id === state.projectId);
    return compactAppPath(params, project ? (project.slug ?? project.id) : (state.projectId ?? missingProject), workspaceAddress);
  }, [demoMode, pageBase, workspace, missingProject, readAddress, workspaceAddress]);
  const navKey = JSON.stringify(navState);
  const routeKey = JSON.stringify({ ...navState, fanout: { selected: fanoutNavigation.selected, term: fanoutNavigation.term } });
  const previousRouteKey = useRef(routeKey);
  useEffect(() => {
    const address = addressOf({ ...(JSON.parse(navKey) as NavState), listScroll: promptReturnScroll.current }, true);
    if (address !== `${window.location.pathname}${window.location.search}`) {
      const method =
        !workspace || !navigationReady.current || restoringHistory.current || previousRouteKey.current === routeKey
          ? 'replaceState'
          : 'pushState';
      window.history[method](null, '', address);
    }
    if (tab !== 'settings' && tab !== 'admin') {
      queueMicrotask(() => setReturnToApp(address));
      try { sessionStorage.setItem(`lastfind:settings-return:${pageBase}`, address); } catch { /* In-memory fallback. */ }
    }
    previousRouteKey.current = routeKey;
    if (workspace) navigationReady.current = true;
    restoringHistory.current = false;
  }, [workspace, navKey, routeKey, tab, pageBase, addressOf]);
  const mutate = async (
    path: string,
    method: string,
    data: unknown,
    selected = projectId,
  ) => {
    setBusy(true);
    setError('');
    try {
      const result = await request(path, method, data);
      // A new workspace address: the next requests (the refresh below) name it, the old one no longer opens the workspace.
      if (path === '/api/workspace/slug' && result && typeof (result as { slug?: unknown }).slug === 'string') setRequestWorkspace((result as { slug: string }).slug);
      // Workspace only: selective cache drop already happened; do not remount every tab.
      await refresh(selected, false);
      setTopic('');
      if ((path === '/api/prompts' && method === 'POST') || (editingPrompt && path === `/api/prompts/${encodeURIComponent(editingPrompt.id)}` && method === 'PATCH')) {
        setAddOpen(false);
        setEditingPrompt(null);
      }
      return result ?? true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  // Drill down: any target keeps the project, period and filters and changes only what it names.
  const resolveTarget = (target: DrillTarget) => {
    const changing = target.tab !== undefined && target.tab !== tab;
    const nextTab = (target.tab ?? tab) as Tab;
    return {
      ...navState,
      tab: nextTab,
      entity: 'entity' in target ? (target.entity ?? null) : changing ? null : entity,
      runRoute: 'run' in target ? (target.run ?? null) : changing ? null : runRoute,
      promptRoute: 'prompt' in target ? (target.prompt ?? null) : changing ? null : promptRoute,
      brandFilter: 'brand' in target ? (target.brand ?? '') : changing ? '' : brandFilter,
      responseCites: 'cites' in target ? (target.cites ?? '') : changing ? '' : responseCites,
      brandLabel: 'brand' in target ? (target.brandLabel ?? '') : changing ? '' : brandLabel,
      responseSentiment: 'sentiment' in target ? (target.sentiment ?? '') : 'brand' in target || changing ? '' : responseSentiment,
      // A day (or week, month) of a chart: the period becomes that range.
      ...(target.range ? { startDate: target.range.start, endDate: target.range.end } : {}),
      brandPage: 'brandPage' in target ? (target.brandPage ?? null) : changing ? null : brandPage,
      productDetail: 'productDetail' in target ? (target.productDetail ?? null) : changing ? null : productDetail,
      comparisonView: 'comparisonView' in target ? (target.comparisonView ?? null) : changing ? null : comparisonView,
      aiBotsView: 'aiBotsView' in target ? (target.aiBotsView ?? null) : changing ? null : aiBotsView,
      responseMention: target.mention ?? (changing ? 'all' : responseMention),
      engineFilter: target.engine ?? engineFilter,
      topicFilter: 'topic' in target ? (target.topic ?? '') : topicFilter,
      tagFilter: target.tags ?? tagFilter,
      queryText: target.query ?? queryText,
      typeFilter: 'type' in target ? (target.type ?? '') : changing ? '' : typeFilter,
      ownerFilter: 'owner' in target ? (target.owner ?? '') : changing ? '' : ownerFilter,
      sourceOrigin: target.origin ?? (changing ? 'all' : sourceOrigin),
      sourceGroup: target.group ?? sourceGroup,
      sourceKind: target.kind ?? sourceKind,
      // `section` names a Settings section or an Admin page, whichever the target opens.
      settingsSection: nextTab === 'settings' ? ((target.section as SettingsSection | undefined) ?? settingsSection) : settingsSection,
      adminPage: nextTab === 'admin' && target.section ? adminPageFor(target.section, adminPages) : adminPage,
      brandView: target.brandView ? parseBrandReportView(target.brandView) : brandView,
      fanout: 'fanoutTerm' in target
        ? { ...fanoutNavigation, selected: null, page: 1, term: target.fanoutTerm ?? null }
        : target.fanoutQuery
          ? { ...fanoutNavigation, selected: target.fanoutQuery }
          : fanoutNavigation,
    } satisfies NavState;
  };
  const navigate = (target: DrillTarget) => {
    if (settingsDirty && (target.tab !== tab || target.section !== settingsSection)) { guardSettingsNavigation(() => { clearSettingsDirty(); applyNavigation(target); }); return; }
    applyNavigation(target);
  };
  const applyNavigation = (target: DrillTarget) => {
    const next = resolveTarget(target);
    setTab(next.tab);
    setAdminDenied(false);
    setDetail(null);
    setEntity(next.entity);
    setRunRoute(next.runRoute);
    setPromptRoute(next.promptRoute);
    setBrandFilter(next.brandFilter);
    setResponseCites(next.responseCites);
    setBrandLabel(next.brandLabel);
    setResponseSentiment(next.responseSentiment);
    setStartDate(next.startDate);
    setEndDate(next.endDate);
    setBrandPage(next.brandPage);
    setProductDetail(next.productDetail);
    setComparisonView(next.comparisonView);
    setAiBotsView(next.aiBotsView);
    setResponseMention(next.responseMention);
    setEngineFilter(next.engineFilter);
    setTopicFilter(next.topicFilter);
    setTagFilter(next.tagFilter);
    setQuery(next.queryText);
    setTypeFilter(next.typeFilter);
    setOwnerFilter(next.ownerFilter);
    setSourceOrigin(next.sourceOrigin);
    setSourceGroup(next.sourceGroup);
    setSourceKind(next.sourceKind);
    setSettingsSection(next.settingsSection);
    setAdminPage(next.adminPage);
    setBrandView(next.brandView);
    if (projectId && next.fanout !== fanoutNavigation) setFanoutByProject((states) => ({ ...states, [projectId]: next.fanout }));
    if (next.tab !== tab || next.typeFilter !== typeFilter || next.ownerFilter !== ownerFilter || next.sourceGroup !== sourceGroup || next.sourceOrigin !== sourceOrigin) setSourcePage(1);
    setMobileFiltersOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const link: Linker = (target) => {
    return {
      href: addressOf(resolveTarget(target)),
      onClick: (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(target);
      },
    };
  };
  // Runs point at a collection subscription; prompt pages are addressed by their logical question.
  const promptUnit = (promptId: string) =>
    workspace?.prompts.find((item) => item.id === promptId || item.subscription_ids?.includes(promptId))?.id ?? promptId;
  // A product's, an attribute's or a persona's page in Comparison (comparisonView `<section>/<id>`).
  const comparisonDetail = tab === 'comparison' ? comparisonDetailOf(comparisonView) : null;
  const detailCrumb =
    tab === 'sources' && entity
      ? entity.key.replace(/^https?:\/\//, '')
      : tab === 'responses' && runRoute
        ? (detail?.prompt_text ?? '…')
        : tab === 'prompts' && selectedPrompt
          ? selectedPrompt.text
          : tab === 'competitors' && brandPage
            ? (() => {
                const current = workspace?.projects.find((item) => item.id === projectId);
                return brandPathLabel(brandPage, [
                  brandPageTitle,
                  current?.name,
                  ...(current?.competitors.map((item) => item.name) ?? []),
                ]);
              })()
            : tab === 'products' && productDetail && isProductDetail(productDetail)
              ? (productTitle ?? productDetail.replace(/^brands\//, '').replace(/-/g, ' '))
              : null;
  const project = workspace?.projects.find((item) => item.id === projectId);
  // The open project's address (its Overview): the Agent's links and Ask Lastfind's new window start with it.
  const projectHref = project ? compactAppPath(new URLSearchParams(), project.slug ?? project.id, workspaceAddress) : addressBase.slice(0, -1);
  const promptsGroup = (promptsTabs as readonly Tab[]).includes(tab);
  const agentGroup = (agentTabs as readonly Tab[]).includes(tab);
  // Agent > Chat opens with its conversations already read: once the project is known, after the screen's own reads.
  const agentProject = project && workspace?.capabilities.agent && !demoMode ? project.id : null;
  useEffect(() => {
    if (!agentProject) return;
    const timer = window.setTimeout(() => prefetchConversations(agentProject), 500);
    return () => window.clearTimeout(timer);
  }, [agentProject]);
  // Agent: a conversation opened from a list, and a request taken to the chat (Agent > Contents: sent at once, or left
  // in the box to finish).
  const toChat = (conversation: string | null, artifact?: string) => {
    const params = new URLSearchParams(window.location.search);
    for (const key of ['conversation', 'artifact', 'new']) params.delete(key);
    if (conversation) params.set('conversation', conversation);
    if (artifact) params.set('artifact', artifact);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}`);
    navigate({ tab: 'agent' });
  };
  const openConversation = (id: string) => toChat(id);
  // Agent > Contents and Agent > Artifacts from the sidebar are always the list, never the artifact (or the wizard) open there
  // or beside a chat: an artifact opens only from its link or a click.
  const [listVisit, setListVisit] = useState(0);
  const listLink = (id: 'artifacts' | 'contents'): ReturnType<Linker> => {
    const base = link({ tab: id, entity: null, prompt: null, run: null });
    return {
      href: base.href,
      onClick: (event) => {
        base.onClick(event);
        if (!event.defaultPrevented) return;
        const params = new URLSearchParams(window.location.search);
        params.delete('artifact');
        params.delete('new');
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}`);
        setListVisit((visit) => visit + 1);
      },
    };
  };
  const setContentMode = (mode: ContentMode | null) => project ? mutate(`/api/projects/${encodeURIComponent(project.id)}`, 'PATCH', { agent_content_mode: mode }).then(Boolean) : Promise.resolve(false);
  const createContent = project ? (
    <CreateContentButton
      mode={project.agent_content_mode ?? null}
      disabled={busy}
      onRemember={(mode) => void setContentMode(mode)}
      onStart={(mode) => {
        // Both ways start in Agent > Contents: the wizard, or (the chat) the new content with its chat beside it.
        const params = new URLSearchParams(window.location.search);
        params.set('new', mode === 'chat' ? 'chat' : '1');
        window.history.pushState(window.history.state, '', `${window.location.pathname}?${params}`);
        window.dispatchEvent(new Event(NEW_CONTENT_EVENT));
      }}
    />
  ) : null;
  // The chat and its artifacts filter nothing; Opportunities is a report of the period and its filters.
  const agentScreen = agentGroup && tab !== 'opportunities';
  // The header's period control: the header, and the agent's message box (the chat has no header), share one period.
  const periodPicker = (
    <DateRangePicker
      value={{ days, from: startDate || undefined, to: endDate || undefined }}
      bounds={periodBounds}
      comparison={comparison}
      onChange={(period, nextComparison) => {
        setDays(period.days === 'custom' ? '28' : period.days);
        setStartDate(period.from || '');
        setEndDate(period.to || '');
        setComparison(nextComparison);
      }}
    />
  );
  // While the workspace loads, a prompt in the address is already its page.
  const promptDetail = workspace ? Boolean(selectedPrompt) : Boolean(promptRoute);
  // A prompt address that names no prompt of the project: its not-found state in place of the list.
  const promptMissing = !!workspace && tab === 'prompts' && !!promptRoute && !selectedPrompt;
  const listScreen = (tab === 'prompts' && !promptDetail) || (tab === 'responses' && !runRoute) || (tab === 'sources' && !entity) ||
    (tab === 'competitors' && !brandPage) || tab === 'models' || tab === 'fanout' || tab === 'agent' || tab === 'opportunities' || tab === 'products' || (tab === 'comparison' && !!comparisonView && !comparisonDetail) || tab === 'artifacts' || tab === 'contents' || tab === 'skills';
  const tableListScreen = Boolean(project) && !creatingProject && listScreen;
  // An Admin page that is a list screen (Workspaces): full-bleed like Brands, titled by the top bar alone.
  const adminList = tab === 'admin' && !creatingProject && !!adminPages.find((page) => page.id === adminPage)?.list;
  const settingsScope = settingsSection === 'profile'
    ? { id: 'account' as const, label: ['Account', 'Conta'] as [string, string] }
    : settingsSectionGroups.find((group) => group.sections.some((section) => section.id === settingsSection));
  const settingsDescriptions: Record<SettingsSection, [string, string]> = {
    workspace: ['Define how your brand is recognized in AI answers.', 'Defina como sua marca é reconhecida nas respostas de IA.'],
    competitors: ['Manage the brands you compare with your own.', 'Gerencie as marcas que você compara com a sua.'],
    monitoring: ['Choose when and where to monitor your visibility.', 'Escolha quando e onde monitorar sua visibilidade.'],
    semantic: ['Configure the attributes behind your brand perception.', 'Configure os atributos da percepção da sua marca.'],
    'ai-bots': ['Connect your site to see the AI bots that read it and the visits AI answers send.', 'Conecte o seu site para ver os robôs de IA que o leem e as visitas que as respostas de IA mandam.'],
    agent: ['Choose how the agent helps this project create content.', 'Escolha como o agente ajuda este projeto a criar conteúdo.'],
    data: ['Make, download and restore backups of this project.', 'Gere, baixe e restaure backups deste projeto.'],
    projects: ['Organize your projects in this workspace.', 'Organize seus projetos neste workspace.'],
    members: ['Review the people and permissions in this workspace.', 'Confira as pessoas e permissões deste workspace.'],
    connections: ['Connect Claude, ChatGPT, Cursor and other AI apps to your reports.', 'Conecte Claude, ChatGPT, Cursor e outros apps de IA aos seus relatórios.'],
    profile: ['Your photo, your details and the interface language.', 'Sua foto, seus dados e o idioma da interface.'],
  };
  // A workspace section names the workspace it changes, as a project section names its project.
  const settingsCurrentWorkspace = workspace?.workspaces?.find((item) => item.current);
  const settingsScopeName = settingsScope?.id === 'project'
    ? (project ? projectLabel(project) : t('No project yet', 'Nenhum projeto ainda'))
    : settingsScope?.id === 'account'
      ? workspace?.user.name || workspace?.user.email || ''
      : settingsScope?.id === 'workspace' && settingsCurrentWorkspace?.role !== 'owner'
        ? settingsCurrentWorkspace?.name ?? ''
        : '';
  // The scope's label only with a name it introduces: a workspace section already says "this workspace", so it names only
  // someone else's workspace; "… this workspace. Workspace" (no name) or "Workspace: Your workspace" would repeat it.
  const settingsDescription = `${t(...settingsDescriptions[settingsSection])}${settingsScope && settingsScopeName ? ` ${t(...settingsScope.label)}: ${settingsScopeName}` : ''}`;
  // Settings and Admin: no project filters, no export, a centered column and their own sidebar navigation.
  const fullPage = tab === 'settings' || tab === 'admin';
  // The sidebar's links fade in only when they swap (app and Settings), never on the first paint: a page drawn without
  // running animations (a screenshot, a print) would keep them half faded.
  const sidebarKey = fullPage ? tab : 'app';
  const [navSwap, setNavSwap] = useState({ key: sidebarKey, swapped: false });
  if (navSwap.key !== sidebarKey) setNavSwap({ key: sidebarKey, swapped: true });
  const navFade = navSwap.swapped || navSwap.key !== sidebarKey;
  const adminCopy = adminPageCopy[adminPage];
  // Cloud: the workspace this page acts in. Its owner names a new one in the workspace wizard before its first project, unless
  // they were invited elsewhere and that workspace opens instead (the effect above); an admin opens it from its address too.
  const currentChoice = !demoMode ? workspace?.workspaces?.find((item) => item.current) : undefined;
  const leavingForInvitation = !!workspace?.workspaces?.some((item) => !item.current) && typeof document !== 'undefined' && !document.cookie.includes('lastfind_workspace=');
  const showWorkspaceWizard = !!workspace && !!currentChoice && !workspaceNamed && (currentChoice.role === 'owner' || currentChoice.role === 'admin') &&
    (settingUpWorkspace || (!!currentChoice.unnamed && currentChoice.role === 'owner' && !workspace.projects.length && !leavingForInvitation));
  // The top bar's path: the earlier crumbs muted (a link where they lead somewhere), the screen or item last.
  const topbarCrumbs: { label: string; to?: DrillTarget }[] = creatingProject || (workspace && !project && !(tab === 'settings' || tab === 'admin'))
    ? [{ label: creatingWorkspace ? t('New workspace', 'Novo workspace') : showWorkspaceWizard ? t('Workspace', 'Workspace') : t('New project', 'Novo projeto') }]
    : detailCrumb
    ? [{ label: t(...label[tab]), to: { entity: null, run: null, prompt: null, brandPage: null, productDetail: tab === 'products' ? PRODUCT_SECTIONS[productSection(productDetail)].page : null } }, { label: detailCrumb }]
    : tab === 'settings'
      ? [{ label: t(...label.settings) }, { label: t(...(settingsSections.find((section) => section.id === settingsSection)?.label ?? label.settings)) }]
      : tab === 'admin'
        ? [{ label: t(...label.admin) }, { label: t(...adminCopy.label) }]
        : (agentTabs as readonly Tab[]).includes(tab)
          ? [{ label: t('Agent', 'Agente') }, { label: t(...label[tab]) }]
          : tab === 'products'
            ? [{ label: t(...label.products) }, { label: t(...PRODUCT_SECTIONS[productSection(productDetail)].label) }]
            : tab === 'comparison' && comparisonDetail
              ? [{ label: t(...label.comparison), to: { comparisonView: null } }, { label: t(...COMPARISON_SECTIONS[comparisonDetail.section].label), to: { comparisonView: COMPARISON_SECTIONS[comparisonDetail.section].page } }, { label: comparisonTitle ?? '…' }]
            : tab === 'comparison'
              ? [{ label: t(...label.comparison) }, { label: t(...COMPARISON_SECTIONS[comparisonSection(comparisonView)].label) }]
              : tab === 'ai-bots'
                ? [{ label: t(...label['ai-bots']) }, { label: t(...AI_BOTS_SECTIONS[aiBotsSection(aiBotsView)].label) }]
                : [{ label: t(...label[tab]) }];

  const headerScope = { topic: topicFilter, tags: tagFilter, engine: engineFilter };
  const filteredPrompts =
    workspace?.prompts.filter(
      (item) =>
        (statusFilter === 'archived'
          ? item.archived
          : !item.archived &&
            (statusFilter === 'active' ? item.active : !item.active)) &&
        (!queryText ||
          `${item.text} ${item.tag} ${item.tags.join(' ')}`
            .toLowerCase()
            .includes(queryText.toLowerCase())) &&
        inHeaderFilters(item, headerScope),
    ) ?? [];
  const importPreview = useMemo(() => {
    try { return { rows: parseDemoPromptImport(importText), error: '' }; }
    catch (cause) { return { rows: [], error: cause instanceof Error ? cause.message : String(cause),
      }; }
  }, [importText]);
  // Each status tab counts the prompts the header's topic, tags and models leave, as the list and the reports do.
  const promptStatusCount = (status: typeof statusFilter) =>
    workspace?.prompts.filter((item) =>
      (status === 'archived' ? item.archived : !item.archived && (status === 'active' ? item.active : !item.active)) &&
      inHeaderFilters(item, headerScope),
    ).length ?? 0;
  // Same tab: the last report stays while the next filters load (avoids card/table jump), never after: a read that failed
  // leaves no report rather than another filter's numbers under this header.
  const currentReport = cachedReport ?? (report != null && (reportKey === `${tab}|${filterQuery}` || (reportLoading && reportKey?.startsWith(`${tab}|`))) ? report : null);
  const summary = tab === 'overview' ? (currentReport as SummaryReport | null) : null;
  // A project's first collection under way (12/11/2026): answers in flight and none complete yet. Its active prompts, or 0.
  const firstCollection = project && !demoMode && workspace?.monitoring && workspace.monitoring.pending > 0 && !workspace.monitoring.last && !summary?.metrics.responses
    ? Math.max(1, workspace.prompts.filter((item) => item.project_id === project.id && item.active && !item.archived).length)
    : 0;
  // Both Overview reads start with the screen, beside the reports, not after the summary has arrived.
  const sentiment = useOverviewSentiment({
    projectId: tab === 'overview' && workspaceReady ? project?.id ?? null : null,
    filters: filterQuery,
    refresh: cache.generation,
    demo: demoMode,
    request,
  });
  // A new project's first answers being processed (13/11/2026: its position read "Not measured" and its sentiment "Not evaluated" until
  // a manual refresh): within its first collection interval, while answers are in flight, collected but not yet in its reports, or
  // naming the brand without their sentiment. Its figures read as on their way meanwhile.
  const firstInterval = !!project && !demoMode && openedAt - Date.parse(project.created_at) < project.interval_hours * 3_600_000;
  const processing = firstInterval && !!workspace?.monitoring && (workspace.monitoring.pending > 0 || !!workspace.monitoring.unpublished);
  const evaluating = firstInterval && !!project && awaitingEvaluation(sentiment.report, project.name);
  // Meanwhile the Overview follows it: the workspace every minute and, when it moved or a sentiment is awaited, the reports read again in
  // place (no skeleton).
  const settlingProject = (firstCollection || processing || evaluating) && tab === 'overview' ? project?.id ?? null : null;
  const monitoringNow = useRef(workspace?.monitoring);
  const evaluatingNow = useRef(evaluating);
  useEffect(() => {
    monitoringNow.current = workspace?.monitoring;
    evaluatingNow.current = evaluating;
  }, [workspace?.monitoring, evaluating]);
  useEffect(() => {
    if (!settlingProject) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const before = monitoringNow.current;
      void refresh(settlingProject, false).then((data) => {
        const after = data?.monitoring;
        if (!after) return;
        if (after.pending !== before?.pending || after.last !== before?.last || !!after.unpublished !== !!before?.unpublished || evaluatingNow.current) cache.revalidate();
      }, () => {});
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [settlingProject, refresh, cache]);
  // The header's Brands filter decides which brands the reports list; their numbers stay the same.
  const listedBrands = readBrandFilter(brandsFilter);
  const brandFiltering = brandFilterActive(listedBrands);
  const monitoredListed = (name: string) => name === project?.name || brandShown(listedBrands, brandKey(name), 'monitored');
  const brandListed = (name: string, monitored: boolean) => (monitored ? monitoredListed(name) : brandShown(listedBrands, brandKey(name), 'discovered'));
  const [brandMenuOpened, setBrandMenuOpened] = useState(false);
  // The menu never waits on a click: its discoveries are read shortly after the screen's own reads (or when it opens first),
  // through the cache, which keeps them in the tab for the next visit (analytics-cache.ts).
  useEffect(() => {
    if (!workspaceReady || brandMenuOpened) return;
    const timer = window.setTimeout(() => setBrandMenuOpened(true), 1000);
    return () => window.clearTimeout(timer);
  }, [workspaceReady, brandMenuOpened]);
  // The discoveries it lists: read early (above), and on the screens that name them by key.
  const brandChoicesRead = useReport<{ rows: BrandRow[] }>(
    project && workspaceReady && (brandMenuOpened || brandFiltering || tab === 'responses' || (tab === 'prompts' && !!promptRoute))
      ? discoveriesReadPath(project.id)
      : null,
    dataRevision,
    request,
  );
  const discoveredChoices: BrandChoice[] | null | 'failed' = brandChoicesRead.data
    ? brandChoicesRead.data.rows.map((row) => ({ key: row.key, name: row.name, domain: row.domain ?? '', kind: 'discovered' as const }))
    : brandChoicesRead.error ? 'failed' : null;
  const discoveredNames = new Map(Array.isArray(discoveredChoices) ? discoveredChoices.map((brand) => [brand.key, brand]) : []);
  // The response detail's brands as the filter lists them: a monitored one by its name, any other as a discovery.
  const answerBrandsListed = (detail?.brands ?? []).filter((brand) => brandListed(brand.name, brand.role === 'tracked'));
  // A Responses row's brands as the filter lists them: the monitored ones it mentions, then the discovered competitors among
  // the 50 most mentioned, most mentioned first (a discovery beyond them has no name here). `filter` opens their answers.
  const runBrands = (run: Run) => [
    ...Object.entries(run.mentions || {}).filter(([name, value]) => value && monitoredListed(name)).map(([name]) => ({ name, filter: name, label: null })),
    ...[...discoveredNames.values()].filter((brand) => run.discovered?.includes(brand.key) && brandShown(listedBrands, brand.key, 'discovered')).map((brand) => ({ name: brand.name, filter: brand.key, label: brand.name })),
  ];
  const discoveries = useBrandDiscoveries({
    project,
    enabled: tab === 'overview' && workspaceReady,
    refresh: dataRevision,
    request,
    t,
    shown: brandFiltering ? { brand: (key) => brandShown(listedBrands, key, 'discovered'), picked: listedBrands.base === 'picked' } : undefined,
  });
  // Discovered brands have daily mention counts of every answer only: with a model, topic, tag or text filter they would not
  // match the report's answers, so the ranking and the chart leave them out; otherwise they count in the report's own window.
  const discoveredMeasured = engineFilter === 'all' && !topicFilter && !tagFilter && !responseQuery;
  // They have no positions; their share of voice is in the card's universe (every identified brand), so they chart it too.
  const discoveredCharted = overviewChart !== 'position' && discoveredMeasured;
  const discoveredSeries = discoveredCharted
    ? discoveries.brands.filter((brand) => Object.keys(brand.days).length > 0).map((brand) => ({ brand, key: `disc:${brand.key}` }))
    : [];
  const overviewChartBrands = project && summary ? [
    { id: project.domain, key: overviewChart === 'shareOfVoice' ? 'sov' : overviewChart === 'position' ? 'position' : 'brand', name: project.name,
      color: seriesColorVar(project.name, project.name, project.competitors.map((item) => item.name)), primary: true, icon: <SiteFavicon domain={project.domain} name={project.name} /> },
    ...project.competitors.map((item, index) => ({
      id: item.domain, key: overviewChart === 'shareOfVoice' ? `sovC${index}` : overviewChart === 'position' ? `positionC${index}` : `c${index}`,
      name: item.name, color: seriesColorVar(item.name, project.name, project.competitors.map((item) => item.name)), primary: false,
      icon: <SiteFavicon domain={item.domain} name={item.name} />,
    })),
    ...discoveredSeries.map(({ brand, key }) => ({
      id: `discovered:${brand.key}`, key: overviewChart === 'shareOfVoice' ? `sov:${key}` : key, name: brand.name,
      color: seriesColorVar(brand.name, project.name, [...project.competitors.map((item) => item.name), ...discoveredSeries.map((item) => item.brand.name)]), primary: false,
      icon: <SiteFavicon domain={brand.domain} name={brand.name} />,
    })),
  ] : [];
  const overviewCompetitorCount = project?.competitors.length ?? 0;
  const overviewTrend = summary ? summaryTrend(summary, overviewResolution, overviewCompetitorCount, discoveredSeries.map(({ brand, key }) => ({ key, days: brand.days }))) : [];
  const overviewTotals = new Map(overviewChartBrands.map((brand, index) => {
    const sum = (key: string) => overviewTrend.reduce((total, row) => total + Number(row[key] ?? 0), 0);
    if (brand.id.startsWith('discovered:')) return [brand.key, extraPeriodShare(overviewTrend, brand.key.replace(/^sov:/, ''), overviewChart === 'shareOfVoice')] as const;
    const suffix = index ? `C${index - 1}` : '';
    // Share of voice counts only the answers the brand analysis read (`voiceMentions`, run-rows voiceSql).
    const numerator = overviewChart === 'position' ? `positionSum${suffix}` : overviewChart === 'shareOfVoice' ? voiceField(overviewTrend, `mentions${suffix}`) : `mentions${suffix}`;
    const denominator = overviewChart === 'position' ? `positionSamples${suffix}` : overviewChart === 'shareOfVoice' ? 'totalMentions' : 'responses';
    const total = sum(denominator);
    return [brand.key, total ? sum(numerator) / total : null] as const;
  }));
  // The ranking follows the trend's metric (one toggle for both cards) over the same period: share of voice and position are
  // the chart's summed counts over its summed denominator, as the cards compute them; visibility is the report's.
  const chartKeys = new Map(overviewChartBrands.map((brand) => [brand.id, brand.key]));
  const rankingValue = (key: string, visibility: number | null) => {
    if (overviewChart === 'visibility') return visibility;
    const value = overviewTotals.get(chartKeys.get(key) ?? '');
    return value == null ? null : overviewChart === 'shareOfVoice' ? value * 100 : value;
  };
  const rankingLabel = overviewChart === 'shareOfVoice' ? t('Share of voice', 'Share of voice') : overviewChart === 'position' ? t('Average position', 'Posição média') : t('Visibility', 'Visibilidade');
  // As many brands as fill the card beside the brand trend (6 in one column).
  const [rankingTable, rankingFit] = useRowsThatFit(6);
  const rankingRows: {
    key: string;
    name: string;
    domain: string;
    /** Mentions: only the ranking's tiebreaker, never shown on the Overview (since 10/11/2026). */
    count: number | null;
    value: number | null;
    discovered?: DiscoveredBrand;
    rank: number;
  }[] = summary
    ? cutBrandRanking(
        [
          ...summary.leaderboard.filter((item) => item.domain === project?.domain || monitoredListed(item.name)).map((item) => ({
            key: item.domain,
            name: item.name,
            domain: item.domain,
            count: item.count,
            value: rankingValue(item.domain, item.visibility),
          })),
          ...(discoveredMeasured ? discoveries.brands : []).map((brand) => {
            const period = discoveredInPeriod(summary, brand.days);
            return {
              key: `discovered:${brand.key}`,
              name: brand.name,
              domain: brand.domain,
              count: period.mentions,
              value: rankingValue(`discovered:${brand.key}`, period.visibility),
              discovered: brand,
            };
          }),
        ].sort(byRankingValue(overviewChart === 'position')),
        (item) => item.domain === project?.domain,
        rankingFit,
      ).map(({ row, rank }) => ({ ...row, rank }))
    : [];
  // Most cited domains and pages beside the Site and Content types donuts: the rows that fill the height the donut's whole legend
  // gives the row (12/11/2026: the donut card no longer scrolls inside; 5 in one column).
  const [domainsTable, domainsFit] = useRowsThatFit(5);
  const [pagesTable, pagesFit] = useRowsThatFit(5);
  // Query Fan Out beside Top terms: as many queries as fill the card (12/11/2026: it ended in blank space; 5 in one column).
  const [fanoutTable, fanoutFit] = useRowsThatFit(5);
  const fanoutRows = orderSeriesByTotal(overviewFanout?.queries ?? [], (row) => row.occurrences).slice(0, fanoutFit);
  // The brand trend draws the Brand ranking's brands, in its order (12/11/2026): one set for both cards of the row, so the chart
  // never names a brand the ranking beside it leaves out. A brand the chart cannot draw (a discovery has no position) is skipped.
  const chartById = new Map(overviewChartBrands.map((brand) => [brand.id, brand]));
  const orderedChartBrands = rankingRows.flatMap((row) => chartById.get(row.key) ?? []);
  // By default the chart draws at most CHART_SERIES_COUNT (10) of them: the project's own and the others with the most
  // mentions in the period; the legend turns any brand on or off.
  const overviewShown = defaultShownSeries(orderedChartBrands, (brand) => {
    const index = overviewChartBrands.indexOf(brand);
    const field = brand.id.startsWith('discovered:') ? `x:${brand.key.replace(/^sov:/, '')}` : `mentions${index ? `C${index - 1}` : ''}`;
    return overviewTrend.reduce((total, row) => total + Number(row[field] ?? 0), 0);
  });
  const hiddenChartBrands = orderedChartBrands.filter((brand) => !(chartBrandChoices[brand.id] ?? overviewShown.has(brand.id))).map((brand) => brand.id);
  // The hidden ones nobody turned off wait behind the legend's "+N": the legend names only the ten the chart draws.
  const foldedChartBrands = hiddenChartBrands.filter((id) => !(id in chartBrandChoices));
  const visibleChartBrands = orderedChartBrands.filter((brand) => !hiddenChartBrands.includes(brand.id));
  const overviewMetric = overviewChart as TrendMetric;
  const overviewScale = getTrendScale(overviewTrend, visibleChartBrands.map((brand) => brand.key), overviewMetric);
  const [showAllSources, setShowAllSources] = useState(false);
  const promptUnanswered = !!detailReport && 'daily' in detailReport && !(detailReport.metrics?.responses ?? detailReport.platforms.reduce((sum, row) => sum + row.responses, 0));
  const promptNow = detailReport && 'daily' in detailReport
    ? { responses: detailReport.metrics?.responses ?? detailReport.platforms.reduce((sum, row) => sum + row.responses, 0), mentions: detailReport.metrics?.mentions ?? detailReport.platforms.reduce((sum, row) => sum + row.mentions, 0), visibility: detailReport.metrics?.visibility ?? 0, position: detailReport.metrics?.position ?? null }
    : { responses: 0, mentions: 0, visibility: 0, position: null };
  const promptBefore = detailReport && 'daily' in detailReport ? detailReport.previous : undefined;
  // The change beside each figure, only against an earlier period with enough answers (lib/period-coverage); why there is
  // none goes in the card's info balloon (rule 8), never as a line under every card.
  const promptCovered = !compared.off && coveredPeriods(promptBefore?.responses, promptNow.responses);
  const promptDelta = (now: number, before: number | null | undefined, unit: '' | ' pp', invert = false) =>
    promptCovered && before != null ? <Change value={now - before} unit={unit} locale={locale} invert={invert} {...(unit ? {} : { margin: 0 })} /> : undefined;
  const promptWhy = (definition: string, before?: number | null) =>
    promptUnanswered
      ? `${definition} ${t('No answer collected yet for this prompt in the period.', 'Nenhuma resposta coletada ainda para este prompt no período.')}`
      : compared.off || (promptCovered && before != null)
        ? definition
        : `${definition} ${
            !promptBefore?.responses
              ? t(`No answers in ${compared.period}.`, `Sem respostas no ${compared.period}.`)
              : !promptCovered
                ? thinPeriodNote(t, compared.period, formatNumber(locale, promptBefore.responses), formatNumber(locale, promptNow.responses))
                : t(`Not measured in ${compared.period}.`, `Não medido no ${compared.period}.`)
          }`;
  const promptTrend = detailReport && 'daily' in detailReport ? detailReport.daily.filter((row) => row.responses > 0) : [];
  const promptScale = getTrendScale(promptTrend, ['visibility'], 'visibility');
  const hasChartData = overviewTrend.some((row) => visibleChartBrands.some((brand) => row[brand.key] != null));
  const promptStats =
    tab === 'prompts' ? (currentReport as PromptReport | null) : null;
  // Prompts are ordered as a whole list (visibility and position come from the report) before they are paged.
  const [promptSort, setPromptSort] = useState<DataSort>();
  const promptSentimentQuery = useMemo(() => {
    // Not before the workspace is ready: the demo transport answers "not ready" then, and a read is not repeated.
    if (tab !== 'prompts' || !projectId || !workspaceReady) return null;
    return researchReadPath(demoMode, projectId, filterQuery);
  }, [tab, projectId, filterQuery, demoMode, workspaceReady]);
  const promptSentimentRemote = useKeptReport<BrandResearchReport>(promptSentimentQuery, promptSentimentQuery && !demoMode ? `lastfind:brand-research:${promptSentimentQuery}` : null, cache.generation, request);
  // The server's verdict per question for the project brand, composed across models as the Overview score is.
  const promptSentimentByUnit = new Map<string, number>();
  for (const [unitId, reading] of Object.entries(promptSentimentRemote.data?.units ?? {})) {
    const score = sentimentScore(reading);
    if (score != null) promptSentimentByUnit.set(unitId, score);
  }
  const promptSortValue = {
    prompt: (item: Prompt) => item.text,
    models: (item: Prompt) => (item.engines ?? [item.engine]).length,
    tags: (item: Prompt) => item.tags[0],
    visibility: (item: Prompt) => (promptStats?.[item.id]?.responses ? promptStats[item.id].visibility : null),
    shareOfVoice: (item: Prompt) => promptStats?.[item.id]?.shareOfVoice ?? null,
    sentiment: (item: Prompt) => promptSentimentByUnit.get(item.id) ?? null,
    position: (item: Prompt) => promptStats?.[item.id]?.position,
  };
  // The filter panel's conditions over the header-filtered list; metric conditions wait for their report.
  const promptMatches = (filters: PromptFilters) => (item: Prompt) => matchesPromptFilters(
    filters,
    { createdAt: item.created_at, metric: promptStats?.[item.id] ?? null, sentiment: promptSentimentByUnit.get(item.id) ?? null },
    { metrics: Boolean(promptStats), sentiment: !promptSentimentRemote.loading },
  );
  // Only competitors: the report then counts only answers without the brand, so a prompt it does not list has none.
  const promptsAfter = (list: Prompt[], filters: PromptFilters) =>
    (filters.gap ? list.filter((item) => (promptStats?.[item.id]?.responses ?? 0) > 0) : list).filter(promptMatches(filters));
  const orderedPrompts = sortRows(
    promptsAfter(filteredPrompts, promptFilters),
    Object.entries(promptSortValue).map(([key, sortValue]) => ({ key, sortValue })),
    promptSort,
  );
  const promptPage = useCollectionPage(
    orderedPrompts,
    `${projectId}|${queryText}|${topicFilter}|${tagFilter}|${engineFilter}|${JSON.stringify(promptFilters)}|${promptSort?.key}|${promptSort?.direction}`,
    25,
    t,
    '',
    { page: promptListPage, onPage: setPromptListPage },
  );
  const visiblePrompts = promptPage.rows;
  const promptScope = `${projectId}|${queryText}|${topicFilter}|${tagFilter}|${engineFilter}|${JSON.stringify(promptFilters)}|${promptSort?.key}|${promptSort?.direction}`;
  useEffect(() => {
    if (!workspace) return;
    const changed =
      promptScopeRef.current !== null && promptScopeRef.current !== promptScope;
    promptScopeRef.current = promptScope;
    const page = changed ? 1 : promptPage.page;
    if (page !== promptListPage) queueMicrotask(() => setPromptListPage(page));
  }, [workspace, promptScope, promptPage.page, promptListPage]);
  useEffect(() => {
    queueMicrotask(() => setSelectedPrompts([]));
  }, [
    promptPage.page,
    projectId,
    queryText,
    topicFilter,
    tagFilter,
    engineFilter,
    statusFilter,
  ]);
  const selectedVisiblePrompts = visiblePrompts.filter((item) => selectedPrompts.includes(item.id),
  );
  const history = tab === 'responses' ? (currentReport as HistoryPage | null) : null;
  const currentHistory =
    responsePage === 1 ? history : historyPages[responsePage - 2];
  const sources = tab === 'sources' ? (currentReport as SourcesPage | null) : null;
  const brands =
    tab === 'competitors' ? (currentReport as CompetitorsReport | null) : null;
  const models = tab === 'models' ? (currentReport as AnalysisReport | null) : null;
  const fanout = tab === 'fanout' ? (currentReport as FanoutReport | null) : null;
  const opportunities = tab === 'opportunities' ? (currentReport as OpportunitiesReport | null) : null;
  const products = tab === 'products' ? (currentReport as ProductsReport | null) : null;
  const pageScope = `${projectId}|${tab}|${filterQuery}`;
  const topicsPage = useSortedPage(
    workspace?.topics ?? [],
    { name: (item) => item.name },
    `${projectId}|topics`,
    25,
    t,
  );
  const [projectSort, setProjectSort] = useState<DataSort>();
  const projectCountry = (item: Project) => countryName(item.location_code, locale);
  const projectColumns: DataColumn<Project>[] = [
    { key: 'project', header: t('Project', 'Projeto'), sortValue: (item) => projectLabel(item), mobile: 'title', cell: (item) => <Button variant="ghost" onClick={() => void openProject(item.id).catch((cause) => setError(cause.message))}>{projectLabel(item)}</Button> },
    { key: 'domain', header: t('Domain', 'Domínio'), sortValue: (item) => item.domain, mobile: 'wide', label: t('Domain', 'Domínio'), cell: (item) => item.domain },
    { key: 'country', header: t('Country', 'País'), sortValue: projectCountry, label: t('Country', 'País'), cell: projectCountry },
  ];
  const projectsPage = useCollectionPage(
    sortRows(workspace?.projects ?? [], projectColumns, projectSort),
    `projects|${projectSort?.key}|${projectSort?.direction}`,
    25,
    t,
  );
  const modelNeedle = tab === 'models' ? queryText.trim().toLowerCase() : '';
  // The AIs active in the project (its own and its prompts'), within the plan and the project's country (8/11/2026: an AI outside
  // the plan, or turned off since, is not listed).
  const monitoredEngines = new Set([
    ...(project?.engines ?? []),
    ...(workspace?.prompts ?? []).filter((item) => item.project_id === project?.id && item.active && !item.archived).flatMap((item) => item.engines ?? [item.engine]),
  ]);
  const projectEngines = availableEngines(
    (workspace?.capabilities.engines ?? ['chat_gpt']).filter((engine) => !project?.engines || monitoredEngines.has(engine)),
    project?.location_code ?? 2840,
  );
  // The AI models screen also shows each AI's Semantic Branding score, from that collection.
  const semanticModels = useSemanticReport({ projectId: project?.id, filters: filterQuery, request, refresh: dataRevision, demo: demoMode, enabled: tab === 'models' });
  // The models this project monitors, never all of them. An AI Semantic Branding asks is listed too (its Prompts columns empty), so its
  // score is never hidden; both are the project's active AIs within its plan.
  const semanticEngines = new Set((semanticModels.data?.byAssistant?.columns ?? []).map((column) => column.engine));
  const modelChannels = (models?.channels ?? []).filter((row) => projectEngines.includes(row.key));
  // The table's rows: those, and any other AI Semantic Branding asks; the cards and the summary count only the Prompts' models.
  const modelRows = (models?.channels ?? []).filter((row) => modelChannels.includes(row) || semanticEngines.has(row.key));
  const filteredModels = modelRows.filter(
    (item) => !modelNeedle || ENGINE_LABELS[item.key].toLowerCase().includes(modelNeedle),
  );
  const modelsPage = useSortedPage(
    filteredModels,
    {
      model: (item) => ENGINE_LABELS[item.key],
      responses: (item) => item.responses,
      mentions: (item) => item.mentions,
      visibility: (item) => (item.responses ? item.visibility : null),
      citationCoverage: (item) => (item.responses ? item.citationCoverage : null),
      consultedCoverage: (item) => (item.responses ? item.consultedCoverage : null),
    },
    `${pageScope}|${modelNeedle}`,
    25,
    t,
  );
  const runSourcesPage = useCollectionPage(
    detail?.sources ?? [],
    detail?.id ?? '',
    25,
    t,
  );
  const runConsultedPage = useCollectionPage(
    detail?.consulted_sources ?? [],
    detail?.id ?? '',
    25,
    t,
  );
  const runQueriesPage = useCollectionPage(
    detail?.search_queries ?? [],
    detail?.id ?? '',
    25,
    t,
  );
  // The plan's limits as the edition sends them (never a Cloud plan inferred from a number); none in the independent edition.
  const free = !!workspace?.capabilities.free;
  const promptsFull = (workspace?.capabilities.promptLimit ?? Infinity) <= (workspace?.capacity.prompts ?? 0);
  const topicsFull = (workspace?.capabilities.topicLimit ?? Infinity) <= (workspace?.capacity.topics ?? 0);
  // The plan has no room for another project (Free's one): New project stays visible, disabled, with the way to free it.
  const projectsFull = !!workspace?.capacity.projectsFull;
  const projectLimitCopy = t('Your plan includes one project at a time and a few new projects a month. Archive or delete it in Settings > Brand and market to start another, or wait for next month if this month\'s were used.', 'Seu plano inclui um projeto por vez e poucos projetos novos por mês. Arquive-o ou exclua-o em Configurações > Marca e mercado para começar outro, ou espere o próximo mês se os deste mês já foram usados.');
  // When the project's prompts are next asked, as Settings > Monitoring computes it (said on empty screens and when adding a prompt).
  const collectsNow = !!workspace?.config?.collectsNow && !free;
  const nextCollectionCopy = !project || !workspace
    ? ''
    : !project.daily_enabled
      ? t('Monitoring is paused for this project; resume it in Settings > Monitoring.', 'O monitoramento deste projeto está pausado; retome em Configurações > Monitoramento.')
      : t(`Next collection: ${formatNextCollection(scheduleOf(project, free, workspace.timeZone), locale)}.`, `Próxima coleta: ${formatNextCollection(scheduleOf(project, free, workspace.timeZone), locale)}.`);
  // A new prompt: right away where the edition collects it at once (the independent one), else at the next collection.
  const newPromptCopy = collectsNow && project?.daily_enabled && workspace?.config?.dataforseo !== false
    ? t('Monitoring starts as soon as you add it.', 'A coleta começa assim que você adicionar.')
    : nextCollectionCopy;
  // Query Fan Out: once the report is loaded, only AIs that returned searches (may be none).
  const engines = fanout
    ? projectEngines.filter((engine) => fanout.fanoutEngines.includes(engine))
    : projectEngines;
  const openPromptEditor = (item?: Prompt) => {
    setError('');
    setEditingPrompt(item ?? null);
    setAddOpen(true);
  };
  // A response opens by route: the address holds its id, so it can be shared, reloaded and
  // reached with the browser's back button.
  const onRun = (id: string) => {
    setTab('responses');
    setEntity(null);
    setRunRoute(id);
  };
  const [runState, setRunState] = useState<'idle' | 'loading' | 'failed'>('idle');
  useEffect(() => {
    if (!workspace) return;
    if (tab !== 'responses' || !runRoute) {
      queueMicrotask(() => {
        setDetail((current) => (current ? null : current));
        setRunState('idle');
      });
      return;
    }
    if (detail?.id === runRoute) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setDetail(null);
      setRunState('loading');
    });
    request<Run>(`${api}/runs/${encodeURIComponent(runRoute)}`)
      .then((run) => {
        if (!active) return;
        setDetail(run);
        setRunState('idle');
      })
      .catch((cause) => {
        if (active && cause?.name !== 'AbortError') setRunState('failed');
      });
    return () => {
      active = false;
    };
  }, [workspace, tab, runRoute, detail?.id, api, request, dataRevision]);
  const onPromptDetail = (item: Prompt) => {
    promptReturnScroll.current = Math.round(window.scrollY);
    const list = new URL(window.location.href);
    list.searchParams.set('listScroll', String(promptReturnScroll.current));
    list.searchParams.set('listPage', String(promptListPage));
    window.history.replaceState(window.history.state, '', list);
    setTab('prompts');
    setPromptRoute(`${item.id}-${slugify(item.text)}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  useEffect(() => {
    if (!workspace || !promptRoute || tab !== 'prompts') return;
    const item = workspace.prompts.find(
      (item) =>
        item.id === promptRoute || promptRoute.startsWith(`${item.id}-`),
    );
    // An unknown prompt address is its own not-found state (promptMissing), never the list with dashes and a toast.
    if (!item) return;
    queueMicrotask(() => {
      setDetailLoading(true);
      setDetailReport(null);
      setDetailHistoryCursors(['']);
      setDetailHistoryPage(1);
      setDetailSourceCursors(['']);
      setDetailSourcePage(1);
    });
    const version = ++detailRequest.current;
    const params = new URLSearchParams(filterQuery);
    params.set('view', 'prompt-detail');
    params.set('prompt', item.id);
    // The page's other reads of this prompt (who the AIs name, the sentiment evidence) need nothing from its report: they
    // start with it, and the panels find them under way, instead of starting once it has answered.
    void request(promptRankingPath(api, filterQuery, item.id)).catch(() => {});
    if (!demoMode && projectId) void request(researchPanelPath(projectId, filterQuery, { promptId: item.id })).catch(() => {});
    void request<PromptDetail>(`${api}/reports?${params}`)
      .then((data) => {
        if (detailRequest.current === version) setDetailReport(data);
      })
      .catch((cause) => {
        if (detailRequest.current === version && cause.name !== 'AbortError')
          setError(cause.message);
      })
      .finally(() => {
        if (detailRequest.current === version) setDetailLoading(false);
      });
    return () => {
      if (detailRequest.current === version)
        detailRequest.current = version + 1;
    };
  }, [workspace, promptRoute, tab, filterQuery, dataRevision, api, request, t, demoMode, projectId]);
  const changeDetailPage = async (
    kind: 'history' | 'sources',
    next: boolean | number,
  ) => {
    if (!detailReport) return;
    const promptDetail = 'history' in detailReport;
    const cursor =
      kind === 'history'
        ? promptDetail
          ? detailReport.history.nextCursor
          : detailReport.nextCursor
        : !promptDetail
          ? detailReport.nextSourceCursor
          : '';
    const page = kind === 'history' ? detailHistoryPage : detailSourcePage;
    const cursors =
      kind === 'history' ? detailHistoryCursors : detailSourceCursors;
    const targetPage = typeof next === 'number' ? next : next ? page + 1 : page - 1;
    const targetCursors =
      next === true && !cursors[page] ? [...cursors, cursor || ''] : cursors;
    const params = new URLSearchParams(filterQuery);
    params.set('view', promptDetail ? 'prompt-detail' : 'source-detail');
    if (promptDetail && selectedPrompt) params.set('prompt', selectedPrompt.id);
    const historyCursor =
      kind === 'history'
        ? targetCursors[targetPage - 1]
        : detailHistoryCursors[detailHistoryPage - 1];
    const sourceCursor =
      kind === 'sources'
        ? targetCursors[targetPage - 1]
        : detailSourceCursors[detailSourcePage - 1];
    if (historyCursor) params.set('cursor', historyCursor);
    if (sourceCursor) params.set('sourceCursor', sourceCursor);
    params.set(
      'sourcePage',
      String(kind === 'sources' ? targetPage : detailSourcePage),
    );
    const version = ++detailRequest.current;
    setBusy(true);
    try {
      const result = await request<PromptDetail | SourceDetail>(
        `${api}/reports?${params}`,
      );
      if (version !== detailRequest.current) return;
      setDetailReport(result);
      if (kind === 'history') {
        setDetailHistoryCursors(targetCursors);
        setDetailHistoryPage(targetPage);
      } else {
        setDetailSourceCursors(targetCursors);
        setDetailSourcePage(targetPage);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const detailPagination = (kind: 'history' | 'sources', hasMore: boolean) => {
    const page = kind === 'history' ? detailHistoryPage : detailSourcePage;
    return (
      <CollectionPagination
        page={page}
        pages={hasMore ? undefined : page}
        selectablePages={(kind === 'history' ? detailHistoryCursors : detailSourceCursors).length}
        busy={busy}
        label={`${kind === 'history' ? t('Responses', 'Respostas') : t('Sources', 'Fontes')}, ${t('Page', 'Página')} ${formatNumber(locale, page)}`}
        previousLabel={t('Previous', 'Anterior')}
        nextLabel={t('Next', 'Próxima')}
        onPage={(target) => void changeDetailPage(kind, target)}
        onPrevious={() => void changeDetailPage(kind, false)}
        onNext={() => void changeDetailPage(kind, true)}
      />
    );
  };
  const loadMore = async (page: number, cursor?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const params = new URLSearchParams(filterQuery);
      params.set('view', 'history');
      params.set('page', String(page));
      if (cursor) params.set('cursor', cursor);
      const next = await request<HistoryPage>(`${api}/reports?${params}`);
      setHistoryPages((previous) => {
        const pages = [...previous];
        pages[page - 2] = next;
        return pages;
      });
      setResponsePage(page);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const promptColumnLabels: Record<string, string> = {
    models: t('AI models', 'Modelos de IA'),
    tags: t('Tags', 'Tags'),
    visibility: t('Visibility', 'Visibilidade'),
    shareOfVoice: t('Share of voice', 'Share of voice'),
    sentiment: t('Sentiment', 'Sentimento'),
    position: t('Position', 'Posição'),
    country: t('Country', 'País'),
    channels: t('Per-model performance', 'Desempenho por modelo'),
  };
  const showPromptColumn = (column: string) => !promptColumnsPref.hidden.includes(column);
  let promptSummaryResponses = 0, promptSummaryMentions = 0, promptSummaryTotalMentions = 0, promptSummaryVoice = 0, promptSummarySentimentWeight = 0, promptSummarySentimentSum = 0;
  const promptSummaryPositionRows: MentionPositionRow[] = [];
  for (const item of orderedPrompts) {
    const metric = promptStats?.[item.id];
    // Each question counts with its topic's factor (topic weights), as on the Overview.
    const weight = metric?.weight ?? 1;
    if (metric?.responses) {
      promptSummaryResponses += weight * metric.responses;
      promptSummaryMentions += weight * metric.mentions;
      promptSummaryTotalMentions += weight * (metric.totalMentions || 0);
      promptSummaryVoice += weight * (metric.voiceMentions ?? metric.mentions);
    }
    promptSummaryPositionRows.push({ position: metric?.position, mentions: metric?.mentions == null ? metric?.mentions : weight * metric.mentions, positionSamples: metric?.positionSamples == null ? metric?.positionSamples : weight * metric.positionSamples });
    const sentiment = promptSentimentByUnit.get(item.id);
    if (sentiment != null) { promptSummarySentimentSum += weight * sentiment; promptSummarySentimentWeight += weight; }
  }
  const promptSummary = {
    count: orderedPrompts.length,
    visibility: promptSummaryResponses ? (promptSummaryMentions / promptSummaryResponses) * 100 : null,
    shareOfVoice: promptSummaryTotalMentions ? (promptSummaryVoice / promptSummaryTotalMentions) * 100 : null,
    sentiment: promptSummarySentimentWeight ? Math.round(promptSummarySentimentSum / promptSummarySentimentWeight) : null,
    position: weightedMentionPosition(promptSummaryPositionRows),
  };
  const summaryPath = useMemo(() => {
    // As the Prompts sentiment: a read sent before the workspace is ready gets "not ready" from the demo and is not repeated.
    if (!projectId || !workspaceReady || (tab !== 'competitors' && tab !== 'responses')) return null;
    return reportViewPath(api, filterQuery, 'summary');
  }, [projectId, tab, filterQuery, api, workspaceReady]);
  const summaryRemote = useReport<SummaryReport>(summaryPath, cache.generation, request);
  const tabSummary = summaryRemote.data ?? null;
  // Per-question metrics come from a slower report than the prompt list: "—" means "no response in the period", never "still loading" or "failed".
  const promptMetricsLoading = tab === 'prompts' && reportLoading;
  const promptMetricsFailed = tab === 'prompts' && !promptRoute && workspaceReady && Boolean(reportPath) && !reportLoading && !promptStats;
  // Drill down: a prompt's figures open its answers that name the brand, in Responses; its sentiment, the prompt's page.
  const promptAnswers = (prompt: string): DrillTarget => ({ tab: 'responses', prompt, brand: null, brandLabel: null, sentiment: null, mention: 'mentioned', cites: null, run: null });
  const promptMetricCell = (value: ReactNode, size = 'w-10') =>
    promptMetricsLoading ? <output aria-busy="true" className={`ml-auto block h-4 animate-pulse rounded bg-muted ${size}`}><span className="sr-only">{t('Loading…', 'Carregando…')}</span></output>
    : promptMetricsFailed ? <span className="sr-only">{t('Unavailable', 'Indisponível')}</span> : value;
  const promptSummaryRow = {
    prompt: t(`Summary (${formatNumber(locale, promptSummary.count)})`, `Resumo (${formatNumber(locale, promptSummary.count)})`),
    ...(showPromptColumn('visibility') ? { visibility: promptMetricCell(promptSummary.visibility != null ? formatPercent(locale, promptSummary.visibility) : '—') } : {}),
    ...(showPromptColumn('shareOfVoice') ? { shareOfVoice: promptMetricCell(promptSummary.shareOfVoice != null ? formatPercent(locale, promptSummary.shareOfVoice) : '—') } : {}),
    ...(showPromptColumn('sentiment') ? { sentiment: promptSummary.sentiment != null ? formatNumber(locale, promptSummary.sentiment, 0) : '—' } : {}),
    ...(showPromptColumn('position') ? { position: promptMetricCell(promptSummary.position != null ? formatNumber(locale, promptSummary.position, 1) : '—') } : {}),
  };
  // The pager in the Summary row, the same on every list screen. `more` marks a total that is a lower bound (server-paged lists).
  const summaryPager = (pager: { from: number; to: number; total: number; more?: boolean; page: number; pages: number; onPage: (page: number) => void; label: string }) => {
    const [from, to, total] = [pager.from, pager.to, pager.total].map((value) => formatNumber(locale, value));
    return (
      <CompactPagination
        from={pager.from}
        to={pager.to}
        total={pager.total}
        page={pager.page}
        pages={pager.pages}
        onPrevious={() => pager.onPage(pager.page - 1)}
        onNext={() => pager.onPage(pager.page + 1)}
        onPage={pager.onPage}
        previousLabel={t('Previous page', 'Página anterior')}
        nextLabel={t('Next page', 'Próxima página')}
        pageLabel={t('Page', 'Página')}
        label={pager.label}
        rangeLabel={t(`${from} to ${to} of ${total}${pager.more ? '+' : ''}`, `${from} a ${to} de ${total}${pager.more ? '+' : ''}`)}
      />
    );
  };
  const promptPagerFrom = orderedPrompts.length ? promptPage.offset + 1 : 0;
  const promptPagerTo = promptPage.offset + visiblePrompts.length;
  const promptSummaryPager = orderedPrompts.length ? summaryPager({
    from: promptPagerFrom,
    to: promptPagerTo,
    total: orderedPrompts.length,
    page: promptPage.page,
    pages: promptPage.pages,
    onPage: setPromptListPage,
    label: t('Prompt pages', 'Páginas de prompts'),
  }) : null;
  // Sources have no total; the pager uses the number loaded as a lower bound.
  const sourcesPager = sources?.rows.length ? summaryPager({
    from: (sourcePage - 1) * SOURCE_PAGE_SIZE + 1,
    to: (sourcePage - 1) * SOURCE_PAGE_SIZE + sources.rows.length,
    total: (sourcePage - 1) * SOURCE_PAGE_SIZE + sources.rows.length,
    more: sources.hasMore,
    page: sourcePage,
    pages: sourcePage + (sources.hasMore ? 1 : 0),
    onPage: setSourcePage,
    label: t('Source pages', 'Páginas de fontes'),
  }) : null;
  const responsePages = [history, ...historyPages];
  const responsesMore = Boolean(responsePages[responsePages.length - 1]?.nextCursor);
  const responsesFrom = (responsePage - 1) * 25 + 1;
  const responsesTotal = tabSummary?.metrics.responses;
  const responsesTo = responsesFrom + (currentHistory?.runs.length ?? 0) - 1;
  const responsesPager = currentHistory?.runs.length ? summaryPager({
    from: responsesFrom,
    to: responsesTo,
    total: responsesTotal ?? responsePages.reduce((sum, page) => sum + (page?.runs.length ?? 0), 0),
    more: responsesTotal == null && responsesMore,
    page: responsePage,
    pages: responsesTotal != null ? Math.ceil(responsesTotal / 25) : responsePages.length + (responsesMore ? 1 : 0),
    onPage: (page) => {
      if (responsePages[page - 1]) setResponsePage(page);
      else if (responsesTotal != null) void loadMore(page);
      else {
        const last = responsePages[responsePages.length - 1];
        if (last?.nextCursor) void loadMore(page, last.nextCursor);
      }
    },
    label: t('Response pages', 'Páginas de respostas'),
  }) : null;
  // The Summary counts the complete answers of the whole filtered period, the same set the list shows (reports.ts historyStatement).
  const responsesSummary = {
    prompt: tabSummary?.metrics.responses
      ? t(`Summary (${formatNumber(locale, tabSummary.metrics.responses)})`, `Resumo (${formatNumber(locale, tabSummary.metrics.responses)})`)
      : t('Summary', 'Resumo'),
  };
  const modelsSummary = (rows: AnalysisRow[]) => {
    const values = modelsSummaryValues(rows);
    const percent = (value: number | null) => (value == null ? '—' : formatPercent(locale, value));
    return {
      model: t(`Summary (${formatNumber(locale, rows.length)})`, `Resumo (${formatNumber(locale, rows.length)})`),
      responses: formatNumber(locale, values.responses),
      mentions: formatNumber(locale, values.mentions),
      visibility: percent(values.visibility),
      citationCoverage: percent(values.citationCoverage),
      consultedCoverage: percent(values.consultedCoverage),
    };
  };
  const promptTableColumns = (): DataColumn<Prompt>[] => {
    const metricFor = (item: Prompt) => promptStats?.[item.id];
    // A prompt's change against the comparison period: none when it had no answer then or the figure was not measured in both.
    // Without its unit in the cell (the column says it), so the list keeps its widths.
    const promptDelta = (item: Prompt, key: 'visibility' | 'shareOfVoice' | 'position') => {
      const metric = metricFor(item), now = metric?.[key], before = metric?.previous?.[key];
      return metric?.responses && coveredPeriods(metric.previous?.responses, metric.responses) && now != null && before != null
        // A table colours any difference: the margin of error is for cards only.
        ? <Change value={now - before} locale={locale} invert={key === 'position'} margin={0} /> : null;
    };
    const changeNote = compared.off ? '' : ` ${t(`Beside it, the change against ${compared.period} (in percentage points for shares); none when the prompt was not measured in both, or that period measured fewer than half its answers of this one.`, `Ao lado, a variação ante o ${compared.period} (em pontos percentuais nas parcelas); nenhuma quando o prompt não foi medido nos dois, ou esse período mediu menos da metade das respostas deste.`)}`;
    return [
      {
        key: 'select', width: 44, mobile: 'check', headerClassName: 'w-10 pl-4', cellClassName: 'pl-4',
        header: <Checkbox aria-label={t('Select all visible prompts', 'Selecionar todos os prompts visíveis')} checked={visiblePrompts.length > 0 && selectedVisiblePrompts.length === visiblePrompts.length} indeterminate={selectedVisiblePrompts.length > 0 && selectedVisiblePrompts.length < visiblePrompts.length} onCheckedChange={(checked) => setSelectedPrompts(checked ? visiblePrompts.map((item) => item.id) : [])} />,
        cell: (item) => <Checkbox aria-label={`${t('Select', 'Selecionar')} ${item.text}`} checked={selectedPrompts.includes(item.id)} onCheckedChange={(checked) => setSelectedPrompts((current) => checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />,
      },
      {
        key: 'prompt', mobile: 'title', cellClassName: 'min-w-0', header: t('Prompt', 'Prompt'), sortValue: promptSortValue.prompt,
        cell: (item) => (
          // onPromptDetail writes a ref, but only when clicked; the compiler cannot tell a handler handed to DataTable from a render-time call.
          <Hint text={item.text}>
          {/* oxlint-disable-next-line react/react-compiler */}
          <button className="block w-full truncate text-left text-body text-foreground hover:text-primary" onClick={() => onPromptDetail(item)}>
            {item.text}
          </button>
          </Hint>
        ),
      },
      ...(showPromptColumn('models') ? [{
        key: 'models', width: 140, mobile: 'hide' as const, sortValue: promptSortValue.models, header: promptColumnLabels.models, label: promptColumnLabels.models,
        cell: (item: Prompt) => <CompactEngineIcons engines={item.engines ?? [item.engine]} />,
      }] : []),
      ...(showPromptColumn('tags') ? [{
        key: 'tags', width: 110, sortValue: promptSortValue.tags, header: promptColumnLabels.tags, label: promptColumnLabels.tags,
        cell: (item: Prompt) => (
          <div className="flex max-w-28 gap-1 overflow-hidden">
            {item.tags.length ? item.tags.slice(0, 1).map((tag) => <TagBadge key={tag} tone="muted">{tag}</TagBadge>) : <span className="text-muted-foreground">—</span>}
            {item.tags.length > 1 ? <span className="text-muted-foreground tabular-nums">+{item.tags.length - 1}</span> : null}
          </div>
        ),
      }] : []),
      ...(showPromptColumn('visibility') ? [{
        key: 'visibility', width: compared.off ? 110 : 124, align: 'end' as const, sortValue: promptSortValue.visibility, header: promptColumnLabels.visibility, label: promptColumnLabels.visibility,
        ...(changeNote ? { info: t('Answers that mention your brand ÷ all answers of the prompt in the period.', 'Respostas que mencionam sua marca ÷ todas as respostas do prompt no período.') + changeNote } : {}),
        cell: (item: Prompt) => {
          const metric = metricFor(item);
          return promptMetricCell(metric?.responses ? <WithChange change={promptDelta(item, 'visibility')}><DrillLink link={link} to={promptAnswers(item.id)}>{formatPercent(locale, metric.visibility)}</DrillLink></WithChange> : '—');
        },
      }] : []),
      ...(showPromptColumn('shareOfVoice') ? [{
        key: 'shareOfVoice', width: 148, align: 'end' as const, sortValue: promptSortValue.shareOfVoice, header: promptColumnLabels.shareOfVoice, label: promptColumnLabels.shareOfVoice,
        ...(changeNote ? { info: t('Your brand’s mentions ÷ mentions of every identified brand in the prompt’s answers.', 'Menções à sua marca ÷ menções a todas as marcas identificadas nas respostas do prompt.') + changeNote } : {}),
        cell: (item: Prompt) => {
          const metric = metricFor(item);
          return promptMetricCell(metric?.shareOfVoice != null ? <WithChange change={promptDelta(item, 'shareOfVoice')}><DrillLink link={link} to={promptAnswers(item.id)}>{formatPercent(locale, metric.shareOfVoice)}</DrillLink></WithChange> : '—');
        },
      }] : []),
      ...(showPromptColumn('sentiment') ? [{
        key: 'sentiment', width: 120, align: 'end' as const, sortValue: promptSortValue.sentiment, header: promptColumnLabels.sentiment, label: promptColumnLabels.sentiment,
        cell: (item: Prompt) => {
          if (promptSentimentRemote.loading) return promptMetricCell(null);
          // A failed read has no data: say so instead of a dash that reads as "no sentiment".
          if (promptSentimentRemote.error) return <Hint text={t('Sentiment could not be loaded. Reopen Prompts to try again.', 'Não foi possível carregar o sentimento. Abra Prompts de novo para tentar.')}><button type="button" aria-label={t('Sentiment unavailable', 'Sentimento indisponível')} className="inline-flex text-destructive"><CircleAlert size={16} aria-hidden="true" /></button></Hint>;
          const score = promptSentimentByUnit.get(item.id);
          return score != null ? <DrillLink link={link} to={{ tab: 'prompts', prompt: item.id }}>{formatNumber(locale, score, 0)}</DrillLink> : '—';
        },
      }] : []),
      ...(showPromptColumn('position') ? [{
        key: 'position', width: compared.off ? 100 : 112, align: 'end' as const, sortValue: promptSortValue.position, header: promptColumnLabels.position, label: promptColumnLabels.position,
        info: t(
          'Average rank of the brand’s first mention among the competitors the answer names, monitored and discovered (1 = named first). Lower is better. In the Summary: weighted by the answers that mention your brand.',
          'Posição média da primeira menção à marca entre os concorrentes que a resposta cita, monitorados e descobertos (1 = citada primeiro). Quanto menor, melhor. No Resumo: média ponderada pelas respostas que mencionam sua marca.',
        ) + changeNote,
        cell: (item: Prompt) => {
          const metric = metricFor(item);
          return promptMetricCell(metric?.position != null ? <WithChange change={promptDelta(item, 'position')}><DrillLink link={link} to={promptAnswers(item.id)}>{formatNumber(locale, metric.position, 1)}</DrillLink></WithChange> : '—');
        },
      }] : []),
      ...(showPromptColumn('country') ? [{
        key: 'country', width: 140, header: promptColumnLabels.country, label: promptColumnLabels.country, cellClassName: 'text-muted-foreground',
        cell: () => project ? `${countryFlag(project.location_code)} ${countryName(project.location_code, locale)}` : '',
      }] : []),
      ...(showPromptColumn('channels') ? [{
        key: 'channels', width: 200, mobile: 'wide' as const, header: promptColumnLabels.channels, label: promptColumnLabels.channels,
        cell: (item: Prompt) => {
          const metric = metricFor(item);
          return (
            <div className="live-model-icons live-model-icons-compact">
              {(item.engines ?? [item.engine]).map((engine) => {
                const channel = metric?.channels?.[engine];
                return (
                  <Hint key={engine} text={`${ENGINE_LABELS[engine]} ${channel?.responses ? formatPercent(locale, channel.visibility) : '—'}`}>
                  <span className="inline-flex items-center gap-1 text-caption tabular-nums">
                    <EngineIcon engine={engine} />
                    <span className="sr-only">{ENGINE_LABELS[engine]}</span>
                    {promptMetricCell(channel?.responses ? <DrillLink link={link} to={{ ...promptAnswers(item.id), engine }} aria-label={`${ENGINE_LABELS[engine]}: ${formatPercent(locale, channel.visibility)}. ${t('Open the answers of this prompt in this model', 'Abrir as respostas deste prompt neste modelo')}`}>{formatPercent(locale, channel.visibility)}</DrillLink> : '—', 'w-8')}
                  </span>
                  </Hint>
                );
              })}
            </div>
          );
        },
      }] : []),
      {
        key: 'actions', width: 48, mobile: 'actions', header: <span className="sr-only">{t('Actions', 'Ações')}</span>,
        cell: (item) => (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`${t('Actions for', 'Ações para')} ${item.text}`} />}>
              <MoreVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="analytics-menu">
              <DropdownMenuItem onClick={() => openPromptEditor(item)}>
                <Pencil />
                {t('Edit prompt', 'Editar prompt')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={() => void mutate(`/api/prompts/${encodeURIComponent(item.id)}`, 'PATCH', { active: !item.active })}>
                {item.active ? <Pause /> : <Play />}
                {item.active ? t('Pause', 'Pausar') : t('Resume', 'Retomar')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onClick={() => void mutate(`/api/prompts/${encodeURIComponent(item.id)}`, 'PATCH', { archived: !item.archived, ...(item.archived ? { active: true } : {}) })}>
                <Archive />
                {item.archived ? t('Restore', 'Restaurar') : t('Archive', 'Arquivar')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ];
  };
  const promptActions = (
    <PrimaryMenuActions
      label={t('More prompt actions', 'Mais ações de prompts')}
      action={
      <Button
        disabled={promptsFull}
        onClick={() => openPromptEditor()}
      >
        {t('Add prompt', 'Adicionar prompt')}
      </Button>
      }
    >
          <DropdownMenuItem
            onClick={() => {
              setImportText('');
              setImportOpen(true);
            }}
          >
            <Upload size={15} />
            {t('Import CSV', 'Importar CSV')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTab('topics')}>
            {t('Manage topics', 'Gerenciar tópicos')}
          </DropdownMenuItem>
    </PrimaryMenuActions>
  );

  const clearFilter = {
    engine: () => setEngineFilter('all'),
    topic: () => setTopicFilter(''),
    tag: () => setTagFilter(''),
    prompts: () => {
      if (tab !== 'prompts') return;
      setPromptFilters((current) => ({ ...EMPTY_PROMPT_FILTERS, status: current.status }));
      setQuery('');
    },
  };
  // Responses' own filters (search, mention, brand, sentiment, prompt, cited domain): one Clear resets them all.
  const responseFiltersActive = tab === 'responses' && Boolean(queryText || responseMention !== 'all' || brandFilter || responseSentiment || promptRoute || responseCites);
  const headerFiltersActive = engineFilter !== 'all' || (!sbScreen && Boolean(topicFilter || tagFilter || brandsFilter)) || (tab === 'competitors' && brandView !== 'general');
  const clearAllFilters = () => {
    setEngineFilter('all');
    setTopicFilter('');
    setTagFilter('');
    setBrandsFilter('');
    setBrandView('general');
    if (tab !== 'responses') return;
    setQuery('');
    setResponseMention('all');
    setBrandFilter('');
    setBrandLabel('');
    setResponseSentiment('');
    setPromptRoute(null);
    setResponseCites('');
  };

  const loadingLabel = t('Loading your workspace…', 'Carregando seu workspace…');
  const skeletonCards = (count: number, description = false) => <MetricGridSkeleton count={count} label={loadingLabel} description={description} />;
  // The screen's heading, the same while the workspace loads and once it arrives. List screens have none (the table is
  // the page), and a brand or source page leads with its own header.
  // The New project wizard brings its own heading, one per step.
  const wizardShown = !!workspace && ((!project && !fullPage) || creatingProject);
  const pageHeading = (workspace ? !tableListScreen : !listScreen) && !adminList && !(tab === 'competitors' && brandPage) && !(tab === 'sources' && entity) && !comparisonDetail && !wizardShown && (
    <PageHeading
      className={fullPage ? 'live-settings-heading' : undefined}
      title={tab === 'settings' ? t(...(settingsSections.find((section) => section.id === settingsSection)?.label ?? label.settings)) : tab === 'admin' ? t(...adminCopy.label) : workspace && (creatingProject || !project) ? t('Create a project', 'Crie um projeto') : tab === 'prompts' && promptDetail ? selectedPrompt?.text ?? <Skeleton inline className="h-lh w-96 max-w-full align-top" /> : tab === 'ai-bots' ? t(...AI_BOTS_SECTIONS[aiBotsSection(aiBotsView)].title) : t(...label[tab])}
      description={tab === 'settings' ? (workspace ? settingsDescription : t(...settingsDescriptions[settingsSection])) : tab === 'admin' ? t(...adminCopy.description) : workspace && (creatingProject || !project) ? t('Start by naming your brand and market.', 'Comece definindo sua marca e mercado.') : tab === 'prompts' && promptDetail ? t('Explore performance for this specific prompt.', 'Explore o desempenho deste prompt.') : tab === 'ai-bots' ? t(...AI_BOTS_SECTIONS[aiBotsSection(aiBotsView)].description) : t(...description[tab])}
      actions={tab === 'overview' && (project || !workspace) ? (
        <Button disabled={!project} onClick={() => { openPromptEditor(); }}>{t('Add prompt', 'Adicionar prompt')}</Button>
      ) : project && tab === 'contents' && workspace?.capabilities.agent && workspace.role !== 'viewer' ? createContent : null}
    />
  );
  // A prompt's page with its cards, answers and ranking on their way (docs/design/shell.md section 9).
  const promptReportSkeleton = (
    <article className="grid gap-5" aria-busy="true">
      <MetricGridSkeleton count={4} label={t('Loading prompt report…', 'Carregando relatório do prompt…')} />
      <SectionCard loading />
      <SectionCard loading />
    </article>
  );
  // Workspace still loading: each tab's screen in its loading state (its exported <Screen>Skeleton), under the same heading.
  // ponytail: the prompt list, AI models and the agent's screens show their frame until they export their own skeleton.
  // A list screen's frame (cards, toolbar, table) while its columns are not known yet.
  const tableSkeleton = (cards: number, columns: number, descriptions = false) => (
    <DataTableScreen cards={cards ? <MetricGridSkeleton count={cards} label={loadingLabel} description={descriptions} /> : undefined}>
      <DataTableToolbar label={loadingLabel}><Skeleton className="h-(--control-height) w-64 max-w-full" /></DataTableToolbar>
      <DataTable fill singleLine="wide" loading ariaLabel={loadingLabel} rows={[]} rowKey={String} columns={skeletonColumns(columns)} />
    </DataTableScreen>
  );
  const screenSkeletons: Record<Tab, ReactNode> = {
    overview: <OverviewSkeleton />,
    prompts: promptDetail ? promptReportSkeleton : tableSkeleton(0, 9),
    topics: <TopicsSkeleton />,
    responses: runRoute ? (
      <DataTableScreen fill={false} cards={skeletonCards(3)}>
        <DataTableToolbar label={loadingLabel}><Skeleton className="h-8 w-64 max-w-full" /></DataTableToolbar>
        <DetailBodySkeleton label={t('Loading response…', 'Carregando resposta…')} />
      </DataTableScreen>
    ) : tableSkeleton(3, 6),
    sources: entity ? <SourceEntitySkeleton kind={entity.kind} /> : tableSkeleton(3, 6, true),
    products: productDetail && isProductDetail(productDetail) ? <ProductPageSkeleton /> : <ProductsSkeleton view={productSection(productDetail)} />,
    settings: <SettingsSkeleton section={settingsSection} label={loadingLabel} />,
    competitors: brandPage ? <BrandPageSkeleton /> : <BrandsSkeleton />,
    models: tableSkeleton(4, 6),
    fanout: <FanoutSkeleton />,
    'semantic-branding': <SemanticSkeleton label={loadingLabel} />,
    'ai-bots': <AiBotsSkeleton section={aiBotsSection(aiBotsView)} />,
    comparison: <ComparisonSkeleton view={comparisonSection(comparisonView)} detail={!!comparisonDetailOf(comparisonView)} />,
    agent: <DetailBodySkeleton wide label={loadingLabel} />,
    // An artifact opened from its link: its page from the first frame (agent-screen.tsx), never the list's frame and top bar.
    contents: openingArtifact ? <ArtifactPageSkeleton /> : tableSkeleton(0, 4),
    artifacts: openingArtifact ? <ArtifactPageSkeleton /> : tableSkeleton(0, 4),
    brain: <BrainSkeleton />,
    skills: tableSkeleton(0, 4),
    opportunities: <OpportunitiesSkeleton />,
    admin: <AdminSkeleton label={loadingLabel} />,
  };
  const workspaceSkeleton = <>{pageHeading}{screenSkeletons[tab]}</>;
  // App errors are a toast with Retry, never a block above the screen; forms that show the error themselves keep it.
  useStatusToast(
    'app-error',
    // Without a workspace the screen itself says so (below), with the same Retry.
    error && workspace && !addOpen && tab !== 'settings'
      ? {
          type: 'error',
          title: error,
          actionProps: {
            children: t(...RETRY_LABEL),
            onClick: () => {
              setError('');
              void refresh(projectId).catch((cause) => setError(cause.message));
            },
          },
        }
      : null,
  );

  // A project screen under an address that names no project: say so, and offer the first project (no other one's data here).
  const firstProject = workspace?.projects[0];
  const projectNotFound = missingProject && workspace && !creatingProject && tab !== 'admin' && (tab !== 'settings' || settingsScope?.id === 'project') ? (
    <section>
      <EmptyState
        title={t('Project not found', 'Projeto não encontrado')}
        description={t(`No project in this workspace has the address “${missingProject}”. It may have been renamed or archived.`, `Nenhum projeto deste workspace tem o endereço “${missingProject}”. Ele pode ter sido renomeado ou arquivado.`)}
        action={firstProject ? (
          <Button nativeButton={false} render={<a href={addressOf({ ...navState, projectId: firstProject.id })} aria-label={t(`Open ${firstProject.name}`, `Abrir ${firstProject.name}`)} onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void openProject(firstProject.id).catch((cause) => setError(cause.message)); }} />}>
            {t(`Open ${firstProject.name}`, `Abrir ${firstProject.name}`)}
          </Button>
        ) : (
          <Button onClick={() => setCreatingProject(true)}>{t('Create a project', 'Criar projeto')}</Button>
        )}
      />
    </section>
  ) : null;
  // /app/admin asked for by someone who is not an admin: said plainly, never a silent jump to another screen.
  const adminNotAllowed = adminDenied && workspace && !creatingProject ? (
    <section>
      <EmptyState
        tone="error"
        title={t('You do not have access to Admin', 'Você não tem acesso ao Admin')}
        description={t('Admin is only for the Lastfind team. Your projects are under Overview.', 'O Admin é só para a equipe do Lastfind. Seus projetos estão na Visão geral.')}
        action={<Button onClick={() => setAdminDenied(false)}>{t('Go to Overview', 'Ir para a Visão geral')}</Button>}
      />
    </section>
  ) : null;
  // Cloud lists every workspace the person belongs to, with New workspace after them (the independent edition has none).
  const workspaceChoices = !demoMode ? workspace?.workspaces ?? [] : [];
  const currentWorkspace = workspaceChoices.find((item) => item.current);
  // Your own workspace is named as such; another person's carries its owner's name.
  const workspaceName = (item: { name: string }) => item.name;
  const projectSwitcher = workspace && (project || workspaceChoices.length > 0) && (
    <ProjectSwitcher
      icon={project ? <SiteFavicon domain={project.domain} name={project.name} /> : <navIcons.workspaces size={16} aria-hidden="true" />}
      name={project ? projectLabel(project) : currentWorkspace && workspaceName(currentWorkspace)}
      label={workspaceChoices.length ? t('Switch workspace or project', 'Trocar workspace ou projeto') : t('Switch project', 'Trocar projeto')}
      collapsed={!sidebarOpen}
    >
      {workspaceChoices.length > 0 && (
        <>
          <div className="menu-caption">{t('Workspaces', 'Workspaces')}</div>
          {workspaceChoices.map((item) => (
            <DropdownMenuItem key={item.id} onClick={() => { if (!item.current) guardSettingsNavigation(() => { clearSettingsDirty(); openWorkspace(item.id, `/app/${encodeURIComponent(item.slug)}`); }); }}>
              <navIcons.workspaces />
              <span className="min-w-0 truncate">{workspaceName(item)}</span>
              <span className="ml-auto text-caption text-muted-foreground">{roleLabel(item.role, t)}</span>
              {item.current && <Check />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => guardSettingsNavigation(() => { clearSettingsDirty(); setCreatingWorkspace(true); setCreatingProject(true); })}>
            <Plus />
            {t('New workspace', 'Novo workspace')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <div className="menu-caption">{t('Projects', 'Projetos')}</div>
      {workspace.projects.map((item) => (
        <DropdownMenuItem
          key={item.id}
          onClick={() => {
            if (item.id !== project?.id) guardSettingsNavigation(() => void openProject(item.id).catch((cause) => setError(cause.message)));
          }}
        >
          <SiteFavicon domain={item.domain} name={item.name} />
          <span className="truncate">{projectLabel(item)}</span>
          {item.id === project?.id && <Check className="ml-auto" />}
        </DropdownMenuItem>
      ))}
      {(!workspace.role || workspace.role === 'owner' || workspace.role === 'admin') && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={projectsFull} onClick={() => guardSettingsNavigation(() => { clearSettingsDirty(); setCreatingProject(true); })}>
            <Plus />
            {t('New project', 'Novo projeto')}
          </DropdownMenuItem>
          {projectsFull && <p className="menu-caption max-w-64">{projectLimitCopy}</p>}
        </>}
    </ProjectSwitcher>
  );

  const filtersProjectId = project?.id;
  const workspaceLoaded = Boolean(workspace);
  useLayoutEffect(() => {
    const bar = topbarRef.current;
    if (!bar) return;
    let frame = 0;
    const fit = () => {
      const filters = bar.querySelector<HTMLElement>('.topbar-filters');
      const row = filters?.querySelector<HTMLElement>('.filter-main');
      const actions = filters?.parentElement;
      if (!filters || !row || !actions) return setFoldedFilters(0);
      // A screen's own filters sit in the row's slot (display: contents): each one is an item of the row.
      const items = [...row.children].flatMap((child) => (child.classList.contains('topbar-filters-slot') ? [...child.children] : [child])) as HTMLElement[];
      // A filter's menu stays under its trigger: while one is open the row keeps its fold (folding the trigger would leave the
      // menu with no anchor, at the window's top left); it fits again when the menu closes.
      if (row.querySelector('[aria-expanded="true"]')) return;
      items.forEach((item) => item.removeAttribute('data-folded'));
      if (filters.dataset.mobileOpen === 'true') return; // Open, every filter shows in its panel; the count stays.
      if (window.matchMedia('(max-width: 767px)').matches) return setFoldedFilters(0);
      const rowStyle = getComputedStyle(row);
      const gap = parseFloat(rowStyle.columnGap) || 0;
      // The row's own inset (room for the focus ring) takes width beside its items.
      const inset = (parseFloat(rowStyle.paddingLeft) || 0) + (parseFloat(rowStyle.paddingRight) || 0) + (parseFloat(rowStyle.marginRight) || 0);
      const actionsGap = parseFloat(getComputedStyle(actions).columnGap) || 0;
      const toggle = actions.querySelector<HTMLElement>(':scope > .mobile-filter-toggle');
      const others = [...actions.children].filter((child) => child !== filters && child !== toggle) as HTMLElement[];
      const available = actions.getBoundingClientRect().width - inset - others.reduce((sum, child) => sum + child.getBoundingClientRect().width + actionsGap, 0);
      let toggleWidth = 0;
      if (toggle) {
        const shown = toggle.style.display;
        toggle.style.display = 'inline-flex';
        toggleWidth = toggle.getBoundingClientRect().width;
        toggle.style.display = shown;
      }
      const kept = filtersThatFit(items.map((item) => item.getBoundingClientRect().width), gap, available, toggleWidth);
      items.slice(kept).forEach((item) => item.setAttribute('data-folded', ''));
      setFoldedFilters(items.length - kept);
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(bar);
    // A filter that arrives (a screen's own, as it loads) folds before the frame is drawn, never a frame later: drawn first,
    // the row scrolled sideways for that frame (13/11/2026, layout-flow).
    const changes = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      fit();
    });
    const row = bar.querySelector('.filter-main');
    if (row) changes.observe(row, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-expanded'] });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
    };
  }, [tab, mobileFiltersOpen, filtersProjectId, creatingProject, fullPage, agentScreen, workspaceLoaded]);
  return (
    <ComparisonContext value={comparisonValue}>
    <ProjectHrefContext value={projectHref}>
    <FaviconRouteProvider value={faviconRoute}>
    <SidebarProvider
      className={`analytics-app live-app ${fullPage ? 'settings-mode' : ''}`}
      open={sidebarOpen} onOpenChange={setSidebarOpen} defaultWidth={sidebar?.width}
      onClickCapture={(event) => {
        const anchor = (event.target as HTMLElement).closest('a');
        if (settingsDirty && anchor && !anchor.href.includes('?') && anchor.getAttribute('href') !== '#analytics-main' && !event.metaKey && !event.ctrlKey) {
          event.preventDefault(); event.stopPropagation();
          guardSettingsNavigation(() => { clearSettingsDirty(); settingsDirtyRef.current = false; window.location.assign(anchor.href); });
        }
      }}
      style={{ '--sidebar-width': 'var(--sidebar-width-app)' } as React.CSSProperties}
    >
      <Dialog open={Boolean(pendingNavigation)} onOpenChange={(open) => { if (!open) setPendingNavigation(null); }}>
        <DialogContent><DialogHeader><DialogTitle>{t('Unsaved changes', 'Alterações não salvas')}</DialogTitle><DialogDescription>{t('Your changes have not been saved. Continue editing or discard them to leave.', 'Suas alterações não foram salvas. Continue editando ou descarte para sair.')}</DialogDescription></DialogHeader><DialogFooter>
          <Button variant="outline" onClick={() => setPendingNavigation(null)}>{t('Continue editing', 'Continuar editando')}</Button>
          <Button onClick={() => { const action = pendingNavigation; setPendingNavigation(null); clearSettingsDirty(); settingsDirtyRef.current = false; action?.(); }}>{t('Discard', 'Descartar')}</Button>
        </DialogFooter></DialogContent>
      </Dialog>
      <a className="skip-link" href="#analytics-main">
        {t('Skip to content', 'Ir para o conteúdo')}
      </a>
      <Sidebar collapsible="icon" className="analytics-sidebar">
        <SidebarHeader className="px-3 pt-5 pb-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                className="lastfind-wordmark"
                render={<a href={workspaceAddress ? `/app/${encodeURIComponent(workspaceAddress)}` : pageBase} aria-label="Lastfind" />}
              >
                <LastfindLogo />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {projectSwitcher}
          {loading && !workspace && <ProjectSwitcher loading label={t('Switch project', 'Trocar projeto')} />}
          {workspace && !project && (!workspace.role || workspace.role === 'owner' || workspace.role === 'admin') && (
            <Button variant="outline" onClick={() => guardSettingsNavigation(() => { clearSettingsDirty(); setCreatingProject(true); })}>
              {t('New project', 'Novo projeto')}
            </Button>
          )}
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label={t('Project sections', 'Seções do projeto')} key={sidebarKey} className={navFade ? 'sidebar-nav-swap' : undefined}>
            {fullPage ? <>
              <SidebarGroup className="px-3 pb-0">
                <SidebarMenu>
                  <SectionMenuItem label={t('Back', 'Voltar')} icon={<ArrowLeft />} active={false} link={{ href: returnToApp || link({ tab: 'overview' }).href, onClick: (event) => {
                    event.preventDefault(); guardSettingsNavigation(() => {
                      let destination = returnToApp;
                      try { destination ||= sessionStorage.getItem(`lastfind:settings-return:${pageBase}`) || ''; } catch { /* Use overview. */ }
                      window.history.pushState(null, '', destination || link({ tab: 'overview' }).href);
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    });
                  } }} />
                </SidebarMenu>
              </SidebarGroup>
              {tab === 'admin' ? (
                <SidebarGroup className="px-3 pb-3">
                  <SidebarGroupLabel>{t(...label.admin)}</SidebarGroupLabel>
                  <SidebarMenu>{adminPages.map((page) => <SectionMenuItem key={page.id} label={t(...adminPageCopy[page.id].label)} icon={createElement(adminIcons[page.id])} active={adminPage === page.id} link={link({ tab: 'admin', section: page.id })} />)}</SidebarMenu>
                </SidebarGroup>
              ) : settingsSectionGroups.map((group, index) => <SidebarGroup key={group.id} className="px-3 pb-3">
                {index === 0 ? <SidebarGroupLabel>{t('Settings', 'Configurações')}</SidebarGroupLabel> : <SidebarSeparator className="mb-3" />}
                <SidebarMenu>{group.sections.map((section) => <SectionMenuItem key={section.id} label={t(...section.label)} icon={createElement(settingsIcons[section.id as keyof typeof settingsIcons])} active={settingsSection === section.id} link={link({ tab: 'settings', section: section.id })} />)}</SidebarMenu>
              </SidebarGroup>)}
            </> : (
              <SidebarGroup className="px-3 pb-4">
                <SidebarMenu className="gap-1">
              {navigation.filter((item) => item.group === 'Main' && !(demoMode && (item.id === 'ai-bots' || item.id === 'comparison'))).map((item) => (
                  <SectionMenuItem
                    key={item.id}
                    groupId={item.id}
                    label={t(item.en, item.pt)}
                    icon={<item.icon />}
                    // In the New project wizard no screen of the open project is current: no row is marked.
                    active={!wizardShown && (tab === item.id || (item.id === 'prompts' && promptsGroup) || (item.id === 'agent' && agentGroup))}
                    link={link({ tab: item.id, entity: null, prompt: null, run: null })}
                    items={item.id === 'prompts' ? promptsTabs.map((id) => ({
                      id,
                      label: t(...label[id]),
                      active: tab === id,
                      link: link({ tab: id, entity: null, prompt: null, run: null }),
                      badge: id === 'prompts' ? <span className="nav-count">{workspace ? formatNumber(locale, workspace.prompts.filter((prompt) => prompt.active && !prompt.archived).length) : '—'}</span> : undefined,
                    })) : item.id === 'agent' ? (demoMode ? (['agent'] as const) : agentTabs).map((id) => ({
                      id,
                      label: t(...label[id]),
                      active: tab === id,
                      link: id === 'artifacts' || id === 'contents' ? listLink(id) : link({ tab: id, entity: null, prompt: null, run: null }),
                    })) : item.id === 'sources' ? [
                      { id: 'domain', label: t('Domains', 'Domínios'), active: tab === 'sources' && (entity?.kind ?? sourceGroup) === 'domain', link: link({ tab: 'sources', group: 'domain', entity: null, type: null, owner: null }) },
                      { id: 'url', label: 'URLs', active: tab === 'sources' && (entity?.kind ?? sourceGroup) === 'url', link: link({ tab: 'sources', group: 'url', entity: null, type: null, owner: null }) },
                    ] : item.id === 'products' ? Object.entries(PRODUCT_SECTIONS).map(([id, section]) => ({
                      id,
                      label: t(...section.label),
                      active: tab === 'products' && productSection(productDetail) === id,
                      link: link({ tab: 'products', productDetail: section.page }),
                    })) : item.id === 'comparison' ? Object.entries(COMPARISON_SECTIONS).map(([id, section]) => ({
                      id,
                      label: t(...section.label),
                      active: tab === 'comparison' && comparisonSection(comparisonView) === id,
                      link: link({ tab: 'comparison', comparisonView: section.page }),
                    })) : item.id === 'ai-bots' ? Object.entries(AI_BOTS_SECTIONS).map(([id, section]) => ({
                      id,
                      label: t(...section.label),
                      active: tab === 'ai-bots' && aiBotsSection(aiBotsView) === id,
                      link: link({ tab: 'ai-bots', aiBotsView: section.page }),
                    })) : undefined}
                  />
                ))}
                </SidebarMenu>
              </SidebarGroup>
            )}
          </nav>
        </SidebarContent>
        <SidebarFooter className="shrink-0 px-3 pb-3">
          {/* Same footer in every section: entering Settings only swaps the navigation above. */}
          <SidebarMenu>
            <SectionMenuItem
              label={t('Settings', 'Configurações')}
              icon={<navIcons.settings />}
              active={tab === 'settings' && settingsSection !== 'profile'}
              link={link({ tab: 'settings', section: 'workspace' })}
            />
            {admin && (
              <SectionMenuItem
                label={t(...label.admin)}
                icon={<navIcons.admin />}
                active={tab === 'admin'}
                link={link({ tab: 'admin', section: adminPages[0].id })}
              />
            )}
          </SidebarMenu>
          {loading && !workspace && <NavUser loading label={t('User menu', 'Menu do usuário')} />}
          {workspace && (
            <NavUser
              name={workspace.user.name || workspace.user.email}
              email={workspace.user.email}
              avatar={<UserAvatar user={{ name: workspace.user.name || workspace.user.email, importedAvatar: !demoMode }} className="account-avatar" />}
              label={t('User menu', 'Menu do usuário')}
            >
                <div className="menu-caption">
                    {workspace.capabilities.plan ?? t('Your plan', 'Seu plano')}
                  </div>
                <div className="grid gap-3 px-2 pb-2 pt-1">
                  <UsageMeterRow row={{ key: 'prompts', label: t('Prompts', 'Prompts'), used: workspace.capacity.prompts, limit: workspace.capabilities.promptLimit }} />
                  <UsageMeterRow row={{ key: 'topics', label: t('Topics', 'Tópicos'), used: workspace.capacity.topics, limit: workspace.capabilities.topicLimit }} />
                  <UsageMeterRow row={{ key: 'collections', label: t('Collections this month', 'Coletas neste mês'), used: workspace.usage?.used, limit: workspace.usage?.limit }} />
                  {/* The month's AI credits left (Unlimited: used; independent edition: the project's budget), in the plan's rows. */}
                  {agentProject && <AgentUsageRow key={agentProject} projectId={agentProject} />}
                </div>
                <DropdownMenuSeparator />
                <LanguageSwitcher submenu />
                <DropdownMenuItem onClick={() => navigate({ tab: 'settings', section: 'profile' })}>
                    <navIcons.profile />
                    {t('My profile', 'Meu perfil')}
                  </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTab('settings')}>
                    <navIcons.settings />
                    {t('Settings', 'Configurações')}
                  </DropdownMenuItem>
                <DropdownMenuItem
                  render={
                    <a
                      href="/docs"
                      aria-label={t('Documentation', 'Documentação')}
                    />
                  }
                >
                  <navIcons.docs />
                  {t('Documentation', 'Documentação')}
                  <ArrowUpRight className="ml-auto" />
                </DropdownMenuItem>
                {billingPanel && (workspace?.role === 'owner' || workspace?.role === 'admin') && (
                  <DropdownMenuItem
                    onClick={() => {
                      setSettingsSection('projects');
                      setTab('settings');
                    }}
                  >
                    <navIcons.billing />
                    {t('Plan and billing', 'Plano e cobrança')}
                  </DropdownMenuItem>
                )}
                {demoMode && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        cache.invalidate();
                        resetDemo?.();
                      }}
                    >
                      <navIcons.resetDemo />
                      {t('Reset demo', 'Restaurar demo')}
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem
                    disabled={busy}
                    onClick={async () => {
                      try {
                        if (demoMode) window.location.assign('/demo');
                        else {
                          await request('/api/auth/logout', 'POST');
                          announceSessionChange();
                          window.location.assign('/app');
                        }
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : String(cause),
                        );
                      }
                    }}
                  >
                    <navIcons.signOut />
                    {t('Sign out', 'Sair')}
                  </DropdownMenuItem>
            </NavUser>
          )}
        </SidebarFooter>
        <SidebarRail aria-label={t('Toggle navigation', 'Alternar navegação')} hint={sidebarOpen ? t('Click to collapse. Drag or use the arrow keys to resize.', 'Clique para recolher. Arraste ou use as setas para redimensionar.') : t('Click to expand.', 'Clique para expandir.')} />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header ref={topbarRef} className="analytics-topbar" data-filters-folded={foldedFilters > 0 || undefined}>
          <div className="topbar-path">
            <SidebarTrigger
              aria-label={t('Toggle navigation', 'Alternar navegação')}
            />
            <span className="topbar-divider" />
            {/* The project is named in the sidebar switcher; the path starts at the screen (docs/design/shell.md section 4). */}
            <Breadcrumb className="min-w-0" data-section-path={((tab === 'products' || tab === 'comparison' || tab === 'ai-bots') && !detailCrumb && !comparisonDetail) || undefined}>
              <BreadcrumbList className="flex-nowrap">
                {topbarCrumbs.map((crumb, index) => (
                  <Fragment key={index}>
                    {index > 0 && <BreadcrumbSeparator />}
                    {index < topbarCrumbs.length - 1 ? (
                      <BreadcrumbItem className="shrink-0">
                        {crumb.to ? <DrillLink link={link} to={crumb.to} className="hover:text-foreground">{crumb.label}</DrillLink> : crumb.label}
                      </BreadcrumbItem>
                    ) : (
                      <BreadcrumbItem className="min-w-0">
                        <Hint text={detailCrumb || comparisonDetail ? crumb.label : undefined}><BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage></Hint>
                      </BreadcrumbItem>
                    )}
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="topbar-actions">
            {/* While the workspace loads, the filters' places are held so the bar never changes once it arrives. */}
            {loading && !fullPage && !agentScreen && (
              <>
                <Skeleton aria-hidden="true" className="mobile-filter-toggle h-(--control-height-touch) w-21" />
                <div className="topbar-filters" aria-hidden="true">
                  <div className="analytics-filters">
                    <FilterBar>
                      {['w-36', 'w-36', 'w-28', 'w-24', 'w-28'].map((width, index) => <Skeleton key={index} className={`h-(--control-height) ${width}`} />)}
                    </FilterBar>
                  </div>
                </div>
              </>
            )}
            {/* The agent's screens filter nothing: the chat asks for the period it needs. */}
            {project && !creatingProject && !fullPage && !agentScreen && (
              <Button
                variant="outline"
                className="mobile-filter-toggle"
                aria-label={appliedHeaderFilters ? t(`Filters, ${appliedHeaderFilters} applied`, `Filtros, ${appliedHeaderFilters} aplicados`) : undefined}
                aria-expanded={mobileFiltersOpen}
                aria-controls="analytics-topbar-filters"
                onClick={() => setMobileFiltersOpen((open) => !open)}
              >
                <ListFilter size={16} />
                {t('Filters', 'Filtros')}
                {appliedHeaderFilters > 0 && <TagBadge tone="primary">{formatNumber(locale, appliedHeaderFilters)}</TagBadge>}
              </Button>
            )}
            {project && !creatingProject && !fullPage && !agentScreen && (
              <div
                className="topbar-filters"
                id="analytics-topbar-filters"
                data-mobile-open={mobileFiltersOpen}
              >
                <div className="analytics-filters">
                  <FilterBar>
                    {/* First: the row is anchored at its right end, so this button appearing never moves the filters. Phones name it. */}
                    {(headerFiltersActive || responseFiltersActive) && (
                      <Hint text={t('Clear filters', 'Limpar filtros')}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="max-md:w-auto max-md:px-3"
                        onClick={clearAllFilters}
                      >
                        <X aria-hidden="true" />
                        <span className="md:sr-only">{t('Clear filters', 'Limpar filtros')}</span>
                      </Button>
                      </Hint>
                    )}
                    {periodPicker}
                    {new Set(workspace?.projects.map((item) => item.location_code) ?? []).size > 1 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<FilterTrigger aria-label={t('Country', 'País')} />}>
                        <Globe2 />
                        {countryName(project.location_code, locale)}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="analytics-menu">
                        <DropdownMenuItem disabled>{t('Country is fixed for this project.', 'O país é fixo para este projeto.',
                          )}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTab('settings')}>{t('Change project country in Settings', 'Alterar país do projeto em Configurações',
                          )}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    )}
                    {/* Semantic Branding asks the AIs about the brand itself, not through the prompts: the period and the AI filter
                        apply there; topics, tags and brands do not, so the bar does not offer them (the page says why). */}
                    {engines.length > 0 && tab !== 'ai-bots' && <ModelFilter engines={engines} value={engineFilter} onChange={setEngineFilter} />}
                    {!sbScreen && <>
                    <NamesFilter icon={<Layers />} names={(workspace?.topics ?? []).map((topic) => topic.name)} value={topicFilter} separator={TOPIC_SEPARATOR} max={20} onChange={setTopicFilter} label={t('All topics', 'Todos os tópicos')} count={(n) => t(`${n} topics`, `${n} tópicos`)} />
                    <NamesFilter icon={<Tag />} names={[...new Set(workspace?.prompts.flatMap((item) => item.tags) ?? [])]} value={tagFilter} separator="," max={8} onChange={setTagFilter} label={t('All tags', 'Todas as tags')} count={(n) => t(`${n} tags`, `${n} tags`)} />
                    <BrandsFilter
                      value={brandsFilter}
                      onChange={setBrandsFilter}
                      monitored={[
                        { key: brandKey(project.name), name: project.name, domain: project.domain, kind: 'own' },
                        ...project.competitors.map((item) => ({ key: brandKey(item.name), name: item.name, domain: item.domain, kind: 'monitored' as const })),
                      ]}
                      discovered={discoveredChoices}
                      onOpen={() => setBrandMenuOpened(true)}
                      status={tab === 'competitors' && !brandPage ? { value: brandView, onChange: setBrandView } : undefined}
                    />
                    </>}
                  </FilterBar>
                </div>
              </div>
            )}
            <div className="topbar-help">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('More actions', 'Mais ações')}
                    />
                  }
                >
                  <EllipsisVertical size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="analytics-menu">
                  {project && !fullPage && !agentScreen && (
                    <ExportMenuItem
                      href={`${api}/export?${filterQuery}`}
                      label={exporting ? t('Preparing CSV…', 'Preparando CSV…') : t('Export', 'Exportar')}
                      busy={exporting || (tab === 'fanout' && (reportLoading || !fanout?.withFanout || Boolean(fanoutNavigation.selected)))}
                      onExport={
                        tab === 'fanout'
                          ? () => fanoutExport.current?.()
                          : demoMode
                          ? () => {
                              setExporting(true);
                              void Promise.resolve(exportDemo?.(filterQuery))
                                .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
                                .finally(() => setExporting(false));
                            }
                          : undefined
                      }
                    />
                  )}
                  <DropdownMenuItem onClick={() => window.location.assign('/docs')}>
                    <CircleHelp aria-hidden="true" />
                    {t('Help', 'Ajuda')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <div className="analytics-content live-content" id="analytics-main">
          {loading ? (
            <section aria-live="polite" aria-busy="true">{workspaceSkeleton}</section>
          ) : !workspace && error ? (
            <EmptyState
              tone="error"
              title={t('We could not load your workspace.', 'Não foi possível carregar seu workspace.')}
              description={t('Your projects and data are safe.', 'Seus projetos e dados estão preservados.')}
              onRetry={() => { setError(''); void refresh(projectId).catch((cause) => setError(cause.message)); }}
            />
          ) : adminNotAllowed ?? projectNotFound ?? (
            workspace && (
              <section>
                <>
                  {/* List screens follow the Prompts model: the table is the page (no title/subtitle). Detail pages keep their heading; a brand or source page leads with its own header. */}
                  {pageHeading}
                </>
                {creatingWorkspace && workspace.newWorkspace ? (
                  <WorkspaceWizard
                    key="new-workspace"
                    name=""
                    slug=""
                    selfEmail={workspace.user.email}
                    request={transport}
                    t={t}
                    create={{ gate: workspace.newWorkspace, onCancel: () => { setCreatingWorkspace(false); setCreatingProject(false); setRequestWorkspace(workspaceAddress); } }}
                    onDone={(slug) => window.location.assign(`/app/${encodeURIComponent(slug)}/onboarding`)}
                  />
                ) : showWorkspaceWizard ? (
                  <WorkspaceWizard
                    name={currentChoice!.name}
                    slug={currentChoice!.slug}
                    selfEmail={workspace.user.email}
                    request={transport}
                    t={t}
                    onDone={() => {
                      setWorkspaceNamed(true);
                      setSettingUpWorkspace(false);
                      setCreatingProject(true);
                      cache.invalidate();
                      void refresh(projectId).catch((cause) => setError(cause.message));
                    }}
                  />
                ) : ((!project && !fullPage) || creatingProject) && (
                  <NewProjectWizard
                    workspace={workspace}
                    project={project ?? null}
                    locale={locale}
                    t={t}
                    onCreated={async (id) => {
                      cache.invalidate();
                      await openProject(id);
                      setCreatingProject(false);
                      setTab('overview');
                    }}
                  />
                )}
                {project && !creatingProject && tab === 'overview' && (
                  <>
                    <h2 className="sr-only">{t('Overview', 'Visão geral')}</h2>
                    {workspace.monitoring?.collectionBlocked && (
                      // A limit stopped this project's collection; said here so daily data never stops silently.
                      <Note tone="danger" icon={<CircleAlert size={16} />} className="analytics-panel mb-5">
                        {workspace.monitoring.collectionBlocked.reason === 'platform'
                          // The platform's own pause: nothing the customer can do, so no internals and no remedy to look for.
                          ? t('Collection paused: it resumes on its own soon, nothing for you to do. If it lasts more than a day, contact support.', 'Coleta pausada: ela volta sozinha em breve, você não precisa fazer nada. Se durar mais de um dia, fale com o suporte.')
                          : `${t('Collection paused: ', 'Coleta pausada: ')}${blockLabel(workspace.monitoring.collectionBlocked.reason, t)}. ${blockRemedy(workspace.monitoring.collectionBlocked.reason, t)}`}
                      </Note>
                    )}
                    {reportLoading ? (
                      <OverviewSkeleton />
                    ) : summary && firstCollection ? (
                      // A new project before its first answer (12/11/2026): what is happening and when to come back, never cards
                      // that read "No responses". A recommendation, not a promise; the page follows the collection on its own.
                      <EmptyState
                        tone="progress"
                        title={t('Collecting the first answers', 'Coletando as primeiras respostas')}
                        description={t(
                          `The AIs are answering your ${firstCollection} prompt${firstCollection === 1 ? '' : 's'} now. The first answers usually arrive within 15 minutes, and the whole first collection within a few hours. We recommend coming back in about 15 minutes; this page updates on its own.`,
                          `As IAs estão respondendo ${firstCollection === 1 ? 'o seu prompt' : `os seus ${firstCollection} prompts`} agora. As primeiras respostas costumam chegar em até 15 minutos, e a primeira coleta inteira em algumas horas. Recomendamos voltar em cerca de 15 minutos; esta página se atualiza sozinha.`,
                        )}
                      />
                    ) : summary ? (
                        <div className="overview-rows">
                          <OverviewKpis summary={summary} locale={locale} t={t} link={link} settling={processing}>
                            <OverviewSentimentCard brand={project.name} link={link} locale={locale} demo={demoMode} operator={!!workspace.config?.providerSettings} engines={summary.channels?.map((channel) => channel.engine)} settling={processing || evaluating} {...sentiment} />
                          </OverviewKpis>
                          {summary.metrics.responses ? (<>
                          <div className="overview-grid">
                            <TrendCard
                              className="trend-panel"
                              title={t('Brand trend', 'Evolução das marcas')}
                              action={<div className="flex flex-wrap items-center justify-end gap-2">
                                <ToggleGroup multiple={false} value={[overviewChart]} onValueChange={(value) => { if (value[0]) setOverviewChart(value[0] as typeof overviewChart); }} size="sm" variant="outline" spacing={0} aria-label={t('Chart metric', 'Métrica do gráfico')}>
                                  {/* Each label folds to its icon when the card is narrow (.trend-toggle-label), so the header keeps one line beside the ranking's. */}
                                  <Hint text={t('Share of voice', 'Share of voice')}><ToggleGroupItem value="shareOfVoice" aria-label={t('Share of voice', 'Share of voice')}><MessageSquare /><span className="trend-toggle-label">SOV</span></ToggleGroupItem></Hint>
                                  <Hint text={t('Visibility', 'Visibilidade')}><ToggleGroupItem value="visibility" aria-label={t('Visibility', 'Visibilidade')}><Eye /><span className="trend-toggle-label">{t('Visibility', 'Visibilidade')}</span></ToggleGroupItem></Hint>
                                  <Hint text={t('Position', 'Posição')}><ToggleGroupItem value="position" aria-label={t('Position', 'Posição')}><ListOrdered /><span className="trend-toggle-label">{t('Position', 'Posição')}</span></ToggleGroupItem></Hint>
                                </ToggleGroup>
                                <ToggleGroup multiple={false} value={[overviewResolution]} onValueChange={(value) => { if (value[0]) setOverviewResolution(value[0] as TrendResolution); }} size="sm" variant="outline" spacing={0} aria-label={t('Time resolution', 'Resolução temporal')}>
                                  {(['day', 'week', 'month'] as const).map((resolution, index) => <Hint key={resolution} text={resolution === 'day' ? t('Day', 'Dia') : resolution === 'week' ? t('Week', 'Semana') : t('Month', 'Mês')}><ToggleGroupItem value={resolution} aria-label={resolution === 'day' ? t('Day', 'Dia') : resolution === 'week' ? t('Week', 'Semana') : t('Month', 'Mês')}>{['D', 'W', 'M'][index]}</ToggleGroupItem></Hint>)}
                                </ToggleGroup>
                              </div>}
                              series={orderedChartBrands}
                              hidden={hiddenChartBrands}
                              folded={foldedChartBrands}
                              onToggle={(id) => setChartBrandChoices((current) => ({ ...current, [id]: hiddenChartBrands.includes(id) }))}
                              empty={hasChartData ? undefined : <EmptyState frame="bare" title={visibleChartBrands.length === 0 ? t('Select a brand to display.', 'Selecione uma marca para exibir.') : overviewChart === 'position' ? t('No measured mention positions in this period.', 'Sem posições de menção medidas neste período.') : t('No measured data in this period.', 'Sem dados medidos neste período.')} />}
                              data={overviewTrend}
                              scale={overviewScale}
                              locale={locale}
                              reversed={overviewChart === 'position'}
                              monthly={overviewResolution === 'month'}
                              formatValue={(value) => overviewChart === 'position' ? formatNumber(locale, value, 1) : formatPercent(locale, value)}
                              formatTick={(value) => overviewChart === 'position' ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value) : formatPercent(locale, value, 0)}
                              onSelectDate={(date) => navigate({ tab: 'responses', range: trendRange(date, overviewResolution), brand: null, brandLabel: null, sentiment: null, mention: 'all', cites: null, run: null, prompt: null })}
                              // A brand's point: that brand's answers in that day, week or month (a discovered one by its key).
                              onSelectSeries={(date, series) => {
                                const discovered = series.id.startsWith('discovered:') ? series.id.slice('discovered:'.length) : null;
                                navigate({
                                  tab: 'responses', range: trendRange(date, overviewResolution), mention: 'mentioned', sentiment: null, cites: null, run: null, prompt: null,
                                  brand: series.primary ? null : discovered ?? series.name, brandLabel: discovered ? series.name : null,
                                });
                              }}
                            />
                            <SectionCard
                              className="ranking-panel rows-fit"
                              title={t('Brand ranking', 'Ranking de marcas')}
                              action={<ViewAllAction link={link} to={{ tab: 'competitors', brandPage: null }}>{t('View all', 'Ver todas')}</ViewAllAction>}
                            >
                              <DataTable singleLine minWidth={0} containerProps={{ ref: rankingTable }}
                                rows={rankingRows}
                                rowKey={(item) => item.key}
                                ariaLabel={t('Brand ranking', 'Ranking de marcas')}
                                rowLink={(item) => link({ tab: 'competitors', brandPage: item.discovered ? item.discovered.key : brandKey(item.name) })}
                                columns={[
                                  { key: 'rank', header: '#', ...RANKING_COLUMNS.rank, align: 'center', cell: (item) => formatNumber(locale, item.rank) },
                                  { key: 'brand', header: t('Brand', 'Marca'), ...RANKING_COLUMNS.brand, sortValue: (item) => item.name, cell: (item) => (
                                    <span className="flex flex-wrap items-center gap-2"><BrandName name={item.name} domain={item.domain} own={false} />
                                      {item.discovered?.review && <TagBadge tone="quiet" title={item.discovered.row.reasons.join(', ') || undefined}>{t('To review', 'A revisar')}</TagBadge>}
                                    </span>
                                  ) },
                                  // The trend's metric: a position is lower-is-better and a brand without one shows a dash, never a zero.
                                  { key: overviewChart, header: rankingLabel, label: rankingLabel, align: 'end', width: RANKING_COLUMNS.metric[overviewChart], sortValue: (item) => item.value, cell: (item) => item.value != null
                                    ? overviewChart === 'position' ? formatNumber(locale, item.value, 1) : formatPercent(locale, item.value)
                                    : <Hint text={overviewChart === 'position'
                                      ? item.discovered ? t('Position is measured for monitored brands.', 'A posição é medida para marcas monitoradas.') : t('No measured mention position in this period.', 'Sem posição de menção medida neste período.')
                                      : item.discovered ? t('Shown when the analysis of the saved answers finishes.', 'Aparece quando a análise das respostas salvas termina.') : t('No brand mentions in this period.', 'Nenhuma menção a marcas neste período.')}><span>—</span></Hint> },
                                ]}
                              />
                              {(discoveries.state === 'error' || discoveries.state === 'unavailable') && (
                                <Note
                                  tone="danger"
                                  data-testid="discoveries-unavailable"
                                  action={<Button variant="outline" onClick={discoveries.retry}>{t(...RETRY_LABEL)}</Button>}
                                >
                                  {discoveries.state === 'error'
                                    ? t('Discovered brands could not be loaded; the monitored brands above are not affected.', 'Não foi possível carregar as marcas descobertas; as marcas monitoradas acima não são afetadas.')
                                    : t('Discovered brands are temporarily unavailable; your decisions are safe.', 'As marcas descobertas estão temporariamente indisponíveis; suas decisões estão preservadas.')}
                                </Note>
                              )}
                              <MoreCompetitorsNote
                                competitors={project.competitors.length}
                                discovered={discoveries.waiting > 0 || discoveries.brands.length > 0}
                                onAdd={demoMode ? undefined : () => { setBrandView('discovered'); setTab('competitors'); }}
                                t={t}
                              />
                            </SectionCard>
                          </div>
                          {/* Semantic Branding (radar beside the brands' scores, from the same report as its page), then topic coverage. */}
                          <SemanticOverviewRow projectId={project.id} filters={filterQuery} request={request} refresh={dataRevision} demo={demoMode} admin={admin} link={link} onConfigure={() => { setSettingsSection('semantic'); setTab('settings'); }} />
                          <OverviewTopicCoverage summary={summary} brand={project.name} link={link} locale={locale} t={t}
                            topics={filterQuery.getAll('topic').length ? filterQuery.getAll('topic') : workspace.topics.filter((item) => item.project_id === project.id).map((item) => item.name)} />
                          <div className="overview-grid overview-pair">
                            <SourceTypesPanel
                              report={typesReport}
                              loading={typesState === 'loading' && !typesReport}
                              failed={typesState === 'failed'}
                              locale={locale}
                              t={t}
                              classifying={classifying}
                              actionError={classifyError}
                              limit={OVERVIEW_TYPES_SHOWN}
                              quiet
                              onSelectType={(type) => navigate({ tab: 'sources', group: 'domain', type, owner: null, entity: null })}
                              onClassify={demoMode ? undefined : () => void classifySources('domain')}
                              onConfigure={demoMode ? undefined : () => { setSettingsSection('competitors'); setTab('settings'); }}
                              viewAll={{ link, to: { tab: 'sources', group: 'domain', type: null, owner: null, entity: null } }}
                              onRetry={() => setTypesAttempt((value) => value + 1)}
                            />
                            <SectionCard
                              className="rows-fit"
                              title={t('Most cited domains', 'Domínios mais citados')}
                              action={<ViewAllAction link={link} to={{ tab: 'sources', group: 'domain', kind: 'cited', type: null, owner: null, entity: null }}>{t('View all', 'Ver todos')}</ViewAllAction>}
                            >
                              <TopSourcesList state={overviewSourcesState} rows={overviewSources?.leaders?.ranking ?? overviewSources?.rows ?? []} limit={domainsFit} tableRef={domainsTable} link={link} locale={locale} t={t} group="domain" />
                            </SectionCard>
                          </div>
                          <div className="overview-grid overview-pair">
                            <ContentTypesPanel
                              report={contentReport}
                              loading={contentState === 'loading' && !contentReport}
                              failed={contentState === 'failed'}
                              locale={locale}
                              t={t}
                              classifying={classifying}
                              actionError={classifyError}
                              limit={OVERVIEW_TYPES_SHOWN}
                              quiet
                              onSelectType={(type) => navigate({ tab: 'sources', group: 'url', type, owner: null, entity: null })}
                              onClassify={demoMode ? undefined : () => void classifySources('url')}
                              onConfigure={demoMode ? undefined : () => { setSettingsSection('competitors'); setTab('settings'); }}
                              viewAll={{ link, to: { tab: 'sources', group: 'url', type: null, owner: null, entity: null } }}
                              onRetry={() => setContentAttempt((value) => value + 1)}
                            />
                            <SectionCard
                              className="rows-fit"
                              title={t('Most cited pages', 'Páginas mais citadas')}
                              action={<ViewAllAction link={link} to={{ tab: 'sources', group: 'url', kind: 'cited', type: null, owner: null, entity: null }}>{t('View all', 'Ver todas')}</ViewAllAction>}
                            >
                              <TopSourcesList state={overviewContentState} rows={overviewContent?.leaders?.ranking ?? overviewContent?.rows ?? []} limit={pagesFit} tableRef={pagesTable} link={link} locale={locale} t={t} group="url" />
                            </SectionCard>
                          </div>
                          <div className="overview-grid overview-pair">
                            <TopTermsCard report={overviewFanout} loading={overviewFanoutState === 'loading'} failed={overviewFanoutState === 'failed'} link={link} locale={locale} t={t} selected={fanoutNavigation.term ? termKey(fanoutNavigation.term) : null} />
                            <SectionCard
                              className="overview-fanout rows-fit"
                              title={t('Query Fan Out', 'Query Fan Out')}
                              action={<ViewAllAction link={link} to={{ tab: 'fanout' }}>{t('View all', 'Ver todas')}</ViewAllAction>}
                              loading={overviewFanoutState === 'loading'}
                            >
                              {overviewFanoutState === 'failed' ? (
                                <EmptyState frame="bare" tone="error" title={t('Could not load the queries.', 'Não foi possível carregar as consultas.')} />
                              ) : !(overviewFanout?.queries ?? []).length ? (
                                <EmptyState frame="bare" title={t('No fan-out queries in this period.', 'Sem consultas de fan-out neste período.')} />
                              ) : (
                                <DataTable singleLine minWidth={0} containerProps={{ ref: fanoutTable }}
                                  rows={fanoutRows}
                                  rowKey={(row) => row.key}
                                  ariaLabel={t('Query Fan Out', 'Query Fan Out')}
                                  rowLink={() => link({ tab: 'fanout' })}
                                  columns={[
                                    {
                                      key: 'query',
                                      header: t('Query', 'Consulta'),
                                      mobile: 'title',
                                      cell: (row) => <Hint text={row.text}><span className="overview-fanout-query">{row.text}</span></Hint>,
                                    },
                                    {
                                      key: 'occurrences',
                                      header: t('Occurrences', 'Ocorrências'),
                                      label: t('Occurrences', 'Ocorrências'),
                                      align: 'end',
                                      width: '7.5rem',
                                      cell: (row) => formatNumber(locale, row.occurrences),
                                    },
                                  ]}
                                />
                              )}
                            </SectionCard>
                          </div>
                          <SectionCard
                            className="overview-recent"
                            title={t('Recent responses', 'Respostas recentes')}
                            action={<ViewAllAction link={link} to={{ tab: 'responses', run: null }}>{t('View all', 'Ver todas')}</ViewAllAction>}
                          >
                            <RecentResponsesTable state={overviewHistoryState} runs={overviewHistory?.runs ?? []} link={link} locale={locale} t={t} />
                          </SectionCard>
                        </>) : (
                        workspace.config?.dataforseo === false ? (
                          // An installation without provider keys accepts prompts but never collects: say so instead of waiting forever.
                          <EmptyState
                            title={t('Monitoring is off: this installation has no search data key.', 'O monitoramento está desligado: esta instalação não tem a chave de dados de busca.')}
                            description={<>{t('Add it in Admin > Providers; your prompts are kept.', 'Adicione em Admin > Provedores; seus prompts ficam guardados.')}{' '}<a href="/app/admin/providers" className="text-primary hover:underline">{t('Open Admin', 'Abrir Admin')}</a></>}
                          />
                        ) : (
                          <EmptyState
                            title={t('No collected answers yet.', 'Ainda não há respostas coletadas.')}
                            description={
                              workspace.prompts.some((item) => item.project_id === project.id && item.active && !item.archived)
                                ? workspace.monitoring && workspace.monitoring.pending > 0
                                  // A collection in flight (a new project's first one starts right away, 8/11/2026): said, never its size.
                                  ? t('A collection is in progress: results appear as soon as it completes.', 'Uma coleta está em andamento: os resultados aparecem assim que ela terminar.')
                                  : `${t('Results appear after a collection completes.', 'Os resultados aparecem depois que uma coleta termina.')} ${nextCollectionCopy}`
                                : `${t('Add a prompt to start monitoring.', 'Adicione um prompt para começar o monitoramento.')} ${newPromptCopy}`
                            }
                          />
                        )
                      )}
                        </div>
                    ) : null}
                    <p className="live-muted">
                      {t('Monitoring', 'Monitoramento')}:{' '}
                      {workspace.config?.dataforseo === false
                        ? t('off, no search data key', 'desligado, sem chave de dados de busca')
                        : project.daily_enabled
                        ? scheduleOf(project, free).weekly ? t('weekly', 'semanal') : t('daily', 'diário')
                        : t('paused', 'pausado')}
                    </p>
                  </>
                )}
                {project && !creatingProject && tab === 'topics' && (
                  <>
                    <h2 className="sr-only">{t('Topics', 'Tópicos')}</h2>
                    <SectionCard inset="padded" title={t('Add a topic', 'Adicionar um tópico')}>
                      <form
                        className="live-inline"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void mutate('/api/topics', 'POST', {
                            project_id: project.id,
                            name: topic.trim(),
                          });
                        }}
                      >
                        <input
                          aria-label={t('Topic name', 'Nome do tópico')}
                          required
                          maxLength={40}
                          value={topic}
                          onChange={(event) => setTopic(event.target.value)}
                          placeholder={t('New topic', 'Novo tópico')}
                        />
                        <button disabled={busy || topicsFull}>
                          {t('Add topic', 'Adicionar tópico')}
                        </button>
                      </form>
                    </SectionCard>
                    {workspace.topics.length ? (
                      <SectionCard>
                        <DataTable singleLine="wide"
                          rows={topicsPage.rows}
                          rowKey={(item) => item.id}
                          sort={topicsPage.sort}
                          onSortChange={topicsPage.onSortChange}
                          columns={[
                            { key: 'name', header: t('Topic', 'Tópico'), mobile: 'title', sortValue: (item) => item.name, cell: (item) => item.name },
                            {
                              key: 'rename', mobile: 'wide', header: <span className="sr-only">{t('Rename', 'Renomear')}</span>,
                              cell: (item) => (
                                <Button
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => {
                                    const next = window.prompt(t('Rename topic', 'Renomear tópico'), item.name);
                                    if (next?.trim()) void mutate('/api/topics', 'PATCH', { id: item.id, name: next.trim() });
                                  }}
                                >
                                  {t('Rename', 'Renomear')}
                                </Button>
                              ),
                            },
                          ]}
                        />
                        {topicsPage.controls}
                      </SectionCard>
                    ) : (
                      <EmptyState title={t('No topics yet.', 'Ainda não há tópicos.')} />
                    )}
                  </>
                )}
                {project && !creatingProject && (
                  <PromptDialog
                    key={`${addOpen ? 'open' : 'closed'}:${editingPrompt?.id ?? 'new'}`}
                    open={addOpen}
                    onOpenChange={(open) => { setAddOpen(open); if (!open) setEditingPrompt(null); }}
                    editing={editingPrompt}
                    project={project}
                    topics={workspace.topics}
                    engines={engines}
                    atLimit={promptsFull}
                    collectionNote={newPromptCopy}
                    demo={demoMode}
                    busy={busy}
                    serverError={addOpen ? error : ''}
                    t={t}
                    onSubmit={async (payload) =>
                      !!(await mutate(editingPrompt ? `/api/prompts/${encodeURIComponent(editingPrompt.id)}` : '/api/prompts', editingPrompt ? 'PATCH' : 'POST', {
                        ...(!editingPrompt ? { project_id: project.id } : {}),
                        ...payload,
                      }))
                    }
                  />
                )}
                {project && !creatingProject && promptMissing && (
                  <EmptyState
                    title={t('Prompt not found', 'Prompt não encontrado')}
                    description={t('No prompt of this project has this address. It may have been deleted, or the link is incomplete.', 'Nenhum prompt deste projeto tem este endereço. Ele pode ter sido excluído, ou o link está incompleto.')}
                    action={<Button variant="outline" nativeButton={false} render={<a {...link({ tab: 'prompts', prompt: null })} aria-label={t('View all prompts', 'Ver todos os prompts')} />}>{t('View all prompts', 'Ver todos os prompts')}</Button>}
                  />
                )}
                {project && !creatingProject && tab === 'prompts' && !promptMissing && (
                  <>
                    <h2 className="sr-only">{t('Prompts', 'Prompts')}</h2>
                    <Dialog open={importOpen} onOpenChange={setImportOpen}>
                      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
                        <DialogHeader>
                          <DialogTitle>{t('Import prompts', 'Importar prompts')}</DialogTitle>
                          <DialogDescription>{t('Upload a CSV with a prompt column. Review the rows before importing.', 'Envie um CSV com a coluna prompt. Confira as linhas antes de importar.',
                            )}</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-3">
                          <Button variant="outline" onClick={() => importInput.current?.click()}>{t('Choose CSV file', 'Escolher arquivo CSV')}</Button>
                          <label className="grid gap-2">{t('CSV content', 'Conteúdo CSV')}
                            <Textarea className="min-h-32 font-mono" value={importText} onChange={(event) => setImportText(event.target.value)} />
                          </label>
                          {importText && (
                            <p role={importPreview.error ? 'alert' : 'status'} className="text-muted-foreground">{importPreview.error ? t('Invalid CSV: ', 'CSV inválido: ') + importPreview.error : `${formatNumber(locale, importPreview.rows.length)} ${t('prompts ready', 'prompts prontos')}`}</p>
                          )}
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setImportOpen(false)}>{t('Cancel', 'Cancelar')}</Button>
                          <Button disabled={busy || !importPreview.rows.length || !!importPreview.error} onClick={() => void mutate('/api/prompts', 'POST', { project_id: project.id, prompts: importPreview.rows.map((row) => ({ text: row.text, engines: null, tag: row.topic || defaultTopic(project.language_code), tags: row.tags,
                                })),
                              }).then((saved) => { if (saved) setImportOpen(false); })}>{t('Import prompts', 'Importar prompts')}</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <div
                      className={`prompts-layout grid items-start gap-5 ${selectedPrompt ? 'live-prompt-detail-layout' : 'live-table-fill'}`}>
                      <div className={`analytics-panel prompts-panel collection-panel live-prompts-main${selectedPrompt ? '' : ' live-table-fill-panel'}`}>
                        <DataTableToolbar
                          className="live-prompt-toolbar"
                          label={t('Prompt filters', 'Filtros de prompts')}
                          actions={
                            <>
                              <ColumnPicker
                                label={t('Columns', 'Colunas')}
                                columns={Object.entries(promptColumnLabels).map(([key, label]) => ({ key, label }))}
                                hidden={promptColumnsPref.hidden}
                                onChange={promptColumnsPref.setHidden}
                              />
                              {promptActions}
                              <input
                                ref={importInput}
                                className="sr-only"
                                type="file"
                                accept=".csv,text/csv"
                                aria-label={t('Import CSV', 'Importar CSV')}
                                onChange={async (event) => {
                                  const file = event.target.files?.[0];
                                  event.target.value = '';
                                  if (!file) return;
                                  try { setImportText(await file.text()); }
                                  catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                                }}
                              />
                            </>
                          }
                        >
                          <Tabs value={statusFilter} onValueChange={(status: typeof statusFilter) => { setStatusFilter(status); setSelectedPrompts([]); }}>
                            <TabsList variant="line" aria-label={t('Prompt status', 'Status dos prompts')}>
                              {(['active', 'inactive', 'archived'] as const).map((status) => (
                                <TabsTrigger key={status} value={status}>
                                  {status === 'active'
                                    ? t('Active', 'Ativos')
                                    : status === 'inactive'
                                      ? t('Inactive', 'Inativos')
                                      : t('Archived', 'Arquivados')}
                                  <span className="live-status-count">{formatNumber(locale, promptStatusCount(status))}</span>
                                </TabsTrigger>
                              ))}
                            </TabsList>
                          </Tabs>
                          <SearchField
                            value={queryText}
                            onChange={setQuery}
                            placeholder={t('Search prompts…', 'Buscar prompts…')}
                          />
                          <PromptFiltersButton
                            value={promptFilters}
                            preview={(filters) => promptsAfter(filteredPrompts, filters).length}
                            onChange={setPromptFilters}
                          />
                          <PageFilters>
                            <FilterSelect
                              multiple={false}
                              label={t('Competitors', 'Concorrentes')}
                              value={promptGap ? 'competitor-only' : 'all'}
                              onChange={(value) => setPromptGap(value === 'competitor-only')}
                              options={[
                                { value: 'all', label: t('All prompts', 'Todos os prompts') },
                                { value: 'competitor-only', label: t('Only competitors', 'Só concorrentes') },
                              ]}
                            />
                          </PageFilters>
                        </DataTableToolbar>
                        {selectedVisiblePrompts.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2">
                            <span className="mr-2 text-foreground">{formatNumber(locale, selectedVisiblePrompts.length)}{' '} {t('selected', 'selecionados')}</span>
                            <Button variant="outline" size="xs" disabled={busy} onClick={() => void Promise.all(selectedVisiblePrompts.map((item) => request(`/api/prompts/${encodeURIComponent(item.id)}`, 'PATCH', { active: false },
                                    ),
                                  ),
                                ).then(() => refresh(project.id)).then(() => setSelectedPrompts([])).catch((cause) => setError(String(cause)))}>{t('Pause', 'Pausar')}</Button>
                            <Button variant="outline" size="xs" disabled={busy} onClick={() => void Promise.all(selectedVisiblePrompts.map((item) => request(`/api/prompts/${encodeURIComponent(item.id)}`, 'PATCH', { active: true, archived: false },
                                    ),
                                  ),
                                ).then(() => refresh(project.id)).then(() => setSelectedPrompts([])).catch((cause) => setError(String(cause)))}>{t('Restore', 'Restaurar')}</Button>
                            <Button variant="outline" size="xs" disabled={busy} onClick={() => void Promise.all(selectedVisiblePrompts.map((item) => request(`/api/prompts/${encodeURIComponent(item.id)}`, 'PATCH', { archived: true },
                                    ),
                                  ),
                                ).then(() => refresh(project.id)).then(() => setSelectedPrompts([])).catch((cause) => setError(String(cause)))}>{t('Archive', 'Arquivar')}</Button>
                            <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={t('Clear selection', 'Limpar seleção',
                              )} onClick={() => setSelectedPrompts([])}><X /></Button>
                          </div>
                        )}
                        {promptMetricsFailed && (
                          <p role="alert" className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-destructive">
                            {t('Could not load visibility and position.', 'Não foi possível carregar visibilidade e posição.')}
                            <Button variant="outline" size="xs" onClick={() => setReportAttempt((value) => value + 1)}>{t(...RETRY_LABEL)}</Button>
                          </p>
                        )}
                        {visiblePrompts.length ? (
                          <DataTable singleLine="wide"
                            tableRef={promptTable}
                            minWidth={720}
                            className="table-fixed"
                            fill={!selectedPrompt}
                            columns={promptTableColumns()}
                            rows={visiblePrompts}
                            rowKey={(item) => item.id}
                            sort={promptSort}
                            onSortChange={setPromptSort}
                            rowState={(item) => selectedPrompts.includes(item.id) ? 'selected' : undefined}
                            summary={promptSummaryRow}
                            summaryAside={promptSummaryPager}
                          />
                        ) : (
                          (queryText || topicFilter || tagFilter || engineFilter !== 'all' || promptGap || activeConditions(promptFilters).length > 0) ? (
                            <EmptyState
                              frame="bare"
                              title={t('No prompts match these filters', 'Nenhum prompt com estes filtros')}
                              action={<Button variant="outline" onClick={() => { clearFilter.engine(); clearFilter.topic(); clearFilter.tag(); clearFilter.prompts(); }}>{t('Clear filters', 'Limpar filtros')}</Button>}
                            />
                          ) : statusFilter === 'active' && promptStatusCount('inactive') > 0 ? (
                            <EmptyState
                              frame="bare"
                              title={t('No active prompts', 'Nenhum prompt ativo')}
                              action={<Button variant="outline" onClick={() => { setStatusFilter('inactive'); setSelectedPrompts([]); }}>{t(`View ${formatNumber(locale, promptStatusCount('inactive'))} inactive`, `Ver ${formatNumber(locale, promptStatusCount('inactive'))} inativos`)}</Button>}
                            />
                          ) : (
                            <EmptyState
                              frame="bare"
                              title={t('No prompts yet.', 'Ainda não há prompts.')}
                              description={`${t('Add the questions your customers ask AI.', 'Adicione as perguntas que seus clientes fazem à IA.')} ${newPromptCopy}`}
                              action={<Button disabled={promptsFull} onClick={() => openPromptEditor()}>{t('Add prompt', 'Adicionar prompt')}</Button>}
                            />
                          )
                        )}
                        {selectedPrompt &&
                          detailReport &&
                          'daily' in detailReport && (
                            <article className="grid gap-5">
                              <MetricGrid columns={4}>
                                <MetricCard
                                  label={t('Responses', 'Respostas')}
                                  value={formatNumber(locale, promptNow.responses)}
                                  definition={promptWhy(t('Complete answers to this prompt in the period.', 'Respostas completas a este prompt no período.'), promptBefore?.responses)}
                                  delta={promptDelta(promptNow.responses, promptBefore?.responses, '')}
                                />
                                <MetricCard
                                  label={t('Mentions', 'Menções')}
                                  value={promptUnanswered ? '—' : formatNumber(locale, promptNow.mentions)}
                                  definition={promptWhy(t('Answers to this prompt that mention your brand.', 'Respostas a este prompt que mencionam a sua marca.'), promptBefore?.mentions)}
                                  delta={promptDelta(promptNow.mentions, promptBefore?.mentions, '')}
                                />
                                <MetricCard
                                  label={t('Visibility', 'Visibilidade')}
                                  value={promptNow.responses ? formatPercent(locale, promptNow.visibility) : '—'}
                                  definition={promptWhy(t('Answers mentioning your brand ÷ all answers to this prompt.', 'Respostas que mencionam a sua marca ÷ todas as respostas a este prompt.'), promptBefore?.visibility)}
                                  delta={promptNow.responses ? promptDelta(promptNow.visibility, promptBefore?.visibility, ' pp') : undefined}
                                />
                                <MetricCard
                                  label={t('Position', 'Posição')}
                                  value={promptNow.position != null ? formatNumber(locale, promptNow.position, 1) : '—'}
                                  definition={promptWhy(
                                    t('Average rank of the brand’s first mention among the competitors the answer names, monitored and discovered (1 = named first). Lower is better.', 'Posição média da primeira menção à marca entre os concorrentes que a resposta cita, monitorados e descobertos (1 = citada primeiro). Quanto menor, melhor.') +
                                      (promptNow.responses && promptNow.position == null ? ` ${t('The brand was not mentioned in any answer.', 'A marca não foi mencionada em nenhuma resposta.')}` : ''),
                                    promptBefore?.position,
                                  )}
                                  delta={promptNow.position != null ? promptDelta(promptNow.position, promptBefore?.position, '', true) : undefined}
                                />
                              </MetricGrid>
                              <PromptAnswersByModel detail={detailReport} api={api} project={project} link={link} locale={locale} t={t} listed={brandListed} filters={filterQuery} promptId={selectedPrompt.id} demo={demoMode} request={request} />
                              <PromptBrandRanking api={api} filters={filterQuery} promptId={selectedPrompt.id} project={project} locale={locale} t={t} listed={listedBrands} discovered={discoveredNames} request={request} demo={demoMode} />
                              <SectionCard
                                title={t(
                                  'Visibility over time',
                                  'Visibilidade ao longo do tempo',
                                )}
                              >
                                {promptTrend.length === 1 ? (
                                  <EmptyState frame="bare" title={t(
                                    `Only one day of answers so far (${formatPercent(locale, promptTrend[0].visibility)} visibility on ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${promptTrend[0].date}T00:00:00Z`))}). The trend line appears once a second day is collected.`,
                                    `Só há um dia de respostas até agora (${formatPercent(locale, promptTrend[0].visibility)} de visibilidade em ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${promptTrend[0].date}T00:00:00Z`))}). A linha de evolução aparece quando o segundo dia for coletado.`,
                                  )} />
                                ) : promptTrend.length ? (
                                  <TrendChart
                                    data={promptTrend}
                                    series={[{ id: 'visibility', key: 'visibility', name: t('Visibility', 'Visibilidade'), color: 'var(--chart-1)', primary: true }]}
                                    scale={promptScale}
                                    locale={locale}
                                    formatValue={(value) => formatPercent(locale, value)}
                                    formatTick={(value) => `${value}%`}
                                    label={t('Visibility over time', 'Visibilidade ao longo do tempo')}
                                  />
                                ) : (
                                  <EmptyState frame="bare" title={t('No collected answers for this prompt in the selected period.', 'Sem respostas coletadas para este prompt no período selecionado.')} />
                                )}
                              </SectionCard>
                              <SectionCard title={t('Cited domains', 'Domínios citados')}>
                                <DataTable singleLine="wide"
                                  rows={!showAllSources ? detailReport.sources.slice(0, 8) : detailReport.sources}
                                  rowKey={(item) => item.domain}
                                  caption={
                                    !showAllSources && detailReport.sources.length > 8 ? (
                                      <>
                                        {t(
                                          `Top 8 of ${detailReport.sources.length}${detailReport.hasMoreSources ? '+' : ''}, cited domains`,
                                          `Top 8 de ${detailReport.sources.length}${detailReport.hasMoreSources ? '+' : ''}, domínios citados`,
                                        )}
                                        <Button variant="ghost" onClick={() => setShowAllSources(true)}>
                                          {t('Show all cited domains', 'Ver todos os domínios citados')}
                                        </Button>
                                      </>
                                    ) : undefined
                                  }
                                  columns={[
                                    {
                                      key: 'domain', header: t('Domain', 'Domínio'), mobile: 'title',
                                      cell: (item) => (
                                        <DrillLink link={link} to={{ tab: 'sources', prompt: null, entity: { kind: 'domain', key: item.domain } }} className="flex items-center gap-2">
                                          <SiteFavicon domain={item.domain} name={item.domain} />
                                          {item.domain}
                                        </DrillLink>
                                      ),
                                    },
                                    { key: 'responses', header: t('Responses citing it', 'Respostas que o citam'), label: t('Responses citing it', 'Respostas que o citam'), align: 'end', cell: (item) => formatNumber(locale, item.responses) },
                                  ]}
                                />
                                {!detailReport.sources.length && (
                                  <EmptyState frame="bare" title={promptSourcesEmptyText(promptUnanswered, t)} />
                                )}
                                {showAllSources && detailPagination('sources', !!detailReport.hasMoreSources)}
                              </SectionCard>
                              <BrandResearchPanel key={`${project.id}:${selectedPrompt.id}`} request={request} project={project} filters={filterQuery} demo={demoMode} refresh={cache.generation} busy={busy} onManage={() => { setSettingsSection('competitors'); setTab('settings'); }} onEvidence={(runId) => { setTab('responses'); void onRun(runId); }} promptId={selectedPrompt.id} />
                              <SectionCard title={t('Response history', 'Histórico de respostas')}>
                                {!detailReport.history.runs.length && (
                                  <EmptyState frame="bare" title={t('No run yet for this prompt. Every collection will be listed here, including failed ones.', 'Ainda não há coletas deste prompt. Cada coleta aparecerá aqui, inclusive as que falharem.')} />
                                )}
                                <DataTable singleLine="wide"
                                  rows={detailReport.history.runs}
                                  rowKey={(run) => run.id}
                                  rowLink={(run) => link({ tab: 'responses', prompt: null, run: run.id })}
                                  columns={[
                                    { key: 'model', header: t('Model', 'Modelo'), mobile: 'title', cell: (run) => <span className="flex items-center gap-2"><EngineIcon engine={run.engine} />{ENGINE_LABELS[run.engine]}</span> },
                                    { key: 'date', header: t('Date', 'Data'), label: t('Date', 'Data'), cell: (run) => <time dateTime={run.created_at}>{relativeReportDate(run.created_at, locale)}</time> },
                                    { key: 'status', header: t('Status', 'Status'), label: t('Status', 'Status'), cell: (run) => <TagBadge tone={run.status === 'failed' ? 'danger' : 'neutral'}>{run.status === 'complete' ? t('Complete', 'Concluída') : run.status === 'failed' ? t('Failed', 'Falhou') : t('Pending', 'Pendente')}</TagBadge> },
                                  ]}
                                />
                                {detailPagination(
                                'history',
                                !!detailReport.history.nextCursor,
                              )}
                              </SectionCard>
                            </article>
                          )}
                        {selectedPrompt && (!detailReport || !('daily' in detailReport)) &&
                          (detailLoading || !error ? (
                            promptReportSkeleton
                          ) : (
                            <EmptyState title={t('The prompt report is unavailable. Retry to load it.', 'O relatório do prompt está indisponível. Tente carregar novamente.')} />
                          ))}
                      </div>
                    </div>
                  </>
                )}
                {project && !creatingProject && tab === 'responses' && (
                  <>
                    <h2 className="sr-only">{t('Responses', 'Respostas')}</h2>
                    <DataTableScreen
                      fill={!runRoute}
                      busy={busy}
                      cards={(() => {
                        if (!tabSummary) return skeletonCards(3);
                        const available = (key: 'visibility' | 'citationPresence') => Boolean(tabSummary.availability[key]?.current);
                        const comparable = (key: 'visibility' | 'citationPresence') => available(key) && summaryComparable(tabSummary, key);
                        const responsesComparable =
                          tabSummary.comparison.comparable &&
                          tabSummary.comparison.hasPreviousData &&
                          tabSummary.samples.previous > 0;
                        // Why a card shows no change goes in its info balloon (rule 8), as on the Overview.
                        const why = (shown: boolean) => (shown || compared.off ? '' : ` ${noComparisonNote(tabSummary, locale, t, compared.period)}`);
                        return (
                          <MetricGrid columns={3} mobilePairs label={t('Response metrics', 'Métricas de respostas')}>
                            <MetricCard
                              icon={<MessagesSquare size={14} aria-hidden="true" />}
                              label={t('Responses in the period', 'Respostas no período')}
                              definition={t('Complete answers collected in the selected period.', 'Respostas completas coletadas no período selecionado.') + why(responsesComparable)}
                              value={tabSummary.metrics.responses ? formatNumber(locale, tabSummary.metrics.responses) : t('No responses', 'Sem respostas')}
                              delta={responsesComparable ? <Change value={tabSummary.comparison.delta.responses} locale={locale} margin={0} /> : undefined}
                            />
                            <MetricCard
                              icon={<Eye size={14} aria-hidden="true" />}
                              label={t('Mention the brand', 'Mencionam a marca')}
                              definition={t('Responses mentioning the brand ÷ all responses in the period.', 'Respostas com menção à marca ÷ todas as respostas do período.') + why(comparable('visibility'))}
                              value={available('visibility') ? `${formatNumber(locale, tabSummary.metrics.visibility, 1)}%` : t('Not measured', 'Não medido')}
                              delta={comparable('visibility') ? <Change value={tabSummary.comparison.delta.visibility} unit=" pp" locale={locale} /> : undefined}
                            />
                            <MetricCard
                              icon={<Globe2 size={14} aria-hidden="true" />}
                              label={t('Citations', 'Citações')}
                              definition={t('Responses that cite a registered brand domain as a source ÷ all responses in the period.', 'Respostas que citam um domínio registrado da marca como fonte ÷ todas as respostas do período.') + why(comparable('citationPresence'))}
                              value={available('citationPresence') ? `${formatNumber(locale, tabSummary.metrics.citationPresence, 1)}%` : t('Not measured', 'Não medido')}
                              delta={comparable('citationPresence') ? <Change value={tabSummary.comparison.delta.citationPresence} unit=" pp" locale={locale} /> : undefined}
                            />
                          </MetricGrid>
                        );
                      })()}
                    >
                      <DataTableToolbar
                        label={t('Response filters', 'Filtros de respostas')}
                        actions={
                          <ColumnPicker
                            label={t('Columns', 'Colunas')}
                            columns={[
                              { key: 'prompt', label: t('Prompt', 'Prompt') },
                              { key: 'model', label: t('Model', 'Modelo') },
                              { key: 'brands', label: t('Brands mentioned', 'Marcas mencionadas') },
                              { key: 'citations', label: t('Citations', 'Citações') },
                              { key: 'date', label: t('Date', 'Data') },
                            ]}
                            hidden={responsesColumnsPref.hidden}
                            onChange={responsesColumnsPref.setHidden}
                            required={['prompt']}
                          />
                        }
                      >
                      <SearchField value={queryText} onChange={setQuery} placeholder={t('Search…', 'Buscar…')} ariaLabel={t('Search questions', 'Buscar perguntas')} />
                      <PageFilters>
                        <FilterSelect
                          multiple={false}
                          label={t('Brand mention', 'Menção da marca')}
                          value={responseMention}
                          onChange={(value) => setResponseMention(value as typeof responseMention)}
                          options={[
                            { value: 'all', label: t('All responses', 'Todas as respostas') },
                            { value: 'mentioned', label: t('Brand mentioned', 'Marca mencionada') },
                            // A sentiment reading needs the brand in the answer: "missing" contradicts it.
                            { value: 'missing', label: t('Brand missing', 'Marca ausente'), disabled: Boolean(responseSentiment) },
                          ]}
                        />
                      </PageFilters>
                      {brandFilter && (
                        <TagBadge tone="primary">
                          {t('Brand', 'Marca')}: {brandLabel || brandFilter}
                          <button type="button" aria-label={t('Clear brand filter', 'Limpar filtro de marca')} onClick={() => { setBrandFilter(''); setBrandLabel(''); setResponseSentiment(''); }}><X size={12} /></button>
                        </TagBadge>
                      )}
                      {responseSentiment && !demoMode && (
                        <TagBadge tone="primary">
                          {t('Sentiment', 'Sentimento')}: {sentimentLabel(responseSentiment, t)}
                          <button type="button" aria-label={t('Clear sentiment filter', 'Limpar filtro de sentimento')} onClick={() => setResponseSentiment('')}><X size={12} /></button>
                        </TagBadge>
                      )}
                      {promptRoute && (
                        <TagBadge tone="primary" className="max-w-full">
                          <span className="truncate">{t('Prompt', 'Prompt')}: {workspace?.prompts.find((item) => item.id === promptRoute || promptRoute.startsWith(`${item.id}-`))?.text ?? promptRoute}</span>
                          <button type="button" aria-label={t('Clear prompt filter', 'Limpar filtro de prompt')} onClick={() => setPromptRoute(null)}><X size={12} /></button>
                        </TagBadge>
                      )}
                      {responseCites && (
                        <TagBadge tone="primary" className="max-w-full">
                          <span className="truncate">{t('Citing', 'Citando')}: {responseCites === 'own' ? t('your domain', 'seu domínio') : responseCites}</span>
                          <button type="button" aria-label={t('Clear citation filter', 'Limpar filtro de citação')} onClick={() => setResponseCites('')}><X size={12} /></button>
                        </TagBadge>
                      )}
                      </DataTableToolbar>
                      {runRoute && !detail ? (
                        runState === 'failed' ? (
                          <EmptyState
                            tone="error"
                            title={t('This response is unavailable.', 'Esta resposta está indisponível.')}
                            action={<DrillLink link={link} to={{ run: null }} className="text-link">{t('Back to responses', 'Voltar às respostas')}</DrillLink>}
                          />
                        ) : (
                          <DetailBodySkeleton label={t('Loading response…', 'Carregando resposta…')} />
                        )
                      ) : detail ? (
                        <article className="p-5">
                        <h3 className="text-section"><DrillLink link={link} to={{ tab: 'prompts', run: null, prompt: promptUnit(detail.prompt_id) }}>{detail.prompt_text}</DrillLink></h3>
                        <p className="live-run-meta">
                          <EngineIcon engine={detail.engine} />
                          <span>{ENGINE_LABELS[detail.engine]}</span>
                          <time dateTime={detail.created_at}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(detail.created_at))}</time>
                          <span>{detail.status === 'complete' ? t('Complete', 'Concluída') : detail.status === 'failed' ? t('Failed', 'Falhou') : detail.status === 'pending' ? t('Pending', 'Pendente') : detail.status}</span>
                        </p>
                        {detail.answer ? (
                          <AnswerMarkdown text={detail.answer} />
                        ) : (
                          <p>
                            {detail.textRemoved
                              ? t(
                                  'This answer is older than the project keeps answer text (Settings > Project data). Its numbers stay in every report.',
                                  'Esta resposta é mais antiga do que o projeto guarda o texto das respostas (Configurações > Dados do projeto). Os números dela continuam em todos os relatórios.',
                                )
                              : t(
                                  'Answer not available yet.',
                                  'Resposta ainda indisponível.',
                                )}
                          </p>
                        )}
                        {!!answerBrandsListed.length && (
                          <>
                            <Hint text={t('Every brand the answer mentions, and what the decision model says it is to the project.', 'Toda marca que a resposta menciona e o que o modelo de decisão diz que ela é para o projeto.')}><h4 className="text-section mt-6 mb-2">{t('Brands in this answer', 'Marcas nesta resposta')}</h4></Hint>
                            <ul className="grid gap-2">
                              {ANSWER_BRAND_ROLES.filter(([role]) => answerBrandsListed.some((brand) => brand.role === role)).map(([role, label]) => (
                                <li key={role} className="flex flex-wrap items-center gap-2">
                                  <span className="text-muted-foreground">{t(...label)}</span>
                                  {answerBrandsListed.filter((brand) => brand.role === role).map((brand) => (
                                    <TagBadge key={brand.name} tone={role === 'tracked' || role === 'competitor' ? 'primary' : role === 'pending' || role === 'ambiguous' ? 'quiet' : 'muted'}>{brand.name}</TagBadge>
                                  ))}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                        {detail.sources.length > 0 && (
                          <>
                            <Hint text={t('Citation: the answer lists the URL as a source.', 'Citação: a resposta lista a URL como fonte.')}><h4 className="text-section mt-6 mb-2">{t('Cited sources', 'Fontes citadas')}</h4></Hint>
                            <ul>
                              {runSourcesPage.rows.map((source) => (
                                <li key={source.url}>
                                  <UrlCell link={link} url={source.url} title={source.title} domain={source.domain} t={t} secondary />
                                </li>
                              ))}
                            </ul>
                              {runSourcesPage.controls}
                            </>
                        )}
                        <Hint text={t('Consulted: the AI read the URL while preparing the answer.', 'Consultada: a IA leu a URL ao montar a resposta.')}><h4 className="text-section mt-6 mb-2">{t('Consulted sources', 'Fontes consultadas')}</h4></Hint>
                        {detail.consulted_sources == null ? (
                          <p>
                            —{' '}
                            {t(
                              'Not supplied by this channel',
                              'Não fornecidas por este canal',
                            )}
                          </p>
                        ) : detail.consulted_sources.length ? (
                          <>
                              <ul>
                            {runConsultedPage.rows.map((source) => (
                              <li key={source.url}>
                                <UrlCell link={link} url={source.url} title={source.title} domain={source.domain} t={t} />
                              </li>
                            ))}
                          </ul>
                              {runConsultedPage.controls}
                            </>
                          ) : (
                          <p>{t('None returned', 'Nenhuma retornada')}</p>
                        )}
                        {!!detail.search_queries?.length && (
                          <>
                            <h4 className="text-section mt-6 mb-2">
                              {t('Related searches', 'Buscas relacionadas')}
                            </h4>
                            <ul>
                              {runQueriesPage.rows.map((value) => (
                                <li key={value}>{value}</li>
                              ))}
                            </ul>
                              {runQueriesPage.controls}
                            </>
                        )}
                      </article>
                      ) : reportLoading || currentHistory?.runs.length ? (
                          <DataTable singleLine="wide"
                            fill
                            loading={reportLoading}
                            ariaLabel={reportLoading ? t('Loading responses…', 'Carregando respostas…') : undefined}
                            className="live-fixed-columns"
                            minWidth={960}
                            rows={currentHistory?.runs ?? []}
                            rowKey={(run) => run.id}
                            rowLink={(run) => link({ tab: 'responses', run: run.id })}
                            summary={responsesSummary}
                            summaryAside={responsesPager}
                            columns={visibleColumns<DataColumn<Run>>([
                              {
                                key: 'prompt', sortValue: (run) => run.prompt_text, header: t('Prompt', 'Prompt'), mobile: 'title', cellClassName: 'min-w-0',
                                info: t('Complete answers in the period and filters. Failed and pending collections are not listed or counted.', 'Respostas completas do período e dos filtros. Coletas que falharam ou estão pendentes não são listadas nem contadas.'),
                                cell: (run) => <DrillLink link={link} to={{ tab: 'prompts', prompt: promptUnit(run.prompt_id) }} className="block truncate" title={run.prompt_text}>{run.prompt_text}</DrillLink>,
                              },
                              { key: 'model', width: 150, sortValue: (run) => ENGINE_LABELS[run.engine], header: t('Model', 'Modelo'), label: t('Model', 'Modelo'), cell: (run) => <span className="flex items-center gap-2"><EngineIcon engine={run.engine} />{ENGINE_LABELS[run.engine]}</span> },
                              {
                                key: 'brands',
                                width: 220,
                                sortValue: (run) => runBrands(run).map((brand) => brand.name).join(', '),
                                header: t('Brands mentioned', 'Marcas mencionadas'),
                                label: t('Brands mentioned', 'Marcas mencionadas'),
                                // A phone's card gives the list its own line, whole (half a card cut it after two names).
                                mobile: 'wide',
                                cell: (run) => {
                                  const brands = runBrands(run);
                                  return brands.length ? <Hint text={brands.map((brand) => brand.name).join(', ')}><span className="block truncate">{brands.map((brand, index) => <span key={brand.name}>{index > 0 && ', '}<DrillLink link={link} to={{ tab: 'responses', run: null, brand: brand.filter, brandLabel: brand.label, mention: 'mentioned' }}>{brand.name}</DrillLink></span>)}</span></Hint> : '—';
                                },
                              },
                              { key: 'citations', width: 110, sortValue: (run) => run.source_count ?? run.sources?.length ?? null, header: t('Citations', 'Citações'), label: t('Citations', 'Citações'), align: 'end', cell: (run) => <DrillLink link={link} to={{ tab: 'responses', run: run.id }}>{run.source_count != null || run.sources != null ? formatNumber(locale, run.source_count ?? run.sources!.length) : '—'}</DrillLink> },
                              { key: 'date', width: 120, sortValue: (run) => run.created_at, header: t('Date', 'Data'), label: t('Date', 'Data'), cell: (run) => <time dateTime={run.created_at}>{relativeReportDate(run.created_at, locale)}</time> },
                            ], responsesColumnsPref.hidden, ['prompt'])}
                          />
                      ) : error ? null : headerFiltersActive || responseFiltersActive ? (
                      <EmptyState
                        frame="bare"
                        title={t('No responses match these filters', 'Nenhuma resposta com estes filtros')}
                        description={t('Clear the filters to see every response in the period.', 'Limpe os filtros para ver todas as respostas do período.')}
                        action={<Button variant="outline" onClick={clearAllFilters}>{t('Clear filters', 'Limpar filtros')}</Button>}
                      />
                    ) : (
                      <EmptyState title={t('No responses in this period.', 'Sem respostas neste período.')} description={t('Each AI answer to your prompts lands here once it is collected, with the brands it names and the sources it cites.', 'Cada resposta das IAs aos seus prompts aparece aqui depois de coletada, com as marcas que cita e as fontes que usa.')} />
                    )}
                    </DataTableScreen>
                  </>
                )}
                {project && !creatingProject && tab === 'sources' && (
                  <>
                    <h2 className="sr-only">{t('Sources', 'Fontes')}</h2>
                    {entity ? (
                      <div className="section-content">
                      <SourceEntityPage
                        api={api}
                        request={request}
                        filters={`${detailFilters}&kind=${sourceKind}`}
                        kind={entity.kind}
                        keyValue={entity.key}
                        refresh={dataRevision}
                        locale={locale}
                        t={t}
                        link={link}
                        busy={busy}
                        classifying={classifying}
                        actionError={classifyError}
                        onClassify={demoMode ? undefined : (kind) => void classifySources(kind)}
                        onConfigure={demoMode ? undefined : () => { setSettingsSection('competitors'); setTab('settings'); }}
                        listed={monitoredListed}
                      />
                      </div>
                    ) : (
                    <>
                      <SourcesPresence sources={sources} kind={sourceKind} group={sourceGroup} locale={locale} t={t} busy={reportLoading && Boolean(sources)} loadingCards={reportLoading && !sources ? skeletonCards(3, true) : undefined}>
                        <DataTableToolbar
                          label={sourceGroup === 'domain' ? t('Domain filters', 'Filtros de domínios') : t('URL filters', 'Filtros de URLs')}
                          actions={
                            <ColumnPicker
                              label={t('Columns', 'Colunas')}
                              columns={SOURCE_PICKER_COLUMNS(sourceGroup, t, sourceOrigin === 'semantic-branding')}
                              hidden={sourcesColumnsPref.hidden}
                              onChange={sourcesColumnsPref.setHidden}
                              required={['source']}
                            />
                          }
                        >
                          <SearchField
                            value={sourceSearchDraft}
                            onChange={setSourceSearchDraft}
                            placeholder={sourceGroup === 'domain' ? t('Search domains…', 'Buscar domínios…') : t('Search URLs…', 'Buscar URLs…')}
                            ariaLabel={sourceGroup === 'domain' ? t('Search domains', 'Buscar domínios') : t('Search URLs', 'Buscar URLs')}
                          />
                          <FilterSelect
                            label={sourceGroup === 'domain' ? t('Site type', 'Tipo de site') : t('Content type', 'Tipo de conteúdo')}
                            value={typeFilter || 'all'}
                            onChange={(value) => { setTypeFilter(value === 'all' ? '' : value); setSourcePage(1); }}
                            options={[
                              { value: 'all', label: sourceGroup === 'domain' ? t('All site types', 'Todos os tipos de site') : t('All content types', 'Todos os tipos de conteúdo') },
                              ...(sourceGroup === 'domain' ? DOMAIN_TYPES : PAGE_TYPES).map((type) => ({ value: type, label: sourceTypeLabel(type, t) })),
                              { value: UNCLASSIFIED, label: sourceTypeLabel(UNCLASSIFIED, t) },
                            ]}
                          />
                          <FilterSelect
                            label={t('Owner', 'Dono')}
                            value={ownerFilter || 'all'}
                            onChange={(value) => { setOwnerFilter(value === 'all' ? '' : value); setSourcePage(1); }}
                            options={[
                              { value: 'all', label: t('All owners', 'Todos os donos') },
                              ...SOURCE_OWNERS.map((owner) => ({ value: owner, label: sourceOwnerLabel(owner, t, true) })),
                            ]}
                          />
                          <FilterSelect
                            multiple={false}
                            label={t('Origin', 'Origem')}
                            value={sourceOrigin}
                            onChange={(value) => { setSourceOrigin(value as NavState['sourceOrigin']); setSourcePage(1); }}
                            options={[
                              { value: 'all', label: t('All origins', 'Todas as origens') },
                              { value: 'prompts', label: t('Prompts', 'Prompts') },
                              { value: 'semantic-branding', label: t('Semantic Branding', 'Semantic Branding') },
                            ]}
                          />
                          <SourceCitationFilter value={sourceKind} onChange={(value) => { setSourceKind(value); setSourcePage(1); }} t={t} />
                        </DataTableToolbar>
                        {sourceOrigin === 'semantic-branding' && (
                          <p className="live-table-note">{t(
                            'Sources belong to the Semantic Branding questions. Some AIs, such as Google AI Mode, can answer without sources; this is not an error or a zero score. Average score: each citing response counts once, across its brands and attributes. Prompt, topic and tag filters do not match these questions.',
                            'As fontes pertencem às perguntas do Semantic Branding. Algumas IAs, como o Google AI Mode, podem responder sem fontes; isso não é erro nem nota zero. Nota média: cada resposta que cita a fonte conta uma vez, entre suas marcas e atributos. Filtros de prompt, tópico e tag não correspondem a essas perguntas.',
                          )}</p>
                        )}
                        {/* Only cited sources are sent for classification; a consulted-only one may stay untyped. */}
                        {sources?.classifier && sources.rows.some((row) => row.sourceType === UNCLASSIFIED && row.cited !== false) && (
                          <div className="st-list-notice">
                            <ClassifierNotice
                              classifier={sources.classifier}
                              unclassified={sources.rows.filter((row) => row.sourceType === UNCLASSIFIED && row.cited !== false).length}
                              classifying={classifying}
                              onClassify={demoMode ? undefined : () => void classifySources(sourceGroup)}
                              onConfigure={demoMode ? undefined : () => { setSettingsSection('competitors'); setTab('settings'); }}
                              t={t}
                              noun={sourceGroup === 'domain' ? t('domains', 'domínios') : t('pages', 'páginas')}
                            />
                            {classifyError && <p role="alert" className="st-error">{classifyError}</p>}
                          </div>
                        )}
                      {reportLoading && !sources ? (
                        <DataTable singleLine fill loading ariaLabel={t('Loading sources…', 'Carregando fontes…')} rows={[]} rowKey={String} columns={skeletonColumns(6)} />
                      ) : sources && sources.rows.length ? (
                        <SourcesPresenceTable
                          sources={sources}
                          kind={sourceKind}
                          group={sourceGroup}
                          page={sourcePage}
                          sort={sourceSort}
                          onSortChange={(next) => { setSourceSort(next); setSourcePage(1); }}
                          locale={locale}
                          t={t}
                          link={link}
                          hiddenColumns={sourcesColumnsPref.hidden}
                          summaryAside={sourcesPager}
                        />
                      ) : error ? null : reportLoading ? (
                        <DataTable singleLine fill loading ariaLabel={t('Loading sources…', 'Carregando fontes…')} rows={[]} rowKey={String} columns={skeletonColumns(6)} />
                      ) : (
                        <EmptyState
                          title={sourceQuery
                            ? t(`No sources contain “${sourceQuery}”.`, `Nenhuma fonte contém “${sourceQuery}”.`)
                            : sourceKind === 'consulted' && sources && !sources.available
                            ? t('No model returned consulted URLs in these answers.', 'Nenhum modelo devolveu URLs consultadas nessas respostas.')
                            : typeFilter || ownerFilter
                            ? t('No sources match these filters in this period.', 'Nenhuma fonte corresponde a estes filtros neste período.')
                            : sourceOrigin === 'semantic-branding' ? t('No Semantic Branding sources match this period and these filters. AI answers without sources remain available in the report.', 'Nenhuma fonte do Semantic Branding corresponde ao período e aos filtros. Respostas das IAs sem fontes continuam disponíveis no relatório.')
                            : sourceKind === 'cited' ? t('No cited sources in this period. Collect answers to measure presence.', 'Sem fontes citadas neste período. Colete respostas para medir a presença.')
                            : sourceKind === 'consulted' ? t('No consulted sources in this period.', 'Sem fontes consultadas neste período.') : t('No sources in this period.', 'Sem fontes neste período.')}
                          description={!sourceQuery && !typeFilter && !ownerFilter && sourceKind !== 'consulted' && sourceKind !== 'cited' && sourceOrigin !== 'semantic-branding' ? t('Sources appear after answers are collected: the sites the AIs cite and read to answer your prompts.', 'As fontes aparecem depois que as respostas são coletadas: os sites que as IAs citam e leem para responder aos seus prompts.') : undefined}
                          action={sourceQuery ? (
                            <Button type="button" variant="outline" onClick={() => setQuery('')}>
                              {t('Clear search', 'Limpar busca')}
                            </Button>
                          ) : undefined}
                        />
                      )}
                      </SourcesPresence>
                    </>
                    )}
                  </>
                )}
                {!creatingProject && tab === 'settings' && (
                  <>
                    <h2 className="sr-only">{t('Project settings', 'Configurações do projeto')}</h2>
                    <div className="live-settings-content section-content">
                    {!project && ['workspace', 'competitors', 'monitoring', 'semantic', 'ai-bots', 'data'].includes(settingsSection) && <SectionCard inset="padded" title={t('No project yet', 'Nenhum projeto ainda')} description={t('Create a project to configure its brand, market and monitoring.', 'Crie um projeto para configurar sua marca, mercado e monitoramento.')}><Button onClick={() => guardSettingsNavigation(() => { clearSettingsDirty(); setCreatingProject(true); })}>{t('Create a project', 'Criar projeto')}</Button></SectionCard>}
                    {project && (settingsSection === 'monitoring' || settingsSection === 'semantic') && <LiveMonitoringSettings key={`${project.id}:${settingsSection}`} onDirty={(dirty) => reportSettingsDirty('monitoring', dirty)} workspace={workspace} project={project} engines={engines} busy={busy} t={t} save={mutate} mutationError={error} clearMutationError={() => setError('')} request={request} semantic={settingsSection === 'semantic'} demo={demoMode} brandsLink={link({ tab: 'settings', section: 'competitors' })} />}
                    {project && (settingsSection === 'competitors' && <div className="live-settings-content min-w-0 space-y-6"><LiveCompetitorSettings onDirty={(dirty) => reportSettingsDirty('competitors', dirty)} key={project.id} project={project} busy={busy} t={t} save={mutate} mutationError={error} clearMutationError={() => setError('')} /><BrandResearchPanel settings onDirty={(dirty) => reportSettingsDirty('research', dirty)} key={`research-settings:${project.id}`} project={project} filters={filterQuery} demo={demoMode} refresh={cache.generation} busy={busy} onAdd={async (candidate) => { if (settingsDirty) throw new Error(t('Save or cancel your changes first.', 'Salve ou cancele suas alterações primeiro.')); const saved = await mutate(`/api/projects/${project.id}`, 'PATCH', { competitors: [...project.competitors, candidate] }); if (!saved) throw new Error(t('Could not add this brand.', 'Não foi possível adicionar esta marca.')); }} onEvidence={(runId) => { setTab('responses'); void onRun(runId); }} /><MentionBudget projectId={project.id} t={t} /></div>)}
                    {project && settingsSection === 'workspace' && (
                      <div className="space-y-6">
                        <LiveBrandSettings clearMutationError={() => setError('')} mutationError={error} key={project.id} project={project} addressBase={addressBase} canEditAddress={!demoMode && (!workspace.role || workspace.role === 'owner' || workspace.role === 'admin')} engines={workspace.capabilities.engines} locale={locale} busy={busy} t={t} onDirty={(dirty) => reportSettingsDirty('brand', dirty)} save={async (data) => !!(await mutate(`/api/projects/${encodeURIComponent(project.id)}`, 'PATCH', data))} />
                        <ProjectDangerZone
                          key={`danger:${project.id}`}
                          project={project}
                          owner={!workspace.role || workspace.role === 'owner'}
                          busy={busy}
                          t={t}
                          demo={demoMode}
                          onArchive={async () => Boolean(await mutate(`/api/projects/${encodeURIComponent(project.id)}`, 'DELETE', undefined, null))}
                          onDelete={async () => {
                            try {
                              await request(`/api/projects/${encodeURIComponent(project.id)}/erase`, 'POST', { name: project.name });
                            } catch (cause) {
                              return cause instanceof Error ? cause.message : String(cause);
                            }
                            // Gone: another project opens (its overview), or the New project wizard when none is left.
                            clearSettingsDirty();
                            cache.invalidate();
                            await refresh(null).catch(() => undefined);
                            setTab('overview');
                            return null;
                          }}
                        />
                      </div>
                    )}
                    {project && settingsSection === 'ai-bots' && <AiBotsSettings key={project.id} projectId={project.id} demo={demoMode} reportLink={link({ tab: 'ai-bots', aiBotsView: null })} />}
                    {project && settingsSection === 'agent' && <AgentSettings key={project.id} project={project} busy={busy || demoMode} onDirty={(dirty) => reportSettingsDirty('agent', dirty)} onSave={setContentMode} />}
                    {project && settingsSection === 'data' && <DataRetention key={`retention-${project.id}`} project={project} workspace={workspace} busy={busy} t={t} demo={demoMode} onDirty={(dirty) => reportSettingsDirty('retention', dirty)} save={(value) => mutate(`/api/projects/${encodeURIComponent(project.id)}`, 'PATCH', value)} />}
                    {project && settingsSection === 'data' && <ProjectDataSettings key={project.id} project={project} workspace={workspace} t={t} demo={demoMode} onRestored={async () => { cache.invalidate(); await refresh(project.id); }} />}
                    {settingsSection === 'members' && !demoMode && workspace.workspaces && <MembersSettings request={transport} t={t} selfEmail={workspace.user.email} />}
                    {settingsSection === 'members' && (demoMode || !workspace.workspaces) && (
                        <SectionCard inset="padded" title={t('Members and permissions', 'Membros e permissões')} description={demoMode ? t('Invitations are unavailable in this temporary demo.', 'Convites não estão disponíveis nesta demo temporária.') : t('This independent installation has a single owner, who signs in with its access key. It has no other members to invite.', 'Esta instalação independente tem um único responsável, que entra com a chave de acesso. Não há outros membros para convidar.')}>
                          <div className="flex items-center gap-3"><UserAvatar user={{ name: workspace.user.name || workspace.user.email, importedAvatar: !demoMode }} /><div className="min-w-0"><p>{workspace.user.name || workspace.user.email}</p><p className="text-muted-foreground [overflow-wrap:break-word]">{workspace.user.email.split(/(?=@)/).map((part, index) => <span key={index}>{index > 0 && <wbr />}{part}</span>)}</p></div></div>
                        </SectionCard>
                      )}
                    {settingsSection === 'connections' && (demoMode
                      ? <SectionCard inset="padded" title={t('AI apps', 'Apps de IA')} description={t('Connecting AI apps is unavailable in this temporary demo.', 'Conectar apps de IA não está disponível nesta demo temporária.')}><Button variant="outline" nativeButton={false} render={<a href="/docs/ai-apps" aria-label={t('How it works', 'Como funciona')} />}>{t('How it works', 'Como funciona')}</Button></SectionCard>
                      : <ApiAccessSettings request={transport} t={t} workspaces={workspace.workspaces} role={workspace.role} />)}
                    {settingsSection === 'projects' && workspaceAddress && (
                        <AddressSettings
                          title={t('Workspace address', 'Endereço do workspace')}
                          description={t('Opens this workspace for its members. Each project address starts with it.', 'Abre este workspace para os membros. O endereço de cada projeto começa por ele.')}
                          base="/app/"
                          slug={workspaceAddress}
                          canEdit={workspace.role === 'owner' || workspace.role === 'admin'}
                          busy={busy}
                          t={t}
                          onDirty={(dirty) => reportSettingsDirty('workspace-address', dirty)}
                          onCancel={() => setError('')}
                          error={error || undefined}
                          check={checkWorkspaceSlug}
                          save={async (slug) => !!(await mutate('/api/workspace/slug', 'PATCH', { slug }))}
                        />
                      )}
                    {settingsSection === 'projects' && (
                        <SectionCard title={t('Active projects', 'Projetos ativos')} description={projectsFull ? projectLimitCopy : undefined} action={<Button disabled={projectsFull} onClick={() => guardSettingsNavigation(() => { clearSettingsDirty(); setCreatingProject(true); })}>{t('New project', 'Novo projeto')}</Button>}>{workspace.projects.length ? <div className="live-table-scroll"><DataTable singleLine="wide"
                          rows={projectsPage.rows}
                          rowKey={(item) => item.id}
                          columns={projectColumns}
                          sort={projectSort}
                          onSortChange={setProjectSort}
                        /></div> : (
                          // A new workspace: no active project yet, said instead of an empty table.
                          <EmptyState frame="inline" title={t('No project yet', 'Nenhum projeto ainda')} description={t('This workspace has no active project. Create its first with New project.', 'Este workspace não tem projeto ativo. Crie o primeiro com Novo projeto.')} />
                        )}
                          {projectsPage.controls}
                        </SectionCard>
                      )}
                    {/* The plan is the workspace's (13/11/2026): its owners and admins see it and upgrade it here, never in the personal profile. */}
                    {settingsSection === 'projects' && (workspace.role === 'owner' || workspace.role === 'admin') && billingPanel}
                    {settingsSection === 'projects' && !demoMode && workspace.role === 'owner' && <ArchivedProjects t={t} onUnarchived={async (id) => { cache.invalidate(); await refresh(id); }} />}
                    {settingsSection === 'profile' && (
                        <div className="live-settings-content min-w-0 space-y-6">
                          <SectionCard inset="padded" title={t('Profile', 'Perfil')}><ProfileAvatar name={workspace.user.name || workspace.user.email} email={workspace.user.email} demo={demoMode} /></SectionCard>
                          {profilePanel}
                          <SettingsBlock title={t('Language', 'Idioma')} t={t} busy={busy} onDirty={(dirty) => reportSettingsDirty('profile', dirty)} save={async (data) => { setLocale(data.get('locale') as typeof locale); return true; }}><label className="grid max-w-xs gap-2">{t('Interface language', 'Idioma da interface')}<SelectField name="locale" defaultValue={locale} options={[{ value: 'en', label: 'English' }, { value: 'pt-BR', label: 'Português (Brasil)' }]} /></label></SettingsBlock>
                          {notificationsPanel ?? (!demoMode && <SectionCard inset="padded" title={t('Notifications', 'Notificações')} description={t('Email summaries and alerts are not available in this installation: it does not send email.', 'Resumos e alertas por email não existem nesta instalação: ela não envia email.')}><p className="text-muted-foreground">{t('Your reports stay available in the app.', 'Seus relatórios continuam disponíveis no app.')}</p></SectionCard>)}
                        </div>
                      )}
                    </div>
                  </>
                )}
                {!creatingProject && tab === 'admin' && (adminList ? adminPages.find((page) => page.id === adminPage)?.content : (
                  <div className="live-settings-content section-content min-w-0 space-y-6">
                    {adminPages.find((page) => page.id === adminPage)?.content}
                  </div>
                ))}
                {project && !creatingProject && tab === 'competitors' && (
                  <>
                    <h2 className="sr-only">{t('Tracked brands', 'Marcas monitoradas')}</h2>
                    <BrandsScreen
                      key={project.id}
                      project={project}
                      report={brands}
                      loading={reportLoading}
                      view={brandView}
                      refresh={cache.generation}
                      busy={busy}
                      demo={demoMode}
                      t={t}
                      link={link}
                      onTargetsChanged={async (reports = false) => {
                        // Brand writes go through the raw transport, so drop this project's cached workspace before reading it again.
                        cache.invalidateRelated(`${api}/projects/${encodeURIComponent(project.id)}/brands`);
                        await refresh(project.id, reports);
                      }}
                      onDecided={() => cache.invalidateRelated(`${api}/projects/${encodeURIComponent(project.id)}/brands`)}
                      api={api}
                      page={brandPage}
                      onPageTitle={setBrandPageTitle}
                      operator={!!workspace.config?.providerSettings}
                      error={error}
                      clearError={() => setError('')}
                      onEvidence={(runId) => { setTab('responses'); void onRun(runId); }}
                      summary={tabSummary}
                      summaryLoading={summaryRemote.loading}
                      filters={filterQuery}
                      request={transport}
                      read={request}
                      listed={listedBrands}
                    />
                  </>
                )}
                {project && !creatingProject && agentScreen && (
                  // The public demo: its example conversations, read-only, on every Agent address (lib/agent-demo.ts).
                  demoMode ? (
                    <AgentChat key={project.id} projectId={project.id} projectName={projectLabel(project)} brands={{ own: project.name, roster: project.competitors.map((item) => item.name) }} canEdit={false} demo />
                  ) : !workspace.capabilities.agent ? (
                    <AgentUnavailable />
                  ) : tab === 'agent' ? (
                    <AgentChat
                      key={project.id}
                      projectId={project.id}
                      projectName={projectLabel(project)}
                      brands={{ own: project.name, roster: project.competitors.map((item) => item.name) }}
                      period={{ days, start: startDate || undefined, end: endDate || undefined }}
                      canEdit={workspace.role !== 'viewer'}
                    />
                  ) : tab === 'contents' ? (
                    <AgentContents
                      key={`${project.id}:${listVisit}`}
                      projectId={project.id}
                      canEdit={workspace.role !== 'viewer'}
                      mode={project.agent_content_mode ?? null}
                      action={workspace.role !== 'viewer' ? createContent : undefined}
                      onOpenConversation={openConversation}
                    />
                  ) : tab === 'brain' ? (
                    <AgentBrain key={project.id} projectId={project.id} canEdit={workspace.role !== 'viewer'} />
                  ) : tab === 'skills' ? (
                    <AgentSkills key={project.id} projectId={project.id} canEdit={workspace.role !== 'viewer'} />
                  ) : (
                    <AgentArtifacts key={`${project.id}:${listVisit}`} projectId={project.id} canEdit={workspace.role !== 'viewer'} onOpenConversation={openConversation} />
                  )
                )}
                {project && !creatingProject && tab === 'models' && (
                  <>
                    <h2 className="sr-only">{t('AI models', 'Modelos de IA')}</h2>
                    <DataTableScreen
                      cards={(() => {
                        if (!models) return reportLoading ? skeletonCards(4) : null;
                        const ranked = modelChannels.filter((row) => row.responses > 0);
                        const best = ranked.reduce<(typeof ranked)[number] | null>((lead, row) => (!lead || row.visibility > lead.visibility ? row : lead), null);
                        const worst = ranked.reduce<(typeof ranked)[number] | null>((lead, row) => (!lead || row.visibility < lead.visibility ? row : lead), null);
                        const answered = modelChannels.reduce((sum, row) => sum + row.responses, 0);
                        return (
                          <MetricGrid columns={4} mobilePairs label={t('Model metrics', 'Métricas de modelos')}>
                            <MetricCard
                              icon={<Bot size={14} aria-hidden="true" />}
                              label={t('Monitored models', 'Modelos monitorados')}
                              definition={t('AI models enabled for this project.', 'Modelos de IA habilitados neste projeto.')}
                              value={formatNumber(locale, modelChannels.length)}
                            />
                            <MetricCard
                              icon={<TrendingUp size={14} aria-hidden="true" />}
                              label={t('Strongest model', 'Modelo mais forte')}
                              definition={t('Model whose answers mention your brand most often (highest visibility).', 'Modelo cujas respostas mais mencionam sua marca (maior visibilidade).')}
                              value={best ? ENGINE_LABELS[best.key] : '—'}
                            />
                            <MetricCard
                              icon={<TrendingDown size={14} aria-hidden="true" />}
                              label={t('Weakest model', 'Modelo mais fraco')}
                              definition={t('Model whose answers mention your brand least often (lowest visibility).', 'Modelo cujas respostas menos mencionam sua marca (menor visibilidade).')}
                              value={worst && best && worst.key !== best.key ? ENGINE_LABELS[worst.key] : '—'}
                            />
                            <MetricCard
                              icon={<MessagesSquare size={14} aria-hidden="true" />}
                              label={t('Responses analyzed', 'Respostas analisadas')}
                              definition={t('Complete answers across monitored models in the period.', 'Respostas completas nos modelos monitorados no período.')}
                              value={answered ? formatNumber(locale, answered) : '—'}
                            />
                          </MetricGrid>
                        );
                      })()}
                    >
                      <DataTableToolbar
                        label={t('Model filters', 'Filtros de modelos')}
                        actions={
                          <ColumnPicker
                            label={t('Columns', 'Colunas')}
                            columns={[
                              { key: 'model', label: t('Model', 'Modelo') },
                              { key: 'responses', label: t('Responses', 'Respostas') },
                              { key: 'mentions', label: t('Brand mentions', 'Menções da marca') },
                              { key: 'visibility', label: t('Visibility', 'Visibilidade') },
                              { key: 'citationCoverage', label: t('Responses with citations', 'Respostas com citações') },
                              { key: 'consultedCoverage', label: t('Consulted sources provided', 'Fontes consultadas informadas') },
                              { key: 'semantic', label: t('Semantic Branding score', 'Score do Semantic Branding') },
                            ]}
                            hidden={modelsColumnsPref.hidden}
                            onChange={modelsColumnsPref.setHidden}
                            required={['model']}
                          />
                        }
                      >
                        <SearchField
                          value={queryText}
                          onChange={setQuery}
                          placeholder={t('Search models…', 'Buscar modelos…')}
                          ariaLabel={t('Search models', 'Buscar modelos')}
                        />
                      </DataTableToolbar>
                      {reportLoading ? (
                        <DataTable singleLine="wide" fill loading className="live-fixed-columns" minWidth={960} ariaLabel={t('Loading model analysis…', 'Carregando análise dos modelos…')} rows={[]} rowKey={String} columns={skeletonColumns(6)} />
                      ) : models ? (
                        <>
                        <DataTable singleLine="wide"
                          fill
                          className="live-fixed-columns"
                          minWidth={960}
                          rows={modelsPage.rows}
                          rowKey={(item) => item.key}
                          sort={modelsPage.sort}
                          onSortChange={modelsPage.onSortChange}
                          summary={modelsSummary(filteredModels.filter((row) => modelChannels.includes(row)))}
                          columns={visibleColumns<DataColumn<(typeof models.channels)[number]>>([
                            {
                              key: 'model', width: 200, header: t('Model', 'Modelo'), mobile: 'title', sortValue: (item) => ENGINE_LABELS[item.key],
                              info: t('In the Summary: percentages are weighted by the number of responses; counts are added up.', 'No Resumo: percentuais ponderados pelo número de respostas; contagens somadas.'),
                              cell: (item) => (
                                <DrillLink link={link} to={{ tab: 'responses', engine: item.key }} className="flex items-center gap-2">
                                  <EngineIcon engine={item.key} />
                                  {ENGINE_LABELS[item.key]}
                                </DrillLink>
                              ),
                            },
                            { key: 'responses', width: 130, header: t('Responses', 'Respostas'), label: t('Responses', 'Respostas'), align: 'end', sortValue: (item) => item.responses, cell: (item) => <DrillLink link={link} to={{ tab: 'responses', engine: item.key }}>{formatNumber(locale, item.responses)}</DrillLink> },
                            { key: 'mentions', width: 150, header: t('Brand mentions', 'Menções da marca'), label: t('Brand mentions', 'Menções da marca'), align: 'end', sortValue: (item) => item.mentions, cell: (item) => <DrillLink link={link} to={{ tab: 'responses', engine: item.key, brand: null, mention: 'mentioned', cites: null }}>{formatNumber(locale, item.mentions)}</DrillLink> },
                            { key: 'visibility', width: 130, header: t('Visibility', 'Visibilidade'), label: t('Visibility', 'Visibilidade'), align: 'end', sortValue: (item) => (item.responses ? item.visibility : null), cell: (item) => item.responses ? <DrillLink link={link} to={{ tab: 'responses', engine: item.key, brand: null, mention: 'mentioned', cites: null }}>{formatPercent(locale, item.visibility)}</DrillLink> : '—' },
                            ...modelEvidenceColumns(modelChannels, locale, t),
                            semanticModelColumn<(typeof models.channels)[number]>(semanticModels, t),
                          ], modelsColumnsPref.hidden, ['model'])}
                        />
                        <ModelEvidenceNotice rows={modelChannels} t={t} />
                        </>
                      ) : (
                        <EmptyState frame="bare" title={t('No model data yet.', 'Ainda não há dados por modelo.')} />
                      )}
                    </DataTableScreen>
                  </>
                )}
                {project && !creatingProject && tab === 'fanout' && (
                  <FanoutView
                    key={project.id}
                    navigation={fanoutNavigation}
                    ref={fanoutExport}
                    onNavigation={(state) => setFanoutByProject((states) => ({ ...states, [project.id]: state }))}
                    failed={!reportLoading && !fanout && reportSettledPath === reportPath}
                    onRetry={() => { setError(''); setReportAttempt((value) => value + 1); }}
                    report={fanout}
                    loading={reportLoading}
                    api={api}
                    request={request}
                    filters={detailFilters}
                    refresh={dataRevision}
                    locale={locale}
                    t={t}
                    link={link}
                  />
                )}
                {project && !creatingProject && tab === 'opportunities' && (
                  <OpportunitiesView
                    key={project.id}
                    demo={demoMode}
                    report={opportunities}
                    loading={reportLoading}
                    failed={!reportLoading && !opportunities && reportSettledPath === reportPath}
                    onRetry={() => { setError(''); setReportAttempt((value) => value + 1); }}
                    locale={locale}
                    t={t}
                    link={link}
                  />
                )}
                {project && !creatingProject && tab === 'products' && isProductDetail(productDetail) && (
                  <ProductPage
                    key={`${project.id}:${productDetail}`}
                    target={productDetail}
                    api={api}
                    filters={filterQuery}
                    request={transport}
                    refresh={cache.generation}
                    locale={locale}
                    t={t}
                    link={link}
                    promptUnit={promptUnit}
                    onTitle={setProductTitle}
                  />
                )}
                {project && !creatingProject && tab === 'products' && !isProductDetail(productDetail) && (
                  <ProductsView
                    key={project.id}
                    view={productSection(productDetail)}
                    report={products}
                    loading={reportLoading}
                    failed={!reportLoading && !products && reportSettledPath === reportPath}
                    onRetry={() => { setError(''); setReportAttempt((value) => value + 1); }}
                    locale={locale}
                    t={t}
                    link={link}
                  />
                )}
                {project && !creatingProject && tab === 'ai-bots' && (
                  <AiBotsView key={project.id} projectId={project.id} view={aiBotsView} filters={filterQuery} demo={demoMode} link={link} />
                )}
                {project && !creatingProject && tab === 'comparison' && (
                  <ComparisonView key={project.id} projectId={project.id} view={comparisonSection(comparisonView)} detail={comparisonDetail} onTitle={setComparisonTitle} filters={filterQuery} canEdit={workspace?.role !== 'viewer'} demo={demoMode} link={link} />
                )}
                {project && !creatingProject && tab === 'semantic-branding' && (
                  <section aria-live="polite">
                    <SemanticPerception
                      projectId={project.id}
                      filters={filterQuery}
                      request={request}
                      refresh={dataRevision}
                      demo={demoMode}
                      admin={admin}
                      link={link}
                      onConfigure={() => { setSettingsSection('semantic'); setTab('settings'); }}
                    />
                  </section>
                )}
              </section>
            )
          )}
        </div>
      </SidebarInset>
      {/* Ask Lastfind: the agent over every project screen (not on the Agent's own screens, which are the chat). */}
      {project && !creatingProject && !demoMode && workspace?.capabilities.agent && !agentScreen && tab !== 'admin' && (
        <AskLastfind
          key={project.id}
          projectId={project.id}
          projectHref={projectHref}
          brands={{ own: project.name, roster: project.competitors.map((item) => item.name) }}
          period={{ days, start: startDate || undefined, end: endDate || undefined }}
          screen={tab}
          title={topbarCrumbs.map((crumb) => crumb.label).join(', ')}
          onExpand={toChat}
        />
      )}
      {/* Cloud only (the independent edition has no other workspaces): invitations wait for an explicit answer. */}
      {!demoMode && workspace?.workspaces && <PendingInvitations request={transport} t={t} base={pageBase} />}
    </SidebarProvider>
    </FaviconRouteProvider>
    </ProjectHrefContext>
    </ComparisonContext>
  );
}
