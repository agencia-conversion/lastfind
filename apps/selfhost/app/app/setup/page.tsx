import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server/auth';
import { SetupWizard } from '@/components/admin/setup-wizard';
import { OwnerWelcome } from '@edition/components/lastfind/owner-welcome';
import { currentSetupStage } from '@edition/server/setup';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lastfind setup', robots: { index: false, follow: false } };

/** The first run (lib/setup-state.ts): the wizard until it is finished, then never again (the app opens instead). */
export default async function SetupPage() {
  const stage = await currentSetupStage();
  if (stage === 'done') redirect('/app');
  // The admin exists: only it finishes the setup, after signing in with its key.
  if (stage === 'setup' && !(await currentUser())) return <OwnerWelcome />;
  return <SetupWizard stage={stage} />;
}
