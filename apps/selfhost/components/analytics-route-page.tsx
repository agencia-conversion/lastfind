import { OwnerWelcome } from './lastfind/owner-welcome';
import {
  LegacyAnalyticsPage as LegacyPage,
  AnalyticsRoutePage as RoutePage,
} from '@/components/analytics/route-page';
export {
  analyticsMetadata,
  type AnalyticsSearchParams,
} from '@/components/analytics/route-page';
export function LegacyAnalyticsPage(
  props: Omit<Parameters<typeof LegacyPage>[0], 'welcome'>,
) {
  return <LegacyPage {...props} welcome={<OwnerWelcome />} />;
}
export function AnalyticsRoutePage(
  props: Omit<Parameters<typeof RoutePage>[0], 'welcome'>,
) {
  return <RoutePage {...props} welcome={<OwnerWelcome />} />;
}
