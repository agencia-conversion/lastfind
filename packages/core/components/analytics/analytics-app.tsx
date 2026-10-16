'use client';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SetStateAction,
} from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  Command,
  Folder,
  Globe,
  MessageSquare,
  Plus,
  Sparkles,
  Tag,
  X,
  Download,
} from 'lucide-react';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  demoBrands,
  demoModels,
  demoSources,
  defaultFilters,
  exportDemoCsv,
  getDemoReport,
  filterLabel,
  filterValues,
  type FilterSelection,
  type DemoPrompt,
} from './demo-data';
import {
  Change,
  PrimaryMenuActions,
  SearchField,
  EmptyState,
  MultiFilter,
  ModelMark,
  ModelFilter,
  SiteFavicon,
  useCopy,
  useNumbers,
} from './shared';
import { BrandRanking, Overview } from './overview';
import { PromptsView } from './prompts-view';
import { ChatsView, ModelsView, SourcesView } from './detail-views';
import { WorkspaceSettingsView } from './workspace-settings';
import { OnboardingView } from './onboarding';
import { createOnboardingProject } from './onboarding-project';
import { SemanticBrandingView } from './semantic-branding';
import type { SemanticSessionState } from './semantic-data';
import {
  readSemanticConfigurationSession,
  semanticConfigurationSessionKey,
  validateSemanticConfiguration,
  writeSemanticConfigurationSession,
  type SemanticConfigurationSession,
} from './semantic-configuration';
import { DateRangePicker } from './date-range-picker';
import { getDateRange } from './date-range';
import { useAnalyticsNavigation } from './use-analytics-navigation';
import {
  setProjectPrompts,
  switchDemoContext,
  workspaceRole,
} from './workspace-data';

import { AnalyticsSidebar, navigation } from './analytics-sidebar';
import { PageHeading } from '@/components/lastfind/presentation/page-heading';

export function AnalyticsApp({
  initialPath,
  initialSearch,
  authenticatedUser,
  initialTab,
  initialPromptId,
  initialSidebarOpen = true,
}: {
  authenticatedUser?: { id: string; name: string; email: string };
  initialPath?: string;
  initialSearch?: string;
  initialTab?: string;
  initialPromptId?: string;
  initialSidebarOpen?: boolean;
}) {
  const l = useCopy();
  const { number, percent, locale } = useNumbers();
  const route = useAnalyticsNavigation({
    authenticatedUser,
    initialPath,
    initialSearch,
    initialTab,
    initialPromptId,
  });
  const {
    tab,
    session,
    setSession,
    settingsSection,
    semanticSection,
    setSemanticSection,
    setSettingsSection,
    filters,
    setFilters,
    selectedPrompt,
    selectedBrand,
    setSelectedBrand,
    selectedChat,
    setSelectedChat,
    selectedDomain,
    setSelectedDomain,
    routeError,
    hrefForTab,
  } = route;
  const workspace = session.workspaces.find(
    (w) => w.id === session.workspaceId,
  )!;
  const project = workspace.projects.find((p) => p.id === session.projectId)!;
  const prompts = project.prompts;
  const readOnly = workspaceRole(session) === 'viewer';
  const hasSampleData = project.id === 'conversion-web';
  const setPrompts = (next: SetStateAction<DemoPrompt[]>) =>
    setSession((previous) => {
      const currentPrompts = previous.workspaces
        .find((w) => w.id === previous.workspaceId)!
        .projects.find((p) => p.id === previous.projectId)!.prompts;
      return setProjectPrompts(
        previous,
        typeof next === 'function' ? next(currentPrompts) : next,
      );
    });
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [semanticStates, setSemanticStates] = useState<
    Record<string, SemanticSessionState>
  >({});
  const semanticKey = `${session.workspaceId}/${session.projectId}`;
  const contextKey = `${session.userId}/${session.workspaceId}/${session.projectId}`;
  const semanticStorageKey = semanticConfigurationSessionKey({
    accountId: authenticatedUser?.id ?? 'preview',
    userId: session.userId,
    workspaceId: session.workspaceId,
    projectId: session.projectId,
  });
  const [semanticConfigurations, setSemanticConfigurations] = useState<
    Record<string, SemanticConfigurationSession>
  >({});
  const [restoredSemanticKey, setRestoredSemanticKey] = useState<string | null>(
    null,
  );
  useEffect(() => {
    // Restore the browser-only source after hydration, before mounting its editor.
    const frame = requestAnimationFrame(() => {
      const restored = readSemanticConfigurationSession(semanticStorageKey);
      setSemanticConfigurations((previous) =>
        previous[semanticStorageKey] || !restored
          ? previous
          : { ...previous, [semanticStorageKey]: restored },
      );
      setRestoredSemanticKey(semanticStorageKey);
    });
    return () => cancelAnimationFrame(frame);
  }, [semanticStorageKey]);
  const savedSemanticConfiguration = semanticConfigurations[semanticStorageKey];
  const semanticProject = savedSemanticConfiguration
    ? {
        ...project,
        setup: {
          ...(project.setup ?? {
            segment: '',
            country: filterValues(filters.country)[0] ?? 'Brazil',
            models: [...filters.models],
            competitors: [],
          }),
          language: savedSemanticConfiguration.language,
          semantic: savedSemanticConfiguration.configuration,
        },
      }
    : project;
  const previousContext = useRef(contextKey);
  useEffect(() => {
    if (previousContext.current === contextKey) return;
    previousContext.current = contextKey;
    setAddOpen(false);
    setSearchOpen(false);
    setSearch('');
  }, [contextKey]);
  const report = useMemo(() => {
    const result = getDemoReport(
      selectedPrompt
        ? prompts
            .filter((p) => p.id === selectedPrompt.id)
            .map((p) => ({ ...p, status: 'active' as const }))
        : prompts,
      filters,
    );
    return {
      ...result,
      brands: result.brands.map((brand) =>
        brand.id === 'conversion'
          ? { ...brand, name: project.name, domain: project.domain }
          : brand,
      ),
    };
  }, [prompts, filters, selectedPrompt, project.name, project.domain]);
  const activeCount = prompts.filter((p) => p.status === 'active').length;
  const current =
    navigation.find((n) => n.id === tab) ??
    navigation.find((n) => n.id === 'overview')!;
  const configuringAttributes =
    tab === 'semantic-branding' && semanticSection === 'attributes';
  const pageTitle = configuringAttributes
    ? l('Brand attributes', 'Atributos da marca')
    : l(current.en, current.pt);
  const pageDescription = selectedPrompt
    ? l('Explore performance for this specific prompt.', 'Explore o desempenho deste prompt.')
    : configuringAttributes
      ? l('Choose and refine the associations that define your brand positioning.', 'Escolha e refine as associações que definem o posicionamento da sua marca.')
      : tab === 'semantic-branding'
        ? l('Understand the associations, sources and evidence shaping your brand in AI.', 'Entenda as associações, fontes e evidências que formam sua marca na IA.')
        : tab === 'overview'
          ? l('Understand how AI sees your brand. Make your next move count.', 'Entenda como a IA vê sua marca. Dê o próximo passo com dados.')
          : tab === 'prompts'
            ? l('Track the questions that matter to your brand.', 'Acompanhe as perguntas que importam para sua marca.')
            : tab === 'competitors'
              ? l('See who stands out in AI answers, and where you stand.', 'Veja quem se destaca nas respostas de IA e onde sua marca está.')
              : tab === 'sources'
                ? l('Discover the sources behind your AI visibility.', 'Descubra as fontes por trás da sua visibilidade em IA.')
                : tab === 'models'
                  ? l('Your performance across the AI search landscape.', 'Seu desempenho nos principais modelos de busca com IA.')
                  : tab === 'chats'
                    ? l('Every answer tells a story. Explore yours.', 'Cada resposta conta uma história. Explore a sua.')
                    : l('Make this workspace your own.', 'Deixe este workspace com a sua cara.');
  const own = report.brands.find((b) => b.id === 'conversion')!;
  const navigate = (next: string) => {
    route.navigate(next);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    document.title = `${selectedPrompt?.text ?? pageTitle} · ${project.name} · Lastfind`;
  }, [selectedPrompt, pageTitle, project.name]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const updateFilter = (
    key: 'country' | 'topic' | 'tag',
    value: FilterSelection,
  ) => setFilters((s) => ({ ...s, [key]: value }));
  const openPrompt = (prompt: DemoPrompt) => {
    route.openPrompt(prompt);
    setSearchOpen(false);
    window.scrollTo({ top: 0 });
  };
  const dateRange = getDateRange(filters);
  const exportReport = () =>
    exportDemoCsv(`lastfind-${tab}.csv`, [
      [
        'Dataset',
        'Brand',
        'Visibility (%)',
        'Position',
        'Mentions',
        'Days',
        'Start date',
        'End date',
        'Model',
        'Country',
        'Topic',
        'Tag',
        'Tag match',
      ],
      ...report.brands.map((b) => [
        'DEMO',
        b.name,
        b.visibility.toFixed(1),
        b.position.toFixed(1),
        b.mentions,
        dateRange.days,
        dateRange.from,
        dateRange.to,
        filters.models.join(', '),
        filterLabel(filters.country),
        filterLabel(filters.topic),
        filterLabel(filters.tag),
        filters.tagMode ?? 'any',
      ]),
    ]);
  const filteredNav = navigation.filter((n) =>
    `${n.en} ${n.pt}`.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredPrompts = search.trim()
    ? prompts
        .filter((p) => p.text.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 5)
    : [];
  const hasFilters =
    filters.days !== '28' ||
    !!filters.from ||
    filters.models.length !== demoModels.length ||
    filters.tagMode === 'all' ||
    (['country', 'topic', 'tag'] as const).some(
      (key) => filters[key as keyof typeof filters] !== 'all',
    );
  if (tab === 'onboarding' && !routeError)
    return (
      <TooltipProvider>
        <main className="analytics-app onboarding-shell">
          {!['owner', 'admin'].includes(workspaceRole(session)) ? (
            <EmptyState
              title={l('Read-only access', 'Acesso de leitura')}
              description={l(
                'Ask a workspace administrator to create a project.',
                'Peça a um administrador do workspace para criar um projeto.',
              )}
              action={
                <Button variant="outline" onClick={() => navigate('overview')}>
                  {l('Back to overview', 'Voltar para visão geral')}
                </Button>
              }
            />
          ) : (
            <OnboardingView
              session={session}
              onCancel={() => navigate('overview')}
              onComplete={(result) => {
                setSession((s) => createOnboardingProject(s, result));
                setFilters({
                  ...defaultFilters,
                  models: result.models,
                  country: result.country,
                });
                setSemanticSection('associations');
                navigate(
                  result.semantic?.enabled ? 'semantic-branding' : 'prompts',
                );
              }}
            />
          )}
        </main>
      </TooltipProvider>
    );
  return (
    <TooltipProvider>
      <SidebarProvider
        defaultOpen={initialSidebarOpen}
        className="analytics-app"
        style={{ '--sidebar-width': '224px' } as CSSProperties}
      >
        <a className="skip-link" href="#analytics-main">
          {l('Skip to content', 'Ir para o conteúdo')}
        </a>
        <AnalyticsSidebar
          authenticated={Boolean(authenticatedUser)}
          tab={selectedPrompt ? 'prompts' : tab}
          hrefForTab={hrefForTab}
          onNavigate={navigate}
          onSearch={() => setSearchOpen(true)}
          activeCount={activeCount}
          session={session}
          onContext={(next) => setSession((s) => switchDemoContext(s, next))}
          onSettings={(section) => {
            setSettingsSection(section);
            navigate('settings');
          }}
        />
        <SidebarInset className="min-w-0">
          <header className="analytics-topbar">
            <div>
              <SidebarTrigger
                aria-label={l('Toggle navigation', 'Alternar navegação')}
              />
              <span className="topbar-divider" />
              <span className="text-muted-foreground truncate max-w-40">
                {project.name}
              </span>
              <ChevronDown
                size={12}
                className="rotate-[-90deg] text-muted-foreground"
              />
              <span>{pageTitle}</span>
            </div>
            <div className="topbar-actions">
              <div className="topbar-filters">
                <div className="analytics-filters">
                  <div className="filter-main">
                    <DateRangePicker
                      value={filters}
                      onChange={(period) =>
                        setFilters((previous) => ({ ...previous, ...period }))
                      }
                    />
                    <span className="filter-divider" />
                    <ModelFilter
                      value={filters.models}
                      onChange={(models) =>
                        setFilters((s) => ({ ...s, models }))
                      }
                    />
                    <MultiFilter
                      label={l('Country', 'País')}
                      value={filters.country}
                      onChange={(v) => updateFilter('country', v)}
                      icon={<Globe />}
                      options={Array.from(
                        new Set(prompts.map((prompt) => prompt.country)),
                      ).map((country) => ({
                        value: country,
                        label:
                          country === 'Brazil'
                            ? l('Brazil', 'Brasil')
                            : country === 'United States'
                              ? l('United States', 'Estados Unidos')
                              : country,
                      }))}
                    />
                    <MultiFilter
                      label={l('Topic', 'Tópico')}
                      value={filters.topic}
                      onChange={(v) => updateFilter('topic', v)}
                      icon={<Folder />}
                      options={Array.from(
                        new Set(prompts.map((p) => p.topic)),
                      ).map((v) => ({ value: v, label: v }))}
                    />
                    <MultiFilter
                      label={l('Tag', 'Tag')}
                      value={filters.tag}
                      onChange={(v) => updateFilter('tag', v)}
                      icon={<Tag />}
                      options={Array.from(
                        new Set(prompts.flatMap((prompt) => prompt.tags)),
                      ).map((v) => ({ value: v, label: v }))}
                    />
                    {filters.tag !== 'all' &&
                      filterValues(filters.tag).length > 1 && (
                        <Button
                          variant="outline"
                          aria-pressed={filters.tagMode === 'all'}
                          aria-label={l(
                            'Require all selected tags',
                            'Exigir todas as tags selecionadas',
                          )}
                          onClick={() =>
                            setFilters((previous) => ({
                              ...previous,
                              tagMode:
                                previous.tagMode === 'all' ? 'any' : 'all',
                            }))
                          }
                        >
                          {filters.tagMode === 'all'
                            ? l('Tags: all', 'Tags: todas')
                            : l('Tags: any', 'Tags: qualquer')}
                        </Button>
                      )}
                    {hasFilters && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={l('Clear filters', 'Limpar filtros')}
                        onClick={() => setFilters(defaultFilters)}
                      >
                        <X size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={l('Workspace help', 'Ajuda do workspace')}
                onClick={() => setHelpOpen(true)}
              >
                <CircleHelp />
              </Button>
            </div>
          </header>
          <div className="analytics-content" id="analytics-main">
            {routeError ? (
              <section className="analytics-panel">
                <EmptyState
                  title={l(
                    'This destination is unavailable',
                    'Este destino está indisponível',
                  )}
                  description={
                    routeError === 'no-access'
                      ? l(
                          'The selected user does not have access to this workspace.',
                          'O usuário selecionado não tem acesso a este workspace.',
                        )
                      : l(
                          'Check the link. Workspaces, projects and prompts created in this session are available until you reload.',
                          'Confira o link. Workspaces, projetos e prompts criados nesta sessão ficam disponíveis até você recarregar.',
                        )
                  }
                  action={
                    <Button
                      variant="outline"
                      onClick={() => navigate('overview')}
                    >
                      {l('Go to overview', 'Ir para visão geral')}
                    </Button>
                  }
                />
              </section>
            ) : (
              <>
                <>
                  {selectedPrompt && <button className="back-to-prompts" onClick={() => navigate('prompts')}><ArrowLeft size={13} />{l('All prompts', 'Todos os prompts')}</button>}
                  <PageHeading
                    title={selectedPrompt ? selectedPrompt.text : pageTitle}
                    description={pageDescription}
                    actions={
                      <>
                        {hasSampleData && (selectedPrompt || tab === 'competitors') && (
                          <Button variant="outline" onClick={exportReport}><Download />{l('Export', 'Exportar')}</Button>
                        )}
                        {!selectedPrompt && tab === 'overview' && (
                          <PrimaryMenuActions
                            label={l('More overview actions', 'Mais ações da visão geral')}
                            action={<Button disabled={readOnly} onClick={() => setAddOpen(true)}><Plus />{l('Add prompt', 'Adicionar prompt')}</Button>}
                          >
                            {hasSampleData && <DropdownMenuItem onClick={exportReport}><Download />{l('Export', 'Exportar')}</DropdownMenuItem>}
                          </PrimaryMenuActions>
                        )}
                      </>
                    }
                  />
                </>
                {!hasSampleData &&
                  tab !== 'settings' &&
                  tab !== 'prompts' &&
                  tab !== 'semantic-branding' && (
                    <section className="analytics-panel">
                      <EmptyState
                        title={l(
                          'Your project starts here',
                          'Seu projeto começa aqui',
                        )}
                        description={l(
                          `${project.name} has no analysis data yet. Manage its own prompts and members to prepare your workspace.`,
                          `${project.name} ainda não tem dados de análise. Gerencie seus prompts e membros para preparar seu workspace.`,
                        )}
                        action={
                          <Button
                            variant="outline"
                            onClick={() => navigate('prompts')}
                          >
                            {l('Manage prompts', 'Gerenciar prompts')}
                          </Button>
                        }
                      />
                    </section>
                  )}
                {hasSampleData && tab === 'overview' && (
                  <>
                    {report.responses.length > 0 &&
                      report.previous.length > 0 && (
                        <div className="overview-insight">
                          <Sparkles size={14} />
                          <span>
                            <strong>{project.name}</strong>{' '}
                            {own.change >= 0
                              ? l(
                                  'is gaining visibility',
                                  'está ganhando visibilidade',
                                )
                              : l(
                                  'has lower visibility',
                                  'está com menor visibilidade',
                                )}{' '}
                            <span className="insight-change">
                              {own.change >= 0 ? '+' : ''}
                              {number(own.change, 1)} pp
                            </span>{' '}
                            {l(
                              'compared with the previous period.',
                              'em relação ao período anterior.',
                            )}
                          </span>
                          <span className="insight-rank">
                            {l('Visibility rank', 'Ranking de visibilidade')}{' '}
                            <b>
                              #
                              {report.brands.findIndex(
                                (b) => b.id === 'conversion',
                              ) + 1}
                            </b>{' '}
                            / {report.brands.length}
                          </span>
                        </div>
                      )}
                    <Overview
                      key={contextKey}
                      report={report}
                      prompts={prompts}
                      onNavigate={navigate}
                      onBrand={setSelectedBrand}
                      onOpenChat={setSelectedChat}
                    />
                  </>
                )}
                <div
                  style={tab === 'prompts' ? undefined : { display: 'none' }}
                >
                  <PromptsView
                    visible={tab === 'prompts'}
                    key={contextKey}
                    prompts={prompts}
                    reportFilters={filters}
                    setPrompts={setPrompts}
                    onOpenPrompt={openPrompt}
                    addOpen={addOpen}
                    setAddOpen={setAddOpen}
                    readOnly={readOnly}
                  />
                </div>
                {hasSampleData && tab === 'competitors' && (
                  <section className="analytics-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>{l('Tracked brands', 'Marcas acompanhadas')}</h2>
                        <p>
                          {l(
                            'Six brands, one view of your market.',
                            'Seis marcas, uma visão do seu mercado.',
                          )}
                        </p>
                      </div>
                      <Badge variant="secondary">
                        6 {l('brands', 'marcas')}
                      </Badge>
                    </div>
                    <BrandRanking
                      report={report}
                      onBrand={setSelectedBrand}
                      full
                    />
                    <div className="panel-note">
                      {l(
                        'Select a brand to explore its performance and recent mentions.',
                        'Selecione uma marca para explorar o desempenho e as menções recentes.',
                      )}
                    </div>
                  </section>
                )}
                {hasSampleData && tab === 'sources' && (
                  <SourcesView
                    key={contextKey}
                    responses={report.responses}
                    selectedDomain={selectedDomain}
                    onSelectedDomainChange={setSelectedDomain}
                  />
                )}
                {hasSampleData && tab === 'models' && (
                  <ModelsView
                    key={contextKey}
                    responses={report.responses}
                    brandName={project.name}
                  />
                )}
                {hasSampleData && tab === 'chats' && (
                  <ChatsView
                    key={contextKey}
                    brandName={project.name}
                    responses={report.responses}
                    prompts={prompts}
                    onOpenChat={setSelectedChat}
                  />
                )}
                {tab === 'semantic-branding' &&
                  restoredSemanticKey !== semanticStorageKey && (
                    <output className="semantic-association-note">
                      {l(
                        'Loading brand attributes…',
                        'Carregando atributos da marca…',
                      )}
                    </output>
                  )}
                {tab === 'semantic-branding' &&
                  restoredSemanticKey === semanticStorageKey && (
                    <SemanticBrandingView
                      key={contextKey}
                      project={semanticProject}
                      report={report}
                      filters={filters}
                      onOpenChat={setSelectedChat}
                      onOpenSource={setSelectedDomain}
                      section={semanticSection}
                      onSectionChange={setSemanticSection}
                      savedState={semanticStates[semanticKey]}
                      onSaveState={(state) => {
                        if (!readOnly)
                          setSemanticStates((previous) => ({
                            ...previous,
                            [semanticKey]: state,
                          }));
                      }}
                      onConfigure={(configuration) => {
                        if (
                          readOnly ||
                          validateSemanticConfiguration(configuration)
                        )
                          return false;
                        const saved: SemanticConfigurationSession = {
                          configuration: {
                            enabled: configuration.enabled,
                            attributes: configuration.attributes.map(
                              (attribute) => ({ ...attribute }),
                            ),
                          },
                          language:
                            semanticProject.setup?.language ??
                            (locale === 'pt-BR' ? 'pt-BR' : 'en-US'),
                        };
                        // Local overrides belong to this account/context, not the shared demo session.
                        setSemanticConfigurations((previous) => ({
                          ...previous,
                          [semanticStorageKey]: saved,
                        }));
                        return writeSemanticConfigurationSession(
                          semanticStorageKey,
                          saved,
                        );
                      }}
                      readOnly={readOnly}
                    />
                  )}
                {tab === 'settings' && (
                  <WorkspaceSettingsView
                    session={session}
                    setSession={setSession}
                    section={settingsSection}
                    onSectionChange={setSettingsSection}
                  />
                )}
              </>
            )}
            <footer className="workspace-disclaimer">
              <span>
                lastfind.{' '}
                <span className="text-muted-foreground">by Conversion</span>
              </span>
            </footer>
          </div>
        </SidebarInset>
        <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
          <DialogContent className="sm:max-w-xl p-0 overflow-hidden">
            <div className="p-4 pb-0">
              <DialogTitle>{l('Quick search', 'Busca rápida')}</DialogTitle>
              <DialogDescription className="mt-1 text-sm">
                {l(
                  'Jump to a page or find a tracked prompt.',
                  'Abra uma página ou encontre um prompt acompanhado.',
                )}
              </DialogDescription>
            </div>
            <div className="mx-4">
              <SearchField
                fullWidth
                value={search}
                onChange={setSearch}
                ariaLabel={l('Search workspace', 'Buscar no workspace')}
                placeholder={l(
                  'Search pages and prompts…',
                  'Buscar páginas e prompts…',
                )}
              />
            </div>
            <div className="command-results">
              {filteredNav.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    navigate(n.id);
                    setSearchOpen(false);
                  }}
                >
                  <n.icon size={16} />
                  {l(n.en, n.pt)}
                  <ArrowUpRight size={14} />
                </button>
              ))}
              {filteredPrompts.map((p) => (
                <button key={p.id} onClick={() => openPrompt(p)}>
                  <MessageSquare size={16} />
                  <span className="truncate">{p.text}</span>
                </button>
              ))}
              {!filteredNav.length && !filteredPrompts.length && (
                <EmptyState title={l('No results found', 'Nenhum resultado')} />
              )}
            </div>
            <div className="command-footer">
              <Command size={12} /> K{' '}
              <span>{l('to search', 'para buscar')}</span>
              <kbd>esc</kbd>
              <span>{l('to close', 'para fechar')}</span>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogTitle>
              {l('Meet the new Lastfind', 'Conheça o novo Lastfind')}
            </DialogTitle>
            <DialogDescription>
              {l(
                'Your AI visibility workspace, built around the questions, brands, and sources that matter.',
                'Seu workspace de visibilidade em IA, organizado pelas perguntas, marcas e fontes que importam.',
              )}
            </DialogDescription>
            <div className="rounded-lg border bg-muted/50 p-4 text-sm leading-6">
              {l(
                'All responses and metrics here are synthetic. Filters, prompt management, and exports work with this sample dataset. Changes reset on reload. No monitoring is triggered.',
                'Todas as respostas e métricas são sintéticas. Filtros, gerenciamento de prompts e exportações usam estes dados de exemplo. As alterações são reiniciadas ao recarregar. Nenhum monitoramento é disparado.',
              )}
            </div>
            <Button onClick={() => setHelpOpen(false)}>
              {l('Got it', 'Entendi')}
            </Button>
          </DialogContent>
        </Dialog>
        <Sheet
          open={selectedBrand !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedBrand(null);
          }}
        >
          <SheetContent className="analytics-detail-sheet sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>
                {report.brands.find((b) => b.id === selectedBrand)?.name}
              </SheetTitle>
              <SheetDescription>
                {l(
                  'Brand performance in the selected period',
                  'Desempenho da marca no período selecionado',
                )}
              </SheetDescription>
            </SheetHeader>
            {selectedBrand && (
              <div className="p-6 pt-0 space-y-6">
                <div className="detail-metrics">
                  {(() => {
                    const b = report.brands.find(
                      (b) => b.id === selectedBrand,
                    )!;
                    return (
                      <>
                        <div>
                          <span>{l('Visibility', 'Visibilidade')}</span>
                          <b>
                            {report.responses.length
                              ? percent(b.visibility)
                              : '—'}
                          </b>
                          {!!report.responses.length &&
                            !!report.previous.length && (
                              <Change value={b.change} />
                            )}
                        </div>
                        <div>
                          <span>{l('Position', 'Posição')}</span>
                          <b>{b.mentions ? number(b.position, 1) : '—'}</b>
                        </div>
                      </>
                    );
                  })()}
                </div>
                <h3 className="font-semibold text-sm">
                  {l('Recent mentions', 'Menções recentes')}
                </h3>
                {[...report.responses]
                  .reverse()
                  .filter((r) => r.brandIds.includes(selectedBrand))
                  .slice(0, 6)
                  .map((r) => (
                    <button
                      className="detail-response"
                      key={r.id}
                      onClick={() => {
                        setSelectedChat(r);
                        setSelectedBrand(null);
                      }}
                    >
                      <ModelMark model={r.model} />
                      <p>{prompts.find((p) => p.id === r.promptId)?.text}</p>
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
                {!report.responses.some((r) =>
                  r.brandIds.includes(selectedBrand),
                ) && (
                  <EmptyState
                    title={l(
                      'No mentions in this selection',
                      'Nenhuma menção nesta seleção',
                    )}
                  />
                )}
              </div>
            )}
          </SheetContent>
        </Sheet>
        <Sheet
          open={selectedChat !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedChat(null);
          }}
        >
          <SheetContent className="analytics-detail-sheet sm:max-w-2xl">
            <SheetHeader>
              <SheetTitle>
                {l('Chat details', 'Detalhes da resposta')}
              </SheetTitle>
              <SheetDescription>
                {l(
                  'Synthetic response for design review',
                  'Resposta sintética para revisão do design',
                )}
              </SheetDescription>
            </SheetHeader>
            {selectedChat && (
              <div className="px-6 pb-6 space-y-6">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <ModelMark model={selectedChat.model} />
                  <span>
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                      timeZone: 'UTC',
                    }).format(new Date(selectedChat.date))}{' '}
                    · 04:00 BRT
                  </span>
                </div>
                <div className="chat-prompt-bubble">
                  {prompts.find((p) => p.id === selectedChat.promptId)?.text}
                </div>
                <div className="demo-answer">
                  <p>
                    {l(
                      'The right partner depends on your goals, market, and the expertise your team needs. These agencies are worth considering:',
                      'A escolha do parceiro depende dos seus objetivos, mercado e da especialização que sua equipe precisa. Estas agências merecem atenção:',
                    )}
                  </p>
                  {selectedChat.brandIds.length ? (
                    selectedChat.brandIds.map((id, i) => {
                      const brand = demoBrands.find((b) => b.id === id)!;
                      return (
                        <div key={id}>
                          <h3>
                            {i + 1}. {brand.name}
                            {id === 'conversion' && (
                              <Badge variant="secondary">
                                {l('Your brand', 'Sua marca')}
                              </Badge>
                            )}
                          </h3>
                          <p>
                            {id === 'conversion'
                              ? l(
                                  'Conversion combines technical SEO, original research, and content strategy to help brands grow their organic presence. Its work covers traditional search and emerging AI discovery channels.',
                                  'A Conversion combina SEO técnico, pesquisa original e estratégia de conteúdo para aumentar a presença orgânica de marcas. Seu trabalho abrange busca tradicional e novos canais de descoberta em IA.',
                                )
                              : l(
                                  `${brand.name} offers digital marketing expertise and organic growth services. Evaluate its experience in your industry and the fit with your business objectives.`,
                                  `${brand.name} oferece experiência em marketing digital e serviços de crescimento orgânico. Avalie sua experiência no seu setor e a adequação aos seus objetivos.`,
                                )}
                          </p>
                        </div>
                      );
                    })
                  ) : (
                    <p>
                      {l(
                        'This sample answer does not mention any of the tracked brands.',
                        'Esta resposta de exemplo não menciona nenhuma das marcas acompanhadas.',
                      )}
                    </p>
                  )}
                </div>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">
                    {l('Cited sources', 'Fontes citadas')}{' '}
                    <span className="text-muted-foreground">
                      {number(selectedChat.sourceIds.length)}
                    </span>
                  </h3>
                  {!selectedChat.sourceIds.length && (
                    <p className="text-sm text-muted-foreground">
                      {l(
                        'No citations recorded in this sample.',
                        'Nenhuma citação registrada nesta amostra.',
                      )}
                    </p>
                  )}
                  {selectedChat.sourceIds.map((id) => {
                    const source = demoSources.find((s) => s.id === id)!;
                    return (
                      <a
                        key={id}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="citation-link"
                      >
                        <SiteFavicon
                          domain={source.domain}
                          name={source.title}
                        />
                        <span>
                          <b>{source.title}</b>
                          <small>{source.domain}</small>
                        </span>
                        <ArrowUpRight size={14} />
                      </a>
                    );
                  })}
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">
                    {l('Consulted sources', 'Fontes consultadas')}
                  </h3>
                  {selectedChat.consultedSourceIds === null ? (
                    <p className="text-sm text-muted-foreground leading-5">
                      {l(
                        'Consulted-source evidence is unavailable for this sample response. It is not inferred from citations.',
                        'Evidências de fontes consultadas indisponíveis para esta resposta de exemplo. Elas não são inferidas das citações.',
                      )}
                    </p>
                  ) : !selectedChat.consultedSourceIds.length ? (
                    <p className="text-sm text-muted-foreground">
                      {l(
                        'Consultation evidence is available; no consulted sources were recorded.',
                        'Evidência de consulta disponível; nenhuma fonte consultada foi registrada.',
                      )}
                    </p>
                  ) : (
                    selectedChat.consultedSourceIds.map((id) => (
                      <p className="text-sm" key={id}>
                        {demoSources.find((s) => s.id === id)?.domain}
                      </p>
                    ))
                  )}
                </section>
                <p className="text-sm text-muted-foreground border-t pt-4">
                  {l(
                    'Illustrative text, not an actual response from an AI provider.',
                    'Texto ilustrativo, não é uma resposta real de um provedor de IA.',
                  )}
                </p>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </SidebarProvider>
    </TooltipProvider>
  );
}
