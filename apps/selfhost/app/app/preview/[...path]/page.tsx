import {
  legacyPreviewRedirect,
  type AnalyticsSearchParams,
} from '@edition/components/analytics-route-page';

export const dynamic = 'force-dynamic';

export default async function PreviewSectionPage(props: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  legacyPreviewRedirect({
    target: '/app',
    path: (await props.params).path,
    searchParams: await props.searchParams,
  });
}
