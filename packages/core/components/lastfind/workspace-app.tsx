'use client';
import { LanguageSwitcher, useI18n } from '@/lib/i18n';
import { AdvancedReport } from './advanced-report';
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from 'react';
import { requestJson as api } from '@/lib/client';
import { useReport } from '@/hooks/use-report';
import type {
  SummaryReport,
  ReportDrilldown,
  HistoryPage,
  PromptReport,
} from '@/lib/report-types';
import {
  Aperture,
  ArrowUpRight,
  ArrowRight,
  Plus,
  ChartNoAxesCombined,
  MessageSquare,
  Globe,
  Users,
  Settings2,
  Download,
  Search,
  ChevronRight,
  ChevronLeft,
  Archive,
  Check,
  Clock,
  SlidersHorizontal,
} from 'lucide-react';
import { Onboarding } from './onboarding';
import { PromptManager } from './prompt-manager';
import { EngineBadge, Favicon } from './identity-icons';
import { SourceExplorer, SourceList } from './source-explorer';
import { ENGINE_META } from '@/lib/engines';
const VisibilityChart = lazy(() =>
  import('./visibility-chart').then((m) => ({ default: m.VisibilityChart })),
);
import { Choice, ProjectDialog, PromptDialog } from './forms';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  AppSidebar,
  WORKSPACE_NAV,
  type WorkspaceNavigation,
} from './app-sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination';
import { Toaster, toast } from '@/components/ui/toast';
import { summarize, runsCsv } from '@/lib/metrics';
import {
  ENGINE_LABELS,
  type Workspace,
  type Project,
  type Run,
} from '@/lib/types';
const statusNames: Record<string, string> = {
  queued: 'Na fila',
  submitting: 'Enviando',
  pending: 'Coletando',
  complete: 'Concluída',
  failed: 'Falhou',
  unknown: 'Sem confirmação',
};
function Status({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <span className={`run-status status-${status}`}>
      <span />
      {t(statusNames[status] ?? status)}
    </span>
  );
}
export type WorkspaceExtension = WorkspaceNavigation & {
  render: (data: Workspace, reload: () => Promise<boolean>) => React.ReactNode;
};
export type WorkspaceAppProps = {
  readOnly?: boolean;
  onRefreshReady?: (refresh: (() => Promise<boolean>) | null) => void;
  initialTab?: string;
  initialSidebarOpen?: boolean;
  initialData?: Workspace;
  extensions?: WorkspaceExtension[];
  banner?: React.ReactNode;
  renderAccountSummary?: (data: Workspace | null) => React.ReactNode;
};
export function WorkspaceApp(props: WorkspaceAppProps) {
  return (
    <Toaster>
      <TooltipProvider delay={150}>
        <WorkspaceSurface {...props} />
      </TooltipProvider>
    </Toaster>
  );
}
function WorkspaceSurface({
  readOnly = false,
  onRefreshReady,
  initialTab = 'overview',
  initialSidebarOpen = true,
  initialData,
  extensions = [],
  banner,
  renderAccountSummary,
}: WorkspaceAppProps) {
  const NAV = [...WORKSPACE_NAV, ...extensions];
  const { t, locale, formatTime: formatMonitoringTime } = useI18n();
  const fmt = (n: number) =>
    n.toLocaleString(locale, { maximumFractionDigits: 1 });
  const dateTime = (date: string) =>
    new Date(date).toLocaleString(locale, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }) + ' BRT';
  const [data, setData] = useState<Workspace | null>(() => initialData ?? null),
    [error, setError] = useState(''),
    [tab, setTab] = useState(
      NAV.some((n) => n.id === initialTab) ? initialTab : 'overview',
    ),
    [engine, setEngine] = useState('all'),
    [days, setDays] = useState('30'),
    [reportFilters, setReportFilters] = useState<ReportDrilldown>({}),
    [query, setQuery] = useState(''),
    [statusFilter, setStatusFilter] = useState('all'),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    [projectOpen, setProjectOpen] = useState(false),
    [editing, setEditing] = useState<Project | undefined>(),
    [promptOpen, setPromptOpen] = useState(false),
    [detail, setDetail] = useState<Run | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [confirmation, setConfirmation] = useState<{
      title: string;
      description: string;
      action: () => Promise<void>;
    } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const selectedRef = useRef<string | null>(
      initialData?.selectedProjectId ?? null,
    ),
    requestVersion = useRef(0),
    detailRequestVersion = useRef(0),
    busyRef = useRef(false);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const [asOf, setAsOf] = useState(() => Date.now());
  const reload = useCallback(
    async (project?: string | null) => {
      if (readOnly) return false;
      const version = ++requestVersion.current;
      const id = project === undefined ? selectedRef.current : project;
      try {
        const next = await api<Workspace>(
          `/api/workspace${id ? `?project=${encodeURIComponent(id)}` : ''}`,
        );
        if (version === requestVersion.current) {
          setData(next);
          setAsOf(Date.now());
          selectedRef.current = next.selectedProjectId;
          setError('');
          return true;
        }
      } catch (e) {
        if (version === requestVersion.current)
          setError(
            e instanceof Error ? e.message : t('Erro ao carregar o workspace.'),
          );
      }
      return false;
    },
    [readOnly, t],
  );
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!initialData) void reload(params.get('project'));
  }, [reload, initialData]);
  useEffect(() => {
    onRefreshReady?.(() => reload());
    return () => onRefreshReady?.(null);
  }, [onRefreshReady, reload]);
  const pending =
    data?.monitoring?.pending ??
    data?.runs.filter((r) =>
      ['queued', 'submitting', 'pending'].includes(r.status),
    ).length ??
    0;
  useEffect(() => {
    if (readOnly) return;
    const timer = setInterval(
      async () => {
        if (busyRef.current || document.visibilityState !== 'visible') return;
        busyRef.current = true;
        try {
          await reload();
        } catch (e) {
          setError(
            e instanceof Error ? e.message : t('Erro ao atualizar coletas.'),
          );
        } finally {
          busyRef.current = false;
        }
      },
      pending ? 60000 : 300000,
    );
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !busyRef.current)
        void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pending, readOnly, reload, t]);
  useEffect(() => {
    type MC = {
      registerTool: (
        tool: Record<string, unknown>,
        options: { signal: AbortSignal },
      ) => void | Promise<void>;
    };
    const context = (document as Document & { modelContext?: MC }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools = [
      {
        name: 'lastfind_list_prompts',
        title: t('Listar prompts'),
        description: t(
          'Lista os prompts do projeto aberto. Não inicia coletas.',
        ),
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input: unknown) => {
          if (!input || typeof input !== 'object' || Object.keys(input).length)
            throw new Error(t('Envie um objeto vazio.'));
          return {
            readOnly,
            project_id: dataRef.current?.selectedProjectId,
            prompts: dataRef.current?.prompts ?? [],
          };
        },
      },
      {
        name: 'lastfind_open_prompt_creation',
        title: t('Abrir cadastro de prompt'),
        description: t(
          'Abre o formulário de novo prompt. Não salva dados nem inicia uma coleta.',
        ),
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute: (input: unknown) => {
          if (!input || typeof input !== 'object' || Object.keys(input).length)
            throw new Error(t('Envie um objeto vazio.'));
          if (!dataRef.current?.selectedProjectId)
            throw new Error(t('Crie um projeto primeiro.'));
          if (readOnly) throw new Error(t('A demonstração é somente leitura.'));
          setPromptOpen(true);
          return { form: 'prompt', open: true };
        },
      },
    ];
    for (const tool of tools)
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    return () => lifecycle.abort();
  }, [readOnly, t]);
  const project = data?.projects.find((p) => p.id === data.selectedProjectId),
    competitors = useMemo(
      () => project?.competitors.map((c) => c.name) ?? [],
      [project],
    );
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const reportParams = new URLSearchParams({
    project: project?.id ?? '',
    days,
    engine,
  });
  for (const [key, value] of Object.entries(reportFilters))
    if (value && value !== 'all') reportParams.set(key, value);
  const reportBase = `/api/reports?${reportParams}`;
  const remote = !readOnly && !!project;
  const summary = useReport<SummaryReport>(
    remote && ['overview', 'competitors'].includes(tab) ? reportBase : null,
    asOf,
  );
  const promptStats = useReport<PromptReport>(
    remote && tab === 'prompts' ? `${reportBase}&view=prompts` : null,
    asOf,
  );
  const historyData = useReport<HistoryPage>(
    remote && ['overview', 'history'].includes(tab)
      ? `${reportBase}&view=history${tab === 'history' ? `&status=${statusFilter}&q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursors[page - 1] || '')}` : ''}`
      : null,
    asOf,
  );
  const reportError = summary.error || historyData.error || promptStats.error;
  const reportLoading =
    summary.loading || historyData.loading || promptStats.loading;
  const filtered = useMemo(
    () =>
      (readOnly ? data?.runs : (historyData.data?.runs ?? data?.runs))?.filter(
        (r) =>
          (engine === 'all' || r.engine === engine) &&
          Date.parse(r.created_at) >= asOf - Number(days) * 86400000,
      ) ?? [],
    [data, engine, days, asOf, readOnly, historyData.data],
  );
  const metrics =
    summary.data?.metrics ?? summarize(filtered, project?.name ?? '');
  const changeTab = (next: string) => {
    setTab(next);
    setQuery('');
    setPage(1);
    setCursors([null]);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    history.replaceState(null, '', url);
  };
  const filterReport = (next: ReportDrilldown) => {
    setReportFilters((current) => ({ ...current, ...next }));
    setPage(1);
    setCursors([null]);
  };
  const drilldownReport = (next: ReportDrilldown) => {
    const { engine: selectedEngine, ...rest } = next;
    if (selectedEngine) setEngine(selectedEngine);
    filterReport(rest);
    changeTab('history');
  };
  const l = (en: string, pt: string) => (locale === 'en' ? en : pt);
  const notifyDemo = () =>
    toast.add({
      title: t('Workspace somente leitura'),
      description: t('As alterações estão desativadas neste workspace.'),
      type: 'info',
    });
  async function perform(fn: () => Promise<void>, message?: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
      if (message) toast.add({ title: message, type: 'success' });
      setError('');
    } catch (e) {
      const message =
        e instanceof Error ? e.message : t('Não foi possível concluir.');
      setError(message);
      toast.add({ title: message, type: 'error' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function showRun(r: Run) {
    const version = ++detailRequestVersion.current;
    setDetail(r);
    setDetailLoading(!readOnly);
    if (!readOnly) {
      setDetailLoading(true);
      try {
        const value = await api<Run>(`/api/runs/${r.id}`);
        setDetail((previous) => (previous?.id === r.id ? value : previous));
      } catch (e) {
        toast.add({
          title: e instanceof Error ? e.message : t('Erro ao abrir resposta'),
          type: 'error',
        });
      } finally {
        if (detailRequestVersion.current === version) setDetailLoading(false);
      }
    }
  }
  function exportData() {
    if (!project) return;
    if (!readOnly) {
      const params = new URLSearchParams(reportParams);
      if (tab === 'history') {
        params.set('query', query);
        params.set('status', statusFilter);
      }
      window.location.href = `/api/export?${params}`;
      return;
    }
    const url = URL.createObjectURL(
      new Blob([runsCsv(filtered)], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lastfind-readOnly.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveProject(value: Record<string, unknown>) {
    if (readOnly) {
      notifyDemo();
      return;
    }
    const result = await api<{ id: string }>(
      editing ? `/api/projects/${editing.id}` : '/api/projects',
      editing ? 'PATCH' : 'POST',
      value,
    );
    setProjectOpen(false);
    await reload(editing?.id ?? result.id);
    toast.add({
      title: editing
        ? t('Projeto atualizado')
        : t('Projeto criado. Adicione seu primeiro prompt.'),
      type: 'success',
    });
    if (!editing) setPromptOpen(true);
  }
  async function savePrompt(value: Record<string, unknown>) {
    if (readOnly) {
      notifyDemo();
      return;
    }
    const result = await api<{ added: number; skipped: number }>(
      '/api/prompts',
      'POST',
      value,
    );
    setPromptOpen(false);
    await reload();
    toast.add({
      title: t('{count} prompts adicionados', { count: result.added }),
      description: result.skipped
        ? t('{count} ignorados por duplicidade ou limite.', {
            count: result.skipped,
          })
        : t('Primeira coleta programada para as 4h de Brasília.'),
      type: 'success',
    });
    changeTab('prompts');
  }
  const newProject = () => {
    if (readOnly) {
      notifyDemo();
      return;
    }
    setEditing(undefined);
    setProjectOpen(true);
  };
  const newPrompt = () => {
    if (readOnly) {
      notifyDemo();
      return;
    }
    setPromptOpen(true);
  };
  const editProject = () => {
    if (readOnly) {
      notifyDemo();
      return;
    }
    setEditing(project);
    setProjectOpen(true);
  };
  const historyRuns = filtered.filter(
    (r) =>
      (statusFilter === 'all' || r.status === statusFilter) &&
      r.prompt_text.toLowerCase().includes(query.toLowerCase()),
  );
  const leaderboard = useMemo(
    () =>
      summary.data?.leaderboard ??
      [project?.name ?? '', ...competitors]
        .filter(Boolean)
        .map((name, i) => {
          const count = filtered.filter(
            (r) =>
              r.status === 'complete' &&
              r.mentions[i === 0 ? r.brand_name : name],
          ).length;
          return {
            name,
            domain:
              i === 0
                ? (project?.domain ?? '')
                : (project?.competitors.find((c) => c.name === name)?.domain ??
                  ''),
            count,
            visibility: metrics.responses
              ? (count / metrics.responses) * 100
              : 0,
            color: `var(--chart-${(i % 5) + 1})`,
          };
        })
        .sort((a, b) => b.count - a.count),
    [project, competitors, filtered, metrics.responses, summary.data],
  );
  const pageCount = readOnly
      ? Math.ceil(historyRuns.length / 15)
      : page + (historyData.data?.nextCursor ? 1 : 0),
    title = t(NAV.find((n) => n.id === tab)?.label ?? 'Visão geral');
  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      style={{ '--sidebar-width': '16rem' } as React.CSSProperties}
      className="workspace"
    >
      <AppSidebar
        data={data}
        project={project}
        readOnly={readOnly}
        navigation={NAV}
        accountSummary={renderAccountSummary?.(data)}
        tab={tab}
        onNavigate={changeTab}
        onNewProject={newProject}
        onProject={(value) => {
          setPage(1);
          setReportFilters({});
          void reload(value);
          const url = new URL(window.location.href);
          url.searchParams.set('project', value);
          history.replaceState(null, '', url);
        }}
      />
      <SidebarInset className="workspace-main">
        <header className="workspace-topbar">
          <div>
            <SidebarTrigger
              aria-label={t('Recolher ou expandir menu')}
              aria-expanded={sidebarOpen}
            />
            <Separator
              orientation="vertical"
              className="mx-1 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb aria-label={t('Localização')}>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden sm:inline-flex">
                  <span>{project?.name ?? 'Workspace'}</span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden sm:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <LanguageSwitcher compact />
          <a href="/" className="back-site">
            {t('Início')}
            <ArrowUpRight size={14} />
          </a>
        </header>
        {banner}
        <div className="workspace-content">
          <div className="workspace-title">
            <div>
              <span className="eyebrow">
                {project?.domain ?? t('SUA MARCA, EM PERSPECTIVA')}
              </span>
              <h1>
                {title}
                <span className="title-dot">.</span>
              </h1>
              <p>
                {tab === 'overview'
                  ? t('Acompanhe sua presença nas respostas que importam.')
                  : tab === 'prompts'
                    ? t('As perguntas que conectam seu público à sua marca.')
                    : tab === 'competitors'
                      ? t('Entenda quem compartilha o espaço com a sua marca.')
                      : tab === 'sources'
                        ? t(
                            'Os domínios que aparecem como referência nas respostas.',
                          )
                        : tab === 'history'
                          ? t('Cada resposta, preservada para você investigar.')
                          : tab === 'settings'
                            ? t('Sua marca, seu mercado, suas configurações.')
                            : t('Transparência sobre o que você usa.')}
              </p>
            </div>
            <div className="title-actions">
              {project &&
                ['overview', 'history', 'sources', 'competitors'].includes(
                  tab,
                ) && (
                  <Button
                    variant="outline"
                    className="lf-outline"
                    onClick={exportData}
                  >
                    <Download />
                    {t('Exportar')}
                  </Button>
                )}
              {project && ['overview', 'prompts'].includes(tab) && (
                <Button className="lf-primary" onClick={newPrompt}>
                  <Plus />
                  {t('Adicionar prompts')}
                </Button>
              )}
            </div>
          </div>
          {(error || reportError) && (
            <div className="notice error-notice" role="alert">
              {t(error || reportError || '')}{' '}
              <button className="retry-link" onClick={() => void reload()}>
                {t('Tentar novamente')}
              </button>
            </div>
          )}
          {!data && !error ? (
            <div className="loading-grid">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-80 col-span-full" />
            </div>
          ) : data &&
            !project &&
            !extensions.some((item) => item.id === tab) ? (
            <Onboarding
              capabilities={data.capabilities}
              onComplete={async (id) => {
                await reload(id);
                changeTab('overview');
                toast.add({
                  title: t('Seu acompanhamento começou'),
                  description: t(
                    'As respostas aparecerão aqui automaticamente.',
                  ),
                  type: 'success',
                });
              }}
            />
          ) : (
            data && (
              <>
                {project &&
                  [
                    'overview',
                    'prompts',
                    'history',
                    'sources',
                    'competitors',
                  ].includes(tab) && (
                    <div className="filter-bar">
                      <div>
                        <SlidersHorizontal size={15} />
                        <Choice
                          label={t('Filtrar motor de IA')}
                          value={engine}
                          onChange={(v) => {
                            setEngine(v);
                            setPage(1);
                          }}
                          options={[
                            { value: 'all', label: t('Todos os motores') },
                            ...Object.entries(ENGINE_LABELS).map(
                              ([value, label]) => ({ value, label }),
                            ),
                          ]}
                        />
                        {tab !== 'prompts' && (
                          <Choice
                            label={t('Período')}
                            value={days}
                            onChange={(v) => {
                              setDays(v);
                              setPage(1);
                            }}
                            options={[
                              { value: '7', label: t('Últimos 7 dias') },
                              { value: '30', label: t('Últimos 30 dias') },
                              { value: '90', label: t('Últimos 90 dias') },
                            ]}
                          />
                        )}
                        {tab !== 'prompts' && (
                          <Choice
                            label={l('Report topic', 'Tópico do relatório')}
                            value={reportFilters.topic || 'all'}
                            onChange={(value) =>
                              filterReport({
                                topic: value === 'all' ? '' : value,
                                prompt: '',
                              })
                            }
                            options={[
                              { value: 'all', label: t('Todos os tópicos') },
                              ...(data.topics ?? []).map((topic) => ({
                                value: topic.name,
                                label: topic.name,
                              })),
                            ]}
                          />
                        )}
                        {tab !== 'prompts' && (
                          <details className="report-more-filters">
                            <summary>
                              {l('More filters', 'Mais filtros')}
                            </summary>
                            <div>
                              <Choice
                                label={l('Tracked brand', 'Marca monitorada')}
                                value={reportFilters.brand || 'primary'}
                                onChange={(brand) => filterReport({ brand })}
                                options={[
                                  {
                                    value: 'primary',
                                    label: project?.name ?? t('Sua marca'),
                                  },
                                  ...(project?.competitors ?? []).map(
                                    (item) => ({
                                      value: item.name,
                                      label: item.name,
                                    }),
                                  ),
                                ]}
                              />
                              <Choice
                                label={l('Brand presence', 'Presença da marca')}
                                value={reportFilters.mention || 'all'}
                                onChange={(mention) =>
                                  filterReport({
                                    mention:
                                      mention as ReportDrilldown['mention'],
                                  })
                                }
                                options={[
                                  {
                                    value: 'all',
                                    label: l(
                                      'All answers',
                                      'Todas as respostas',
                                    ),
                                  },
                                  {
                                    value: 'mentioned',
                                    label: l(
                                      'Brand mentioned',
                                      'Marca mencionada',
                                    ),
                                  },
                                  {
                                    value: 'missing',
                                    label: l('Brand missing', 'Marca ausente'),
                                  },
                                ]}
                              />
                              <Choice
                                label={l(
                                  'Specific prompt',
                                  'Prompt específico',
                                )}
                                value={reportFilters.prompt || 'all'}
                                onChange={(prompt) =>
                                  filterReport({
                                    prompt: prompt === 'all' ? '' : prompt,
                                  })
                                }
                                options={[
                                  {
                                    value: 'all',
                                    label: l('All prompts', 'Todos os prompts'),
                                  },
                                  ...data.prompts
                                    .filter(
                                      (item) =>
                                        !reportFilters.topic ||
                                        item.tag === reportFilters.topic,
                                    )
                                    .map((item) => ({
                                      value: item.id,
                                      label: item.text,
                                    })),
                                ]}
                              />
                            </div>
                          </details>
                        )}
                      </div>
                      <span className="refresh-group">
                        {pending > 0 ? (
                          <span className="pending-label">
                            <Clock size={13} />
                            {pending} {t('em andamento')}
                          </span>
                        ) : (
                          <span>
                            <span className="green-dot" />{' '}
                            {readOnly
                              ? t('Dados ilustrativos')
                              : ['overview', 'competitors'].includes(tab)
                                ? l(
                                    `${metrics.responses} responses in this period`,
                                    `${metrics.responses} respostas no período`,
                                  )
                                : t('Acompanhamento diário')}
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                {Object.values(reportFilters).some(Boolean) && (
                  <div className="active-report-filters">
                    <span>{l('Filtered report', 'Relatório filtrado')}</span>
                    {Object.entries(reportFilters)
                      .filter(([, value]) => value && value !== 'all')
                      .map(([key, value]) => (
                        <span className="subtle-tag" key={key}>
                          {key === 'prompt'
                            ? data.prompts.find((item) => item.id === value)
                                ?.text
                            : key === 'brand' && value === 'primary'
                              ? project?.name
                              : value}
                        </span>
                      ))}
                    <button
                      className="text-primary"
                      onClick={() => {
                        setReportFilters({});
                        setPage(1);
                        setCursors([null]);
                      }}
                    >
                      {t('Limpar')}
                    </button>
                  </div>
                )}
                {reportLoading && tab !== 'history' && (
                  <Skeleton
                    className="h-64"
                    aria-label={t('Carregando relatório')}
                  />
                )}
                {tab === 'overview' &&
                  project &&
                  !reportLoading &&
                  (readOnly || !!summary.data) && (
                    <>
                      <div className="metric-grid">
                        <Metric
                          label={t('Visibilidade')}
                          value={`${fmt(metrics.visibility)}%`}
                          sub={l(
                            `${metrics.mentions} of ${metrics.responses} answers mention the brand`,
                            `${metrics.mentions} de ${metrics.responses} respostas mencionam a marca`,
                          )}
                          icon={<ChartNoAxesCombined />}
                        />
                        <Metric
                          label="Share of voice"
                          value={`${fmt(metrics.shareOfVoice)}%`}
                          sub={t('Sua fatia das menções às marcas monitoradas')}
                          icon={<Users />}
                        />
                        <Metric
                          label={t('Respostas coletadas')}
                          value={fmt(metrics.responses)}
                          sub={l(
                            `${data.prompts.filter((p) => p.active).length} active prompts in this project`,
                            `${data.prompts.filter((p) => p.active).length} prompts ativos neste projeto`,
                          )}
                          icon={<MessageSquare />}
                        />
                        <Metric
                          label={t('Domínios citados')}
                          value={fmt(metrics.citedDomains)}
                          sub={t('Fontes únicas nas respostas coletadas')}
                          icon={<Globe />}
                        />
                      </div>
                      {summary.data?.comparison && (
                        <div className="report-comparison">
                          {summary.data.comparison.hasPreviousData ? (
                            <>
                              <span>
                                {l(
                                  'vs. previous period',
                                  'vs. período anterior',
                                )}
                              </span>
                              <span>
                                <b>
                                  {summary.data.comparison.delta.visibility > 0
                                    ? '+'
                                    : ''}
                                  {fmt(
                                    summary.data.comparison.delta.visibility,
                                  )}{' '}
                                  p.p.
                                </b>{' '}
                                {t('Visibilidade')}
                              </span>
                              <span>
                                <b>
                                  {summary.data.comparison.delta.shareOfVoice >
                                  0
                                    ? '+'
                                    : ''}
                                  {fmt(
                                    summary.data.comparison.delta.shareOfVoice,
                                  )}{' '}
                                  p.p.
                                </b>{' '}
                                Share of voice
                              </span>
                              <span>
                                <b>
                                  {summary.data.comparison.delta.responses > 0
                                    ? '+'
                                    : ''}
                                  {fmt(summary.data.comparison.delta.responses)}
                                </b>{' '}
                                {l('responses', 'respostas')}
                              </span>
                            </>
                          ) : (
                            <span>
                              {l(
                                'No data in the previous period for comparison.',
                                'Sem dados no período anterior para comparar.',
                              )}
                            </span>
                          )}
                        </div>
                      )}
                      {!readOnly && (
                        <div className="mb-5">
                          <AdvancedReport
                            reportBase={reportBase}
                            refresh={asOf}
                            onDrilldown={drilldownReport}
                          />
                        </div>
                      )}
                      <div className="dashboard-columns">
                        <Card className="gap-0 py-0 ring-0 panel visibility-panel">
                          <div className="panel-title">
                            <div>
                              <h2>{t('Evolução da visibilidade')}</h2>
                              <p>
                                {t(
                                  'Percentual diário de respostas que mencionam cada marca.',
                                )}
                              </p>
                            </div>
                            <span className="subtle-tag">
                              {days} {t('dias')}
                            </span>
                          </div>
                          <Suspense fallback={<Skeleton className="h-72" />}>
                            <VisibilityChart
                              points={summary.data?.daily}
                              runs={filtered}
                              brandName={project.name}
                              competitors={competitors}
                            />
                          </Suspense>
                        </Card>
                        <Card className="gap-0 py-0 ring-0 panel brand-panel">
                          <div className="panel-title">
                            <div>
                              <h2>{t('Marcas na conversa')}</h2>
                              <p>{t('Presença nas respostas coletadas.')}</p>
                            </div>
                          </div>
                          {leaderboard.map((b, i) => (
                            <div className="ranking-row" key={b.name}>
                              <span className="rank-number">0{i + 1}</span>
                              <Favicon domain={b.domain} name={b.name} />
                              <div>
                                <b>
                                  {b.name}
                                  {b.name === project.name && (
                                    <small>{t('você')}</small>
                                  )}
                                </b>
                                <Progress
                                  value={b.visibility}
                                  aria-label={t(
                                    'Visibilidade de {name}: {value}%',
                                    { name: b.name, value: fmt(b.visibility) },
                                  )}
                                />
                              </div>
                              <strong>
                                {fmt(b.visibility)}
                                <small>%</small>
                              </strong>
                            </div>
                          ))}
                          <button
                            className="panel-link"
                            onClick={() => changeTab('competitors')}
                          >
                            {t('Comparar concorrentes')}
                            <ArrowUpRight size={14} />
                          </button>
                        </Card>
                      </div>
                      <Card className="gap-0 py-0 ring-0 panel recent-panel">
                        <div className="panel-title">
                          <div>
                            <h2>{t('Respostas recentes')}</h2>
                            <p>{t('Vá do indicador à evidência.')}</p>
                          </div>
                          <button
                            onClick={() => changeTab('history')}
                            className="panel-link inline"
                          >
                            {t('Ver histórico')}
                            <ArrowRight size={15} />
                          </button>
                        </div>
                        {filtered.length ? (
                          <ResponseTable
                            runs={filtered.slice(0, 5)}
                            onOpen={showRun}
                          />
                        ) : (
                          <EmptyBlock
                            title={t('Ainda não há respostas.')}
                            description={t(
                              'Adicione suas perguntas. As respostas chegam automaticamente.',
                            )}
                            action={newPrompt}
                            label={t('Adicionar prompt')}
                          />
                        )}
                      </Card>
                      <p className="metric-note">
                        {t(
                          'Visibilidade mede menções, não recomendações. Os resultados variam por prompt, mercado, idioma e momento da coleta.',
                        )}{' '}
                        <a href="/docs#metrics">
                          {t('Entenda as métricas')}
                          <ArrowUpRight size={11} />
                        </a>
                      </p>
                    </>
                  )}
                {tab === 'prompts' && project && (
                  <PromptManager
                    topics={data.topics}
                    capabilities={data.capabilities}
                    capacity={data.capacity}
                    now={asOf}
                    key={project.id}
                    project={project}
                    prompts={data.prompts}
                    runs={filtered}
                    statistics={promptStats.data}
                    reportBase={!readOnly ? reportBase : undefined}
                    engine={engine}
                    demo={readOnly}
                    onReload={async () => {
                      await reload();
                    }}
                    onAdd={newPrompt}
                    onOpen={showRun}
                  />
                )}
                {tab === 'competitors' &&
                  project &&
                  !reportLoading &&
                  (readOnly || !!summary.data) && (
                    <>
                      <div className="competitor-heading">
                        <p>{t('Compare sua marca com até 5 concorrentes.')}</p>
                        <Button
                          variant="outline"
                          className="lf-outline"
                          onClick={editProject}
                        >
                          <Plus />
                          {t('Gerenciar concorrentes')}
                        </Button>
                      </div>
                      <Card className="gap-0 py-0 ring-0 panel">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t('MARCA')}</TableHead>
                              <TableHead>{t('MENÇÕES')}</TableHead>
                              <TableHead>{t('VISIBILIDADE')}</TableHead>
                              <TableHead>SHARE OF VOICE</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {leaderboard.map((b) => (
                              <TableRow key={b.name}>
                                <TableCell>
                                  <span className="brand-table-name">
                                    <Favicon domain={b.domain} name={b.name} />
                                    <span>
                                      <b>{b.name}</b>
                                      <small>
                                        {b.name === project.name
                                          ? project.domain
                                          : project.competitors.find(
                                              (c) => c.name === b.name,
                                            )?.domain}
                                      </small>
                                    </span>
                                    {b.name === project.name && (
                                      <span className="subtle-tag">
                                        {t('Sua marca')}
                                      </span>
                                    )}
                                  </span>
                                </TableCell>
                                <TableCell>{b.count}</TableCell>
                                <TableCell>
                                  <div className="table-progress">
                                    <Progress
                                      value={b.visibility}
                                      aria-label={t('Visibilidade de {name}', {
                                        name: b.name,
                                      })}
                                    />
                                    <span>{fmt(b.visibility)}%</span>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {fmt(
                                    leaderboard.reduce((s, x) => s + x.count, 0)
                                      ? (b.count /
                                          leaderboard.reduce(
                                            (s, x) => s + x.count,
                                            0,
                                          )) *
                                          100
                                      : 0,
                                  )}
                                  %
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Card>
                      <Card className="gap-0 py-0 ring-0 panel mt-6">
                        <div className="panel-title">
                          <div>
                            <h2>{t('Presença ao longo do tempo')}</h2>
                            <p>
                              {t(
                                'Mesmos prompts. Mesmo mercado. Uma comparação direta.',
                              )}
                            </p>
                          </div>
                        </div>
                        <Suspense fallback={<Skeleton className="h-72" />}>
                          <VisibilityChart
                            points={summary.data?.daily}
                            runs={filtered}
                            brandName={project.name}
                            competitors={competitors}
                          />
                        </Suspense>
                      </Card>
                    </>
                  )}
                {tab === 'sources' && (
                  <SourceExplorer
                    {...(readOnly
                      ? { demo: true as const, runs: filtered }
                      : { reportBase, refresh: asOf })}
                    onOpen={showRun}
                  />
                )}
                {tab === 'history' && (
                  <Card className="gap-0 py-0 ring-0 panel">
                    <div className="table-toolbar">
                      <div className="search-input">
                        <Search size={16} />
                        <Input
                          aria-label={t('Buscar no histórico')}
                          placeholder={t('Buscar por prompt…')}
                          value={query}
                          onChange={(e) => {
                            setQuery(e.target.value);
                            setPage(1);
                          }}
                        />
                      </div>
                      <Choice
                        label={t('Filtrar status')}
                        value={statusFilter}
                        onChange={(v) => {
                          setStatusFilter(v);
                          setPage(1);
                        }}
                        options={[
                          { value: 'all', label: t('Todos os status') },
                          { value: 'complete', label: t('Concluídas') },
                          { value: 'pending', label: t('Coletando') },
                          { value: 'failed', label: 'Falhas' },
                          { value: 'unknown', label: t('Sem confirmação') },
                        ]}
                      />
                    </div>
                    {historyData.loading ? (
                      <Skeleton className="m-5 h-48" />
                    ) : historyRuns.length ? (
                      <ResponseTable
                        runs={
                          readOnly
                            ? historyRuns.slice((page - 1) * 15, page * 15)
                            : historyRuns
                        }
                        onOpen={showRun}
                      />
                    ) : (
                      <EmptyBlock
                        title={t('Nenhuma coleta encontrada.')}
                        description={t(
                          'As respostas aparecem automaticamente. Experimente ajustar os filtros.',
                        )}
                      />
                    )}
                    {pageCount > 1 && (
                      <Pagination className="table-pagination">
                        <PaginationContent>
                          <PaginationItem>
                            <Button
                              variant="outline"
                              aria-label={t('Página anterior')}
                              disabled={page <= 1}
                              onClick={() => setPage((p) => p - 1)}
                            >
                              <ChevronLeft />
                              {t('Anterior')}
                            </Button>
                          </PaginationItem>
                          <PaginationItem>
                            <span>
                              {readOnly
                                ? `${page} / ${pageCount}`
                                : t('Página {page}', { page })}
                            </span>
                          </PaginationItem>
                          <PaginationItem>
                            <Button
                              variant="outline"
                              aria-label={t('Próxima página')}
                              disabled={page >= pageCount}
                              onClick={() => {
                                if (!readOnly)
                                  setCursors((previous) => [
                                    ...previous.slice(0, page),
                                    historyData.data?.nextCursor ?? null,
                                  ]);
                                setPage((p) => p + 1);
                              }}
                            >
                              {t('Próxima')}
                              <ChevronRight />
                            </Button>
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    )}
                  </Card>
                )}
                {tab === 'settings' && project && (
                  <div className="settings-grid">
                    <Card className="gap-0 py-0 ring-0 panel settings-panel">
                      <h2>{t('Seu projeto')}</h2>
                      <dl>
                        <div>
                          <dt>{t('Marca')}</dt>
                          <dd>{project.name}</dd>
                        </div>
                        <div>
                          <dt>{t('Domínio')}</dt>
                          <dd>{project.domain}</dd>
                        </div>
                        <div>
                          <dt>{t('Mercado')}</dt>
                          <dd>
                            {
                              {
                                2076: t('Brasil'),
                                2840: t('Estados Unidos'),
                                2826: t('Reino Unido'),
                              }[project.location_code as 2076]
                            }
                          </dd>
                        </div>
                        <div>
                          <dt>{t('Idioma')}</dt>
                          <dd>
                            {project.language_code === 'pt'
                              ? t('Português')
                              : t('Inglês')}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('Concorrentes')}</dt>
                          <dd>
                            {project.competitors
                              .map((c) => c.name)
                              .join(', ') || t('Nenhum')}
                          </dd>
                        </div>
                      </dl>
                      <Button
                        variant="outline"
                        className="lf-outline"
                        onClick={editProject}
                      >
                        <Settings2 />
                        {t('Editar projeto')}
                      </Button>
                    </Card>
                    <Card className="gap-0 py-0 ring-0 panel settings-panel">
                      <h2>{t('Acompanhamento automático')}</h2>
                      {data.config.providerSettings && (
                        <div className="integration-line">
                          <span className="provider-logo">D</span>
                          <div>
                            <b>DataForSEO</b>
                            <p>
                              {data.config.dataforseo
                                ? t('Credenciais configuradas no servidor')
                                : t('Aguardando configuração do operador')}
                            </p>
                          </div>
                          <span
                            className={`run-status ${data.config.dataforseo ? 'status-complete' : 'status-unknown'}`}
                          >
                            <span />
                            {data.config.dataforseo
                              ? t('Configurado')
                              : t('Pendente')}
                          </span>
                        </div>
                      )}
                      <div className="schedule-line">
                        <div>
                          <b>{t('Monitoramento ativo')}</b>
                          <p>
                            {t(
                              'Atualiza seus prompts mesmo com o navegador fechado.',
                            )}
                          </p>
                        </div>
                        <Switch
                          aria-label={t('Monitoramento ativo')}
                          checked={!!project.daily_enabled}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            readOnly
                              ? notifyDemo()
                              : void perform(async () => {
                                  await api(
                                    `/api/projects/${project.id}`,
                                    'PATCH',
                                    { daily_enabled: checked },
                                  );
                                  await reload();
                                })
                          }
                        />
                      </div>
                      <div className="schedule-line">
                        <div>
                          <b>{t('Todos os dias, às 4h')}</b>
                          <p>
                            {t(
                              'Horário de Brasília · respostas liberadas conforme a conclusão de cada plataforma.',
                            )}
                          </p>
                        </div>
                        <Clock size={20} />
                      </div>
                      {!data.config.scheduling && (
                        <div className="notice">
                          {t(
                            'A próxima coleta pode sofrer atraso. Estamos aguardando a confirmação do agendador.',
                          )}
                        </div>
                      )}
                      <p className="form-hint">
                        {t('Última verificação:')}{' '}
                        {data.config.schedulerLastSeen
                          ? formatMonitoringTime(data.config.schedulerLastSeen)
                          : t('ainda não registrada')}{' '}
                        {t('(Brasília).')}
                      </p>
                      {data.config.providerSettings && (
                        <p className="form-hint">
                          <a href="/docs#scheduler">
                            {t('Configuração do agendador e integração')}
                          </a>
                          {t('. As credenciais ficam no servidor.')}
                        </p>
                      )}
                    </Card>
                    <Card className="gap-0 py-0 ring-0 panel settings-panel danger-panel">
                      <h2>{t('Arquivar projeto')}</h2>
                      <p>
                        {t(
                          'Interrompe as coletas futuras e remove o projeto da lista de ativos. O histórico e o uso acumulado são preservados no banco.',
                        )}
                      </p>
                      <Button
                        variant="destructive"
                        className="lf-outline"
                        onClick={() =>
                          readOnly
                            ? notifyDemo()
                            : setConfirmation({
                                title: t('Arquivar {name}?', {
                                  name: project.name,
                                }),
                                description: t(
                                  'Este projeto sairá da lista de ativos e o agendamento será desativado.',
                                ),
                                action: async () => {
                                  await api(
                                    `/api/projects/${project.id}`,
                                    'DELETE',
                                  );
                                  await reload(null);
                                },
                              })
                        }
                      >
                        <Archive />
                        {t('Arquivar projeto')}
                      </Button>
                    </Card>
                  </div>
                )}
                <ExtensionOutlet
                  extension={extensions.find((item) => item.id === tab)}
                  data={data}
                  reload={reload}
                />
              </>
            )
          )}
        </div>
        <footer className="workspace-footer">
          <span>
            <Aperture size={13} />
            {t('Lastfind · Open source por princípio.')}
          </span>
          <a href="/docs">
            {t('Documentação')}
            <ArrowUpRight size={12} />
          </a>
        </footer>
      </SidebarInset>
      <ProjectDialog
        open={projectOpen}
        setOpen={setProjectOpen}
        project={editing}
        onSave={saveProject}
      />
      <PromptDialog
        open={promptOpen}
        setOpen={setPromptOpen}
        project={project}
        onSave={savePrompt}
        capabilities={data?.capabilities}
        topics={data?.topics ?? []}
        capacity={data?.capacity}
      />
      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="response-sheet">
          <SheetTitle>{t('Por dentro da resposta')}</SheetTitle>
          <SheetDescription>
            {detail ? dateTime(detail.created_at) : ''}
          </SheetDescription>
          {detail && (
            <>
              <div className="response-meta">
                <EngineBadge engine={detail.engine} />
                <Status status={detail.status} />
                {readOnly && (
                  <span className="subtle-tag">{t('Ilustrativo')}</span>
                )}
              </div>
              <div className="response-prompt">
                <span className="eyebrow">{t('PROMPT MONITORADO')}</span>
                <h3>{detail.prompt_text}</h3>
              </div>
              <div className="response-mentions">
                {Object.entries(detail.mentions).map(([name, present]) => (
                  <span
                    key={name}
                    className={`mention-tag ${present ? 'mentioned' : ''}`}
                  >
                    {present ? <Check size={13} /> : <span>—</span>}
                    {name}
                  </span>
                ))}
              </div>
              <h4 className="response-section-title">
                {t('Resposta original')}
              </h4>
              {detailLoading ? (
                <Skeleton className="h-64 mt-4" />
              ) : detail.evidence_loaded === false ? (
                <div className="response-text">
                  <p>
                    {t('Não foi possível carregar a resposta e suas fontes.')}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void showRun(detail)}
                  >
                    {t('Tentar novamente')}
                  </Button>
                </div>
              ) : (
                <div className="response-text">
                  {detail.response_available === false
                    ? t(
                        'A plataforma não exibiu um AI Overview para este prompt nesta coleta.',
                      )
                    : detail.answer ||
                      detail.error ||
                      t(
                        'A resposta está sendo preparada. Ela aparecerá automaticamente quando estiver pronta.',
                      )}
                </div>
              )}
              {!detailLoading && detail.evidence_loaded !== false && (
                <>
                  <h4 className="response-section-title">
                    {t('Fontes citadas ·')} {detail.sources.length}
                  </h4>
                  <SourceList
                    sources={detail.sources}
                    empty={t('Nenhuma citação informada nesta resposta.')}
                  />
                  <h4 className="response-section-title">
                    {t('Fontes consultadas')}{' '}
                    {detail.consulted_sources
                      ? ` · ${detail.consulted_sources.length}`
                      : ''}
                  </h4>
                  <SourceList
                    sources={detail.consulted_sources}
                    empty={t(
                      'O provedor retornou uma lista de consulta vazia.',
                    )}
                  />
                  {!!detail.search_queries?.length && (
                    <div className="response-footnote">
                      <b>{t('Buscas relacionadas')}</b>
                      <ul>
                        {detail.search_queries.map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!readOnly && (
                    <div className="response-footnote">
                      <b>
                        {l(
                          'Original provider JSON',
                          'JSON original do provedor',
                        )}
                      </b>
                      {detail.raw_response?.status === 'archived' ? (
                        <>
                          <a
                            className="text-link"
                            href={`/api/runs/${detail.id}/raw`}
                            download
                          >
                            {l(
                              'Download original response',
                              'Baixar resposta original',
                            )}{' '}
                            <Download size={14} />
                          </a>
                          <small>
                            {detail.raw_response.bytes?.toLocaleString(locale)}{' '}
                            bytes · SHA-256: {detail.raw_response.sha256}
                          </small>
                        </>
                      ) : (
                        <p>
                          {l(
                            'The original JSON is not available for this collection. The answer and sources above remain available.',
                            'O JSON original não está disponível para esta coleta. A resposta e as fontes acima continuam disponíveis.',
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="response-footnote">
                    {t('Modelo:')} {detail.model ?? '—'} ·{' '}
                    {ENGINE_META[detail.engine].family === 'responses'
                      ? t('Resposta via API do modelo')
                      : t('Resposta da plataforma')}
                    {data?.config.providerSettings && (
                      <>
                        {t('· Custo: US$')}
                        {detail.cost.toFixed(4)}
                      </>
                    )}
                    <br />
                    {t('ID da coleta:')} {detail.id}
                  </div>
                </>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(v) => !v && setConfirmation(null)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirmation?.description}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancelar')}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await confirmation?.action();
                  setConfirmation(null);
                }, t('Arquivado'))
              }
            >
              {t('Arquivar')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
function ExtensionOutlet({
  extension,
  data,
  reload,
}: {
  extension?: WorkspaceExtension;
  data: Workspace;
  reload: () => Promise<boolean>;
}) {
  return extension?.render(data, reload) ?? null;
}
function Metric({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="metric-card gap-0 ring-0" aria-label={label}>
      <div>
        <span>{label}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <p>{sub}</p>
    </Card>
  );
}
function EmptyBlock({
  title,
  description,
  action,
  label,
}: {
  title: string;
  description: string;
  action?: () => void;
  label?: string;
}) {
  return (
    <Empty className="lf-empty">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Search />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && (
        <Button variant="outline" className="lf-outline" onClick={action}>
          <Plus />
          {label}
        </Button>
      )}
    </Empty>
  );
}
function ResponseTable({
  runs,
  onOpen,
}: {
  runs: Run[];
  onOpen: (r: Run) => void;
}) {
  const { t, locale } = useI18n();
  const dateTime = (date: string) =>
    new Date(date).toLocaleString(locale, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }) + ' BRT';
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>PROMPT</TableHead>
          <TableHead>{t('MOTOR')}</TableHead>
          <TableHead>{t('SUA MARCA')}</TableHead>
          <TableHead>{t('COLETA')}</TableHead>
          <TableHead>{t('DATA')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('Abrir')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="prompt-cell">
              <button
                className="prompt-question response-open"
                onClick={() => onOpen(r)}
              >
                {r.prompt_text}
              </button>
            </TableCell>
            <TableCell>
              <EngineBadge engine={r.engine} />
            </TableCell>
            <TableCell>
              {r.status === 'complete' ? (
                <span
                  className={`mention-tag ${r.mentions[r.brand_name] ? 'mentioned' : ''}`}
                >
                  {r.mentions[r.brand_name] ? <Check size={12} /> : null}
                  {r.mentions[r.brand_name]
                    ? t('Mencionada')
                    : t('Não mencionada')}
                </span>
              ) : (
                <span className="muted">—</span>
              )}
            </TableCell>
            <TableCell>
              <Status status={r.status} />
            </TableCell>
            <TableCell className="date-cell">
              {dateTime(r.created_at)}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('Ver resposta')}
                onClick={() => onOpen(r)}
              >
                <ArrowUpRight />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
