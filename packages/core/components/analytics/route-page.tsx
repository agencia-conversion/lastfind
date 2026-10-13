import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { AnalyticsApp } from '@/components/analytics/analytics-app';
import { LiveAnalyticsApp } from '@/components/analytics/live-app';
import { demoPrompts } from '@/components/analytics/demo-data';
import {
  buildAnalyticsPath,
  parseAnalyticsRoute,
  parseFilters,
  promptKey,
  serializeAnalyticsSearch,
  type AnalyticsRoute,
} from '@/components/analytics/routes';
import { createDemoSession } from '@/components/analytics/workspace-data';
import { currentUser } from '@/lib/server/auth';
import { semanticEvaluationAvailable } from '@/lib/server/capabilities';
import type { ReactNode } from 'react';

type RouteBase = '/app' | '/app/preview';
export type AnalyticsSearchParams = Record<
  string,
  string | string[] | undefined
>;

export const analyticsMetadata = {
  title: 'Lastfind · Analytics',
  robots: { index: false, follow: false },
};

function searchEntries(query: AnalyticsSearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) params.append(key, item);
    }
  }
  return params;
}

function filterSearch(query: AnalyticsSearchParams, tab: string) {
  return serializeAnalyticsSearch(
    parseFilters(searchEntries(query)),
    tab,
    first(query, 'view'),
  ).toString();
}

function first(query: AnalyticsSearchParams, key: string) {
  const value = query[key];
  return Array.isArray(value) ? value[0] : value;
}

function legacyRoute(base: RouteBase, query: AnalyticsSearchParams) {
  const session = createDemoSession();
  const workspaceKey = first(query, 'workspace');
  const projectKey = first(query, 'project');
  const workspace =
    session.workspaces.find((w) =>
      workspaceKey
        ? w.id === workspaceKey || w.slug === workspaceKey
        : projectKey
          ? w.projects.some((p) => p.id === projectKey || p.slug === projectKey)
          : w.id === session.workspaceId,
    ) ?? session.workspaces[0];
  const project =
    workspace.projects.find((p) =>
      projectKey
        ? p.id === projectKey || p.slug === projectKey
        : p.id === session.projectId,
    ) ?? workspace.projects[0];
  const knownWorkspace =
    !workspaceKey ||
    workspace.id === workspaceKey ||
    workspace.slug === workspaceKey;
  const knownProject =
    !projectKey || project.id === projectKey || project.slug === projectKey;
  const workspaceSlug = knownWorkspace ? workspace.slug : workspaceKey;
  const projectSlug = knownProject ? project.slug : projectKey;
  if (
    !workspaceSlug ||
    !projectSlug ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspaceSlug) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectSlug)
  )
    notFound();

  const requestedTab = first(query, 'tab') ?? 'overview';
  const tab =
    requestedTab === 'competitors'
      ? 'brands'
      : requestedTab === 'history'
        ? 'chats'
        : requestedTab;
  if (
    ![
      'overview',
      'prompts',
      'brands',
      'sources',
      'models',
      'chats',
      'settings',
      'onboarding',
      'semantic-branding',
    ].includes(tab)
  )
    notFound();
  if (tab === 'settings' && !knownProject) notFound();
  const route: AnalyticsRoute = {
    base,
    workspaceSlug,
    projectSlug,
    tab: tab === 'brands' ? 'competitors' : tab,
    ...(tab === 'settings' ? { settingsSection: 'workspace' } : {}),
  };
  const requestedPrompt = first(query, 'prompt');
  if (requestedPrompt && tab !== 'settings') {
    const prompt = demoPrompts.find((p) => p.id === requestedPrompt);
    route.tab = 'overview';
    if (
      !/^[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*$/.test(requestedPrompt) ||
      requestedPrompt.length > 180
    )
      notFound();
    route.promptKey = prompt
      ? promptKey(prompt)
      : `${requestedPrompt}-unavailable`;
  }
  return route;
}

export async function LegacyAnalyticsPage({
  base,
  searchParams,
  welcome,
}: {
  base: RouteBase;
  searchParams: Promise<AnalyticsSearchParams>;
  welcome: ReactNode;
}) {
  const user = base === '/app' ? await currentUser() : null;
  if (base === '/app' && !user) return welcome;
  if (user)
    return (
      <LiveAnalyticsApp
        initialSearch={searchEntries(await searchParams).toString()}
        semanticEvaluationAvailable={semanticEvaluationAvailable}
      />
    );
  const query = await searchParams;
  let pathname: string;
  try {
    pathname = buildAnalyticsPath(legacyRoute(base, query));
  } catch {
    notFound();
  }
  if (!parseAnalyticsRoute(pathname)) notFound();
  const search = filterSearch(query, parseAnalyticsRoute(pathname)!.tab);
  redirect(`${pathname}${search ? `?${search}` : ''}`);
}

export async function AnalyticsRoutePage({
  base,
  params,
  searchParams,
  welcome,
}: {
  base: RouteBase;
  params: Promise<{ path: string[] }>;
  searchParams: Promise<AnalyticsSearchParams>;
  welcome: ReactNode;
}) {
  // This edition guard applies to every owner route, including direct links.
  const user = base === '/app' ? await currentUser() : null;
  if (base === '/app' && !user) return welcome;
  const { path } = await params;
  const pathname = `${base}/${path.map(encodeURIComponent).join('/')}`;
  const route = parseAnalyticsRoute(pathname);
  if (!route || route.base !== base) notFound();
  if (user)
    return (
      <LiveAnalyticsApp
        initialPath={path}
        initialSearch={searchEntries(await searchParams).toString()}
        semanticEvaluationAvailable={semanticEvaluationAvailable}
      />
    );
  const canonicalPath = buildAnalyticsPath(route);
  const query = await searchParams;
  const search = filterSearch(query, route.tab);
  if (
    pathname !== canonicalPath ||
    searchEntries(query).toString() !== search
  ) {
    redirect(`${canonicalPath}${search ? `?${search}` : ''}`);
  }
  return (
    <AnalyticsApp
      key="preview"
      initialPath={canonicalPath}
      initialSearch={search}
      initialSidebarOpen={
        (await cookies()).get('sidebar_state')?.value !== 'false'
      }
    />
  );
}
