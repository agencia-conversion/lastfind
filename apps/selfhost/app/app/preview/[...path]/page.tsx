import {
  analyticsMetadata,
  AnalyticsRoutePage,
  type AnalyticsSearchParams,
} from '@edition/components/analytics-route-page';

export const dynamic = 'force-dynamic';
export const metadata = {
  ...analyticsMetadata,
  title: 'Lastfind · UI preview',
};

export default function PreviewSectionPage(props: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  return <AnalyticsRoutePage base="/app/preview" {...props} />;
}
