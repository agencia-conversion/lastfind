import { notFound } from 'next/navigation';
import SelfhostDocs from '../docs-client';
import { selfhostDocsSections } from '../selfhost-docs';

type Params = { section: string };

export default async function DocsSection({ params }: { params: Promise<Params> }) {
  const { section } = await params;
  if (!selfhostDocsSections((en) => en).some((s) => s.id === section)) notFound();
  return <SelfhostDocs section={section} />;
}
