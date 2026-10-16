'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { createAnalyticsRequest } from '@/lib/analytics-cache';
import {
  announceSessionChange,
  requestJson,
  PUBLIC_SESSION_CHANGE_KEY,
  PUBLIC_SESSION_CHANNEL,
} from '@/lib/client';
import { useI18n } from '@/lib/i18n';
import type { Workspace, Run, Engine, Prompt } from '@/lib/types';
import { LiveMonitoringSettings } from './live-monitoring-settings';
import { BrandResearchPanel } from './brand-research-panel';
import { BrandReportTabs, parseBrandReportView, syncBrandReportView, type BrandReportView } from './brand-report-tabs';
import { LiveCompetitorSettings } from './live-competitor-settings';
import { EngineIcon } from '@/components/lastfind/identity-icons';
import { LASTFIND_APP_ICON } from '@/lib/lastfind-brand';
import { availableEngines, ENGINE_LABELS } from '@/lib/engines';
import {
  SiteFavicon,
  SearchField,
  PrimaryMenuActions,
  useCollectionPage,
  CollectionPagination,
  TopicFilter,
  AnalyticsSkeleton,
  FilterSelect,
} from './shared';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
} from 'recharts';
import { UserAvatar } from './user-avatar';
import { PageHeading } from '@/components/lastfind/presentation/page-heading';
import { SectionCard } from '@/components/lastfind/presentation/section-card';
import { parseDemoPromptImport } from './prompts-view';
import { DateRangePicker } from './date-range-picker';
import { slugify } from './routes';
import { SemanticAssociationReport } from './semantic-association-report';
import { measuredAssociationReport } from './semantic-measured-data';
import type { SemanticAggregate } from '@/lib/semantic-report';
import { relativeReportDate } from '@/lib/report-date';
import { SourceEntityPage } from './source-entity-page';
import { ExportButton } from './export-button';
import { SectionSidebar } from './section-sidebar';
import { PromptDialog } from './prompt-dialog';
import { ClassifierNotice, SourceTypeBadge, SourceTypesPanel, sourceTypeLabel, unknownDomainHint, unknownDomainLabel } from './source-types-ui';
import { DrillLink, type DrillTarget, type Linker } from './drill-link';
import { DOMAIN_TYPES, PAGE_TYPES, SOURCE_TYPE_COLORS, UNCLASSIFIED, type DomainType } from '@/lib/source-types';
import { Button, buttonVariants } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { getTrendScale, rankTrendSeries, summaryTrend, type TrendMetric, type TrendResolution } from '@/lib/report-trend';
import { seriesColorVar } from '@/lib/chart-series';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import {
  ChevronsUpDown,
  Check,
  Plus,
  Settings2,
  LogOut,
  Folder,
  Tag,
  Cpu,
  Globe2,
  CircleHelp,
  X,
  ListFilter,
  Sparkles,
  Pause,
  Play,
  Archive,
  Search,
  BookOpen,
  ArrowUpRight,
  ArrowLeft,
  ExternalLink,
  Pencil,
  Upload,
  Eye,
  MessageSquare,
  ListOrdered,
  Info,
  ChevronRight,
  MoreVertical,
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
} from '@/components/ui/sidebar';
import { navigation } from './analytics-sidebar';
import type {
  SummaryReport,
  HistoryPage,
  PromptReport,
  SourcesPage,
  AnalysisReport,
  CompetitorsReport,
  OpportunitiesReport,
  PromptDetail,
  SourceDetail,
  SourceTypesReport,
} from '@/lib/report-types';
import './live-app.css';

type Tab =
  | 'overview'
  | 'prompts'
  | 'topics'
  | 'responses'
  | 'sources'
  | 'settings'
  | 'competitors'
  | 'models'
  | 'opportunities'
  | 'semantic-branding';
type SemanticReport = {
  association?: SemanticAggregate;
  configuration: { revision: number; enabled: boolean; attributes: { id: string; name: string; description?: string }[];
  };
  coverage: { eligible: number; evaluated: number; unassessed: number };
  summary: { brand: string; attribute: string; score: number | null; samples: number; observations: number;
  }[];
  assessments?: {
    run_id: string; engine: Engine; prompt_text: string; run_created_at: string; coverage: string;
    readings: { brand: string; attribute: string; state: 'assessed' | 'insufficient' | 'ambiguous'; score: number | null; quote: string | null; reason: string;
    }[];
  }[];
  nextCursor?: string | null;
};
const tabs: Tab[] = [
  'overview',
  'prompts',
  'topics',
  'responses',
  'sources',
  'settings',
  'competitors',
  'models',
  'opportunities',
  'semantic-branding',
];
const label: Record<Tab, [string, string]> = {
  overview: ['Overview', 'Visão geral'],
  prompts: ['Prompts', 'Prompts'],
  topics: ['Topics', 'Tópicos'],
  responses: ['Responses', 'Respostas'],
  sources: ['Sources', 'Fontes'],
  settings: ['Settings', 'Configurações'],
  competitors: ['Brands', 'Marcas'],
  models: ['AI models', 'Modelos de IA'],
  opportunities: ['Opportunities', 'Oportunidades'],
  'semantic-branding': ['Semantic Branding', 'Branding Semântico'],
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
  settings: ['Make this workspace your own.', 'Deixe este workspace com a sua cara.',
  ],
  competitors: ['See who stands out in AI answers, and where you stand.', 'Veja quem se destaca nas respostas de IA e onde sua marca está.',
  ],
  models: ['Your performance across the AI search landscape.', 'Seu desempenho nos principais modelos de busca com IA.',
  ],
  opportunities: ['Find questions and sources worth exploring.', 'Encontre perguntas e fontes que valem explorar.',
  ],
  'semantic-branding': ['Understand the associations shaping your brand in AI.', 'Entenda as associações que formam sua marca na IA.',
  ],
};

type SettingsSection = 'workspace' | 'competitors' | 'monitoring' | 'semantic' | 'members' | 'projects' | 'profile';
type SettingsSectionGroup = {
  id: 'project' | 'workspace';
  label: [string, string];
  sections: { id: SettingsSection; label: [string, string] }[];
};
const settingsSectionGroups: SettingsSectionGroup[] = [
  {
    id: 'project',
    label: ['Project settings', 'Configurações do projeto'],
    sections: [
      { id: 'workspace', label: ['Brand and market', 'Marca e mercado'] },
      { id: 'competitors', label: ['Competitors', 'Concorrentes'] },
      { id: 'monitoring', label: ['Monitoring', 'Monitoramento'] },
      { id: 'semantic', label: ['Semantic Branding', 'Semantic Branding'] },
    ],
  },
  {
    id: 'workspace',
    label: ['Workspace', 'Workspace'],
    sections: [
      { id: 'projects', label: ['Projects', 'Projetos'] },
      { id: 'members', label: ['Members', 'Membros'] },
      { id: 'profile', label: ['My profile', 'Meu perfil'] },
    ],
  },
];
const settingsSections = settingsSectionGroups.flatMap(({ sections }) => sections);

type SourceEntity = { kind: 'domain' | 'url'; key: string };
// Every piece of navigation state that belongs in the address, so any screen can
// be reopened from its URL and a drill down link can be built without side effects.
type NavState = {
  projectId: string | null;
  tab: Tab;
  days: string;
  startDate: string;
  endDate: string;
  engineFilter: string;
  topicFilter: string;
  tagFilter: string;
  queryText: string;
  sourceKind: 'cited' | 'consulted';
  sourceGroup: 'domain' | 'url';
  responseMention: 'all' | 'mentioned' | 'missing';
  settingsSection: SettingsSection;
  brandView: BrandReportView;
  promptRoute: string | null;
  promptListPage: number;
  listScroll: number;
  entity: SourceEntity | null;
  typeFilter: string;
  runRoute: string | null;
  brandFilter: string;
};
function writeSearch(params: URLSearchParams, state: NavState) {
  const { tab } = state;
  if (state.projectId) params.set('project', state.projectId);
  else params.delete('project');
  params.set('tab', tab);
  syncBrandReportView(params, state.brandView, tab === 'competitors');
  if (tab === 'settings') params.set('section', state.settingsSection);
  else params.delete('section');
  params.set('days', state.days);
  if (state.startDate && state.endDate) {
    params.set('start', state.startDate);
    params.set('end', state.endDate);
  } else {
    params.delete('start');
    params.delete('end');
  }
  for (const [key, value] of [
    ['engine', state.engineFilter],
    ['topic', state.topicFilter],
    ['tags', state.tagFilter],
    ['query', state.queryText],
    ['kind', state.sourceKind],
    ['group', state.sourceGroup],
    ['type', tab === 'sources' ? state.typeFilter : ''],
    ['brand', tab === 'responses' ? state.brandFilter : ''],
    ['run', tab === 'responses' ? state.runRoute ?? '' : ''],
    ['entity', tab === 'sources' ? state.entity?.kind ?? '' : ''],
    ['key', tab === 'sources' ? state.entity?.key ?? '' : ''],
  ]) {
    if (value && value !== 'all') params.set(key, value);
    else params.delete(key);
  }
  if (tab === 'responses' && state.responseMention !== 'all') params.set('mention', state.responseMention);
  else params.delete('mention');
  if (state.promptRoute && tab === 'prompts') params.set('prompt', state.promptRoute);
  else params.delete('prompt');
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
  initialPath = [],
  initialSearch = '',
  demoMode = false,
  semanticEvaluationAvailable = true,
  request: transport = requestJson,
  exportDemo,
  resetDemo,
}: {
  initialPath?: string[];
  initialSearch?: string;
  demoMode?: boolean;
  semanticEvaluationAvailable?: boolean;
  request?: typeof requestJson;
  exportDemo?: (query: URLSearchParams) => void | Promise<void>;
  resetDemo?: () => void;
}) {
  const cache = useMemo(() => createAnalyticsRequest(transport), [transport]);
  const request = cache.request;
  const api = demoMode ? '/api/demo' : '/api';
  const pageBase = demoMode ? '/demo' : '/app';
  const query = new URLSearchParams(initialSearch);
  const pathProject =
    initialPath[0] === 'workspaces' && initialPath[2] === 'projects'
      ? initialPath[3]
      : null;
  const initialProject = pathProject ?? query.get('project');
  const requestedTab = pathProject
    ? initialPath[4]
    : initialPath[0] === 'account' || initialPath[2] === 'settings'
      ? 'settings'
      : query.get('tab');
  const initialTab =
    requestedTab === 'chats'
      ? 'responses'
      : requestedTab === 'brands'
        ? 'competitors'
        : requestedTab;
  const [projectId, setProjectId] = useState(initialProject);
  const [tab, setTab] = useState<Tab>(
    tabs.includes(initialTab as Tab) ? (initialTab as Tab) : 'overview',
  );
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [dataRevision, setDataRevision] = useState(0);
  const [report, setReport] = useState<
    | SummaryReport
    | PromptReport
    | HistoryPage
    | SourcesPage
    | AnalysisReport
    | CompetitorsReport
    | OpportunitiesReport
    | null
  >(null);
  const [reportKey, setReportKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [networkReportLoading, setReportLoading] = useState(false);
  const [overviewSourcesData, setOverviewSources] = useState<SourcesPage | null>(null,
  );
  const [overviewHistoryData, setOverviewHistory] = useState<HistoryPage | null>(null,
  );
  const [overviewSourcesKey, setOverviewSourcesKey] = useState('');
  const [overviewHistoryKey, setOverviewHistoryKey] = useState('');
  const [overviewChart, setOverviewChart] = useState<'visibility' | 'shareOfVoice' | 'position'>('visibility');
  const [overviewResolution, setOverviewResolution] = useState<TrendResolution>('day');
  const [hiddenChartBrands, setHiddenChartBrands] = useState<string[]>([]);
  const [semantic, setSemantic] = useState<SemanticReport | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticEvidencePage, setSemanticEvidencePage] = useState(1);
  const resetSemanticEvidence = useCallback(
    () => setSemanticEvidencePage(1),
    [setSemanticEvidencePage],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [creatingProject, setCreatingProject] = useState(
    initialPath[0] === 'onboarding',
  );
  const [detail, setDetail] = useState<Run | null>(null);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [language, setLanguage] = useState<'en' | 'pt'>('en');
  const [location, setLocation] = useState(2840);
  const [topic, setTopic] = useState('');
  const [days, setDays] = useState(query.get('days') || '28');
  const [startDate, setStartDate] = useState(query.get('start') || '');
  const [endDate, setEndDate] = useState(query.get('end') || '');
  const [engineFilter, setEngineFilter] = useState(
    query.get('engine') || 'all',
  );
  const [topicFilter, setTopicFilter] = useState(query.get('topic') || '');
  const [tagFilter, setTagFilter] = useState(query.get('tags') || '');
  const [sourceKind, setSourceKind] = useState<'cited' | 'consulted'>(
    query.get('kind') === 'consulted' ? 'consulted' : 'cited',
  );
  const [sourceGroup, setSourceGroup] = useState<'domain' | 'url'>(
    query.get('group') === 'url' ? 'url' : 'domain',
  );
  const [entity, setEntity] = useState<SourceEntity | null>(() => {
    const kind = query.get('entity'),
      key = query.get('key');
    return initialTab === 'sources' && (kind === 'domain' || kind === 'url') && key ? { kind, key } : null;
  });
  const [typeFilter, setTypeFilter] = useState(initialTab === 'sources' ? query.get('type') || '' : '');
  const [runRoute, setRunRoute] = useState<string | null>(initialTab === 'responses' ? query.get('run') : null);
  const [brandFilter, setBrandFilter] = useState(initialTab === 'responses' ? query.get('brand') || '' : '');
  const [typesReport, setTypesReport] = useState<SourceTypesReport | null>(null);
  const [typesState, setTypesState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [classifying, setClassifying] = useState(false);
  const [classifyError, setClassifyError] = useState('');
  const [sourcePage, setSourcePage] = useState(1);
  const [promptsSticky, setPromptsSticky] = useState(false);
  const promptSentinel = useRef<HTMLDivElement>(null);
  const promptTable = useRef<HTMLTableElement>(null);
  const promptStickyTable = useRef<HTMLTableElement>(null);
  const [queryText, setQueryText] = useState(query.get('query') || '');
  const [responseMention, setResponseMention] = useState<'all' | 'mentioned' | 'missing'>(initialTab === 'responses' && (query.get('mention') === 'mentioned' || query.get('mention') === 'missing') ? (query.get('mention') as 'mentioned' | 'missing')
      : 'all',
  );
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(
    () => settingsSections.find(({ id }) => id === query.get('section'))?.id ?? 'workspace',
  );
  const [brandView, setBrandView] = useState(() => parseBrandReportView(query.get('brandView')));
  const [visiblePromptColumns, setVisiblePromptColumns] = useState([
    'models',
    'tags',
    'visibility',
    'position',
  ]);
  const [addOpen, setAddOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>([]);
  const importInput = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState<
    'active' | 'suggested' | 'inactive' | 'archived'
  >('active');
  const [historyPages, setHistoryPages] = useState<HistoryPage[]>([]);
  const [responsePage, setResponsePage] = useState(1);
  const [serverPage, setServerPage] = useState(1);
  const [promptRoute, setPromptRoute] = useState<string | null>(
    initialPath[4] === 'prompts'
      ? (initialPath[5] ?? null)
      : query.get('prompt'),
  );
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
  useEffect(() => {
    const sentinel = promptSentinel.current;
    if (tab !== 'prompts' || !sentinel) {
      setPromptsSticky(false);
      return;
    }
    const header = document.querySelector<HTMLElement>('.analytics-topbar');
    const observer = new IntersectionObserver(
      ([entry]) =>
        setPromptsSticky(
          !entry.isIntersecting &&
            entry.boundingClientRect.top < (header?.offsetHeight ?? 56),
        ),
      { rootMargin: `-${header?.offsetHeight ?? 56}px 0px 0px 0px` },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [tab, workspace, selectedPrompt, mobileFiltersOpen]);
  const refresh = useCallback(
    async (selected: string | null) => {
      const version = ++workspaceRequest.current;
      const data = await request<Workspace>(
        `${api}/workspace${selected ? `?project=${encodeURIComponent(selected)}` : ''}`,
      );
      if (version !== workspaceRequest.current) return data;
      setWorkspace(data);
      setProjectId(data.selectedProjectId);
      setDataRevision((revision) => revision + 1);
      return data;
    },
    [api, request, setWorkspace, setProjectId, setDataRevision],
  );
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
  useEffect(() => {
    let active = true;
    const version = ++workspaceRequest.current;
    request<Workspace>(
      `${api}/workspace${initialProject ? `?project=${encodeURIComponent(initialProject)}` : ''}`,
    )
      .then(async (received) => {
        if (!active || workspaceRequest.current !== version) return;
        const match =
          initialProject &&
          received.projects.find(
            (item) =>
              item.id === initialProject ||
              (pathProject && slugify(item.name) === initialProject),
          );
        if (initialProject && !match) {
          setError('Project not found or access denied.');
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
  }, [api, initialProject, pathProject, request]);
  const responseQuery = tab === 'responses' ? queryText : '';
  useEffect(() => {
    queueMicrotask(() => {
      setServerPage(1);
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
    responseMention,
    brandFilter,
    typeFilter,
    tab,
  ]);
  const filterQuery = useMemo(() => {
    const params = new URLSearchParams({ project: projectId || '', days });
    if (startDate && endDate) {
      params.set('start', startDate);
      params.set('end', endDate);
    }
    if (engineFilter !== 'all') params.set('engine', engineFilter);
    if (topicFilter) params.set('topic', topicFilter);
    if (tagFilter) params.set('tags', tagFilter);
    if (responseQuery) params.set('query', responseQuery);
    if (tab === 'responses' && responseMention !== 'all') params.set('mention', responseMention);
    if (tab === 'responses' && brandFilter) params.set('brand', brandFilter);
    if (tab === 'competitors' || tab === 'opportunities')
      params.set('page', String(serverPage));
    if (tab === 'sources') {
      params.set('kind', sourceKind);
      params.set('group', sourceGroup);
      params.set('page', String(sourcePage));
      if (typeFilter) params.set('type', typeFilter);
    }
    return params;
  }, [
    projectId,
    days,
    startDate,
    endDate,
    engineFilter,
    topicFilter,
    tagFilter,
    responseQuery,
    responseMention,
    tab,
    sourceKind,
    sourceGroup,
    sourcePage,
    serverPage,
    brandFilter,
    typeFilter,
  ]);
  const detailFilters = useMemo(() => {
    const params = new URLSearchParams(filterQuery);
    for (const key of ['page', 'kind', 'group', 'type', 'query']) params.delete(key);
    return params.toString();
  }, [filterQuery]);
  const reportPath = useMemo(() => {
    const view = ({ overview: 'summary', prompts: 'prompts', responses: 'history', sources: 'sources', competitors: 'competitors', models: 'analysis', opportunities: 'opportunities' } as Partial<Record<Tab,string>>)[tab];
    if (!view || (tab === 'prompts' && promptRoute) || (tab === 'sources' && entity)) return null;
    const params = new URLSearchParams(filterQuery); params.set('view', view); if (view === 'prompts') params.set('compact', '1');
    return `${api}/reports?${params}`;
  }, [tab, promptRoute, entity, filterQuery, api]);
  const overviewPaths = useMemo(() => {
    const params = new URLSearchParams(filterQuery); params.set('view', 'sources'); params.set('kind', 'cited'); params.set('group', 'domain');
    const sources = `${api}/reports?${params}`; params.set('view', 'history');
    return { sources, history: `${api}/reports?${params}` };
  }, [filterQuery, api]);
  const overviewSources = cache.peek<SourcesPage>(overviewPaths.sources) ?? (overviewSourcesKey === overviewPaths.sources ? overviewSourcesData : null);
  const overviewHistory = cache.peek<HistoryPage>(overviewPaths.history) ?? (overviewHistoryKey === overviewPaths.history ? overviewHistoryData : null);
  const cachedReport = reportPath ? cache.peek<NonNullable<typeof report>>(reportPath) : undefined;
  const reportLoading = networkReportLoading && !cachedReport;
  const workspaceReady = Boolean(workspace);
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
        'opportunities',
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
      if (!cached) { setReport(null); setReportKey(null); }
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
      | OpportunitiesReport
    >(reportPath)
      .then((data) => {
        if (active) { setReport(data); setReportKey(`${tab}|${filterQuery}`); }
      })
      .catch((cause) => {
        if (active && cause.name !== 'AbortError') setError(cause.message);
      })
      .finally(() => {
        if (active) setReportLoading(false);
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
  ]);
  useEffect(() => {
    if (!workspaceReady || !projectId || tab !== 'overview') return;
    let active = true;
    void request<SourcesPage>(overviewPaths.sources).then((data) => { if (active) { setOverviewSources(data); setOverviewSourcesKey(overviewPaths.sources); } }).catch(() => { if (active) { setOverviewSources(null); setOverviewSourcesKey(overviewPaths.sources); } });
    void request<HistoryPage>(overviewPaths.history).then((data) => { if (active) { setOverviewHistory(data); setOverviewHistoryKey(overviewPaths.history); } }).catch(() => { if (active) { setOverviewHistory(null); setOverviewHistoryKey(overviewPaths.history); } });
    return () => { active = false; };
  }, [workspaceReady, dataRevision, projectId, tab, overviewPaths, request]);
  const typesPath = useMemo(() => {
    const params = new URLSearchParams(filterQuery);
    params.set('view', 'source-types');
    return `${api}/reports?${params}`;
  }, [filterQuery, api]);
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
  const classifySources = async (kind: 'domain' | 'url') => {
    if (!projectId || demoMode) return;
    setClassifying(true);
    setClassifyError('');
    try {
      await request(`/api/projects/${encodeURIComponent(projectId)}/source-types?${filterQuery}`, 'POST', { kind });
      cache.invalidate();
      setDataRevision((value) => value + 1);
    } catch (cause) {
      setClassifyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClassifying(false);
    }
  };
  useEffect(() => {
    if (!workspace || !projectId || tab !== 'semantic-branding') {
      queueMicrotask(() => setSemantic(null));
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (active) { setSemanticLoading(true); setSemantic(null);
        setSemanticEvidencePage(1);
      }
    });
    const path = demoMode ? `${api}/semantic` : `/api/projects/${encodeURIComponent(projectId)}/semantic`;
    request<SemanticReport>(`${path}?${filterQuery}`)
      .then((data) => { if (active) setSemantic(data); })
      .catch((cause) => {
        if (active && cause.name !== 'AbortError') setError(cause.message);
      })
      .finally(() => { if (active) setSemanticLoading(false); });
    return () => {
      active = false;
    };
  }, [
    workspace,
    projectId,
    tab,
    filterQuery,
    api,
    demoMode,
    request,
    dataRevision,
  ]);
  useEffect(() => {
    const onPopState = () => {
      const next = new URLSearchParams(window.location.search);
      restoringHistory.current = true;
      const nextProject = next.get('project');
      if (nextProject && nextProject !== projectId)
        void refresh(nextProject).catch((cause) => setError(cause.message));
      const nextPath = window.location.pathname.split('/').filter(Boolean);
      setPromptRoute(
        next.get('prompt') ||
          (nextPath.at(-2) === 'prompts' ? nextPath.at(-1)! : null),
      );
      promptScopeRef.current = null;
      setPromptListPage(listNumber(next.get('listPage'), 1));
      promptReturnScroll.current = listNumber(next.get('listScroll'), 0);
      if (!next.get('prompt') && nextPath.at(-2) !== 'prompts') {
        const scroll = promptReturnScroll.current;
        requestAnimationFrame(() =>
          window.scrollTo({ top: scroll, behavior: 'instant' }),
        );
      }
      const nextTab = tabs.includes(next.get('tab') as Tab) ? (next.get('tab') as Tab)
        : 'overview';
      setTab(nextTab);
      setBrandView(parseBrandReportView(next.get('brandView')));
      const section = next.get('section');
      const nextSettingsSection = settingsSections.find(({ id }) => id === section);
      if (nextSettingsSection) setSettingsSection(nextSettingsSection.id);
      setDays(next.get('days') || '28');
      setStartDate(next.get('start') || '');
      setEndDate(next.get('end') || '');
      setEngineFilter(next.get('engine') || 'all');
      setTopicFilter(next.get('topic') || '');
      setTagFilter(next.get('tags') || '');
      setQueryText(next.get('query') || '');
      setResponseMention(nextTab === 'responses' && (next.get('mention') === 'mentioned' || next.get('mention') === 'missing') ? (next.get('mention') as 'mentioned' | 'missing')
          : 'all',
      );
      setSourceKind(next.get('kind') === 'consulted' ? 'consulted' : 'cited');
      setSourceGroup(next.get('group') === 'url' ? 'url' : 'domain');
      const entityKind = next.get('entity'),
        entityKey = next.get('key');
      setEntity(nextTab === 'sources' && (entityKind === 'domain' || entityKind === 'url') && entityKey ? { kind: entityKind, key: entityKey } : null);
      setTypeFilter(nextTab === 'sources' ? next.get('type') || '' : '');
      setRunRoute(nextTab === 'responses' ? next.get('run') : null);
      setBrandFilter(nextTab === 'responses' ? next.get('brand') || '' : '');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [projectId, refresh]);
  const navState: NavState = {
    projectId,
    tab,
    days,
    startDate,
    endDate,
    engineFilter,
    topicFilter,
    tagFilter,
    queryText,
    sourceKind,
    sourceGroup,
    responseMention,
    settingsSection,
    brandView,
    promptRoute,
    promptListPage,
    listScroll: 0,
    entity,
    typeFilter,
    runRoute,
    brandFilter,
  };
  const navKey = JSON.stringify(navState);
  useEffect(() => {
    const url = new URL(window.location.href);
    writeSearch(url.searchParams, { ...(JSON.parse(navKey) as NavState), listScroll: promptReturnScroll.current });
    const pathname =
      promptRoute && tab === 'prompts' && !demoMode && projectId
        ? `/app/workspaces/workspace/projects/${encodeURIComponent(projectId)}/prompts/${encodeURIComponent(promptRoute)}`
        : pageBase;
    if (url.pathname !== pathname || url.search !== window.location.search) {
      const method =
        !workspace || !navigationReady.current || restoringHistory.current
          ? 'replaceState'
          : 'pushState';
      window.history[method](null, '', `${pathname}${url.search}`);
    }
    if (workspace) navigationReady.current = true;
    restoringHistory.current = false;
  }, [workspace, navKey, promptRoute, tab, projectId, pageBase, demoMode]);
  const mutate = async (
    path: string,
    method: string,
    data: unknown,
    selected = projectId,
  ) => {
    setBusy(true);
    setError('');
    try {
      await request(path, method, data);
      await refresh(selected);
      setTopic('');
      if ((path === '/api/prompts' && method === 'POST') || (editingPrompt && path === `/api/prompts/${encodeURIComponent(editingPrompt.id)}` && method === 'PATCH')) {
        setAddOpen(false);
        setEditingPrompt(null);
      }
      return true;
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
    return {
      ...navState,
      tab: (target.tab ?? tab) as Tab,
      entity: 'entity' in target ? (target.entity ?? null) : changing ? null : entity,
      runRoute: 'run' in target ? (target.run ?? null) : changing ? null : runRoute,
      promptRoute: 'prompt' in target ? (target.prompt ?? null) : changing ? null : promptRoute,
      brandFilter: 'brand' in target ? (target.brand ?? '') : changing ? '' : brandFilter,
      responseMention: target.mention ?? (changing ? 'all' : responseMention),
      engineFilter: target.engine ?? engineFilter,
      typeFilter: 'type' in target ? (target.type ?? '') : changing ? '' : typeFilter,
      sourceGroup: target.group ?? sourceGroup,
      sourceKind: target.kind ?? sourceKind,
      settingsSection: (target.section as SettingsSection | undefined) ?? settingsSection,
      brandView: target.brandView ?? brandView,
    } satisfies NavState;
  };
  const navigate = (target: DrillTarget) => {
    const next = resolveTarget(target);
    setTab(next.tab);
    setEntity(next.entity);
    setRunRoute(next.runRoute);
    setPromptRoute(next.promptRoute);
    setBrandFilter(next.brandFilter);
    setResponseMention(next.responseMention);
    setEngineFilter(next.engineFilter);
    setTypeFilter(next.typeFilter);
    setSourceGroup(next.sourceGroup);
    setSourceKind(next.sourceKind);
    setSettingsSection(next.settingsSection);
    setBrandView(next.brandView);
    if (next.tab !== tab || next.typeFilter !== typeFilter || next.sourceGroup !== sourceGroup) setSourcePage(1);
    setMobileFiltersOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const link: Linker = (target) => {
    const next = resolveTarget(target);
    const params = new URLSearchParams();
    writeSearch(params, next);
    const path =
      next.promptRoute && next.tab === 'prompts' && !demoMode && projectId
        ? `/app/workspaces/workspace/projects/${encodeURIComponent(projectId)}/prompts/${encodeURIComponent(next.promptRoute)}`
        : pageBase;
    return {
      href: `${path}?${params}`,
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
  const detailCrumb =
    tab === 'sources' && entity
      ? entity.key.replace(/^https?:\/\//, '')
      : tab === 'responses' && runRoute
        ? (detail?.prompt_text ?? '…')
        : tab === 'prompts' && selectedPrompt
          ? selectedPrompt.text
          : null;
  const project = workspace?.projects.find((item) => item.id === projectId);
  const filteredPrompts =
    workspace?.prompts.filter(
      (item) =>
        (statusFilter === 'archived'
          ? item.archived
          : statusFilter === 'suggested'
            ? false
          : !item.archived &&
            (statusFilter === 'active' ? item.active : !item.active)) &&
        (!queryText ||
          `${item.text} ${item.tag} ${item.tags.join(' ')}`
            .toLowerCase()
            .includes(queryText.toLowerCase())) &&
        (!topicFilter || item.tag === topicFilter) &&
        (!tagFilter || item.tags.includes(tagFilter)) &&
        (engineFilter === 'all' ||
          (item.engines ?? [item.engine]).some((engine) => engineFilter.split(',').includes(engine))),
    ) ?? [];
  const promptPage = useCollectionPage(
    filteredPrompts,
    `${projectId}|${queryText}|${topicFilter}|${tagFilter}|${engineFilter}|${statusFilter}`,
    25,
    t,
    '',
    { page: promptListPage, onPage: setPromptListPage },
  );
  const visiblePrompts = promptPage.rows;
  const promptScope = `${projectId}|${queryText}|${topicFilter}|${tagFilter}|${engineFilter}|${statusFilter}`;
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
  const importPreview = useMemo(() => {
    try { return { rows: parseDemoPromptImport(importText), error: '' }; }
    catch (cause) { return { rows: [], error: cause instanceof Error ? cause.message : String(cause),
      }; }
  }, [importText]);
  const promptStatusCount = (status: typeof statusFilter) =>
    workspace?.prompts.filter((item) =>
      (status === 'archived' ? item.archived : status === 'suggested' ? false : !item.archived && (status === 'active' ? item.active : !item.active)) &&
      (!topicFilter || item.tag === topicFilter),
    ).length ?? 0;
  const currentReport = cachedReport ?? (reportKey === `${tab}|${filterQuery}` ? report : null);
  const summary = tab === 'overview' ? (currentReport as SummaryReport | null) : null;
  const overviewChartBrands = project && summary ? [
    { id: project.domain, key: overviewChart === 'shareOfVoice' ? 'sov' : overviewChart === 'position' ? 'position' : 'brand', name: project.name,
      color: seriesColorVar(project.name, project.name, project.competitors.map((item) => item.name)), primary: true },
    ...project.competitors.map((item, index) => ({
      id: item.domain, key: overviewChart === 'shareOfVoice' ? `sovC${index}` : overviewChart === 'position' ? `positionC${index}` : `c${index}`,
      name: item.name, color: seriesColorVar(item.name, project.name, project.competitors.map((item) => item.name)), primary: false,
    })),
  ] : [];
  const overviewCompetitorCount = project?.competitors.length ?? 0;
  const overviewTrend = summary ? summaryTrend(summary, overviewResolution, overviewCompetitorCount) : [];
  const visibleChartBrands = overviewChartBrands.filter((brand) => !hiddenChartBrands.includes(brand.id));
  const overviewMetric = overviewChart as TrendMetric;
  const overviewScale = getTrendScale(overviewTrend, visibleChartBrands.map((brand) => brand.key), overviewMetric);
  const overviewTooltipRank = new Map(rankTrendSeries(overviewChartBrands.map((brand, index) => {
    const suffix = index ? `C${index - 1}` : '';
    const numerator = overviewChart === 'position' ? `positionSum${suffix}` : `mentions${suffix}`;
    const denominator = overviewChart === 'position' ? `positionSamples${suffix}` : overviewChart === 'shareOfVoice' ? 'totalMentions' : 'responses';
    const sum = (key: string) => overviewTrend.reduce((total, row) => total + Number(row[key] ?? 0), 0);
    const total = sum(denominator);
    return { key: brand.key, name: brand.name, value: total ? sum(numerator) / total : null };
  })));
  const overviewSingleSamples = new Set(overviewChartBrands.filter((brand) => overviewTrend.filter((row) => row[brand.key] != null).length === 1).map((brand) => brand.key));
  const promptTrend = detailReport && 'daily' in detailReport ? detailReport.daily.filter((row) => row.responses > 0) : [];
  const promptScale = getTrendScale(promptTrend, ['visibility'], 'visibility');
  const hasChartData = overviewTrend.some((row) => visibleChartBrands.some((brand) => row[brand.key] != null));
  const promptStats =
    tab === 'prompts' ? (currentReport as PromptReport | null) : null;
  const history = tab === 'responses' ? (currentReport as HistoryPage | null) : null;
  const currentHistory =
    responsePage === 1 ? history : historyPages[responsePage - 2];
  const sources = tab === 'sources' ? (currentReport as SourcesPage | null) : null;
  const brands =
    tab === 'competitors' ? (currentReport as CompetitorsReport | null) : null;
  const models = tab === 'models' ? (currentReport as AnalysisReport | null) : null;
  const opportunities =
    tab === 'opportunities' ? (currentReport as OpportunitiesReport | null) : null;
  const pageScope = `${projectId}|${tab}|${filterQuery}`;
  const topicsPage = useCollectionPage(
    workspace?.topics ?? [],
    `${projectId}|topics`,
    25,
    t,
  );
  const projectsPage = useCollectionPage(
    workspace?.projects ?? [],
    'projects',
    25,
    t,
  );
  const brandsPage = useCollectionPage(
    brands?.platforms ?? [],
    pageScope,
    25,
    t,
    t('Brands', 'Marcas'),
  );
  const modelsPage = useCollectionPage(
    models?.channels ?? [],
    pageScope,
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
  const free =
    workspace?.capabilities.promptLimit === 10 &&
    workspace.capabilities.topicLimit === 1;
  const engines = availableEngines(
    workspace?.capabilities.engines ?? ['chat_gpt'],
    project?.language_code ?? 'en',
  );
  const onProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await request<{ id: string }>(
        '/api/projects',
        'POST',
        {
          name: name.trim(),
          domain: domain.trim(),
          language_code: language,
          location_code: location,
        });
      await refresh(result.id);
      setName('');
      setDomain('');
      setCreatingProject(false);
      setTab('prompts');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
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
  const closePromptDetail = () => {
    setPromptRoute(null);
    setDetailReport(null);
    requestAnimationFrame(() =>
      window.scrollTo({ top: promptReturnScroll.current, behavior: 'instant' }),
    );
  };
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
    if (!item) {
      queueMicrotask(() =>
        setError(
          t(
            'Prompt not found or access denied.',
            'Prompt não encontrado ou acesso negado.',
          ),
        ),
      );
      return;
    }
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
  }, [workspace, promptRoute, tab, filterQuery, dataRevision, api, request, t]);
  const changeDetailPage = async (
    kind: 'history' | 'sources',
    next: boolean,
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
    const targetPage = next ? page + 1 : page - 1;
    const targetCursors =
      next && !cursors[page] ? [...cursors, cursor || ''] : cursors;
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
        busy={busy}
        label={`${kind === 'history' ? t('Responses', 'Respostas') : t('Sources', 'Fontes')} · ${t('Page', 'Página')} ${page}`}
        previousLabel={t('Previous', 'Anterior')}
        nextLabel={t('Next', 'Próxima')}
        onPrevious={() => void changeDetailPage(kind, false)}
        onNext={() => void changeDetailPage(kind, true)}
      />
    );
  };
  const loadMore = async (cursor: string) => {
    setBusy(true);
    try {
      const params = new URLSearchParams(filterQuery);
      params.set('view', 'history');
      params.set('cursor', cursor);
      const next = await request<HistoryPage>(`${api}/reports?${params}`);
      setHistoryPages((previous) => [...previous, next]);
      setResponsePage((page) => page + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const promptColumnLabels: Record<string, string> = { models: t('AI models', 'Modelos de IA'), tags: t('Tags', 'Tags'), visibility: t('Visibility', 'Visibilidade'), position: t('Position', 'Posição'), country: t('Country', 'País'), channels: t('Per-model performance', 'Desempenho por modelo') };
  const showPromptColumn = (column: string) => visiblePromptColumns.includes(column);
  const promptColumns = (
    <colgroup>
      <col style={{ width: 44 }} />
      <col />
      {[
        ['models', 160],
        ['tags', 110],
        ['visibility', 90],
        ['position', 80],
        ['country', 140],
        ['channels', 260],
      ]
        .filter(([column]) => showPromptColumn(String(column)))
        .map(([column, width]) => <col key={column} style={{ width }} />)}
      <col style={{ width: 48 }} />
    </colgroup>
  );
  const promptHeader = (hidden = false) => <TableHeader className={hidden ? 'sr-only' : undefined}><TableRow><TableHead className="w-10 pl-4">{hidden ? <span className="sr-only">{t('Select', 'Selecionar')}</span> : <Checkbox aria-label={t('Select all visible prompts', 'Selecionar todos os prompts visíveis')} checked={visiblePrompts.length > 0 && selectedVisiblePrompts.length === visiblePrompts.length} indeterminate={selectedVisiblePrompts.length > 0 && selectedVisiblePrompts.length < visiblePrompts.length} onCheckedChange={(checked) => setSelectedPrompts(checked ? visiblePrompts.map((item) => item.id) : [])} />}</TableHead><TableHead>{t('Prompt', 'Prompt')}</TableHead>{Object.entries(promptColumnLabels).filter(([column]) => showPromptColumn(column)).map(([column, label]) => <TableHead key={column} className={['visibility', 'position'].includes(column) ? 'text-right' : undefined}>{label}</TableHead>)}<TableHead><span className="sr-only">{t('Actions', 'Ações')}</span></TableHead></TableRow></TableHeader>;
  const syncPromptScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.dataset.slot !== 'table-container') return;
    for (const table of [promptTable.current, promptStickyTable.current]) {
      const container = table?.parentElement;
      if (container && container !== target && container.scrollLeft !== target.scrollLeft) container.scrollLeft = target.scrollLeft;
    }
  };
  const promptActions = (
    <PrimaryMenuActions
      label={t('More prompt actions', 'Mais ações de prompts')}
      action={
      <Button
        size="sm"
        disabled={free && workspace.capacity.prompts >= 10}
        onClick={() => openPromptEditor()}
      >
        <Plus size={16} />
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

  return (
    <SidebarProvider
      className="analytics-app live-app"
      style={{ '--sidebar-width': '224px' } as React.CSSProperties}
    >
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
                render={<a href={pageBase} aria-label="Lastfind" />}
              >
                <span className="logo-symbol">
                  {/* The official brand asset has fixed intrinsic dimensions. */}
                  {/* eslint-disable-next-line next/no-img-element */}
                  <img
                    src={LASTFIND_APP_ICON.src}
                    alt=""
                    width={44}
                    height={44}
                  />
                </span>
                <span className="wordmark-text">
                  lastfind<span className="text-primary">.</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {workspace && project && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    className="project-switcher group-data-[collapsible=icon]:hidden"
                    aria-label={t('Switch project', 'Trocar projeto')}
                  />
                }
              >
                <SiteFavicon domain={project.domain} name={project.name} />
                <span>
                  <b>{project.name}</b>
                </span>
                <ChevronsUpDown size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="analytics-menu workspace-switcher-menu"
                side="bottom"
                sideOffset={6}
              >
                <div className="menu-caption">{t('Projects', 'Projetos')}</div>
                {workspace.projects.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    onClick={() => {
                      setDetail(null);
                      setResponseMention('all');
                      void refresh(item.id).catch((cause) =>
                        setError(cause.message),
                      );
                    }}
                  >
                    <SiteFavicon domain={item.domain} name={item.name} />
                    <span className="truncate">{item.name}</span>
                    {item.id === project.id && <Check className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
                <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setCreatingProject(true)}>
                      <Plus />
                      {t('New project', 'Novo projeto')}
                    </DropdownMenuItem>
                  </>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!project && (
            <Button variant="outline" onClick={() => setCreatingProject(true)}>
              {t('New project', 'Novo projeto')}
            </Button>
          )}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={t('Quick search', 'Busca rápida')} className="quick-search" onClick={() => { setTab('prompts'); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.live-prompt-toolbar input',
                      )?.focus(),
                  ); }}>
                <Search /><span>{t('Quick search', 'Busca rápida')}</span><kbd className="ml-auto group-data-[collapsible=icon]:hidden">⌘ K</kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label={t('Project sections', 'Seções do projeto')}>
            {(['Workspace', 'Intelligence'] as const).map((group) => (
              <SidebarGroup key={group} className="px-3 pb-4">
                <SidebarGroupLabel>{group === 'Workspace' ? t('Workspace', 'Workspace') : t('Intelligence', 'Inteligência')}</SidebarGroupLabel>
                <SidebarMenu className="gap-1">
              {navigation.filter((item) => item.group === group && item.id !== 'chats',
                    ).map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      tooltip={t(item.en, item.pt)}
                      isActive={tab === item.id}
                      aria-current={tab === item.id ? 'page' : undefined}
                      onClick={() => {
                        setTab(item.id as Tab);
                        setDetail(null);
                      }}
                    >
                      <item.icon />
                      <span>{t(item.en, item.pt)}</span>
                      {item.id === 'prompts' && (
                            <span className="nav-count group-data-[collapsible=icon]:hidden">{workspace?.prompts.filter((prompt) => prompt.active && !prompt.archived,
                              ).length ?? 0}</span>
                          )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              {group === 'Intelligence' && (
                    <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t('Responses', 'Respostas')}
                  isActive={tab === 'responses'}
                  onClick={() => {
                    setTab('responses');
                    setDetail(null);
                  }}
                >
                  <MessageSquare size={16} />
                  <span>{t('Responses', 'Respostas')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
                  )}
              {group === 'Intelligence' && (
                    <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t('Opportunities', 'Oportunidades')}
                  isActive={tab === 'opportunities'}
                  onClick={() => setTab('opportunities')}
                >
                  <Sparkles size={16} />
                  <span>{t('Opportunities', 'Oportunidades')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </nav>
        </SidebarContent>
        <SidebarFooter className="px-3 pb-3">
          <SidebarMenu className="gap-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t('Settings', 'Configurações')}
                isActive={tab === 'settings'}
                onClick={() => setTab('settings')}
              >
                <Settings2 />
                <span>{t('Settings', 'Configurações')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={t('Documentation', 'Documentação')} render={<a href="/docs" aria-label={t('Documentation', 'Documentação')} />}>
                <BookOpen /><span>{t('Documentation', 'Documentação')}</span><ArrowUpRight className="ml-auto group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {workspace && (
            <DropdownMenu>
              <DropdownMenuTrigger
                  render={
                    <button
                      className="sidebar-account user-menu-trigger"
                      aria-label={t('User menu', 'Menu do usuário')}
                    />
                  }
                >
                  <UserAvatar
                    user={{ name: workspace.user.name || workspace.user.email }}
                    className="account-avatar"
                  />
                  <span className="user-menu-identity">
                    <b>{workspace.user.name || workspace.user.email}</b>
                    <span>{workspace.user.email}</span>
                  </span>
                  <ChevronsUpDown size={14} className="user-menu-chevron" />
                </DropdownMenuTrigger>
              <DropdownMenuContent
                  side="bottom"
                  sideOffset={8}
                  className="analytics-menu user-menu-content"
                >
                <div className="menu-user-header">
                    <UserAvatar
                      user={{
                        name: workspace.user.name || workspace.user.email,
                      }}
                      className="size-9"
                    />
                    <span>
                      <b>{workspace.user.name}</b>
                      <small>{workspace.user.email}</small>
                    </span>
                  </div>
                <DropdownMenuSeparator />
                <div className="menu-caption">
                    {workspace.capabilities.promptLimit === 10
                      ? 'Free'
                      : t('Your plan', 'Seu plano')}
                  </div>
                <p className="live-menu-usage">
                    {workspace.capacity.prompts}/
                    {workspace.capabilities.promptLimit ?? '∞'}{' '}
                    {t('prompts', 'prompts')} · {workspace.capacity.topics}/
                    {workspace.capabilities.topicLimit ?? '∞'}{' '}
                    {t('topics', 'tópicos')}
                  </p>
                <p className="live-menu-usage">
                    {workspace.usage?.used ?? 0}/{workspace.usage?.limit ?? '∞'}{' '}
                    {t('collections this month', 'coletas neste mês')}
                  </p>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTab('settings')}>
                    <Settings2 />
                    {t('Settings', 'Configurações')}
                  </DropdownMenuItem>
                {demoMode && (
                  <>
                    <DropdownMenuItem
                      onClick={() => {
                        cache.invalidate();
                        resetDemo?.();
                      }}
                    >
                      {t('Reset demo', 'Restaurar demo')}
                    </DropdownMenuItem>
                    <p className="live-menu-usage">{t('Changes are temporary. This independent streaming study is not sponsored by Netflix.', 'Alterações temporárias. Este estudo independente de streaming não é patrocinado pela Netflix.',
                      )}</p>
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
                    <LogOut />
                    {t('Sign out', 'Sair')}
                  </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="analytics-topbar">
          <div>
            <SidebarTrigger
              aria-label={t('Toggle navigation', 'Alternar navegação')}
            />
            <span className="topbar-divider" />
            <span className="text-muted-foreground truncate max-w-40">
              {project?.name ?? t('Workspace', 'Workspace')}
            </span>
            <ChevronRight size={12} className="text-muted-foreground" />
            {detailCrumb ? (
              <>
                <DrillLink link={link} to={{ entity: null, run: null, prompt: null }} className="text-muted-foreground">{t(...label[tab])}</DrillLink>
                <ChevronRight size={12} className="text-muted-foreground" />
                <span className="truncate max-w-40" title={detailCrumb}>{detailCrumb}</span>
              </>
            ) : (
              <span>{t(...label[tab])}</span>
            )}
          </div>
          <div className="topbar-actions">
            {project && (
              <Button
                variant="outline"
                className="mobile-filter-toggle"
                aria-expanded={mobileFiltersOpen}
                aria-controls="analytics-topbar-filters"
                onClick={() => setMobileFiltersOpen((open) => !open)}
              >
                <ListFilter size={16} />
                {t('Filters', 'Filtros')}
              </Button>
            )}
            {project && (
              <div
                className="topbar-filters"
                id="analytics-topbar-filters"
                data-mobile-open={mobileFiltersOpen}
              >
                <div className="analytics-filters">
                  <div className="filter-main">
                    <DateRangePicker
                      value={{ days, from: startDate || undefined, to: endDate || undefined,
                      }}
                      bounds={{ lastDate: new Date().toISOString().slice(0, 10), firstDate: '2000-01-01', maxDays: 90,
                      }}
                      onChange={(period) => {
                        setDays(period.days === 'custom' ? '28' : period.days);
                        setStartDate(period.from || '');
                        setEndDate(period.to || '');
                      }}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="outline" aria-label={t('Country', 'País')} />}>
                        <Globe2 />
                        {project.location_code === 2076 ? t('Brazil', 'Brasil')
                          : project.location_code === 2826 ? t('United Kingdom', 'Reino Unido')
                          : t('United States', 'Estados Unidos')}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="analytics-menu">
                        <DropdownMenuItem disabled>{t('Country is fixed for this project.', 'O país é fixo para este projeto.',
                          )}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTab('settings')}>{t('Change project country in Settings', 'Alterar país do projeto em Configurações',
                          )}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="outline"
                            aria-label={t('AI models', 'Modelos de IA')}
                          />
                        }
                      >
                        {engineFilter === 'all' ? (
                          <Cpu />
                        ) : (
                          <span className="live-model-icons" aria-hidden="true">
                            {engineFilter
                              .split(',')
                              .map((engine) => (
                              <EngineIcon key={engine} engine={engine} />
                            ))}
                          </span>
                        )}
                        {engineFilter === 'all'
                          ? t('All models', 'Todos os modelos')
                          : engineFilter
                              .split(',')
                              .map((value) => ENGINE_LABELS[value as Engine])
                              .join(', ')}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="analytics-menu">
                        {engines.map((engine) => (
                          <DropdownMenuCheckboxItem
                            key={engine}
                            checked={
                              engineFilter === 'all' ||
                              engineFilter.split(',').includes(engine)
                            }
                            closeOnClick={false}
                            onCheckedChange={(checked) => {
                              const selected =
                                engineFilter === 'all'
                                  ? [...engines]
                                  : (engineFilter
                                      .split(',')
                                      .filter(Boolean) as Engine[]);
                              const next = checked
                                ? [...new Set([...selected, engine])]
                                : selected.filter((value) => value !== engine);
                              if (next.length)
                                setEngineFilter(
                                  next.length === engines.length
                                    ? 'all'
                                    : next.join(','),
                                );
                            }}
                          >
                            {ENGINE_LABELS[engine]}
                          </DropdownMenuCheckboxItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setEngineFilter('all')}
                        >
                          {t('All models', 'Todos os modelos')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <TopicFilter topics={workspace?.topics ?? []} value={topicFilter} onChange={setTopicFilter} label={t('All topics', 'Todos os tópicos')} />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="outline"
                            aria-label={t('Tag', 'Tag')}
                          />
                        }
                      >
                        <Tag />
                        {tagFilter || t('Tag', 'Tag')}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="analytics-menu">
                        <DropdownMenuItem onClick={() => setTagFilter('')}>
                          {t('All tags', 'Todas as tags')}
                        </DropdownMenuItem>
                        {[
                          ...new Set(
                            workspace?.prompts.flatMap((item) => item.tags) ??
                              [],
                          ),
                        ].map((value) => (
                          <DropdownMenuItem
                            key={value}
                            onClick={() => setTagFilter(value)}
                          >
                            {value}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {(engineFilter !== 'all' || topicFilter || tagFilter) && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('Clear filters', 'Limpar filtros')}
                        onClick={() => {
                          setEngineFilter('all');
                          setTopicFilter('');
                          setTagFilter('');
                        }}
                      >
                        <X />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="topbar-help">
              {project && (
                <ExportButton
                  href={`${api}/export?${filterQuery}`}
                  label={exporting ? t('Preparing CSV…', 'Preparando CSV…') : t('Export filtered CSV', 'Exportar CSV filtrado')}
                  busy={exporting}
                  onExport={
                    demoMode
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
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('Workspace help', 'Ajuda do workspace')}
                onClick={() => window.location.assign('/docs')}
              >
                <CircleHelp />
              </Button>
            </div>
          </div>
        </header>
        <div className="analytics-content live-content" id="analytics-main">
          {error && (
            <div role="alert" className="live-error">
              {error}{' '}
              <button
                onClick={() => {
                  setError('');
                  void refresh(projectId).catch((cause) =>
                    setError(cause.message),
                  );
                }}
              >
                {t('Retry', 'Tentar novamente')}
              </button>
            </div>
          )}
          {loading ? (
            <div aria-live="polite" className="live-state">
              <AnalyticsSkeleton label={t('Loading your workspace…', 'Carregando seu workspace…')} rows={8} />
            </div>
          ) : (
            workspace && (
              <section>
                <>
                  {selectedPrompt && tab === 'prompts' && (
                    <button
                      className="back-to-prompts"
                      onClick={() => {
                        closePromptDetail();
                      }}
                    >
                      ← {t('All prompts', 'Todos os prompts')}
                    </button>
                  )}
                  <PageHeading
                    className={tab === 'settings' ? 'live-settings-heading' : undefined}
                    title={creatingProject || !project ? t('Create a project', 'Crie um projeto') : selectedPrompt && tab === 'prompts' ? selectedPrompt.text : t(...label[tab])}
                    description={creatingProject || !project ? t('Start by naming your brand and market.', 'Comece definindo sua marca e mercado.') : selectedPrompt && tab === 'prompts' ? t('Explore performance for this specific prompt.', 'Explore o desempenho deste prompt.') : t(...description[tab])}
                    actions={tab === 'prompts' && !promptsSticky && !selectedPrompt ? promptActions : project && tab === 'overview' ? (
                      <Button onClick={() => { openPromptEditor(); }}><Plus size={15} />{t('Add prompt', 'Adicionar prompt')}</Button>
                    ) : null}
                  />
                </>
                {(!project || creatingProject) && (
                  <form className="live-card live-form" onSubmit={onProject}>
                    <h2>{t('New project', 'Novo projeto')}</h2>
                    <label>
                      {t('Brand', 'Marca')}
                      <input
                        required
                        minLength={2}
                        maxLength={80}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <label>
                      {t('Domain', 'Domínio')}
                      <input
                        required
                        type="text"
                        placeholder="example.com"
                        value={domain}
                        onChange={(event) => setDomain(event.target.value)}
                      />
                    </label>
                    <label>
                      {t('Language', 'Idioma')}
                      <select
                        value={language}
                        onChange={(event) =>
                          setLanguage(event.target.value as 'en' | 'pt')
                        }
                      >
                        <option value="en">English</option>
                        <option value="pt">Português</option>
                      </select>
                    </label>
                    <label>
                      {t('Country', 'País')}
                      <select
                        value={location}
                        onChange={(event) =>
                          setLocation(Number(event.target.value))
                        }
                      >
                        <option value={2840}>
                          {t('United States', 'Estados Unidos')}
                        </option>
                        <option value={2076}>{t('Brazil', 'Brasil')}</option>
                        <option value={2826}>
                          {t('United Kingdom', 'Reino Unido')}
                        </option>
                      </select>
                    </label>
                    <button disabled={busy}>
                      {t('Create project', 'Criar projeto')}
                    </button>
                  </form>
                )}
                {project && !creatingProject && tab === 'overview' && (
                  <>
                    <h2 className="sr-only">{t('Overview', 'Visão geral')}</h2>
                    {reportLoading ? (
                      <AnalyticsSkeleton label={t('Loading report…', 'Carregando relatório…')} />
                    ) : summary ? (
                      summary.metrics.responses ? (
                        <>
                          <div className="metric-strip">
                            {(
                              [
                                [
                                  'visibility',
                                  t('Visibility', 'Visibilidade'),
                                  '%',
                                  t(
                                    'Answers mentioning the brand',
                                    'Respostas que citam a marca',
                                  ),
                                ],
                                [
                                  'shareOfVoice',
                                  t(
                                    'Share of voice',
                                    'Participação nas menções',
                                  ),
                                  '%',
                                  t(
                                    'Share of tracked brand mentions',
                                    'Participação entre menções de marcas monitoradas',
                                  ),
                                ],
                                [
                                  'mentionPosition',
                                  t('Average position', 'Posição média'),
                                  '',
                                  t(
                                    'Average position among tracked brands',
                                    'Posição média entre marcas monitoradas',
                                  ),
                                ],
                              ] as const
                            ).map(([key, title, suffix, description]) => {
                              const available =
                                summary.availability[key]?.current;
                              const delta = summary.comparison.delta[key];
                              return (
                                <article className="metric-summary" key={key}>
                                  <div className="metric-label">
                                    {key === 'visibility' ? (
                                      <Eye size={15} />
                                    ) : key === 'shareOfVoice' ? (
                                      <MessageSquare size={15} />
                                    ) : (
                                      <ListOrdered size={15} />
                                    )}
                                    <span>{title}</span><button type="button" className="metric-help" aria-label={description} title={description}><Info size={12} /></button>
                                  </div>
                                  <div className="metric-number">
                                    {available ? (
                                      <DrillLink link={link} to={{ tab: 'competitors', brandView: 'general' }} aria-label={`${title}: ${summary.metrics[key].toFixed(1)}${suffix}. ${t('Open brands', 'Abrir marcas')}`}>
                                        {`${summary.metrics[key].toFixed(1)}${suffix}`}
                                      </DrillLink>
                                    ) : '—'}
                                  </div>
                                  <p>{description}</p>
                                  {available &&
                                  summary.comparison.comparable &&
                                  summary.comparison.hasPreviousData &&
                                  summary.availability[key]?.previous ? (
                                    <p className="live-metric-delta">
                                      {delta >= 0 ? '+' : ''}
                                      {delta.toFixed(1)} {suffix ? 'pp' : ''}{' '}
                                      {t(
                                        'versus previous period',
                                        'ante período anterior',
                                      )}
                                    </p>
                                  ) : null}
                                </article>
                              );
                            })}
                          </div>
                          <div className="overview-grid">
                            <section className="analytics-panel trend-panel">
                              <div className="panel-heading overview-trend-controls">
                                <ToggleGroup multiple={false} value={[overviewChart]} onValueChange={(value) => { if (value[0]) setOverviewChart(value[0] as typeof overviewChart); }} size="sm" variant="outline" spacing={0} aria-label={t('Chart metric', 'Métrica do gráfico')}>
                                  <ToggleGroupItem value="visibility"><Eye />{t('Visibility', 'Visibilidade')}</ToggleGroupItem>
                                  <ToggleGroupItem value="shareOfVoice" title={t('Share of voice', 'Participação nas menções')} aria-label={t('Share of voice', 'Participação nas menções')}><MessageSquare />SOV</ToggleGroupItem>
                                  <ToggleGroupItem value="position"><ListOrdered />{t('Position', 'Posição')}</ToggleGroupItem>
                                </ToggleGroup>
                                <ToggleGroup multiple={false} value={[overviewResolution]} onValueChange={(value) => { if (value[0]) setOverviewResolution(value[0] as TrendResolution); }} size="sm" variant="outline" spacing={0} aria-label={t('Time resolution', 'Resolução temporal')}>
                                  {(['day', 'week', 'month'] as const).map((resolution, index) => <ToggleGroupItem key={resolution} value={resolution} aria-label={resolution === 'day' ? t('Day', 'Dia') : resolution === 'week' ? t('Week', 'Semana') : t('Month', 'Mês')} title={resolution === 'day' ? t('Day', 'Dia') : resolution === 'week' ? t('Week', 'Semana') : t('Month', 'Mês')}>{['D', 'W', 'M'][index]}</ToggleGroupItem>)}
                                </ToggleGroup>
                              </div>
                              {hasChartData ? (
                                <figure className="trend-chart" aria-label={t('Brand trend', 'Evolução das marcas')}>
                                  <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 500, height: 233 }}>
                                    <ComposedChart data={overviewTrend} margin={{ top: 15, right: 12, bottom: 5, left: -18 }}>
                                      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
                                      <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={38} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickFormatter={(date) => new Intl.DateTimeFormat(locale, { day: overviewResolution === 'month' ? undefined : 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))} dy={10} />
                                      <YAxis axisLine={false} tickLine={false} reversed={overviewChart === 'position'} domain={overviewScale.domain} ticks={overviewScale.ticks} allowDecimals={overviewChart === 'position'} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} tickFormatter={(value) => overviewChart === 'position' ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value)) : `${value}%`} />
                                      <ChartTooltip itemSorter={(item) => overviewTooltipRank.get(String(item.dataKey)) ?? Infinity} labelFormatter={(date) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14 }} formatter={(value, name) => [`${Number(value).toFixed(1)}${overviewChart === 'position' ? '' : '%'}`, overviewChartBrands.find((brand) => brand.key === name)?.name ?? name]} />
                                      {visibleChartBrands.map((brand) => (
                                        <Line key={brand.id} dataKey={brand.key} name={brand.key} type="monotone" stroke={brand.color} strokeWidth={brand.primary ? 2.5 : 1.5} dot={(props) => {
                                          const { cx, cy, payload, index } = props;
                                          if (payload?.[brand.key] == null || !overviewSingleSamples.has(brand.key)) return <g key={index} />;
                                          return <circle key={index} cx={cx} cy={cy} r={3} fill={brand.color} />;
                                        }} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />
                                      ))}
                                    </ComposedChart>
                                  </ResponsiveContainer>
                                </figure>
                              ) : (
                                <p className="live-chart-empty">{visibleChartBrands.length === 0 ? t('Select a brand to display.', 'Selecione uma marca para exibir.') : overviewChart === 'position' ? t('No measured mention positions in this period.', 'Sem posições de menção medidas neste período.') : t('No measured data in this period.', 'Sem dados medidos neste período.')}</p>
                              )}
                              <div className="chart-legend">{overviewChartBrands.map((brand) => (
                                <button key={brand.id} aria-pressed={!hiddenChartBrands.includes(brand.id)} className={hiddenChartBrands.includes(brand.id) ? 'muted-series' : ''} onClick={() => setHiddenChartBrands((current) => current.includes(brand.id) ? current.filter((key) => key !== brand.id) : [...current, brand.id])}><i style={{ background: brand.color }} />{brand.name}</button>
                              ))}</div>
                            </section>
                            <section className="analytics-panel ranking-panel">
                              <div className="panel-heading"><h2>{t('Brand ranking', 'Ranking de marcas')}</h2><Button variant="ghost" size="sm" onClick={() => setTab('competitors')}>{t('View all', 'Ver todas')}<ArrowUpRight size={13} /></Button></div>
                              <div className="live-table-scroll"><Table className="analytics-table"><TableHeader><TableRow><TableHead>#</TableHead><TableHead>{t('Brand', 'Marca')}</TableHead><TableHead className="text-right">{t('Visibility', 'Visibilidade')}</TableHead><TableHead className="text-right">{t('Mentions', 'Menções')}</TableHead></TableRow></TableHeader><TableBody>
                              {summary.leaderboard.map((item, index) => (
                                      <TableRow key={item.domain}><TableCell>{index + 1}</TableCell><TableCell><DrillLink link={link} to={{ tab: 'responses', brand: item.name, mention: 'mentioned' }} className="flex items-center gap-2"><SiteFavicon domain={item.domain} name={item.name} />{item.name}</DrillLink></TableCell><TableCell className="text-right">{item.visibility.toFixed(1)}%</TableCell><TableCell className="text-right"><DrillLink link={link} to={{ tab: 'responses', brand: item.name, mention: 'mentioned' }}>{item.count}</DrillLink></TableCell></TableRow>
                                    ))}
                              </TableBody></Table></div>
                            </section>
                          </div>
                          <div className="overview-grid sources-grid">
                            <div className="overview-stack">
                              <section className="analytics-panel">
                                <div className="panel-heading"><h2>{t('Top sources', 'Principais fontes')}</h2><Button variant="ghost" size="sm" onClick={() => setTab('sources')}>{t('View all', 'Ver todas')}<ArrowUpRight size={13} /></Button></div>
                                {overviewSources?.rows.length ? (
                                  <div className="live-frequency" aria-label={t('Citation frequency by source', 'Frequência de citação por fonte')}>
                                    {overviewSources.rows.slice(0, 5).map((item) => (
                                      <DrillLink key={item.key} link={link} to={{ tab: 'sources', entity: { kind: 'domain', key: item.key } }} disabled={!item.key} title={item.key ? undefined : unknownDomainHint(t)}>
                                        <span className="flex min-w-0 flex-col gap-0.5">
                                          <span className="flex min-w-0 items-center gap-2">
                                            {item.domain && <SiteFavicon domain={item.domain} name={item.domain} />}
                                            <span className="truncate">{item.domain || unknownDomainLabel(t)}</span>
                                          </span>
                                          <span className="st-type-text"><span className="st-dot" style={{ background: SOURCE_TYPE_COLORS[(item.sourceType as DomainType) ?? UNCLASSIFIED] ?? SOURCE_TYPE_COLORS.other }} aria-hidden="true" />{sourceTypeLabel(item.sourceType, t)}</span>
                                        </span>
                                        <i style={{ width: `${(100 * item.responses) / Math.max(1, overviewSources.rows[0].responses)}%` }} />
                                        <b>{item.responses}</b>
                                      </DrillLink>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="p-5 text-muted-foreground">{t('No cited sources in this period.', 'Sem fontes citadas neste período.')}</p>
                                )}
                              </section>
                              <SourceTypesPanel
                                report={typesReport}
                                loading={typesState === 'loading' && !typesReport}
                                failed={typesState === 'failed'}
                                locale={locale}
                                t={t}
                                classifying={classifying}
                                actionError={classifyError}
                                onSelectType={(type) => navigate({ tab: 'sources', group: 'domain', type })}
                                onClassify={demoMode ? undefined : () => void classifySources('domain')}
                                onConfigure={demoMode ? undefined : () => { setSettingsSection('competitors'); setTab('settings'); }}
                                onViewAll={() => setTab('sources')}
                                onRetry={() => setTypesAttempt((value) => value + 1)}
                              />
                            </div>
                            <section className="analytics-panel live-recent-panel">
                              <div className="panel-heading"><h2>{t('Recent responses', 'Respostas recentes')}</h2><Button variant="ghost" size="sm" onClick={() => setTab('responses')}>{t('View all', 'Ver todas')}<ArrowUpRight size={13} /></Button></div>
                              {overviewHistory?.runs.length ? (
                                <ul className="live-list">
                                  {overviewHistory.runs.slice(0, 4).map((run) => (
                                    <li key={run.id}>
                                      <div className="min-w-0">
                                        <DrillLink link={link} to={{ tab: 'responses', run: run.id }} className="live-run-title"><strong>{run.prompt_text}</strong></DrillLink>
                                        <span className="live-run-meta">
                                          <EngineIcon engine={run.engine} />
                                          <span>{ENGINE_LABELS[run.engine]}</span>
                                          <span aria-hidden="true">·</span>
                                          <time
                                            dateTime={run.created_at}
                                            title={new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(run.created_at))}
                                          >
                                            {relativeReportDate(run.created_at, locale)}
                                          </time>
                                        </span>
                                      </div>
                                      <DrillLink link={link} to={{ tab: 'responses', run: run.id }} className={buttonVariants({ variant: 'ghost', size: 'sm' })} aria-label={`${t('Open', 'Abrir')}: ${run.prompt_text}`}>
                                        {t('Open', 'Abrir')}
                                        <ArrowUpRight size={13} aria-hidden="true" />
                                      </DrillLink>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="p-5 text-muted-foreground">{t('No responses in this period.', 'Sem respostas neste período.')}</p>
                              )}
                            </section>
                          </div>
                        </>
                      ) : (
                        <p className="live-card">
                          {t(
                            'No collected answers yet. Results appear after monitoring completes.',
                            'Ainda não há respostas coletadas. Os resultados aparecem após a coleta.',
                          )}
                        </p>
                      )
                    ) : null}
                    <p className="live-muted">
                      {t('Monitoring', 'Monitoramento')}:{' '}
                      {project.daily_enabled
                        ? free ? t('weekly', 'semanal') : t('daily', 'diário')
                        : t('paused', 'pausado')}{' '}
                      · {workspace.monitoring?.pending ?? 0}{' '}
                      {t('pending', 'pendentes')}
                    </p>
                  </>
                )}
                {project && !creatingProject && tab === 'topics' && (
                  <>
                    <h2 className="sr-only">{t('Topics', 'Tópicos')}</h2>
                    <form
                        className="live-card live-inline"
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
                        <button
                          disabled={
                            busy || (free && workspace.capacity.topics >= 1)
                          }
                        >
                          {t('Add topic', 'Adicionar tópico')}
                        </button>
                      </form>
                    {workspace.topics.length ? (
                      <>
                        <ul className="live-list">
                        {topicsPage.rows.map((item) => (
                          <li key={item.id}>
                            <span>{item.name}</span>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => {
                                  const next = window.prompt(
                                    t('Rename topic', 'Renomear tópico'),
                                    item.name,
                                  );
                                  if (next?.trim())
                                    void mutate('/api/topics', 'PATCH', {
                                      id: item.id,
                                      name: next.trim(),
                                    });
                                }}
                              >
                                {t('Rename', 'Renomear')}
                              </Button>
                          </li>
                        ))}
                      </ul>
                        {topicsPage.controls}
                      </>
                    ) : (
                      <p className="live-card">
                        {t('No topics yet.', 'Ainda não há tópicos.')}
                      </p>
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
                    atLimit={free && workspace.capacity.prompts >= 10}
                    demo={demoMode}
                    busy={busy}
                    serverError={addOpen ? error : ''}
                    t={t}
                    onSubmit={(payload) =>
                      mutate(editingPrompt ? `/api/prompts/${encodeURIComponent(editingPrompt.id)}` : '/api/prompts', editingPrompt ? 'PATCH' : 'POST', {
                        ...(!editingPrompt ? { project_id: project.id } : {}),
                        ...payload,
                      })
                    }
                  />
                )}
                {project && !creatingProject && tab === 'prompts' && (
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
                          <Button variant="outline" onClick={() => importInput.current?.click()}><Upload size={15} />{t('Choose CSV file', 'Escolher arquivo CSV')}</Button>
                          <label className="grid gap-2 text-sm font-medium">{t('CSV content', 'Conteúdo CSV')}
                            <textarea className="min-h-32 w-full rounded-md border bg-background p-3 font-mono text-sm" value={importText} onChange={(event) => setImportText(event.target.value)} />
                          </label>
                          {importText && (
                            <p role={importPreview.error ? 'alert' : 'status'} className="text-sm text-muted-foreground">{importPreview.error ? t('Invalid CSV: ', 'CSV inválido: ') + importPreview.error : `${importPreview.rows.length} ${t('prompts ready', 'prompts prontos')}`}</p>
                          )}
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setImportOpen(false)}>{t('Cancel', 'Cancelar')}</Button>
                          <Button disabled={busy || !importPreview.rows.length || !!importPreview.error} onClick={() => void mutate('/api/prompts', 'POST', { project_id: project.id, prompts: importPreview.rows.map((row) => ({ text: row.text, engines: null, tag: row.topic, tags: row.tags,
                                })),
                              }).then((saved) => { if (saved) setImportOpen(false); })}>{t('Import prompts', 'Importar prompts')}</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <div
                      ref={promptSentinel}
                      className="h-px"
                      aria-hidden="true"
                    />
                    <div
                      className={`prompts-layout ${promptsSticky ? 'live-prompts-sticky' : ''} grid items-start gap-5 ${selectedPrompt ? 'live-prompt-detail-layout' : 'section-cols'}`}>
                      <SectionSidebar
                        className="prompts-topics"
                        mode="filter"
                        label={t('Prompt topics', 'Temas dos prompts')}
                        title={t('Topics', 'Temas')}
                        icon={<Folder size={13} />}
                        groups={[{
                          id: 'topics',
                          items: [
                            { id: '', label: t('All prompts', 'Todos os prompts'), icon: <ListFilter size={15} />, count: workspace.prompts.filter((item) => statusFilter === 'archived' ? item.archived : statusFilter === 'suggested' ? false : !item.archived && (statusFilter === 'active' ? item.active : !item.active)).length },
                            ...workspace.topics.map((item, index) => ({
                              id: item.name,
                              label: item.name,
                              swatch: `var(--chart-${(index % 5) + 1})`,
                              count: workspace.prompts.filter((prompt) => prompt.tag === item.name && (statusFilter === 'archived' ? prompt.archived : statusFilter === 'suggested' ? false : !prompt.archived && (statusFilter === 'active' ? prompt.active : !prompt.active))).length,
                            })),
                          ],
                        }]}
                        value={topicFilter}
                        onChange={(id) => { setTopicFilter(id); setSelectedPrompts([]); }}
                        footer={
                          <div className="live-prompt-suggestion">
                            <div className="flex items-center gap-2 px-2 text-sm font-medium"><Sparkles size={14} className="text-primary" />{t('Find your next prompt', 'Encontre seu próximo prompt')}</div>
                            <p className="px-2 pt-2 text-sm leading-5 text-muted-foreground">{t('Explore questions your audience is asking AI.', 'Explore as perguntas que seu público faz à IA.')}</p>
                            <Button variant="ghost" size="sm" className="mt-2 text-sm text-primary" onClick={() => setStatusFilter('suggested')}>{t('Explore suggestions', 'Explorar sugestões')}</Button>
                          </div>
                        }
                      />
                      <div className="analytics-panel prompts-panel collection-panel live-prompts-main" onScrollCapture={syncPromptScroll}>
                        <div className="live-prompt-toolbar">
                          {promptsSticky && <TopicFilter topics={workspace.topics} value={topicFilter} onChange={(value) => { setTopicFilter(value); setSelectedPrompts([]); }} label={t('All topics', 'Todos os tópicos')} />}
                          <div className="live-status-tabs">
                        {(['active', 'suggested', 'inactive', 'archived',
                              ] as const).map(
                          (status) => (
                            <Button
                              key={status}
                              variant="ghost"
                              size="sm"
                              className={statusFilter === status ? 'live-status-active' : ''}
                              onClick={() => { setStatusFilter(status); setSelectedPrompts([]); }}
                            >
                              {status === 'active'
                                ? t('Active', 'Ativos')
                                : status === 'suggested'
                                  ? t('Suggested', 'Sugeridos')
                                : status === 'inactive'
                                  ? t('Inactive', 'Inativos')
                                  : t('Archived', 'Arquivados')}
                              <span className="live-status-count">{promptStatusCount(status)}</span>
                            </Button>
                          ))}
                      </div>
                      <SearchField
                        value={queryText}
                        onChange={setQueryText}
                        placeholder={t('Search prompts…', 'Buscar prompts…',
                            )}
                      />
                      <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm" />}><Settings2 size={14} />{t('Columns', 'Colunas')}</DropdownMenuTrigger><DropdownMenuContent className="analytics-menu">{Object.entries(promptColumnLabels).map(([column, label]) => <DropdownMenuCheckboxItem key={column} checked={showPromptColumn(column)} closeOnClick={false} onCheckedChange={(checked) => setVisiblePromptColumns((selected) => checked ? [...selected, column] : selected.filter((value) => value !== column))}>{label}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu>
                      <>
                            {promptsSticky && promptActions}
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
                              catch (cause) { setError(cause instanceof Error ? cause.message : String(cause),
                                  ); }
                            }}
                          />
                        </>
                    </div>
                        {selectedVisiblePrompts.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-2 text-sm">
                            <span className="mr-2 font-medium text-primary">{selectedVisiblePrompts.length}{' '} {t('selected', 'selecionados')}</span>
                            <Button variant="outline" size="xs" disabled={busy} onClick={() => void Promise.all(selectedVisiblePrompts.map((item) => request(`/api/prompts/${encodeURIComponent(item.id)}`, 'PATCH', { active: false },
                                    ),
                                  ),
                                ).then(() => refresh(project.id)).then(() => setSelectedPrompts([])).catch((cause) => setError(String(cause)))}><Pause />{t('Pause', 'Pausar')}</Button>
                            <Button variant="outline" size="xs" disabled={busy} onClick={() => void Promise.all(selectedVisiblePrompts.map((item) => request(`/api/prompts/${encodeURIComponent(item.id)}`, 'PATCH', { active: true, archived: false },
                                    ),
                                  ),
                                ).then(() => refresh(project.id)).then(() => setSelectedPrompts([])).catch((cause) => setError(String(cause)))}><Play />{t('Restore', 'Restaurar')}</Button>
                            <Button variant="outline" size="xs" disabled={busy} onClick={() => void Promise.all(selectedVisiblePrompts.map((item) => request(`/api/prompts/${encodeURIComponent(item.id)}`, 'PATCH', { archived: true },
                                    ),
                                  ),
                                ).then(() => refresh(project.id)).then(() => setSelectedPrompts([])).catch((cause) => setError(String(cause)))}><Archive />{t('Archive', 'Arquivar')}</Button>
                            <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={t('Clear selection', 'Limpar seleção',
                              )} onClick={() => setSelectedPrompts([])}><X /></Button>
                          </div>
                        )}
                        {visiblePrompts.length ? (
                          <>
                            {promptsSticky && <div className="live-sticky-column-header"><Table ref={promptStickyTable} className="analytics-table live-prompt-table" aria-label={t('Prompt table controls', 'Controles da tabela de prompts')}>{promptColumns}{promptHeader()}</Table></div>}
                            <Table ref={promptTable} className="analytics-table live-prompt-table responsive-table" data-stack-cols="prompt">
                              {promptColumns}
                              {promptHeader(promptsSticky)}
                              <TableBody>
                                {visiblePrompts.map((item) => {
                                  const metric = promptStats?.[item.id];
                                  return (
                                    <TableRow key={item.id} data-state={selectedPrompts.includes(item.id) ? 'selected' : undefined}>
                                      <TableCell className="pl-4" data-mobile="check"><Checkbox aria-label={`${t('Select', 'Selecionar')} ${item.text}`} checked={selectedPrompts.includes(item.id,
                                        )} onCheckedChange={(checked) => setSelectedPrompts((current) => checked ? [...current, item.id] : current.filter((id) => id !== item.id,
                                                ),
                                          )} /></TableCell>
                                      <TableCell className="min-w-0 py-4" data-mobile="title">
                                        <button
                                          title={item.text}
                                          className="line-clamp-2 w-full whitespace-normal text-left text-sm font-medium leading-5 text-foreground hover:text-primary focus-visible:outline-primary"
                                          onClick={() => onPromptDetail(item)}
                                        >
                                          {item.text}
                                        </button>
                                      </TableCell>
                                      {showPromptColumn('models') && <TableCell data-label={promptColumnLabels.models}><div className="live-model-icons">{(item.engines ?? [item.engine]).map((engine) => <span key={engine} title={ENGINE_LABELS[engine]} aria-label={ENGINE_LABELS[engine]}><EngineIcon engine={engine} /></span>)}</div></TableCell>}
                                      {showPromptColumn('tags') && (
                                        <TableCell data-label={promptColumnLabels.tags}>
                                          <div className="flex max-w-[110px] flex-wrap gap-1">
                                            {item.tags.length ? (
                                          item.tags.map((tag) => (
                                            <Badge key={tag} variant="outline" className="h-5 rounded px-1.5 text-sm font-normal text-muted-foreground">{tag}</Badge>))
                                        ) : (
                                          <span className="text-muted-foreground">—</span>
                                        )}
                                          </div>
                                        </TableCell>
                                      )}
                                      {showPromptColumn('visibility') && <TableCell className="text-right tabular-nums" data-label={promptColumnLabels.visibility}>{metric?.responses ? <DrillLink link={link} to={{ tab: 'prompts', prompt: item.id }}>{`${metric.visibility.toFixed(1)}%`}</DrillLink> : '—'}</TableCell>}
                                      {showPromptColumn('position') && <TableCell className="text-right tabular-nums" data-label={promptColumnLabels.position}>
                                      {metric?.position != null
                                        ? metric.position.toFixed(1)
                                        : '—'}
                                    </TableCell>}
                                      {showPromptColumn('country') && <TableCell className="text-muted-foreground" data-label={promptColumnLabels.country}>{project.location_code === 2076 ? '🇧🇷' : project.location_code === 2840 ? '🇺🇸' : ''}{' '} {project.location_code === 2076 ? t('Brazil', 'Brasil') : project.location_code === 2840 ? t('United States', 'Estados Unidos') : t('Project country', 'País do projeto',
                                            )}</TableCell>}
                                      {showPromptColumn('channels') && (
                                        <TableCell data-label={promptColumnLabels.channels} data-mobile="wide">
                                          <div className="space-y-2">
                                            {(item.engines ?? [item.engine]).map((engine) => {
                                              const channel = metric?.channels?.[engine];
                                              return (
                                                <div key={engine} className="flex items-center gap-2 text-xs">
                                                  <EngineIcon engine={engine} />
                                                  <span className="flex-1">{ENGINE_LABELS[engine]}</span>
                                                  <span className="tabular-nums" title={t('Visibility · Position', 'Visibilidade · Posição')}>
                                                    {channel?.responses ? `${channel.visibility.toFixed(1)}%` : '—'}{' '}
                                                    · {' '}
                                                    {channel?.position != null ? channel.position.toFixed(1) : '—'}
                                                  </span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </TableCell>
                                      )}
                                      <TableCell data-mobile="actions">
                                        <DropdownMenu>
                                          <DropdownMenuTrigger
                                            render={
                                              <Button
                                                variant="ghost"
                                                size="icon-xs"
                                                aria-label={`${t('Actions for', 'Ações para')} ${item.text}`}
                                              />
                                            }
                                          >
                                            <MoreVertical />
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent
                                            align='end'
                                            className="analytics-menu"
                                          >
                                            <DropdownMenuItem
                                              onClick={() => openPromptEditor(item)}
                                            >
                                              <Pencil />
                                              {t('Edit prompt', 'Editar prompt',
                                          )}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              disabled={busy}
                                              onClick={() => void mutate(`/api/prompts/${encodeURIComponent(item.id)}`, 'PATCH', { active: !item.active },
                                            )}
                                            >
                                              {item.active ? <Pause /> : <Play />}
                                              {item.active ? t('Pause', 'Pausar') : t('Resume', 'Retomar')}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              disabled={busy}
                                              onClick={() => void mutate(`/api/prompts/${encodeURIComponent(item.id)}`, 'PATCH', { archived: !item.archived, ...(item.archived ? { active: true } : {}),
                                              },
                                            )}
                                            >
                                              <Archive />
                                              {item.archived ? t('Restore', 'Restaurar') : t('Archive', 'Arquivar')}
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </>
                        ) : (
                          <p className="p-5">{statusFilter === 'suggested'
                            ? t('No suggested prompts are available yet.', 'Ainda não há sugestões de prompts disponíveis.',
                                )
                            : t('No prompts yet.', 'Ainda não há prompts.')}</p>
                        )}
                        {promptPage.controls}
                        {selectedPrompt &&
                          detailReport &&
                          'daily' in detailReport && (
                            <article className="grid gap-5">
                              <BrandResearchPanel key={`${project.id}:${selectedPrompt.id}`} project={project} filters={filterQuery} demo={demoMode} refresh={dataRevision} busy={busy} onManage={() => { setSettingsSection('competitors'); setTab('settings'); }} onEvidence={(runId) => { setTab('responses'); void onRun(runId); }} promptId={selectedPrompt.id} />
                              <div className="live-metrics live-prompt-metrics">
                                <article>
                                  <small>{t('Responses', 'Respostas')}</small>
                                  <strong>
                                    {detailReport.metrics?.responses ??
                                      detailReport.platforms.reduce(
                                        (sum, row) => sum + row.responses,
                                        0,
                                      )}
                                  </strong>
                                </article>
                                <article>
                                  <small>{t('Mentions', 'Menções')}</small>
                                  <strong>
                                    {detailReport.metrics?.mentions ??
                                      detailReport.platforms.reduce(
                                        (sum, row) => sum + row.mentions,
                                        0,
                                      )}
                                  </strong>
                                </article>
                                <article>
                                  <small>
                                    {t('Visibility', 'Visibilidade')}
                                  </small>
                                  <strong>
                                    {detailReport.metrics?.responses
                                      ? `${detailReport.metrics.visibility.toFixed(1)}%`
                                      : '—'}
                                  </strong>
                                </article>
                                <article>
                                  <small>{t('Position', 'Posição')}</small>
                                  <strong>
                                    {detailReport.metrics?.position != null
                                      ? detailReport.metrics.position.toFixed(1)
                                      : '—'}
                                  </strong>
                                </article>
                              </div>
                              <SectionCard
                                title={t(
                                  'Visibility over time',
                                  'Visibilidade ao longo do tempo',
                                )}
                              >
                                {promptTrend.length ? (
                                  <div className="px-4 pb-4">
                                    <ResponsiveContainer
                                      width="100%"
                                      height={240}
                                    >
                                      <ComposedChart data={promptTrend}>
                                        <CartesianGrid
                                          strokeDasharray="3 3"
                                          vertical={false}
                                          stroke="var(--border)"
                                        />
                                        <XAxis
                                          dataKey="date"
                                          tickFormatter={(value) =>
                                            new Intl.DateTimeFormat(locale, {
                                              month: 'short',
                                              day: 'numeric',
                                              timeZone: 'UTC',
                                            }).format(new Date(String(value)))
                                          }
                                        />
                                        <YAxis
                                          domain={promptScale.domain}
                                          ticks={promptScale.ticks}
                                          tickFormatter={(value) => `${value}%`}
                                        />
                                        <ChartTooltip
                                          formatter={(value) => [
                                            `${Number(value).toFixed(1)}%`,
                                            t('Visibility', 'Visibilidade'),
                                          ]}
                                        />
                                        <Line
                                          type="monotone"
                                          dataKey='visibility'
                                          stroke="var(--chart-1)"
                                          strokeWidth={2}
                                          dot={promptTrend.length === 1}
                                          isAnimationActive={false}
                                          connectNulls
                                        />
                                      </ComposedChart>
                                    </ResponsiveContainer>
                                  </div>
                                ) : (
                                  <p className="p-4 text-muted-foreground">
                                    {t('No collected answers for this prompt in the selected period.', 'Sem respostas coletadas para este prompt no período selecionado.',
                                    )}
                                  </p>
                                )}
                              </SectionCard>
                              <SectionCard title={t('By model', 'Por modelo')}>
                                <Table className="analytics-table">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>{t('Model', 'Modelo')}</TableHead>
                                      <TableHead className="text-right">{t('Responses', 'Respostas')}</TableHead>
                                      <TableHead className="text-right">{t('Mentions', 'Menções')}</TableHead>
                                      <TableHead className="text-right">{t('Visibility', 'Visibilidade')}</TableHead>
                                      <TableHead className="text-right">{t('Position', 'Posição')}</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {detailReport.platforms.map((item) => (
                                      <TableRow key={item.engine}>
                                        <TableCell>
                                          <span className="flex items-center gap-2">
                                            <EngineIcon engine={item.engine} />
                                            {ENGINE_LABELS[item.engine]}
                                          </span>
                                        </TableCell>
                                        <TableCell className="text-right">{item.responses}</TableCell>
                                        <TableCell className="text-right">{item.mentions}</TableCell>
                                        <TableCell className="text-right">{item.responses ? `${item.visibility.toFixed(1)}%` : '—'}</TableCell>
                                        <TableCell className="text-right">
                                          {item.position != null
                                            ? item.position.toFixed(1)
                                            : '—'}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </SectionCard>
                              <SectionCard title={t('Sources', 'Fontes')}>
                                <Table className="analytics-table">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>{t('Domain', 'Domínio')}</TableHead>
                                      <TableHead className="text-right">{t('Responses', 'Respostas')}</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {detailReport.sources.map((item) => (
                                      <TableRow key={item.domain}>
                                        <TableCell>
                                          <DrillLink link={link} to={{ tab: 'sources', prompt: null, entity: { kind: 'domain', key: item.domain } }} className="flex items-center gap-2">
                                            <SiteFavicon
                                              domain={item.domain}
                                              name={item.domain}
                                            />
                                            {item.domain}
                                          </DrillLink>
                                        </TableCell>
                                        <TableCell className="text-right">{item.responses}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                                {detailPagination(
                                'sources',
                                !!detailReport.hasMoreSources,
                              )}
                              </SectionCard>
                              <SectionCard
                                title={t(
                                  'Response history',
                                  'Histórico de respostas',
                                )}
                              >
                                <Table className="analytics-table">
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>{t('Model', 'Modelo')}</TableHead>
                                      <TableHead>{t('Date', 'Data')}</TableHead>
                                      <TableHead>
                                        {t('Status', 'Status')}
                                      </TableHead>
                                      <TableHead>
                                        <span className="sr-only">
                                          {t('Open response', 'Abrir resposta')}
                                        </span>
                                      </TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {detailReport.history.runs.map((run) => (
                                      <TableRow key={run.id}>
                                        <TableCell>
                                          <span className="flex items-center gap-2">
                                            <EngineIcon engine={run.engine} />
                                            {ENGINE_LABELS[run.engine]}
                                          </span>
                                        </TableCell>
                                        <TableCell>
                                          <time dateTime={run.created_at}>
                                            {relativeReportDate(
                                              run.created_at,
                                              locale,
                                            )}
                                          </time>
                                        </TableCell>
                                        <TableCell>
                                          <Badge variant="secondary">
                                            {run.status === 'complete'
                                              ? t('Complete', 'Concluída')
                                              : run.status === 'failed'
                                                ? t('Failed', 'Falhou')
                                                : t('Pending', 'Pendente')}
                                          </Badge>
                                        </TableCell>
                                        <TableCell>
                                          <DrillLink link={link} to={{ tab: 'responses', prompt: null, run: run.id }} className={buttonVariants({ variant: 'ghost', size: 'sm' })} aria-label={`${t('Open response', 'Abrir resposta')}: ${ENGINE_LABELS[run.engine]}`}>
                                            {t('Open', 'Abrir')}
                                            <ArrowUpRight size={13} aria-hidden="true" />
                                          </DrillLink>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                                {detailPagination(
                                'history',
                                !!detailReport.history.nextCursor,
                              )}
                              </SectionCard>
                            </article>
                          )}
                        {selectedPrompt && (!detailReport || !('daily' in detailReport)) &&
                          (detailLoading || !error ? (
                            <AnalyticsSkeleton
                              label={t('Loading prompt report…', 'Carregando relatório do prompt…',
                                    )}
                            />
                          ) : (
                            <p className="live-card">
                              {t(
                                'The prompt report is unavailable. Retry to load it.',
                                'O relatório do prompt está indisponível. Tente carregar novamente.',
                              )}
                            </p>
                          ))}
                      </div>
                    </div>
                  </>
                )}
                {project && !creatingProject && tab === 'responses' && (
                  <>
                    <h2 className="sr-only">{t('Responses', 'Respostas')}</h2>
                    <div className="analytics-panel">
                      <div className="live-collection-toolbar">
                      <SearchField value={queryText} onChange={setQueryText} placeholder={t('Search questions…', 'Buscar perguntas…',
                          )} />
                      <select aria-label={t('Brand mention', 'Menção da marca')} value={responseMention} onChange={(event) => setResponseMention(event.target.value as typeof responseMention,
                            )}>
                        <option value="all">{t('All responses', 'Todas as respostas')}</option>
                        <option value="mentioned">{t('Brand mentioned', 'Marca mencionada')}</option>
                        <option value="missing">{t('Brand missing', 'Marca ausente')}</option>
                      </select>
                      {brandFilter && (
                        <Badge variant="secondary" className="st-chip">
                          {t('Brand', 'Marca')}: {brandFilter}
                          <button type="button" aria-label={t('Clear brand filter', 'Limpar filtro de marca')} onClick={() => setBrandFilter('')}><X size={12} /></button>
                        </Badge>
                      )}
                    </div>
                      {runRoute && !detail ? (
                        runState === 'failed' ? (
                          <p className="live-card" role="alert">
                            {t('This response is unavailable.', 'Esta resposta está indisponível.')}{' '}
                            <DrillLink link={link} to={{ run: null }} className="st-link">{t('Back to responses', 'Voltar às respostas')}</DrillLink>
                          </p>
                        ) : (
                          <AnalyticsSkeleton label={t('Loading response…', 'Carregando resposta…')} />
                        )
                      ) : detail ? (
                        <article className="p-5">
                        <DrillLink link={link} to={{ run: null }} className="st-back">
                          <ArrowLeft size={14} aria-hidden="true" />
                          {t('All responses', 'Todas as respostas')}
                        </DrillLink>
                        <h3><DrillLink link={link} to={{ tab: 'prompts', run: null, prompt: promptUnit(detail.prompt_id) }}>{detail.prompt_text}</DrillLink></h3>
                        <p className="live-run-meta">
                          <EngineIcon engine={detail.engine} />
                          <span>{ENGINE_LABELS[detail.engine]}</span>
                          <span aria-hidden="true">·</span>
                          <time dateTime={detail.created_at}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(detail.created_at))}</time>
                          <span aria-hidden="true">·</span>
                          <span>{detail.status}</span>
                        </p>
                        {detail.answer ? (
                          <div className="live-answer">{detail.answer}</div>
                        ) : (
                          <p>
                            {t(
                              'Answer not available yet.',
                              'Resposta ainda indisponível.',
                            )}
                          </p>
                        )}
                        {detail.sources.length > 0 && (
                          <>
                            <h4>{t('Cited sources', 'Fontes citadas')}</h4>
                            <ul>
                              {runSourcesPage.rows.map((source) => (
                                <li key={source.url}>
                                  <DrillLink link={link} to={{ tab: 'sources', run: null, entity: { kind: 'url', key: source.url } }}>
                                    {source.title || source.domain}
                                  </DrillLink>{' '}
                                  <small className="inline-flex flex-wrap items-center gap-1">
                                    <DrillLink link={link} to={{ tab: 'sources', run: null, entity: { kind: 'domain', key: source.domain } }}>{source.domain}</DrillLink>
                                    {' · '}
                                    <a href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`${t('Open page', 'Abrir página')}: ${source.url}`}>
                                      {t('Visit', 'Visitar')} <ExternalLink size={11} aria-hidden="true" />
                                    </a>
                                  </small>
                                </li>
                              ))}
                            </ul>
                              {runSourcesPage.controls}
                            </>
                        )}
                        <h4>{t('Consulted sources', 'Fontes consultadas')}</h4>
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
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {source.title || source.domain}
                                </a>
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
                            <h4>
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
                      ) : reportLoading ? (
                        <AnalyticsSkeleton label={t('Loading responses…', 'Carregando respostas…')} />
                      ) : currentHistory?.runs.length ? (
                        <div className="live-table-scroll">
                          <Table className="analytics-table">
                            <TableHeader><TableRow><TableHead>{t('Prompt', 'Prompt')}</TableHead><TableHead>{t('Model', 'Modelo')}</TableHead><TableHead>{t('Brands mentioned', 'Marcas mencionadas')}</TableHead><TableHead className="text-right">{t('Citations', 'Citações')}</TableHead><TableHead>{t('Date', 'Data')}</TableHead><TableHead>{t('Open response', 'Abrir resposta')}</TableHead></TableRow></TableHeader>
                            <TableBody>
                              {currentHistory.runs.map((run) => (
                                <TableRow key={run.id}>
                                  <TableCell className="max-w-[340px] whitespace-normal"><DrillLink link={link} to={{ tab: 'prompts', prompt: promptUnit(run.prompt_id) }} className="font-medium">{run.prompt_text}</DrillLink></TableCell>
                                  <TableCell>
                                    <span className="flex items-center gap-2">
                                      <EngineIcon engine={run.engine} />
                                      {ENGINE_LABELS[run.engine]}
                                    </span>
                                  </TableCell>
                                  <TableCell>{(() => {
                                    const names = Object.entries(run.mentions || {}).filter(([, value]) => value).map(([name]) => name);
                                    return names.length ? names.map((name, index) => <span key={name}>{index > 0 && ', '}<DrillLink link={link} to={{ tab: 'responses', run: null, brand: name, mention: 'mentioned' }}>{name}</DrillLink></span>) : '—';
                                  })()}</TableCell>
                                  <TableCell className="text-right"><DrillLink link={link} to={{ tab: 'responses', run: run.id }}>{run.source_count ?? run.sources?.length ?? 0}</DrillLink></TableCell>
                                  <TableCell>{run.created_at.slice(0, 10)}</TableCell>
                                  <TableCell><DrillLink link={link} to={{ tab: 'responses', run: run.id }} className={buttonVariants({ variant: 'ghost', size: 'sm' })} aria-label={`${t('Open', 'Abrir')}: ${run.prompt_text}`}>{t('Open', 'Abrir')}<ArrowUpRight size={13} aria-hidden="true" /></DrillLink></TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : error ? null : (
                      <p className="live-card">
                        {t(
                          'No responses in this period.',
                          'Sem respostas neste período.',
                        )}
                      </p>
                    )}
                      {!detail && currentHistory && (
                      <CollectionPagination
                          page={responsePage}
                          pages={
                            currentHistory.nextCursor ? undefined : responsePage
                          }
                          busy={busy || reportLoading}
                          label={`${t('Page', 'Página')} ${responsePage}`}
                          previousLabel={t('Previous', 'Anterior')}
                          nextLabel={t('Next', 'Próxima')}
                          onPrevious={() => setResponsePage((page) => page - 1)}
                          onNext={() => {
                            if (historyPages[responsePage - 1])
                              setResponsePage((page) => page + 1);
                            else if (currentHistory.nextCursor)
                              void loadMore(currentHistory.nextCursor);
                          }}
                        />
                    )}
                    </div>
                  </>
                )}
                {project && !creatingProject && tab === 'sources' && (
                  <>
                    <h2 className="sr-only">{t('Sources', 'Fontes')}</h2>
                    {entity ? (
                      <SourceEntityPage
                        api={api}
                        request={request}
                        filters={detailFilters}
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
                      />
                    ) : (
                    <div className="analytics-panel">
                      <div className="live-collection-toolbar">
                        <div className="live-status-tabs" role="tablist" aria-label={t('Source grouping', 'Agrupamento de fontes')}>
                          {(['domain', 'url'] as const).map((group) => (
                            <Button key={group} role="tab" aria-selected={sourceGroup === group} variant="ghost" size="sm" className={sourceGroup === group ? 'live-status-active' : ''} onClick={() => { setSourceGroup(group); setSourcePage(1); setTypeFilter(''); }}>{group === 'domain' ? t('Domains', 'Domínios') : 'URLs'}</Button>))}
                        </div>
                        <FilterSelect
                          label={sourceGroup === 'domain' ? t('Source type', 'Tipo de fonte') : t('Page type', 'Tipo de página')}
                          value={typeFilter || 'all'}
                          onChange={(value) => { setTypeFilter(value === 'all' ? '' : value); setSourcePage(1); }}
                          options={[
                            { value: 'all', label: sourceGroup === 'domain' ? t('All source types', 'Todos os tipos de fonte') : t('All page types', 'Todos os tipos de página') },
                            ...(sourceGroup === 'domain' ? DOMAIN_TYPES : PAGE_TYPES).map((type) => ({ value: type, label: sourceTypeLabel(type, t) })),
                            { value: UNCLASSIFIED, label: sourceTypeLabel(UNCLASSIFIED, t) },
                          ]}
                        />
                        <FilterSelect
                          label={t('Cited or consulted', 'Citadas ou consultadas')}
                          value={sourceKind}
                          onChange={(value) => {
                            setSourceKind(value as typeof sourceKind);
                            setSourcePage(1);
                          }}
                          options={[
                            { value: 'cited', label: t('Cited', 'Citadas') },
                            { value: 'consulted', label: t('Consulted', 'Consultadas') },
                          ]}
                        />
                      </div>
                      {sources && sourceKind === 'consulted' && !sources.available && (
                        <p className="live-card">
                          {t('Consulted sources are unavailable for these answers.', 'Fontes consultadas indisponíveis para estas respostas.')}
                        </p>
                      )}
                      {sources?.classifier && sources.rows.some((row) => row.sourceType === UNCLASSIFIED && row.ownership === 'third-party') && (
                        <div className="st-list-notice">
                          <ClassifierNotice
                            classifier={sources.classifier}
                            unclassified={sources.rows.filter((row) => row.sourceType === UNCLASSIFIED).length}
                            classifying={classifying}
                            onClassify={demoMode ? undefined : () => void classifySources(sourceGroup)}
                            onConfigure={demoMode ? undefined : () => { setSettingsSection('competitors'); setTab('settings'); }}
                            t={t}
                            noun={sourceGroup === 'domain' ? t('domains', 'domínios') : t('pages', 'páginas')}
                          />
                          {classifyError && <p role="alert" className="st-error">{classifyError}</p>}
                        </div>
                      )}
                      {reportLoading ? (
                        <AnalyticsSkeleton label={t('Loading sources…', 'Carregando fontes…')} />
                      ) : sources && sources.rows.length ? (
                        <div className="live-table-scroll">
                          <Table className="analytics-table live-sources-table responsive-table" data-stack-cols="2">
                            <TableHeader>
                              <TableRow>
                                <TableHead data-mobile="hide">#</TableHead>
                                <TableHead>{sourceGroup === 'domain' ? t('Domain', 'Domínio') : 'URL'}</TableHead>
                                <TableHead>{sourceGroup === 'domain' ? t('Type', 'Tipo') : t('Page type', 'Tipo de página')}</TableHead>
                                <TableHead className="text-right">
                                  {sourceKind === 'cited' ? t('Responses with citation', 'Respostas com citação') : t('Responses consulted', 'Respostas consultadas')}
                                </TableHead>
                                <TableHead className="text-right">
                                  {sourceKind === 'cited' ? t('Citation rate', 'Taxa de citação') : t('Consultation rate', 'Taxa de consulta')}
                                </TableHead>
                                <TableHead>{t('Models', 'Modelos')}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {sources.rows.map((source, index) => (
                                <TableRow key={source.key}>
                                  <TableCell data-mobile="hide">{(sourcePage - 1) * 50 + index + 1}</TableCell>
                                  <TableCell data-mobile="title">
                                    <DrillLink link={link} to={{ tab: 'sources', entity: { kind: sourceGroup, key: source.key } }} className="flex items-center gap-2" disabled={!source.key}>
                                      {source.domain && <SiteFavicon domain={source.domain} name={source.domain} />}
                                      <strong className="truncate">{source.title || source.domain || unknownDomainLabel(t)}</strong>
                                    </DrillLink>
                                    {sourceGroup === 'url' ? (
                                      <small className="st-url">{source.domain || unknownDomainLabel(t)}</small>
                                    ) : !source.key && (
                                      <small className="st-url">{unknownDomainHint(t)}</small>
                                    )}
                                  </TableCell>
                                  <TableCell data-label={sourceGroup === 'domain' ? t('Type', 'Tipo') : t('Page type', 'Tipo de página')}>
                                    <span className="flex flex-wrap items-center gap-1.5">
                                      <SourceTypeBadge type={source.sourceType} t={t} />
                                      {sourceGroup === 'url' && source.domainType && source.domainType !== UNCLASSIFIED && <SourceTypeBadge type={source.domainType} t={t} className="st-badge-quiet" />}
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-right" data-label={sourceKind === 'cited' ? t('Responses with citation', 'Respostas com citação') : t('Responses consulted', 'Respostas consultadas')}>{source.responses}</TableCell>
                                  <TableCell className="text-right" data-label={sourceKind === 'cited' ? t('Citation rate', 'Taxa de citação') : t('Consultation rate', 'Taxa de consulta')}>{sources.complete ? `${((100 * source.responses) / sources.complete).toFixed(1)}%` : '—'}</TableCell>
                                  <TableCell data-label={t('Models', 'Modelos')} data-mobile="wide">
                                    <div className="live-model-icons">
                                      {source.engines.map((engine) => <span key={engine} title={ENGINE_LABELS[engine]} aria-label={ENGINE_LABELS[engine]}><EngineIcon engine={engine} /></span>)}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : error ? null : (
                        <p className="live-card">
                          {typeFilter
                            ? t('No sources of this type in this period.', 'Nenhuma fonte deste tipo neste período.')
                            : t('No cited sources in this period.', 'Sem fontes citadas neste período.')}
                        </p>
                      )}
                      {sources && (
                        <CollectionPagination
                          page={sourcePage}
                          pages={sources.hasMore ? undefined : sourcePage}
                          busy={reportLoading}
                          label={`${t('Page', 'Página')} ${sourcePage}`}
                          previousLabel={t('Previous', 'Anterior')}
                          nextLabel={t('Next', 'Próxima')}
                          onPrevious={() => setSourcePage((page) => page - 1)}
                          onNext={() => setSourcePage((page) => page + 1)}
                        />
                      )}
                    </div>
                    )}
                  </>
                )}
                {project && !creatingProject && tab === 'settings' && (
                  <>
                    <h2 className="sr-only">{t('Project settings', 'Configurações do projeto')}</h2>
                    <div className="live-settings-layout section-layout">
                      <SectionSidebar
                        label={t('Settings sections', 'Seções de configurações')}
                        groups={settingsSectionGroups.map((group) => ({
                          id: group.id,
                          label: t(...group.label),
                          items: group.sections.map((section) => ({ id: section.id, label: t(...section.label) })),
                        }))}
                        value={settingsSection}
                        onChange={(id) => setSettingsSection(id as SettingsSection)}
                      />
                    {(settingsSection === 'monitoring' || settingsSection === 'semantic') && <LiveMonitoringSettings workspace={workspace} project={project} engines={engines} busy={busy} t={t} save={mutate} mutationError={error} clearMutationError={() => setError('')} request={request} semantic={settingsSection === 'semantic'} demo={demoMode} />}
                    {settingsSection === 'competitors' && <div className="live-settings-content min-w-0 space-y-6"><LiveCompetitorSettings key={project.id} project={project} busy={busy} t={t} save={mutate} mutationError={error} clearMutationError={() => setError('')} /><BrandResearchPanel settings key={`research-settings:${project.id}`} project={project} filters={filterQuery} demo={demoMode} refresh={dataRevision} busy={busy} onAdd={async (candidate) => { const saved = await mutate(`/api/projects/${project.id}`, 'PATCH', { competitors: [...project.competitors, candidate] }); if (!saved) throw new Error(t('Could not add this brand.', 'Não foi possível adicionar esta marca.')); }} onEvidence={(runId) => { setTab('responses'); void onRun(runId); }} /></div>}
                    {settingsSection === 'workspace' && (
                    <SectionCard
                      className="live-settings-panel"
                      title={t('Brand and market', 'Marca e mercado')}
                      action={<Button disabled={busy} type="submit" form="live-brand-settings">{t('Save settings', 'Salvar configurações')}</Button>}
                    >
                    <form
                        id="live-brand-settings"
                        key={`${project.id}|${settingsSection}`}
                        className="live-form live-settings-form live-settings-brand"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = new FormData(event.currentTarget);
                          const split = (value: FormDataEntryValue | null,
                              ) =>
                            String(value || '')
                              .split(',')
                              .map((part) => part.trim())
                              .filter(Boolean);
                          void mutate(
                            `/api/projects/${encodeURIComponent(project.id)}`,
                            'PATCH',
                            {
                              name: data.get('name'),
                              domain: data.get('domain'),
                              aliases: split(data.get('aliases')),
                              additional_domains: split(
                                data.get('additional_domains'),
                              ),
                              location_code: Number(data.get('location_code'),
                                  ),
                              language_code: data.get('language_code'),
                              category: data.get('category'),
                              audience: data.get('audience'),
                            },
                          );
                        }}
                      >
                        {settingsSection === 'workspace' && <>
                        <label>
                          {t('Brand name', 'Nome da marca')}
                          <input
                            name="name"
                            required
                            defaultValue={project.name}
                          />
                        </label>
                        <label>
                          {t('Primary domain', 'Domínio principal')}
                          <input
                            name="domain"
                            required
                            defaultValue={project.domain}
                          />
                        </label>
                        <label>
                          {t(
                            'Name variations, comma separated',
                            'Variações do nome, separadas por vírgula',
                          )}
                          <input
                            name="aliases"
                            defaultValue={project.aliases.join(', ')}
                          />
                        </label>
                        <label>
                          {t(
                            'Additional domains, comma separated',
                            'Domínios adicionais, separados por vírgula',
                          )}
                          <input
                            name="additional_domains"
                            defaultValue={project.additional_domains.join(', ',
                                )}
                          />
                        </label>
                        <label>
                          {t('Country', 'País')}
                          <select
                            name="location_code"
                            defaultValue={project.location_code}
                          >
                            <option value={2840}>
                              {t('United States', 'Estados Unidos')}
                            </option>
                            <option value={2076}>
                              {t('Brazil', 'Brasil')}
                            </option>
                            <option value={2826}>
                              {t('United Kingdom', 'Reino Unido')}
                            </option>
                          </select>
                        </label>
                        <label>
                          {t('Language', 'Idioma')}
                          <select
                            name="language_code"
                            defaultValue={project.language_code}
                          >
                            <option value="en">English</option>
                            <option value="pt">Português</option>
                          </select>
                        </label>
                        <label>
                          {t('Category', 'Categoria')}
                          <input
                            name="category"
                            defaultValue={project.category}
                          />
                        </label>
                        <label>
                          {t('Audience', 'Público')}
                          <input
                            name="audience"
                            defaultValue={project.audience}
                          />
                        </label>
                        </>}
                      </form>
                    </SectionCard>
                      )}
                    {settingsSection === 'members' && (
                        <SectionCard className="live-settings-panel" title={t('Members and permissions', 'Membros e permissões')} description={demoMode ? t('Invitations are unavailable in this temporary demo.', 'Convites não estão disponíveis nesta demo temporária.') : t('Members are managed by the workspace owner.', 'Os membros são gerenciados pelo responsável do workspace.')}>
                          <div className="flex items-center gap-3"><UserAvatar user={{ name: workspace.user.name || workspace.user.email }} /><div><strong>{workspace.user.name || workspace.user.email}</strong><p className="text-muted-foreground">{workspace.user.email}</p></div></div>
                        </SectionCard>
                      )}
                    {settingsSection === 'projects' && (
                        <SectionCard className="live-settings-panel" title={t('Projects', 'Projetos')} action={<Button size="sm" onClick={() => setCreatingProject(true)}><Plus size={15} />{t('New project', 'Novo projeto')}</Button>}><div className="live-table-scroll"><Table className="analytics-table"><TableHeader><TableRow><TableHead>{t('Project', 'Projeto')}</TableHead><TableHead>{t('Domain', 'Domínio')}</TableHead><TableHead>{t('Country', 'País')}</TableHead></TableRow></TableHeader><TableBody>{projectsPage.rows.map((item) => (
                                  <TableRow key={item.id}><TableCell><Button variant="ghost" onClick={() => void refresh(item.id)}>{item.name}</Button></TableCell><TableCell>{item.domain}</TableCell><TableCell>{item.location_code === 2076 ? t('Brazil', 'Brasil') : item.location_code === 2840 ? t('United States', 'Estados Unidos') : t('United Kingdom', 'Reino Unido')}</TableCell></TableRow>))}</TableBody></Table></div>
                          {projectsPage.controls}
                        </SectionCard>
                      )}
                    {settingsSection === 'profile' && (
                        <SectionCard className="live-settings-panel" title={t('My profile', 'Meu perfil')}><p>{workspace.user.name || workspace.user.email}</p><p className="text-muted-foreground">{workspace.user.email}</p><label className="mt-5 grid max-w-xs gap-2">{t('Interface language', 'Idioma da interface')}<select className="rounded-md border bg-background p-2" value={locale} onChange={(event) => { const next = event.target.value as typeof locale; setLocale(next); }}><option value="en">English</option><option value="pt-BR">Português (Brasil)</option></select></label></SectionCard>
                      )}
                    </div>
                  </>
                )}
                {project && !creatingProject && tab === 'competitors' && (
                  <>
                    <h2 className="sr-only">{t('Tracked brands', 'Marcas monitoradas')}</h2>
                    <BrandReportTabs value={brandView} onChange={setBrandView}>
                    {brandView === 'sentiment' ? (<BrandResearchPanel key={project.id} project={project} filters={filterQuery} demo={demoMode} refresh={dataRevision} busy={busy} onManage={() => { setSettingsSection('competitors'); setTab('settings'); }} onEvidence={(runId) => { setTab('responses'); void onRun(runId); }} />) : (<>
                    {reportLoading ? (
                      <AnalyticsSkeleton label={t('Loading brands…', 'Carregando marcas…')} />
                    ) : brands ? (
                      <>
                        <section className="analytics-panel">
                          {brands.platforms.length ? (
                            <div className="live-table-scroll">
                              <Table className="analytics-table responsive-table" data-stack-cols="3">
                                <TableHeader>
                                  <TableRow>
                                    <TableHead data-mobile="hide">#</TableHead>
                                    <TableHead>{t('Brand', 'Marca')}</TableHead>
                                    <TableHead className="text-right">{t('Visibility', 'Visibilidade')}</TableHead>
                                    <TableHead className="text-right">
                                      {t('Share of voice', 'Share of voice')}
                                    </TableHead>
                                    <TableHead className="text-right">{t('Mentions', 'Menções')}</TableHead>
                                    <TableHead className="text-right" data-mobile="hide">{t('Position', 'Posição')}</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {brandsPage.rows.map((item, index) => (
                                    <TableRow key={item.domain}>
                                      <TableCell data-mobile="hide">{index + 1}</TableCell>
                                      <TableCell data-mobile="title"><DrillLink link={link} to={{ tab: 'responses', brand: item.name, mention: 'mentioned' }} className="flex items-center gap-2"><SiteFavicon domain={item.domain} name={item.name} />{item.name}{item.domain === project.domain && (
                                            <Badge variant="secondary">{t('You', 'Você')}</Badge>
                                          )}</DrillLink></TableCell>
                                      <TableCell className="text-right" data-label={t('Visibility', 'Visibilidade')}>{item.responses ? `${item.visibility.toFixed(1)}%` : '—'}</TableCell>
                                      <TableCell className="text-right" data-label={t('Share of voice', 'Share of voice')}>
                                        {item.shareOfVoice == null
                                          ? '—'
                                          : `${item.shareOfVoice.toFixed(1)}%`}
                                      </TableCell>
                                      <TableCell className="text-right" data-label={t('Mentions', 'Menções')}><DrillLink link={link} to={{ tab: 'responses', brand: item.name, mention: 'mentioned' }}>{item.mentions}</DrillLink></TableCell>
                                      <TableCell className="text-right text-muted-foreground" data-mobile="hide">—</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          ) : (
                            <p className="p-5 text-muted-foreground">{t('No collected answers yet.', 'Ainda não há respostas coletadas.',
                              )}</p>
                          )}
                          {brandsPage.controls}
                        </section>
                        <section className="live-card">
                          <h3>
                            {t(
                              'Competitor-only questions',
                              'Perguntas só com concorrentes',
                            )}
                          </h3>
                          {brands.competitorOnly.length ? (
                            <ul className="live-list">
                              {brands.competitorOnly.map((item, index) => (
                                <li key={`${item.prompt}-${index}`}>
                                  <div className="min-w-0">
                                    <button
                                      className="text-left font-medium hover:text-primary"
                                      onClick={() => {
                                        const prompt = workspace.prompts.find(
                                          (prompt) => prompt.id === item.prompt,
                                        );
                                        if (prompt) onPromptDetail(prompt);
                                      }}
                                    >
                                      {item.label}
                                    </button>
                                    <small>
                                      {item.responses}{' '}
                                      {t('responses', 'respostas')} · {' '}
                                      {item.topic}
                                    </small>
                                    <div className="flex flex-wrap gap-3">
                                      {item.brands?.map((brand) => (
                                        <span
                                          key={brand.domain}
                                          className="flex items-center gap-1 text-sm"
                                        >
                                          <SiteFavicon
                                            domain={brand.domain}
                                            name={brand.name}
                                          />
                                          {brand.name}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="live-model-icons">{(item.engines ?? [item.engine]).map((engine) => <span key={engine} title={ENGINE_LABELS[engine]} aria-label={ENGINE_LABELS[engine]}><EngineIcon engine={engine} /></span>)}</div>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>
                              {t(
                                'No gaps in this period.',
                                'Sem lacunas neste período.',
                              )}
                            </p>
                          )}
                          {brands && (
                      <CollectionPagination
                        page={serverPage}
                        pages={
                          brands.hasMoreCompetitorOnly ? undefined : serverPage
                        }
                        busy={reportLoading}
                        label={`${t('Competitor-only questions', 'Perguntas só com concorrentes')} · ${t('Page', 'Página')} ${serverPage}`}
                        previousLabel={t('Previous', 'Anterior')}
                        nextLabel={t('Next', 'Próxima')}
                        onPrevious={() => setServerPage((page) => page - 1)}
                        onNext={() => setServerPage((page) => page + 1)}
                      />
                          )}
                        </section>
                      </>
                    ) : (
                      <p className="live-card">
                        {t(
                          'No collected answers yet.',
                          'Ainda não há respostas coletadas.',
                        )}
                      </p>
                    )}
                    </>)}
                    </BrandReportTabs>
                  </>
                )}
                {project && !creatingProject && tab === 'models' && (
                  <>
                    <h2 className="sr-only">{t('AI models', 'Modelos de IA')}</h2>
                    {reportLoading ? (
                      <AnalyticsSkeleton label={t('Loading model analysis…', 'Carregando análise dos modelos…')} />
                    ) : models ? (
                      <section className="analytics-panel live-table-scroll">
                        <Table className="analytics-table">
                          <TableHeader><TableRow><TableHead>{t('Model', 'Modelo')}</TableHead><TableHead className="text-right">{t('Responses', 'Respostas')}</TableHead><TableHead className="text-right">{t('Brand mentions', 'Menções da marca')}</TableHead><TableHead className="text-right">{t('Visibility', 'Visibilidade')}</TableHead><TableHead className="text-right">{t('Citations', 'Citações')}</TableHead><TableHead className="text-right">{t('Query evidence', 'Evidência de consulta')}</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {modelsPage.rows.map((item) => (
                              <TableRow key={item.key}>
                                <TableCell className="font-medium">
                                  <DrillLink link={link} to={{ tab: 'responses', engine: item.key }} className="flex items-center gap-2">
                                    <EngineIcon engine={item.key} />
                                    {ENGINE_LABELS[item.key]}
                                  </DrillLink>
                                </TableCell>
                                <TableCell className="text-right"><DrillLink link={link} to={{ tab: 'responses', engine: item.key }}>{item.responses}</DrillLink></TableCell>
                                <TableCell className="text-right">{item.mentions}</TableCell>
                                <TableCell className="text-right">{item.responses ? `${item.visibility.toFixed(1)}%` : '—'}</TableCell>
                                <TableCell className="text-right text-muted-foreground">—</TableCell>
                                <TableCell className="text-right text-muted-foreground">—</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </section>
                    ) : (
                      <p className="live-card">
                        {t(
                          'No model data yet.',
                          'Ainda não há dados por modelo.',
                        )}
                      </p>
                    )}
                    {modelsPage.controls}
                  </>
                )}
                {project && !creatingProject && tab === 'opportunities' && (
                  <>
                    <h2>{t('Opportunities', 'Oportunidades')}</h2>
                    {reportLoading ? (
                      <AnalyticsSkeleton label={t('Loading opportunities…', 'Carregando oportunidades…')} />
                    ) : opportunities?.rows.length ? (
                      <ul className="live-list">
                        {opportunities.rows.map((item) => (
                          <li key={`${item.type}-${item.id}`}>
                            <span>
                              <strong>
                                {item.type === 'uncited-brand' && item.source ? (
                                  <DrillLink link={link} to={{ tab: 'sources', entity: { kind: 'domain', key: item.source } }}>{item.title}</DrillLink>
                                ) : item.prompt ? (
                                  <DrillLink link={link} to={{ tab: 'prompts', prompt: promptUnit(item.prompt) }}>{item.title}</DrillLink>
                                ) : item.title}
                              </strong>
                              <small>{item.detail}</small>
                            </span>
                            <strong>{item.responses}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="live-card">
                        {t(
                          'No measured opportunities in this period.',
                          'Nenhuma oportunidade medida neste período.',
                        )}
                      </p>
                    )}
                    {opportunities && (
                      <CollectionPagination
                        page={serverPage}
                        pages={opportunities.hasMore ? undefined : serverPage}
                        busy={reportLoading}
                        label={`${t('Page', 'Página')} ${serverPage}`}
                        previousLabel={t('Previous', 'Anterior')}
                        nextLabel={t('Next', 'Próxima')}
                        onPrevious={() => setServerPage((page) => page - 1)}
                        onNext={() => setServerPage((page) => page + 1)}
                      />
                    )}
                  </>
                )}
                {project && !creatingProject && tab === 'semantic-branding' && (
                  <section aria-live="polite">
                    {semanticLoading ? (
                      <AnalyticsSkeleton
                        label={t('Loading measured associations…', 'Carregando associações medidas…',
                              )}
                      />
                    ) : !semantic ? (
                      <p className="live-card">{t('The report is unavailable. Retry to load it.', 'O relatório está indisponível. Tente carregar novamente.',
                              )}</p>
                    ) : (
                      <>
                        {semantic.configuration.enabled &&
                          semantic.coverage.evaluated === 0 && (
                            <p className="live-card">
                              {t(
                                'Attributes are configured. Compatible evaluations are not available yet.',
                                'Os atributos estão configurados. Ainda não há avaliações compatíveis disponíveis.',
                              )}
                            </p>
                          )}
                        <p className="live-muted">
                          {semantic.coverage.evaluated} /
                    {' '}
                          {semantic.coverage.eligible}{' '}
                          {t(
                            'eligible answers evaluated',
                            'respostas elegíveis avaliadas',
                          )}{' '}
                          · {semantic.coverage.unassessed}{' '}
                          {t('not evaluated', 'não avaliadas')}
                        </p>
                        {!semanticEvaluationAvailable && (
                          <p className="live-muted">
                            {t(
                              'Automatic evaluation is unavailable in the independent edition.',
                              'A avaliação automática está indisponível na edição independente.',
                            )}
                          </p>
                        )}
                        <SemanticAssociationReport
                          report={measuredAssociationReport(
                            {
                              enabled: semantic.configuration.enabled,
                              attributes: semantic.configuration.attributes.map(
                                (attribute) => ({
                                  ...attribute,
                                  description: attribute.description ?? '',
                                }),
                              ),
                            },
                            semantic.association ?? {
                              ownBrand: project.name,
                              brands: [
                                { name: project.name, domain: project.domain },
                                ...project.competitors,
                              ],
                              cells: [],
                              prompts: 0,
                              engines: [],
                              date: null,
                            },
                          )}
                          prompts={[]}
                          responses={[]}
                          idPrefix="semantic-measured"
                          publicReport={demoMode}
                          onConfigure={() => {
                            setSettingsSection('semantic');
                            setTab('settings');
                          }}
                          onEvidenceSelectionChange={resetSemanticEvidence}
                          explanations={({ brandId, attributeId }) => (
                            <div>
                              <h3>{t(demoMode ? 'Aggregates' : 'Evidence', demoMode ? 'Agregados' : 'Evidências')}</h3>
                              {demoMode ? (
                                <>
                                  <p className="live-muted">{t('This public report publishes aggregate scores and sample counts only. Individual quotes and evaluation reasoning remain private. Observed samples may differ between brands.', 'Este relatório público apresenta somente notas agregadas e contagens de amostras. Citações individuais e justificativas das avaliações permanecem privadas. As amostras observadas podem diferir entre marcas.')}</p>
                                  <ul className="live-list">
                                    {(semantic.association?.brands ?? [])
                                      .filter((brand) => brandId === 'all' || brand.name === brandId)
                                      .map((brand) => {
                                        const cell = semantic.association?.cells.find(
                                          (cell) => cell.brand === brand.name && cell.attribute === attributeId,
                                        );
                                        const grade = (score: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(score);
                                        return (
                                          <li key={brand.name}>
                                            <span>
                                              <strong>{brand.name}</strong>
                                              <small>{semantic.configuration.attributes.find((attribute) => attribute.id === attributeId)?.name}</small>
                                              <small>
                                                {cell?.score == null
                                                  ? t('No comparable sample', 'Sem amostra comparável')
                                                  : `${t('Comparable', 'Comparável')}: ${grade(cell.score)} / 100 · ${cell.samples} ${t(cell.samples === 1 ? 'evaluation' : 'evaluations', cell.samples === 1 ? 'avaliação' : 'avaliações')}`}
                                              </small>
                                              <small>{cell?.insufficient ?? 0} {t('insufficient', 'insuficientes')} · {cell?.ambiguous ?? 0} {t('ambiguous', 'ambíguas')}</small>
                                            </span>
                                            <span>
                                              {cell?.observedScore == null
                                                ? t('No assessed evidence', 'Sem evidência avaliada')
                                                : `${grade(cell.observedScore)} / 100 · ${cell.observedSamples} ${t(cell.observedSamples === 1 ? 'evaluation' : 'evaluations', cell.observedSamples === 1 ? 'avaliação' : 'avaliações')}`}
                                            </span>
                                          </li>
                                        );
                                      })}
                                  </ul>
                                </>
                              ) : semantic.assessments?.length ? (
                                <>
                                  <ul className="live-list">
                                    {semantic.assessments
                                      .filter((assessment) =>
                                        assessment.readings.some(
                                          (reading) =>
                                            reading.attribute === attributeId &&
                                            (brandId === 'all' ||
                                              reading.brand === brandId),
                                        ),
                                      )
                                      .slice(
                                        (semanticEvidencePage - 1) * 20,
                                        semanticEvidencePage * 20,
                                      )
                                      .map((assessment) => (
                                        <li key={assessment.run_id}>
                                          <details>
                                            <summary><strong>{assessment.prompt_text}</strong><small>{ENGINE_LABELS[assessment.engine]}{' '}
                                                ·{' '}
                                                {assessment.run_created_at.slice(0, 10,
                                                )}{' '}
                                                ·{' '}
                                                {assessment.coverage === 'partial' ? t('partial answer excerpt', 'trecho parcial da resposta',
                                                    ) : t('full answer excerpt', 'trecho completo da resposta',
                                                    )}</small></summary>
                                            {assessment.readings
                                              .filter(
                                                (reading) =>
                                                  reading.attribute ===
                                                    attributeId &&
                                                  (brandId === 'all' ||
                                                    reading.brand === brandId),
                                              )
                                              .map((reading) => (
                                                <div key={`${reading.brand}:${reading.attribute}`}>
                                  <p><strong>{reading.brand} ·{' '}
                                                      {semantic.configuration.attributes.find((item) => item.id === reading.attribute,
                                                      )?.name ?? reading.attribute}</strong>{' '}
                                                    ·{' '}
                                                    {reading.score == null ? t('No score', 'Sem nota',
                                                        ) : `${reading.score}/100`}</p>
                                  {reading.quote && (
                                                    <blockquote className="live-semantic-evidence">{reading.quote}</blockquote>
                                                  )}
                                  <p className="live-muted">{reading.reason}</p>
                                </div>))}
                                          </details>
                                        </li>
                                      ))}
                                  </ul>
                                  <CollectionPagination
                                    page={semanticEvidencePage}
                                    pages={semantic.nextCursor
                                        ? undefined
                                        : Math.max(
                                            1,
                                            Math.ceil(
                                              semantic.assessments.length / 20,
                                            ),
                                          )
                                    }
                                    busy={busy}
                                    label={`${t('Evidence', 'Evidências')} · ${t('Page', 'Página')} ${semanticEvidencePage}`}
                                    previousLabel={t('Previous', 'Anterior')}
                                    nextLabel={t('Next', 'Próxima')}
                                    onPrevious={() =>
                                      setSemanticEvidencePage(
                                        (page) => page - 1,
                                      )
                                    }
                                    onNext={() => {
                                      if (
                                        semantic.assessments!.length >
                                        semanticEvidencePage * 20
                                      ) {
                                        setSemanticEvidencePage(
                                          (page) => page + 1,
                                        );
                                        return;
                                      }
                                      if (!semantic.nextCursor) return;
                                      setBusy(true);
                                      const params = new URLSearchParams(filterQuery,
                                      );
                                params.set('cursor', semantic.nextCursor);
                                      void request<SemanticReport>(`/api/projects/${encodeURIComponent(project.id)}/semantic?${params}`,
                                      )
                                        .then((next) => {
                                          setSemantic((current) => current && { ...current, assessments: [...(current.assessments ?? []), ...(next.assessments ?? []),
                                                ], nextCursor: next.nextCursor,
                                              },
                                          );
                                          setSemanticEvidencePage(
                                            (page) => page + 1,
                                          );
                              })
                                        .catch((cause) =>
                                          setError(cause instanceof Error ? cause.message : String(cause),
                                          ),
                                        )
                                        .finally(() => setBusy(false)); }
                            }
                                  />
                                </>
                              ) : (
                                <p className="live-card">{t('No individual assessment is available for these filters yet.', 'Ainda não há avaliação individual para estes filtros.',
                                  )}</p>
                              )}
                            </div>
                          )}
                        />
                      </>
                    )}
                  </section>
                )}
              </section>
            )
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
