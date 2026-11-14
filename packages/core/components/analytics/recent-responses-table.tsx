'use client';
import { EngineIcon } from '@/components/lastfind/identity-icons';
import { DataTable } from '@/components/lastfind/presentation/data-table';
import { Hint } from '@/components/ui/tooltip';
import { ENGINE_LABELS } from '@/lib/engines';
import { relativeReportDate } from '@/lib/report-date';
import type { Run } from '@/lib/types';
import type { Linker } from './drill-link';
import { EmptyState } from './shared';

/** Rows the Overview shows; "View all" opens the full list. */
export const RECENT_RESPONSES_SHOWN = 10;

// Overview "Recent responses": the analytic table, sortable, the whole row opens the answer.
export function RecentResponsesTable({
  state,
  runs,
  link,
  locale,
  t,
}: {
  state: 'loading' | 'failed' | 'ready';
  runs: Run[];
  link: Linker;
  locale: string;
  t: (en: string, pt: string) => string;
}) {
  if (state === 'failed')
    return <EmptyState frame="inline" tone="error" title={t('Could not load recent responses.', 'Não foi possível carregar as respostas recentes.')} />;
  if (state === 'ready' && !runs.length)
    return <EmptyState frame="inline" title={t('No responses in this period.', 'Sem respostas neste período.')} />;
  // Loading: the same table with its header and placeholder rows, so nothing moves when the answers arrive.
  return (
    <DataTable
      rows={state === 'ready' ? runs.slice(0, RECENT_RESPONSES_SHOWN) : []}
      loading={state === 'loading' ? 5 : undefined}
      rowKey={(run) => run.id}
      singleLine
      // Model and date take the width of their content; the prompt takes the rest and truncates at the edge of its column
      // (CSS ellipsis, full text on hover), keeping the cell padding.
      className="min-w-0!"
      ariaLabel={t('Recent responses', 'Respostas recentes')}
      defaultSort={{ key: 'date', direction: 'desc' }}
      rowLink={(run) => link({ tab: 'responses', run: run.id })}
      columns={[
        {
          key: 'prompt',
          header: t('Prompt', 'Prompt'),
          // A phone's card shows it whole (DataTable stacks a single-line list with a name column there).
          mobile: 'title',
          cellClassName: 'max-w-0',
          sortValue: (run) => run.prompt_text,
          cell: (run) => <Hint text={run.prompt_text}><span className="block truncate">{run.prompt_text}</span></Hint>,
        },
        {
          key: 'model',
          header: t('Model', 'Modelo'),
          label: t('Model', 'Modelo'),
          headerClassName: 'hidden w-px whitespace-nowrap sm:table-cell',
          cellClassName: 'hidden sm:table-cell',
          sortValue: (run) => ENGINE_LABELS[run.engine],
          cell: (run) => (
            <span className="inline-flex min-w-max items-center gap-2">
              <EngineIcon engine={run.engine} />
              {ENGINE_LABELS[run.engine]}
            </span>
          ),
        },
        {
          key: 'date',
          header: t('Date', 'Data'),
          label: t('Date', 'Data'),
          headerClassName: 'w-px whitespace-nowrap',
          align: 'end',
          sortValue: (run) => Date.parse(run.created_at),
          cell: (run) => (
            <Hint text={new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(run.created_at))}>
            <time
              dateTime={run.created_at}
            >
              {relativeReportDate(run.created_at, locale)}
            </time>
            </Hint>
          ),
        },
      ]}
    />
  );
}
