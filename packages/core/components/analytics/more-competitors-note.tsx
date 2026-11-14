'use client';
import { Button } from '@/components/ui/button';
import { Note } from '@/components/lastfind/presentation/note';
import { navIcons } from './nav-icons';

/** Below this many monitored competitors the comparison is thin: the Overview invites adding more. */
export const RICH_REPORT_COMPETITORS = 5;

/** Brand ranking footer: a friendly invitation (not a count of what is hidden) to monitor the brands found in the answers. */
export function MoreCompetitorsNote({
  competitors,
  discovered,
  onAdd,
  t,
}: {
  /** Competitors the project monitors. */
  competitors: number;
  /** Whether the answers mention brands the project does not monitor yet. */
  discovered: boolean;
  /** Opens the discovered brands; absent where the reader cannot change the project (demo). */
  onAdd?: () => void;
  t: (en: string, pt: string) => string;
}) {
  if (competitors >= RICH_REPORT_COMPETITORS || !discovered) return null;
  return (
    <Note
      icon={<navIcons.competitors size={15} />}
      action={
        onAdd && (
          <Button variant="outline" onClick={onAdd}>
            {t('Add competitors', 'Adicionar concorrentes')}
          </Button>
        )
      }
    >
      {t(
        `Monitor at least ${RICH_REPORT_COMPETITORS} competitors for a richer report. Your answers mention other brands you can add.`,
        `Monitore pelo menos ${RICH_REPORT_COMPETITORS} concorrentes para um relatório mais completo. As respostas citam outras marcas que você pode adicionar.`,
      )}
    </Note>
  );
}
