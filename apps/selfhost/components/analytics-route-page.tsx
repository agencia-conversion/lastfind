import { OwnerWelcome } from './lastfind/owner-welcome';
import { AdminClassifiers } from '@/components/admin/admin-classifiers';
import { AdminOverview } from '@/components/admin/admin-overview';
import { AdminProviders } from '@/components/admin/admin-providers';
import { AdminUsage } from '@/components/admin/admin-usage';
import { redirect } from 'next/navigation';
import { currentSetupStage } from '@edition/server/setup';
import { ConnectPage, connectQuery } from '@/components/lastfind/connect-page';
import {
  AppRootPage as RootPage,
  AnalyticsRoutePage as RoutePage,
  type AnalyticsSearchParams,
} from '@/components/analytics/route-page';
export {
  analyticsMetadata,
  type AnalyticsSearchParams,
} from '@/components/analytics/route-page';

/** The owner administers the installation: health, usage, provider keys and the classifiers' models. */
const adminPanel = () => [
  { id: 'overview' as const, content: <AdminOverview /> },
  { id: 'usage' as const, content: <AdminUsage /> },
  { id: 'providers' as const, content: <AdminProviders /> },
  { id: 'classifiers' as const, content: <AdminClassifiers /> },
];
/**
 * First run: until the setup wizard is finished (lib/setup-state.ts), every app address opens it instead (/app/setup), signed in
 * or not; it creates the admin, so it comes before the sign-in. Once finished, nothing more is read (server/setup.ts).
 */
async function setupFirst() {
  if ((await currentSetupStage()) !== 'done') redirect('/app/setup');
}
export async function AppRootPage(
  props: Omit<Parameters<typeof RootPage>[0], 'welcome'>,
) {
  await setupFirst();
  return <RootPage {...props} welcome={<OwnerWelcome />} adminPanel={adminPanel} />;
}
export async function AnalyticsRoutePage(
  props: Omit<Parameters<typeof RoutePage>[0], 'welcome'>,
) {
  await setupFirst();
  return <RoutePage {...props} welcome={<OwnerWelcome />} adminPanel={adminPanel} />;
}

/** `/app/connect` (OAuth consent): the owner signs in with the access key, then sees the request. */
export async function ConnectRoutePage({ searchParams }: { searchParams: Promise<AnalyticsSearchParams> }) {
  return <ConnectPage query={connectQuery(await searchParams)} signIn={<OwnerWelcome />} />;
}
