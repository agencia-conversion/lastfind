import {
  analyticsMetadata,
  AnalyticsRoutePage,
  type AnalyticsSearchParams,
} from '@edition/components/analytics-route-page';

export const dynamic = 'force-dynamic';
export const metadata = analyticsMetadata;

export default function AppSectionPage(props: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  return <AnalyticsRoutePage {...props} />;
}
