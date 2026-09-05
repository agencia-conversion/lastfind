import { cookies } from 'next/headers';
import { workspace } from '@/lib/server/workspace';
import { currentUser, requireUser } from '@/lib/server/auth';
import { WorkspaceApp } from '@/components/lastfind/workspace-app';
import { OwnerWelcome } from '@edition/components/lastfind/owner-welcome';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workspace' };
export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; project?: string }>;
}) {
  const query = await searchParams;
  if (!(await currentUser())) return <OwnerWelcome />;
  return (
    <WorkspaceApp
      initialData={await workspace(await requireUser(), query.project)}
      initialTab={query.tab}
      initialSidebarOpen={
        (await cookies()).get('sidebar_state')?.value !== 'false'
      }
    />
  );
}
