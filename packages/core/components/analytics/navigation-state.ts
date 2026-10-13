import {
  defaultFilters,
  demoBrands,
  demoResponses,
  demoSources,
  type DemoFilters,
} from './demo-data.ts';
import {
  buildAnalyticsPath,
  parseAnalyticsRoute,
  parseFilters,
  promptKey,
  resolvePromptKey,
  routeForProject,
  serializeAnalyticsSearch,
  parseSemanticSection,
  type AnalyticsRoute,
} from './routes.ts';
import {
  accessibleWorkspaces,
  type DemoSession,
  type SettingsSection,
} from './workspace-data.ts';

export type AnalyticsNavigation = {
  session: DemoSession;
  base: AnalyticsRoute['base'];
  tab: string;
  settingsSection: SettingsSection;
  semanticSection: string;
  promptId: string | null;
  brandId: string | null;
  chatId: string | null;
  sourceDomain: string | null;
  filters: DemoFilters;
  error: 'not-found' | 'unavailable' | 'no-access' | null;
};

export const closedDetails = {
  promptId: null,
  brandId: null,
  chatId: null,
  sourceDomain: null,
};

/** A prompt drilldown narrows the entity while preserving the complete report scope. */
export function openPromptNavigation(
  state: AnalyticsNavigation,
  promptId: string,
): AnalyticsNavigation {
  return { ...state, ...closedDetails, promptId, tab: 'overview', error: null };
}

export function normalizeTab(value?: string) {
  if (value === 'history') return 'chats';
  if (value === 'brands') return 'competitors';
  return [
    'overview',
    'prompts',
    'competitors',
    'sources',
    'models',
    'chats',
    'settings',
    'onboarding',
    'semantic-branding',
  ].includes(value ?? '')
    ? value!
    : 'overview';
}

export function currentContext(session: DemoSession) {
  const workspace = session.workspaces.find(
    (w) => w.id === session.workspaceId,
  )!;
  return {
    workspace,
    project: workspace.projects.find((p) => p.id === session.projectId)!,
  };
}

export function resolveAnalyticsLocation(
  session: DemoSession,
  pathname: string,
  search = '',
): AnalyticsNavigation {
  const route = parseAnalyticsRoute(pathname);
  const state: AnalyticsNavigation = {
    session,
    base:
      pathname === '/app/preview' || pathname.startsWith('/app/preview/')
        ? '/app/preview'
        : '/app',
    tab: route?.tab ?? 'overview',
    settingsSection: route?.settingsSection ?? 'workspace',
    semanticSection:
      route?.tab === 'semantic-branding'
        ? parseSemanticSection(new URLSearchParams(search).get('view'))
        : 'associations',
    ...closedDetails,
    filters: parseFilters(new URLSearchParams(search)),
    error: null,
  };
  if (!route) return { ...state, error: 'not-found' };
  if (route.workspaceSlug) {
    const workspace = session.workspaces.find(
      (w) => w.slug === route.workspaceSlug,
    );
    if (!workspace) return { ...state, error: 'unavailable' };
    if (!accessibleWorkspaces(session).some((w) => w.id === workspace.id))
      return { ...state, error: 'no-access' };
    const project = route.projectSlug
      ? workspace.projects.find((p) => p.slug === route.projectSlug)
      : (workspace.projects.find((p) => p.id === session.projectId) ??
        workspace.projects[0]);
    if (!project) return { ...state, error: 'unavailable' };
    state.session = {
      ...session,
      workspaceId: workspace.id,
      projectId: project.id,
    };
  }
  const { project } = currentContext(state.session);
  if (route.promptKey) {
    const prompt = resolvePromptKey(route.promptKey, project.prompts);
    if (!prompt) return { ...state, error: 'unavailable' };
    state.promptId = prompt.id;
  }
  if (route.brandId || route.chatId || route.sourceDomain) {
    if (project.id !== 'conversion-web')
      return { ...state, error: 'unavailable' };
    if (route.brandId && !demoBrands.some((b) => b.id === route.brandId))
      return { ...state, error: 'unavailable' };
    if (
      route.chatId &&
      !demoResponses.some(
        (r) =>
          r.id === route.chatId &&
          project.prompts.some((p) => p.id === r.promptId),
      )
    )
      return { ...state, error: 'unavailable' };
    if (
      route.sourceDomain &&
      !demoSources.some((s) => s.domain === route.sourceDomain)
    )
      return { ...state, error: 'unavailable' };
    state.brandId = route.brandId ?? null;
    state.chatId = route.chatId ?? null;
    state.sourceDomain = route.sourceDomain ?? null;
  }
  return state;
}

export function analyticsLocation(state: AnalyticsNavigation): string {
  const { workspace, project } = currentContext(state.session);
  const prompt = project.prompts.find((p) => p.id === state.promptId);
  const route = {
    ...routeForProject(state.base, workspace, project, state.tab),
    settingsSection: state.settingsSection,
    promptKey: prompt ? promptKey(prompt) : undefined,
    brandId: state.brandId ?? undefined,
    chatId: state.chatId ?? undefined,
    sourceDomain: state.sourceDomain ?? undefined,
  };
  const query = serializeAnalyticsSearch(
    state.filters,
    state.tab,
    state.semanticSection,
  ).toString();
  return `${buildAnalyticsPath(route)}${query ? `?${query}` : ''}`;
}

export function changeNavigationSession(
  state: AnalyticsNavigation,
  session: DemoSession,
): AnalyticsNavigation {
  const changed = ['userId', 'workspaceId', 'projectId'].some(
    (key) => state.session[key as 'userId'] !== session[key as 'userId'],
  );
  return {
    ...state,
    session,
    ...(changed
      ? {
          ...closedDetails,
          filters: { ...defaultFilters, models: [...defaultFilters.models] },
          error: null,
        }
      : {}),
  };
}
