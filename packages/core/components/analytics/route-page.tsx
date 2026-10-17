import { notFound, redirect } from 'next/navigation';
import { LiveAnalyticsApp } from '@/components/analytics/live-app';
import { parseAnalyticsRoute } from '@/components/analytics/routes';
import { currentUser } from '@/lib/server/auth';
import { semanticEvaluationAvailable } from '@/lib/server/capabilities';
import type { ReactNode } from 'react';

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

export async function LegacyAnalyticsPage({
  searchParams,
  welcome,
  billingPanel,
}: {
  searchParams: Promise<AnalyticsSearchParams>;
  welcome: ReactNode;
  billingPanel?: ReactNode;
}) {
  const user = await currentUser();
  if (!user) return welcome;
  return (
    <LiveAnalyticsApp
      initialSearch={searchEntries(await searchParams).toString()}
      semanticEvaluationAvailable={semanticEvaluationAvailable}
      billingPanel={billingPanel}
    />
  );
}

export async function AnalyticsRoutePage({
  params,
  searchParams,
  welcome,
  billingPanel,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<AnalyticsSearchParams>;
  welcome: ReactNode;
  billingPanel?: ReactNode;
}) {
  // This edition guard applies to every owner route, including direct links.
  const user = await currentUser();
  if (!user) return welcome;
  const { path } = await params;
  const route = parseAnalyticsRoute(`/app/${path.map(encodeURIComponent).join('/')}`);
  if (!route) notFound();
  return (
    <LiveAnalyticsApp
      initialPath={path}
      initialSearch={searchEntries(await searchParams).toString()}
      semanticEvaluationAvailable={semanticEvaluationAvailable}
      billingPanel={billingPanel}
    />
  );
}

// `/app/preview` was a second, mock copy of the app. Its URLs now open the same
// product screens: the real demo (`/demo`, Cloud) or the owner sign-in (`/app`,
// selfhost, which has no public demo). Section, period and the old `?tab=`
// links are carried over so no earlier link breaks.
const legacySections: Record<string, string> = {
  overview: 'overview',
  prompts: 'prompts',
  brands: 'competitors',
  competitors: 'competitors',
  sources: 'sources',
  models: 'models',
  chats: 'responses',
  history: 'responses',
  'semantic-branding': 'semantic-branding',
};

export function legacyPreviewRedirect({
  target,
  path = [],
  searchParams,
}: {
  target: '/demo' | '/app';
  path?: string[];
  searchParams: AnalyticsSearchParams;
}): never {
  if (target === '/app') redirect('/app');
  const query = searchEntries(searchParams);
  let section = path[0] === 'workspaces' && path[2] === 'projects' ? path[4] : query.get('tab');
  if (path[0] === 'workspaces' && path[2] === 'settings') section = 'settings';
  const next = new URLSearchParams();
  const tab = section === 'settings' ? 'settings' : legacySections[section ?? ''];
  if (tab && tab !== 'overview') next.set('tab', tab);
  const days = query.get('days');
  if (days && /^\d{1,3}$/.test(days)) next.set('days', days);
  const search = next.toString();
  redirect(search ? `/demo?${search}` : '/demo');
}
