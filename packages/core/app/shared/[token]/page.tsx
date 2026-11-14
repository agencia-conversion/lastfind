import { notFound } from 'next/navigation';
import { sharedArtifact } from '@/lib/server/agent';
import { AgentSharedArtifact } from '@/components/analytics/agent-screen';

// An artifact shared by link (Agent > Artifacts): the document alone, for anyone with the link, never indexed.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lastfind', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function SharedArtifactPage({ params }: { params: Promise<{ token: string }> }) {
  const artifact = await sharedArtifact((await params).token).catch(() => null);
  if (!artifact) notFound();
  return <AgentSharedArtifact artifact={artifact} />;
}
