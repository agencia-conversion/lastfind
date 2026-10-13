'use client';
import { useEffect, useRef, useState, type SetStateAction } from 'react';
import {
  demoResponses,
  type DemoFilters,
  type DemoPrompt,
  type DemoResponse,
} from './demo-data';
import { buildAnalyticsPath, promptKey, routeForProject } from './routes';
import {
  createDemoSession,
  type DemoSession,
  type DemoUser,
  type SettingsSection,
} from './workspace-data';
import {
  analyticsLocation,
  changeNavigationSession,
  closedDetails,
  currentContext,
  normalizeTab,
  openPromptNavigation,
  resolveAnalyticsLocation,
  type AnalyticsNavigation,
} from './navigation-state';

export function useAnalyticsNavigation(initial: {
  authenticatedUser?: Pick<DemoUser, 'id' | 'name' | 'email'>;
  initialPath?: string;
  initialSearch?: string;
  initialTab?: string;
  initialPromptId?: string;
}) {
  const [state, setState] = useState(() => {
    const session = createDemoSession(initial.authenticatedUser);
    const { workspace, project } = currentContext(session);
    const prompt = project.prompts.find(
      (p) => p.id === initial.initialPromptId,
    );
    const fallback = buildAnalyticsPath({
      ...routeForProject(
        '/app/preview',
        workspace,
        project,
        prompt ? 'overview' : normalizeTab(initial.initialTab),
      ),
      promptKey: prompt ? promptKey(prompt) : undefined,
    });
    return resolveAnalyticsLocation(
      session,
      initial.initialPath ?? fallback,
      initial.initialSearch,
    );
  });
  const historyMode = useRef<'push' | 'replace'>('replace');
  const latest = useRef(state);
  const change = (
    update: (previous: AnalyticsNavigation) => AnalyticsNavigation,
    mode: 'push' | 'replace' = 'push',
  ) => {
    historyMode.current = mode;
    setState(update);
  };
  useEffect(() => {
    latest.current = state;
    if (state.error) return;
    const destination = analyticsLocation(state);
    if (window.location.pathname + window.location.search !== destination) {
      if (historyMode.current === 'push')
        window.history.pushState(null, '', destination);
      else window.history.replaceState(null, '', destination);
    }
    historyMode.current = 'replace';
  }, [state]);
  useEffect(() => {
    const onPop = () => {
      const next = resolveAnalyticsLocation(
        latest.current.session,
        window.location.pathname,
        window.location.search,
      );
      if (next.base !== latest.current.base) {
        window.location.reload();
        return;
      }
      historyMode.current = 'replace';
      setState(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const { project } = currentContext(state.session);
  return {
    tab: state.tab,
    session: state.session,
    filters: state.filters,
    settingsSection: state.settingsSection,
    semanticSection: state.semanticSection,
    setSemanticSection: (semanticSection: string) =>
      change((previous) => ({ ...previous, semanticSection })),
    routeError: state.error,
    selectedPrompt:
      project.prompts.find((p) => p.id === state.promptId) ?? null,
    selectedBrand: state.brandId,
    selectedChat: demoResponses.find((r) => r.id === state.chatId) ?? null,
    selectedDomain: state.sourceDomain,
    hrefForTab: (tab: string, settingsSection = state.settingsSection) =>
      analyticsLocation({
        ...state,
        ...closedDetails,
        tab: normalizeTab(tab),
        settingsSection,
      }),
    navigate: (tab: string) =>
      change((s) => ({
        ...s,
        ...closedDetails,
        tab: normalizeTab(tab),
        error: null,
      })),
    setSession: (next: SetStateAction<DemoSession>) =>
      change((s) =>
        changeNavigationSession(
          s,
          typeof next === 'function' ? next(s.session) : next,
        ),
      ),
    setFilters: (next: SetStateAction<DemoFilters>) =>
      change(
        (s) => ({
          ...s,
          filters: typeof next === 'function' ? next(s.filters) : next,
        }),
        'replace',
      ),
    setSettingsSection: (settingsSection: SettingsSection) =>
      change((s) => ({
        ...s,
        ...closedDetails,
        tab: 'settings',
        settingsSection,
        error: null,
      })),
    openPrompt: (prompt: DemoPrompt) =>
      change((s) => openPromptNavigation(s, prompt.id)),
    setSelectedBrand: (brandId: string | null) =>
      change((s) =>
        brandId
          ? { ...s, ...closedDetails, brandId, tab: 'competitors', error: null }
          : { ...s, brandId: null },
      ),
    setSelectedChat: (chat: DemoResponse | null) =>
      change((s) =>
        chat
          ? {
              ...s,
              ...closedDetails,
              chatId: chat.id,
              tab: 'chats',
              error: null,
            }
          : { ...s, chatId: null },
      ),
    setSelectedDomain: (sourceDomain: string | null) =>
      change((s) =>
        sourceDomain
          ? {
              ...s,
              ...closedDetails,
              sourceDomain,
              tab: 'sources',
              error: null,
            }
          : { ...s, sourceDomain: null },
      ),
  };
}
