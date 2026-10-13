import {
  analyticsMetadata,
  LegacyAnalyticsPage,
  type AnalyticsSearchParams,
} from '@edition/components/analytics-route-page';

export const dynamic = 'force-dynamic';
export const metadata = {
  ...analyticsMetadata,
  title: 'Lastfind · UI preview',
};
// Public preview contains only synthetic fixtures; authenticated APIs remain private.
export default function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  return (
    <LegacyAnalyticsPage base="/app/preview" searchParams={searchParams} />
  );
}
