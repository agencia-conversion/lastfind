import { ConnectRoutePage, type AnalyticsSearchParams } from '@edition/components/analytics-route-page';
import { connectMetadata } from '@/components/lastfind/connect-page';

export const dynamic = 'force-dynamic';
export const metadata = connectMetadata;

export default function ConnectAppPage(props: { searchParams: Promise<AnalyticsSearchParams> }) {
  return <ConnectRoutePage {...props} />;
}
