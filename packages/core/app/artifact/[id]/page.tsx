import { AgentArtifactPage } from '@/components/analytics/agent-screen';

// An artifact on its own page, without the app's navigation (Agent > Artifacts, "Open in a full page"): for the
// workspace's people only (the page asks the artifact's route, which checks the session), never indexed.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lastfind', robots: { index: false, follow: false } };

export default async function ArtifactPage({ params }: { params: Promise<{ id: string }> }) {
  return <AgentArtifactPage id={(await params).id} />;
}
