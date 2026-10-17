import {
  legacyPreviewRedirect,
  type AnalyticsSearchParams,
} from '@edition/components/analytics-route-page';

export const dynamic = 'force-dynamic';

// The old mock copy of the app was removed; its URL opens the owner sign-in.
export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  legacyPreviewRedirect({ target: '/app', searchParams: await searchParams });
}
