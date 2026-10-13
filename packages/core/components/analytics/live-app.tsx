'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { announceSessionChange, requestJson } from '@/lib/client';
import type { Workspace, Run, Engine, Prompt } from '@/lib/types';
import { LASTFIND_APP_ICON } from '@/lib/lastfind-brand';
import { availableEngines, ENGINE_LABELS, ENGINE_META } from '@/lib/engines';
import { SiteFavicon, SearchField } from './shared';
import { UserAvatar } from './user-avatar';
import { parseDemoPromptImport } from './prompts-view';
import { slugify } from './routes';
import { Button } from '@/components/ui/button';
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
  Download,
  Folder,
  Tag,
  Cpu,
  Globe2,
  CircleHelp,
  X,
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
  configuration: { revision: number; enabled: boolean; attributes: { id: string; name: string; description?: string }[] };
  coverage: { eligible: number; evaluated: number; unassessed: number };
  summary: { brand: string; attribute: string; score: number | null; samples: number; observations: number }[];
  assessments?: {
    run_id: string; engine: Engine; prompt_text: string; run_created_at: string; coverage: string;
    readings: { brand: string; attribute: string; state: 'assessed' | 'insufficient' | 'ambiguous'; score: number | null; quote: string | null; reason: string }[];
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

export function LiveAnalyticsApp({
  initialPath = [],
  initialSearch = '',
  readOnly = false,
  semanticEvaluationAvailable = true,
  demoQuestions = [],
}: {
  initialPath?: string[];
  initialSearch?: string;
  readOnly?: boolean;
  semanticEvaluationAvailable?: boolean;
  demoQuestions?: { topic: string; question: string; responses: number }[];
}) {
  const api = readOnly ? '/api/demo' : '/api';
  const pageBase = readOnly ? '/demo' : '/app';
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
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
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
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [semantic, setSemantic] = useState<SemanticReport | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creatingProject, setCreatingProject] = useState(
    initialPath[0] === 'onboarding',
  );
  const [detail, setDetail] = useState<Run | null>(null);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [language, setLanguage] = useState<'en' | 'pt'>('en');
  const [location, setLocation] = useState(2840);
  const [topic, setTopic] = useState('');
  const [prompt, setPrompt] = useState('');
  const [days, setDays] = useState(query.get('days') || '28');
  const [startDate, setStartDate] = useState(query.get('start') || '');
  const [endDate, setEndDate] = useState(query.get('end') || '');
  const [draftStart, setDraftStart] = useState(query.get('start') || '');
  const [draftEnd, setDraftEnd] = useState(query.get('end') || '');
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
  const [sourcePage, setSourcePage] = useState(1);
  const [queryText, setQueryText] = useState(query.get('query') || '');
  const [promptEngine, setPromptEngine] = useState<Engine>('chat_gpt');
  const [promptTopic, setPromptTopic] = useState('');
  const [promptTags, setPromptTags] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState<
    'active' | 'suggested' | 'inactive' | 'archived'
  >('active');
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [more, setMore] = useState<Run[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [detailReport, setDetailReport] = useState<
    PromptDetail | SourceDetail | null
  >(null);
  const navigationReady = useRef(false);
  const restoringHistory = useRef(false);
  const [locale, setLocale] = useState<'en' | 'pt-BR'>('en');
  const t = (en: string, pt: string) => (locale === 'pt-BR' ? pt : en);

  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      setLocale(
        document.cookie
          .split(';')
          .some((part) => part.trim() === 'lastfind_locale=pt-BR')
          ? 'pt-BR'
          : 'en',
      ),
    );
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.live-app');
    const header = root?.querySelector<HTMLElement>('.analytics-topbar');
    if (!root || !header) return;
    const update = () => {
      const toolbar = root.querySelector<HTMLElement>('.live-prompt-toolbar');
      root.style.setProperty(
        '--live-header-height',
        `${header.offsetHeight}px`,
      );
      root.style.setProperty(
        '--live-toolbar-height',
        `${toolbar?.offsetHeight ?? 0}px`,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(header);
    const toolbar = root.querySelector<HTMLElement>('.live-prompt-toolbar');
    if (toolbar) observer.observe(toolbar);
    update();
    return () => observer.disconnect();
  }, [tab, locale, workspace]);
  const refresh = useCallback(
    async (selected: string | null) => {
      const data = await requestJson<Workspace>(
        `${api}/workspace${selected ? `?project=${encodeURIComponent(selected)}` : ''}`,
      );
      setWorkspace(data);
      setProjectId(data.selectedProjectId);
      return data;
    },
    [api, setWorkspace, setProjectId],
  );
  useEffect(() => {
    let active = true;
    requestJson<Workspace>(
      `${api}/workspace${initialProject ? `?project=${encodeURIComponent(initialProject)}` : ''}`,
    )
      .then(async (received) => {
        if (!active) return;
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
            ? await requestJson<Workspace>(
                `${api}/workspace?project=${encodeURIComponent(match.id)}`,
              )
            : received;
        if (!active) return;
        setWorkspace(data);
        setProjectId(data.selectedProjectId);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, initialProject, pathProject]);
  const responseQuery = tab === 'responses' ? queryText : '';
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
    if (tab === 'sources') {
      params.set('kind', sourceKind);
      params.set('group', sourceGroup);
      params.set('page', String(sourcePage));
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
    tab,
    sourceKind,
    sourceGroup,
    sourcePage,
  ]);
  useEffect(() => {
    if (
      !workspace ||
      !projectId ||
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
      queueMicrotask(() => setReport(null));
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setReportLoading(true);
        setReport(null);
        setMore([]);
        setPageCursor(null);
      }
    });
    const view = (
      {
        overview: 'summary',
        prompts: 'prompts',
        responses: 'history',
        sources: 'sources',
        competitors: 'competitors',
        models: 'analysis',
        opportunities: 'opportunities',
      } as const
    )[
      tab as
        | 'overview'
        | 'prompts'
        | 'responses'
        | 'sources'
        | 'competitors'
        | 'models'
        | 'opportunities'
    ];
    const params = new URLSearchParams(filterQuery);
    params.set('view', view);
    requestJson<
      | SummaryReport
      | PromptReport
      | HistoryPage
      | SourcesPage
      | AnalysisReport
      | CompetitorsReport
      | OpportunitiesReport
    >(`${api}/reports?${params}`)
      .then((data) => {
        if (active) setReport(data);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setReportLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspace, projectId, tab, filterQuery, api]);
  useEffect(() => {
    if (!workspace || !projectId || tab !== 'semantic-branding') {
      queueMicrotask(() => setSemantic(null));
      return;
    }
    let active = true;
    queueMicrotask(() => {
      if (active) { setSemanticLoading(true); setSemantic(null); }
    });
    const path = readOnly ? `${api}/semantic` : `/api/projects/${encodeURIComponent(projectId)}/semantic`;
    requestJson<SemanticReport>(`${path}?${filterQuery}`)
      .then((data) => { if (active) setSemantic(data); })
      .catch((cause) => { if (active) setError(cause.message); })
      .finally(() => { if (active) setSemanticLoading(false); });
    return () => { active = false; };
  }, [workspace, projectId, tab, filterQuery, api, readOnly]);
  useEffect(() => {
    const onPopState = () => {
      const next = new URLSearchParams(window.location.search);
      restoringHistory.current = true;
      const nextProject = next.get('project');
      if (nextProject && nextProject !== projectId)
        void refresh(nextProject).catch((cause) => setError(cause.message));
      setTab(
        tabs.includes(next.get('tab') as Tab)
          ? (next.get('tab') as Tab)
          : 'overview',
      );
      setDays(next.get('days') || '28');
      setStartDate(next.get('start') || '');
      setEndDate(next.get('end') || '');
      setEngineFilter(next.get('engine') || 'all');
      setTopicFilter(next.get('topic') || '');
      setTagFilter(next.get('tags') || '');
      setQueryText(next.get('query') || '');
      setSourceKind(next.get('kind') === 'consulted' ? 'consulted' : 'cited');
      setSourceGroup(next.get('group') === 'url' ? 'url' : 'domain');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [projectId, refresh]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (projectId) url.searchParams.set('project', projectId);
    else url.searchParams.delete('project');
    url.searchParams.set('tab', tab);
    url.searchParams.set('days', days);
    if (startDate && endDate) {
      url.searchParams.set('start', startDate);
      url.searchParams.set('end', endDate);
    } else {
      url.searchParams.delete('start');
      url.searchParams.delete('end');
    }
    for (const [key, value] of [
      ['engine', engineFilter],
      ['topic', topicFilter],
      ['tags', tagFilter],
      ['query', queryText],
      ['kind', sourceKind],
      ['group', sourceGroup],
    ]) {
      if (value && value !== 'all') url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    if (url.pathname !== pageBase || url.search !== window.location.search) {
      const method =
        !workspace || !navigationReady.current || restoringHistory.current
          ? 'replaceState'
          : 'pushState';
      window.history[method](null, '', `${pageBase}${url.search}`);
    }
    if (workspace) navigationReady.current = true;
    restoringHistory.current = false;
  }, [
    workspace,
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
    pageBase,
  ]);
  const mutate = async (
    path: string,
    method: string,
    data: unknown,
    selected = projectId,
  ) => {
    if (readOnly) return;
    setBusy(true);
    setError('');
    try {
      await requestJson(path, method, data);
      await refresh(selected);
      setPrompt('');
      setTopic('');
      if (path === '/api/prompts' && method === 'POST') setAddOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const project = workspace?.projects.find((item) => item.id === projectId);
  const visiblePrompts =
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
          engineFilter.split(',').includes(item.engine)),
    ) ?? [];
  const demoGroups = new Map<string, Prompt[]>();
  if (readOnly) for (const item of workspace?.prompts ?? []) {
    if (item.archived ||
      (queryText && !`${item.text} ${item.tag} ${item.tags.join(' ')}`.toLowerCase().includes(queryText.toLowerCase())) ||
      (topicFilter && item.tag !== topicFilter) ||
      (tagFilter && !item.tags.includes(tagFilter)) ||
      (engineFilter !== 'all' && !engineFilter.split(',').includes(item.engine))) continue;
    const key = `${item.tag}\u0000${item.text}`;
    const group = demoGroups.get(key) ?? [];
    group.push(item);
    demoGroups.set(key, group);
  }
  const promptGroups = readOnly ? [...demoGroups.values()] : visiblePrompts.map((item) => [item]);
  const summary = tab === 'overview' ? (report as SummaryReport | null) : null;
  const promptStats =
    tab === 'prompts' ? (report as PromptReport | null) : null;
  const history = tab === 'responses' ? (report as HistoryPage | null) : null;
  const sources = tab === 'sources' ? (report as SourcesPage | null) : null;
  const brands =
    tab === 'competitors' ? (report as CompetitorsReport | null) : null;
  const models = tab === 'models' ? (report as AnalysisReport | null) : null;
  const opportunities =
    tab === 'opportunities' ? (report as OpportunitiesReport | null) : null;
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
      const result = await requestJson<{ id: string }>(
        '/api/projects',
        'POST',
        {
          name: name.trim(),
          domain: domain.trim(),
          language_code: language,
          location_code: location,
        },
      );
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
  const onRun = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      setDetail(
        await requestJson<Run>(`${api}/runs/${encodeURIComponent(id)}`),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const onPromptDetail = (item: Prompt) => {
    setSelectedPrompt(item);
    setDetailReport(null);
    const params = new URLSearchParams(filterQuery);
    params.set('view', 'prompt-detail');
    params.set('prompt', item.id);
    void requestJson<PromptDetail>(`${api}/reports?${params}`)
      .then(setDetailReport)
      .catch((cause) => setError(cause.message));
  };
  const loadMore = async (cursor: string) => {
    setBusy(true);
    try {
      const params = new URLSearchParams(filterQuery);
      params.set('view', 'history');
      params.set('cursor', cursor);
      const next = await requestJson<HistoryPage>(`${api}/reports?${params}`);
      setMore((previous) => [...previous, ...next.runs]);
      setPageCursor(next.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

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
                render={<a href="/app" aria-label="Lastfind" />}
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
                {!readOnly && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setCreatingProject(true)}>
                      <Plus />
                      {t('New project', 'Novo projeto')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!readOnly && !project && (
            <Button variant="outline" onClick={() => setCreatingProject(true)}>
              {t('New project', 'Novo projeto')}
            </Button>
          )}
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label={t('Project sections', 'Seções do projeto')}>
            <SidebarMenu className="px-3 gap-1">
              {navigation
                .filter((item) =>
                  [
                    'overview',
                    'prompts',
                    'competitors',
                    'sources',
                    'models',
                    'semantic-branding',
                  ].includes(item.id),
                )
                .map((item) => (
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
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t('Responses', 'Respostas')}
                  isActive={tab === 'responses'}
                  onClick={() => {
                    setTab('responses');
                    setDetail(null);
                  }}
                >
                  <span className="live-nav-icon">↳</span>
                  <span>{t('Responses', 'Respostas')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t('Opportunities', 'Oportunidades')}
                  isActive={tab === 'opportunities'}
                  onClick={() => setTab('opportunities')}
                >
                  <span className="live-nav-icon">✧</span>
                  <span>{t('Opportunities', 'Oportunidades')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </nav>
        </SidebarContent>
        <SidebarFooter className="px-3 pb-3">
          <SidebarMenu>
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
          </SidebarMenu>
          {readOnly ? (
            <a className="live-demo-account" href="/app">
              {t('Start a free workspace', 'Criar workspace grátis')}
            </a>
          ) : (
            workspace && (
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
                  <DropdownMenuItem
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await requestJson('/api/auth/logout', 'POST');
                        announceSessionChange();
                        window.location.assign('/app');
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
            )
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
            <span>{t(...label[tab])}</span>
          </div>
          <div className="topbar-actions">
            {project && (
              <div className="topbar-filters">
                <div className="analytics-filters">
                  <div className="filter-main">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="outline"
                            aria-label={t('Period', 'Período')}
                          />
                        }
                      >
                        {startDate && endDate
                          ? `${startDate} – ${endDate}`
                          : t(`Last ${days} days`, `Últimos ${days} dias`)}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="analytics-menu">
                        {['7', '14', '28', '30', '90'].map((value) => (
                          <DropdownMenuItem
                            key={value}
                            onClick={() => {
                              setDays(value);
                              setStartDate('');
                              setEndDate('');
                            }}
                          >
                            {t(`Last ${value} days`, `Últimos ${value} dias`)}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <form
                          className="live-date-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const from = Date.parse(`${draftStart}T00:00:00Z`);
                            const to = Date.parse(`${draftEnd}T00:00:00Z`);
                            if (
                              !Number.isFinite(from) ||
                              !Number.isFinite(to) ||
                              to < from ||
                              to - from >= 90 * 86400000 ||
                              to > Date.now()
                            ) {
                              setError(
                                t(
                                  'Choose a valid period of up to 90 days.',
                                  'Escolha um período válido de até 90 dias.',
                                ),
                              );
                              return;
                            }
                            setStartDate(draftStart);
                            setEndDate(draftEnd);
                            setError('');
                          }}
                        >
                          <label>
                            {t('From', 'De')}
                            <input
                              type="date"
                              required
                              max={new Date().toISOString().slice(0, 10)}
                              value={draftStart}
                              onChange={(event) =>
                                setDraftStart(event.target.value)
                              }
                            />
                          </label>
                          <label>
                            {t('To', 'Até')}
                            <input
                              type="date"
                              required
                              max={new Date().toISOString().slice(0, 10)}
                              value={draftEnd}
                              onChange={(event) =>
                                setDraftEnd(event.target.value)
                              }
                            />
                          </label>
                          <Button size="sm">{t('Apply', 'Aplicar')}</Button>
                        </form>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="outline" aria-label={t('Country', 'País')} />}>
                        <Globe2 />
                        {project.location_code === 2076 ? t('Brazil', 'Brasil')
                          : project.location_code === 2826 ? t('United Kingdom', 'Reino Unido')
                          : t('United States', 'Estados Unidos')}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="analytics-menu">
                        <DropdownMenuItem disabled>{t('Country is fixed for this project.', 'O país é fixo para este projeto.')}</DropdownMenuItem>
                        {!readOnly && <DropdownMenuItem onClick={() => setTab('settings')}>{t('Change project country in Settings', 'Alterar país do projeto em Configurações')}</DropdownMenuItem>}
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
                        <Cpu />
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
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="outline"
                            aria-label={t('Topic', 'Tópico')}
                          />
                        }
                      >
                        <Folder />
                        {topicFilter || t('Topic', 'Tópico')}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="analytics-menu">
                        <DropdownMenuItem onClick={() => setTopicFilter('')}>
                          {t('All topics', 'Todos os tópicos')}
                        </DropdownMenuItem>
                        {workspace?.topics.map((item) => (
                          <DropdownMenuItem
                            key={item.id}
                            onClick={() => setTopicFilter(item.name)}
                          >
                            {item.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
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
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('Workspace help', 'Ajuda do workspace')}
              onClick={() => window.location.assign('/docs')}
            >
              <CircleHelp />
            </Button>
          </div>
        </header>
        <div className="analytics-content live-content" id="analytics-main">
          {readOnly && (
            <div className="live-demo-disclosure">
              <strong>
                {t(
                  'Independent Netflix streaming study',
                  'Estudo independente sobre streaming e Netflix',
                )}
              </strong>
              <p>
                {t(
                  'This study monitors streaming-service questions in the US. Responses appear after each channel completes a collection. Netflix is the tracked brand, not a sponsor. A channel may recommend another service or none.',
                  'Este estudo monitora perguntas sobre serviços de streaming nos EUA. As respostas aparecem quando cada canal conclui uma coleta. Netflix é a marca monitorada, não patrocinadora. Um canal pode recomendar outro serviço ou nenhum.',
                )}
              </p>
              <small>
                {new Set(demoQuestions.map((item) => item.topic)).size}{' '}
                {t('topics', 'tópicos')} · {demoQuestions.length}{' '}
                {t('distinct questions', 'perguntas distintas')} ·{' '}
                {demoQuestions.reduce((sum, item) => sum + item.responses, 0)}{' '}
                {t('completed collections', 'coletas concluídas')}
              </small>
            </div>
          )}
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
            <p aria-live="polite" className="live-state">
              {t('Loading your workspace…', 'Carregando seu workspace…')}
            </p>
          ) : (
            workspace && (
              <section>
                <div className="live-heading">
                  <div>
                    <p className="live-eyebrow">
                      {readOnly
                        ? t('Public demo', 'Demo pública')
                        : 'Lastfind'}
                    </p>
                    <h1>
                      {creatingProject || !project
                        ? t('Create a project', 'Crie um projeto')
                        : project.name}
                    </h1>
                  </div>
                  {project && (
                    <div className="live-heading-actions">
                      <span>{project.domain}</span>
                      <a
                        className="live-export"
                        href={`${api}/export?${filterQuery}`}
                        download
                      >
                        <Download size={15} />
                        {readOnly
                          ? t('Question summary', 'Resumo das perguntas')
                          : t('Export filtered CSV', 'Exportar CSV filtrado')}
                      </a>
                    </div>
                  )}
                </div>
                {!readOnly && (!project || creatingProject) && (
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
                    <h2>{t('Overview', 'Visão geral')}</h2>
                    {reportLoading ? (
                      <p aria-live="polite">
                        {t('Loading report…', 'Carregando relatório…')}
                      </p>
                    ) : summary ? (
                      summary.metrics.responses ? (
                        <>
                          <div className="live-metrics">
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
                                  'citationPresence',
                                  t(
                                    'Citation presence',
                                    'Presença em citações',
                                  ),
                                  '%',
                                  t(
                                    'Answers citing your registered domain',
                                    'Respostas que citam seu domínio cadastrado',
                                  ),
                                ],
                                [
                                  'mentionPosition',
                                  t('Mention position', 'Posição de menção'),
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
                                <article key={key}>
                                  <span>{title}</span>
                                  <strong>
                                    {available
                                      ? `${summary.metrics[key].toFixed(1)}${suffix}`
                                      : '—'}
                                  </strong>
                                  <small>{description}</small>
                                  <small>
                                    {available
                                      ? `${available} ${t('valid answers', 'respostas válidas')}`
                                      : t(
                                          'Insufficient data',
                                          'Dados insuficientes',
                                        )}
                                  </small>
                                  {available &&
                                  summary.comparison.comparable &&
                                  summary.comparison.hasPreviousData &&
                                  summary.availability[key]?.previous ? (
                                    <small>
                                      {delta >= 0 ? '+' : ''}
                                      {delta.toFixed(1)} {suffix ? 'pp' : ''}{' '}
                                      {t(
                                        'versus previous period',
                                        'ante período anterior',
                                      )}
                                    </small>
                                  ) : null}
                                </article>
                              );
                            })}
                          </div>
                          <div className="live-analysis-grid">
                            <section className="live-card">
                              <h2>
                                {t('Daily visibility', 'Visibilidade diária')}
                              </h2>
                              <figure className="live-trend">
                                {summary.daily.map((point, index) => (
                                  <span
                                    key={`${point.date}-${index}`}
                                    style={{
                                      height: `${Math.max(3, Number(point.brand || 0))}%`,
                                    }}
                                    title={`${point.date}: ${point.brand ?? '—'}%`}
                                  />
                                ))}
                                <figcaption className="sr-only">
                                  {t(
                                    'Daily brand visibility',
                                    'Visibilidade diária da marca',
                                  )}
                                </figcaption>
                              </figure>
                            </section>
                            <section className="live-card">
                              <h2>
                                {t('Tracked brands', 'Marcas monitoradas')}
                              </h2>
                              <ol className="live-ranking">
                                {summary.leaderboard.map((item) => (
                                  <li key={item.domain}>
                                    <SiteFavicon
                                      domain={item.domain}
                                      name={item.name}
                                    />
                                    <span>{item.name}</span>
                                    <strong>
                                      {item.visibility.toFixed(1)}%
                                    </strong>
                                  </li>
                                ))}
                              </ol>
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
                    <h2>{t('Topics', 'Tópicos')}</h2>
                    {!readOnly && (
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
                    )}
                    {workspace.topics.length ? (
                      <ul className="live-list">
                        {workspace.topics.map((item) => (
                          <li key={item.id}>
                            <span>{item.name}</span>
                            {!readOnly && (
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
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="live-card">
                        {t('No topics yet.', 'Ainda não há tópicos.')}
                      </p>
                    )}
                  </>
                )}
                {project && !creatingProject && tab === 'prompts' && (
                  <>
                    <h2>{t('Prompts', 'Prompts')}</h2>
                    <div className="live-prompt-toolbar">
                      {!readOnly && <div className="live-status-tabs">
                        {(['active', 'suggested', 'inactive', 'archived'] as const).map(
                          (status) => (
                            <Button
                              key={status}
                              variant={
                                statusFilter === status ? 'default' : 'ghost'
                              }
                              size="sm"
                              onClick={() => setStatusFilter(status)}
                            >
                              {status === 'active'
                                ? t('Active', 'Ativos')
                                : status === 'suggested'
                                  ? t('Suggested', 'Sugeridos')
                                : status === 'inactive'
                                  ? t('Inactive', 'Inativos')
                                  : t('Archived', 'Arquivados')}
                            </Button>
                          ),
                        )}
                      </div>}
                      <SearchField
                        value={queryText}
                        onChange={setQueryText}
                        placeholder={t('Search prompts…', 'Buscar prompts…')}
                      />
                      {!readOnly && (
                        <>
                          <Button
                            size="sm"
                            disabled={free && workspace.capacity.prompts >= 10}
                            onClick={() => setAddOpen((open) => !open)}
                          >
                            <Plus size={16} />
                            {t('Add prompt', 'Adicionar prompt')}
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t(
                                    'More prompt actions',
                                    'Mais ações de prompts',
                                  )}
                                />
                              }
                            >
                              ⋮
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="analytics-menu">
                              <DropdownMenuItem
                                onClick={() => importInput.current?.click()}
                              >
                                {t('Import CSV', 'Importar CSV')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setTab('topics')}
                              >
                                {t('Manage topics', 'Gerenciar tópicos')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
                              try {
                                const rows = parseDemoPromptImport(
                                  await file.text(),
                                );
                                await mutate('/api/prompts', 'POST', {
                                  project_id: project.id,
                                  prompts: rows.map((row) => ({
                                    text: row.text,
                                    engine: promptEngine,
                                    tag: row.topic,
                                    tags: row.tags,
                                  })),
                                });
                              } catch (cause) {
                                setError(
                                  cause instanceof Error
                                    ? cause.message
                                    : String(cause),
                                );
                              }
                            }}
                          />
                        </>
                      )}
                    </div>
                    {!readOnly && addOpen && (
                      <form
                        className="live-card live-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void mutate('/api/prompts', 'POST', {
                            project_id: project.id,
                            text: prompt.trim(),
                            engine: promptEngine,
                            tag:
                              promptTopic ||
                              workspace.topics[0]?.name ||
                              'Geral',
                            tags: promptTags
                              .split(',')
                              .map((value) => value.trim())
                              .filter(Boolean),
                          });
                        }}
                      >
                        <label>
                          {t('Question to monitor', 'Pergunta para monitorar')}
                          <textarea
                            required
                            minLength={5}
                            maxLength={ENGINE_META[promptEngine].maxLength}
                            value={prompt}
                            onChange={(event) => setPrompt(event.target.value)}
                          />
                        </label>
                        <label>
                          {t('AI model', 'Modelo de IA')}
                          <select
                            aria-label={t('AI model', 'Modelo de IA')}
                            value={promptEngine}
                            onChange={(event) =>
                              setPromptEngine(event.target.value as Engine)
                            }
                          >
                            {engines.map((engine) => (
                              <option key={engine} value={engine}>
                                {ENGINE_LABELS[engine]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t('Topic', 'Tópico')}
                          <select
                            aria-label={t('Topic', 'Tópico')}
                            value={promptTopic}
                            onChange={(event) =>
                              setPromptTopic(event.target.value)
                            }
                          >
                            <option value="">
                              {workspace.topics[0]?.name ||
                                t('General', 'Geral')}
                            </option>
                            {workspace.topics.map((item) => (
                              <option key={item.id} value={item.name}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t(
                            'Tags (comma separated)',
                            'Tags (separadas por vírgula)',
                          )}
                          <input
                            value={promptTags}
                            onChange={(event) =>
                              setPromptTags(event.target.value)
                            }
                          />
                        </label>
                        <button
                          disabled={
                            busy || (free && workspace.capacity.prompts >= 10)
                          }
                        >
                          {t('Add prompt', 'Adicionar prompt')}
                        </button>
                        <small>
                          {t(
                            'Adding a prompt starts monitoring and may use provider credits.',
                            'Adicionar um prompt inicia a coleta e pode usar créditos do provedor.',
                          )}
                        </small>
                      </form>
                    )}
                    <div className="live-prompts-layout">
                      <aside className="live-topics-aside">
                        <h3>{t('Topics', 'Tópicos')}</h3>
                        <Button
                          variant={topicFilter ? 'ghost' : 'default'}
                          size="sm"
                          onClick={() => setTopicFilter('')}
                        >
                          {t('All topics', 'Todos os tópicos')}
                        </Button>
                        {workspace.topics.map((item) => (
                          <Button
                            key={item.id}
                            title={item.name}
                            variant={
                              topicFilter === item.name ? 'default' : 'ghost'
                            }
                            size="sm"
                            onClick={() => setTopicFilter(item.name)}
                          >
                            {item.name}
                          </Button>
                        ))}
                      </aside>
                      <div className="live-prompts-main">
                        {reportLoading ? (
                          <p aria-live="polite">
                            {t('Loading prompts…', 'Carregando prompts…')}
                          </p>
                        ) : promptGroups.length ? (
                          <ul className="live-list">
                            {promptGroups.map((group) => {
                              const item = group[0];
                              const count = demoQuestions.find((row) => row.topic === item.tag && row.question === item.text)?.responses ?? 0;
                              return (
                              <li key={item.id}>
                                <div>
                                  <strong>{item.text}</strong>
                                  <small>
                                    {item.tag} · {readOnly
                                      ? `${group.length} ${t('channels', 'canais')} · ${count} ${t('completed collections', 'coletas concluídas')}`
                                      : `${ENGINE_LABELS[item.engine]} · ${item.active ? t('active', 'ativo') : t('paused', 'pausado')}${promptStats?.[item.id]?.responses ? ` · ${promptStats[item.id].responses} ${t('responses', 'respostas')}` : ''}`}
                                  </small>
                                  {readOnly && <div className="live-demo-channels">
                                    {group.map((channel) => <Button key={channel.id} variant="outline" size="sm" onClick={() => onPromptDetail(channel)}>
                                      {ENGINE_LABELS[channel.engine]} {t('details', 'detalhes')}
                                    </Button>)}
                                  </div>}
                                </div>
                                <div className="live-row-actions">
                                  {!readOnly && <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onPromptDetail(item)}
                                  >
                                    {t('Details', 'Detalhes')}
                                  </Button>}
                                  {!readOnly && (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger
                                        render={
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            aria-label={t(
                                              'Prompt actions',
                                              'Ações do prompt',
                                            )}
                                          />
                                        }
                                      >
                                        ⋮
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent className="analytics-menu">
                                        <DropdownMenuItem
                                          onClick={() =>
                                            void mutate(
                                              `/api/prompts/${encodeURIComponent(item.id)}`,
                                              'PATCH',
                                              { active: !item.active },
                                            )
                                          }
                                        >
                                          {item.active
                                            ? t('Pause', 'Pausar')
                                            : t('Resume', 'Retomar')}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onClick={() =>
                                            void mutate(
                                              `/api/prompts/${encodeURIComponent(item.id)}`,
                                              'PATCH',
                                              { archived: !item.archived },
                                            )
                                          }
                                        >
                                          {item.archived
                                            ? t('Restore', 'Restaurar')
                                            : t('Archive', 'Arquivar')}
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                                </div>
                              </li>
                            );})}
                          </ul>
                        ) : (
                          <p className="live-card">{statusFilter === 'suggested' && !readOnly
                            ? t('No suggested prompts are available yet.', 'Ainda não há sugestões de prompts disponíveis.')
                            : t('No prompts yet.', 'Ainda não há prompts.')}</p>
                        )}
                        {selectedPrompt &&
                          detailReport &&
                          'daily' in detailReport && (
                            <article className="live-card">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedPrompt(null);
                                  setDetailReport(null);
                                }}
                              >
                                ← {t('All prompts', 'Todos os prompts')}
                              </Button>
                              <h3>{selectedPrompt.text}</h3>
                              <p>
                                {ENGINE_LABELS[selectedPrompt.engine]} ·{' '}
                                {selectedPrompt.tag}
                              </p>
                              <div className="live-analysis-grid">
                                <section>
                                  <h4>
                                    {t(
                                      'Daily visibility',
                                      'Visibilidade diária',
                                    )}
                                  </h4>
                                  <ul>
                                    {detailReport.daily.map((item) => (
                                      <li key={item.date}>
                                        {item.date}:{' '}
                                        {item.responses
                                          ? `${item.visibility.toFixed(1)}%`
                                          : '—'}{' '}
                                        ({item.responses})
                                      </li>
                                    ))}
                                  </ul>
                                </section>
                                <section>
                                  <h4>{t('By model', 'Por modelo')}</h4>
                                  <ul>
                                    {detailReport.platforms.map((item) => (
                                      <li key={item.engine}>
                                        {ENGINE_LABELS[item.engine]}:{' '}
                                        {item.responses
                                          ? `${item.visibility.toFixed(1)}%`
                                          : '—'}
                                      </li>
                                    ))}
                                  </ul>
                                </section>
                              </div>
                              <h4>{t('Sources', 'Fontes')}</h4>
                              <ul>
                                {detailReport.sources.map((item) => (
                                  <li key={item.domain}>
                                    {item.domain}: {item.responses}
                                  </li>
                                ))}
                              </ul>
                              <h4>
                                {t(
                                  'Response history',
                                  'Histórico de respostas',
                                )}
                              </h4>
                              <ul>
                                {detailReport.history.runs.map((run) => (
                                  <li key={run.id}>
                                    <Button
                                      variant="ghost"
                                      onClick={() => {
                                        setTab('responses');
                                        void onRun(run.id);
                                      }}
                                    >
                                      {run.created_at} · {run.status}
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                            </article>
                          )}
                      </div>
                    </div>
                  </>
                )}
                {project && !creatingProject && tab === 'responses' && (
                  <>
                    <h2>{t('Responses', 'Respostas')}</h2>
                    <SearchField
                      value={queryText}
                      onChange={setQueryText}
                      placeholder={t('Search questions…', 'Buscar perguntas…')}
                    />
                    {detail ? (
                      <article className="live-card">
                        <button onClick={() => setDetail(null)}>
                          ← {t('Back', 'Voltar')}
                        </button>
                        <h3>{detail.prompt_text}</h3>
                        <p>
                          {detail.engine} · {detail.created_at} ·{' '}
                          {detail.status}
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
                              {detail.sources.map((source) => (
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
                          <ul>
                            {detail.consulted_sources.map((source) => (
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
                        ) : (
                          <p>{t('None returned', 'Nenhuma retornada')}</p>
                        )}
                        {!!detail.search_queries?.length && (
                          <>
                            <h4>
                              {t('Related searches', 'Buscas relacionadas')}
                            </h4>
                            <ul>
                              {detail.search_queries.map((value) => (
                                <li key={value}>{value}</li>
                              ))}
                            </ul>
                          </>
                        )}
                      </article>
                    ) : reportLoading ? (
                      <p aria-live="polite">
                        {t('Loading responses…', 'Carregando respostas…')}
                      </p>
                    ) : history && (history.runs.length || more.length) ? (
                      <ul className="live-list">
                        {[...history.runs, ...more].map((run) => (
                          <li key={run.id}>
                            <div>
                              <strong>{run.prompt_text}</strong>
                              <small>
                                {run.engine} · {run.created_at} · {run.status}
                              </small>
                            </div>
                            <button
                              disabled={busy}
                              onClick={() => void onRun(run.id)}
                            >
                              {t('View', 'Ver')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : error ? null : (
                      <p className="live-card">
                        {t(
                          'No responses in this period.',
                          'Sem respostas neste período.',
                        )}
                      </p>
                    )}
                    {!detail && (pageCursor || history?.nextCursor) && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void loadMore((pageCursor || history?.nextCursor)!)
                        }
                      >
                        {t('Load more', 'Carregar mais')}
                      </Button>
                    )}
                  </>
                )}
                {project && !creatingProject && tab === 'sources' && (
                  <>
                    <h2>{t('Sources', 'Fontes')}</h2>
                    <div className="live-prompt-tools">
                      <select
                        aria-label={t('Source kind', 'Tipo de fonte')}
                        value={sourceKind}
                        onChange={(event) => {
                          setSourceKind(
                            event.target.value as typeof sourceKind,
                          );
                          setSourcePage(1);
                          setSelectedSource(null);
                        }}
                      >
                        <option value="cited">{t('Cited', 'Citadas')}</option>
                        <option value="consulted">
                          {t('Consulted', 'Consultadas')}
                        </option>
                      </select>
                      <select
                        aria-label={t(
                          'Source grouping',
                          'Agrupamento de fontes',
                        )}
                        value={sourceGroup}
                        onChange={(event) => {
                          setSourceGroup(
                            event.target.value as typeof sourceGroup,
                          );
                          setSourcePage(1);
                          setSelectedSource(null);
                        }}
                      >
                        <option value="domain">
                          {t('Domains', 'Domínios')}
                        </option>
                        <option value="url">URLs</option>
                      </select>
                    </div>
                    {sources &&
                      sourceKind === 'consulted' &&
                      !sources.available && (
                        <p className="live-card">
                          {t(
                            'Consulted sources are unavailable for these answers.',
                            'Fontes consultadas indisponíveis para estas respostas.',
                          )}
                        </p>
                      )}
                    {selectedSource &&
                      detailReport &&
                      'runs' in detailReport && (
                        <article className="live-card">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedSource(null);
                              setDetailReport(null);
                            }}
                          >
                            ← {t('All sources', 'Todas as fontes')}
                          </Button>
                          <h3>{selectedSource}</h3>
                          <ul>
                            {detailReport.sources.map((source) => (
                              <li key={source.url}>
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {source.title || source.url}
                                </a>
                              </li>
                            ))}
                          </ul>
                          <p>
                            {detailReport.runs.length}{' '}
                            {t(
                              'matching responses',
                              'respostas correspondentes',
                            )}
                          </p>
                          {detailReport.runs.map((run) => (
                            <Button
                              key={run.id}
                              variant="ghost"
                              onClick={() => {
                                setTab('responses');
                                void onRun(run.id);
                              }}
                            >
                              {run.prompt_text}
                            </Button>
                          ))}
                        </article>
                      )}
                    {reportLoading ? (
                      <p aria-live="polite">
                        {t('Loading sources…', 'Carregando fontes…')}
                      </p>
                    ) : sources && sources.rows.length ? (
                      <ul className="live-list">
                        {sources.rows.map((source) => (
                          <li key={source.key}>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setSelectedSource(source.key);
                                setDetailReport(null);
                                const params = new URLSearchParams(filterQuery);
                                params.set('view', 'source-detail');
                                params.set('key', source.key);
                                void requestJson<SourceDetail>(
                                  `${api}/reports?${params}`,
                                )
                                  .then(setDetailReport)
                                  .catch((cause) => setError(cause.message));
                              }}
                            >
                              <strong>{source.title || source.domain}</strong>
                            </Button>
                            <span>
                              {source.responses} {t('responses', 'respostas')} ·{' '}
                              {source.ownership}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : error ? null : (
                      <p className="live-card">
                        {t(
                          'No cited sources in this period.',
                          'Sem fontes citadas neste período.',
                        )}
                      </p>
                    )}
                    {sources && (
                      <div className="live-pagination">
                        <Button
                          variant="outline"
                          disabled={sourcePage === 1}
                          onClick={() => setSourcePage((page) => page - 1)}
                        >
                          {t('Previous', 'Anterior')}
                        </Button>
                        <span>{sourcePage}</span>
                        <Button
                          variant="outline"
                          disabled={!sources.hasMore}
                          onClick={() => setSourcePage((page) => page + 1)}
                        >
                          {t('Next', 'Próxima')}
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {project && !creatingProject && tab === 'settings' && (
                  <>
                    <h2>{t('Project settings', 'Configurações do projeto')}</h2>
                    <div className="live-card">
                      <p>
                        {project.name} · {project.domain}
                      </p>
                      <p>
                        {free ? t('Weekly monitoring', 'Monitoramento semanal') : t('Daily monitoring', 'Monitoramento diário')}:{' '}
                        {project.daily_enabled
                          ? t('on', 'ligado')
                          : t('off', 'desligado')}
                      </p>
                      {!readOnly && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              `/api/projects/${encodeURIComponent(project.id)}`,
                              'PATCH',
                              { daily_enabled: !project.daily_enabled },
                            )
                          }
                        >
                          {project.daily_enabled
                            ? t('Pause monitoring', 'Pausar monitoramento')
                            : t('Resume monitoring', 'Retomar monitoramento')}
                        </button>
                      )}
                    </div>
                    {!readOnly && (
                      <form
                        key={project.id}
                        className="live-card live-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = new FormData(event.currentTarget);
                          const split = (value: FormDataEntryValue | null) =>
                            String(value || '')
                              .split(',')
                              .map((part) => part.trim())
                              .filter(Boolean);
                          const competitors = String(
                            data.get('competitors') || '',
                          )
                            .split('\n')
                            .map((line) => line.trim())
                            .filter(Boolean)
                            .map((line) => {
                              const [name, ...domain] = line.split(',');
                              return {
                                name: name.trim(),
                                domain: domain.join(',').trim(),
                              };
                            });
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
                              competitors,
                              location_code: Number(data.get('location_code')),
                              language_code: data.get('language_code'),
                              category: data.get('category'),
                              audience: data.get('audience'),
                            },
                          );
                        }}
                      >
                        <h2>{t('Brand and market', 'Marca e mercado')}</h2>
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
                            defaultValue={project.additional_domains.join(', ')}
                          />
                        </label>
                        <label>
                          {t(
                            'Competitors, one name,domain per line',
                            'Concorrentes, um nome,domínio por linha',
                          )}
                          <textarea
                            name="competitors"
                            defaultValue={project.competitors
                              .map((item) => `${item.name},${item.domain}`)
                              .join('\n')}
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
                        <Button disabled={busy}>
                          {t('Save settings', 'Salvar configurações')}
                        </Button>
                      </form>
                    )}
                  </>
                )}
                {project && !creatingProject && tab === 'competitors' && (
                  <>
                    <h2>{t('Tracked brands', 'Marcas monitoradas')}</h2>
                    {reportLoading ? (
                      <p>{t('Loading brands…', 'Carregando marcas…')}</p>
                    ) : brands ? (
                      <>
                        <div className="live-analysis-grid">
                          <section className="live-card">
                            <h3>{t('By AI model', 'Por modelo de IA')}</h3>
                            <ul className="live-list">
                              {brands.platforms.map((item) => (
                                <li key={item.domain}>
                                  <SiteFavicon
                                    domain={item.domain}
                                    name={item.name}
                                  />
                                  <span>{item.name}</span>
                                  <strong>
                                    {item.responses
                                      ? `${item.visibility.toFixed(1)}%`
                                      : '—'}
                                  </strong>
                                </li>
                              ))}
                            </ul>
                          </section>
                          <section className="live-card">
                            <h3>{t('By topic', 'Por tópico')}</h3>
                            <ul className="live-list">
                              {brands.topics.map((item) => (
                                <li key={item.domain}>
                                  <span>{item.name}</span>
                                  <strong>
                                    {item.responses
                                      ? `${item.visibility.toFixed(1)}%`
                                      : '—'}
                                  </strong>
                                </li>
                              ))}
                            </ul>
                          </section>
                        </div>
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
                                  <span>{item.prompt}</span>
                                  <small>
                                    {item.label} · {item.responses}{' '}
                                    {t('responses', 'respostas')}
                                  </small>
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
                  </>
                )}
                {project && !creatingProject && tab === 'models' && (
                  <>
                    <h2>{t('AI models', 'Modelos de IA')}</h2>
                    {reportLoading ? (
                      <p>
                        {t(
                          'Loading model analysis…',
                          'Carregando análise dos modelos…',
                        )}
                      </p>
                    ) : models ? (
                      <ul className="live-list">
                        {models.channels.map((item) => (
                          <li key={item.key}>
                            <span>
                              <strong>{ENGINE_LABELS[item.key]}</strong>
                              <small>
                                {item.responses}{' '}
                                {t('valid answers', 'respostas válidas')} ·{' '}
                                {item.pending} {t('pending', 'pendentes')} ·{' '}
                                {item.failed} {t('failed', 'falhas')}
                              </small>
                            </span>
                            <strong>
                              {item.responses
                                ? `${item.visibility.toFixed(1)}%`
                                : '—'}
                            </strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="live-card">
                        {t(
                          'No model data yet.',
                          'Ainda não há dados por modelo.',
                        )}
                      </p>
                    )}
                  </>
                )}
                {project && !creatingProject && tab === 'opportunities' && (
                  <>
                    <h2>{t('Opportunities', 'Oportunidades')}</h2>
                    {reportLoading ? (
                      <p>
                        {t(
                          'Loading opportunities…',
                          'Carregando oportunidades…',
                        )}
                      </p>
                    ) : opportunities?.rows.length ? (
                      <ul className="live-list">
                        {opportunities.rows.map((item) => (
                          <li key={`${item.type}-${item.id}`}>
                            <span>
                              <strong>{item.title}</strong>
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
                  </>
                )}
                {project && !creatingProject && tab === 'semantic-branding' && (
                  <section aria-live="polite">
                    <h2>{t(...label[tab])}</h2>
                    {semanticLoading ? <p>{t('Loading measured associations…', 'Carregando associações medidas…')}</p>
                      : !semantic ? <p className="live-card">{t('The report is unavailable. Retry to load it.', 'O relatório está indisponível. Tente carregar novamente.')}</p>
                      : <>
                        {!semanticEvaluationAvailable && <p className="live-card">{t('Automatic Semantic Branding scores are not available in the independent edition yet.', 'As notas automáticas de Branding Semântico ainda não estão disponíveis na edição independente.')}</p>}
                        <p className="live-muted">{t('Association scores use evidence from collected answers. Missing or ambiguous evidence has no score.', 'As notas de associação usam evidências das respostas coletadas. Evidência ausente ou ambígua não recebe nota.')}</p>
                        {!semantic.configuration.enabled && <p className="live-card">{t('Semantic evaluation is not configured for this project yet.', 'A avaliação semântica ainda não está configurada para este projeto.')}</p>}
                        {semantic.configuration.attributes.length > 0 && <p className="live-muted">{t('Attributes', 'Atributos')}: {semantic.configuration.attributes.map((item) => item.name).join(' · ')}</p>}
                        <div className="live-metrics live-semantic-metrics">
                          <article><small>{t('Eligible answers', 'Respostas elegíveis')}</small><strong>{semantic.coverage.eligible}</strong></article>
                          <article><small>{t('Evaluated answers', 'Respostas avaliadas')}</small><strong>{semantic.coverage.evaluated}</strong></article>
                          <article><small>{t('Not evaluated', 'Não avaliadas')}</small><strong>{semantic.coverage.unassessed}</strong></article>
                        </div>
                        <h3>{t('Association by brand and attribute', 'Associação por marca e atributo')}</h3>
                        {semantic.summary.length ? <ul className="live-list">{semantic.summary.map((row) => <li key={`${row.brand}:${row.attribute}`}>
                          <span><strong>{row.brand}</strong><small>{semantic.configuration.attributes.find((item) => item.id === row.attribute)?.name ?? row.attribute} · {row.samples} {t('scored answers', 'respostas com nota')}</small></span>
                          <strong>{row.score == null ? '—' : `${Math.round(row.score)}/100`}</strong>
                        </li>)}</ul> : <p className="live-card">{readOnly
                          ? t('No measured Semantic Branding score is available for this public study yet.', 'Ainda não há nota medida de Branding Semântico para este estudo público.')
                          : t('No scored associations match these filters yet.', 'Ainda não há associações com nota para estes filtros.')}</p>}
                        <h3>{t('Evidence', 'Evidências')}</h3>
                        {readOnly ? <p className="live-card">{t('Individual evidence is not published in this public report.', 'As evidências individuais não são publicadas neste relatório público.')}</p>
                          : semantic.assessments?.length ? <>
                            <ul className="live-list">{semantic.assessments.map((assessment) => <li key={assessment.run_id}>
                              <details><summary><strong>{assessment.prompt_text}</strong><small>{ENGINE_LABELS[assessment.engine]} · {assessment.run_created_at.slice(0, 10)} · {assessment.coverage === 'partial' ? t('partial answer excerpt', 'trecho parcial da resposta') : t('full answer excerpt', 'trecho completo da resposta')}</small></summary>
                                {assessment.readings.map((reading) => <div key={`${reading.brand}:${reading.attribute}`}>
                                  <p><strong>{reading.brand} · {semantic.configuration.attributes.find((item) => item.id === reading.attribute)?.name ?? reading.attribute}</strong> · {reading.score == null ? t('No score', 'Sem nota') : `${reading.score}/100`}</p>
                                  {reading.quote && <blockquote className="live-semantic-evidence">{reading.quote}</blockquote>}
                                  <p className="live-muted">{reading.reason}</p>
                                </div>)}
                              </details>
                            </li>)}</ul>
                            {semantic.nextCursor && <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
                              setBusy(true);
                              try {
                                const params = new URLSearchParams(filterQuery);
                                params.set('cursor', semantic.nextCursor!);
                                const next = await requestJson<SemanticReport>(`/api/projects/${encodeURIComponent(project.id)}/semantic?${params}`);
                                setSemantic((current) => current && ({ ...current, assessments: [...(current.assessments ?? []), ...(next.assessments ?? [])], nextCursor: next.nextCursor }));
                              } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                              finally { setBusy(false); }
                            }}>{t('Load more evidence', 'Carregar mais evidências')}</Button>}
                          </> : <p className="live-card">{t('No individual assessment is available for these filters yet.', 'Ainda não há avaliação individual para estes filtros.')}</p>}
                      </>}
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
