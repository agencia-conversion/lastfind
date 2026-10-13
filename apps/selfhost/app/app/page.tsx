import {
  analyticsMetadata,
  LegacyAnalyticsPage,
  type AnalyticsSearchParams,
} from '@edition/components/analytics-route-page';
export const dynamic = 'force-dynamic';
export const metadata = analyticsMetadata;
export default function AppPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  return <LegacyAnalyticsPage base="/app" searchParams={searchParams} />;
}
