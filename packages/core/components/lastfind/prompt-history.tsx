'use client';
import { useI18n } from '@/lib/i18n';
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useReport } from '@/hooks/use-report';
import type { HistoryPage } from '@/lib/report-types';
import type { Run, Prompt } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
export function PromptHistory({
  reportBase,
  prompt,
  onOpen,
}: {
  reportBase: string;
  prompt: Prompt;
  onOpen: (r: Run) => void;
}) {
  const { t, formatTime: formatMonitoringTime } = useI18n();
  const [cursors, setCursors] = useState<(string | null)[]>([null]),
    [page, setPage] = useState(0),
    [part, setPart] = useState(0);
  const { data, error, loading } = useReport<HistoryPage>(
    `${reportBase}&view=history&prompt=${encodeURIComponent(prompt.id)}&cursor=${encodeURIComponent(cursors[page] || '')}`,
  );
  if (loading) return <Skeleton className="h-40" />;
  return (
    <div className="prompt-history-list">
      {error && <p role="alert">{error}</p>}
      {data?.runs.slice(part * 5, part * 5 + 5).map((r) => (
        <button key={r.id} onClick={() => onOpen(r)}>
          <span>
            {formatMonitoringTime(r.created_at)}
            <small>
              {r.status === 'complete'
                ? r.mentions[r.brand_name]
                  ? t('Sua marca foi mencionada')
                  : t('Sua marca não foi mencionada')
                : r.status === 'failed'
                  ? t('Coleta sem resposta')
                  : t('Coleta em andamento')}
            </small>
          </span>
          <span>
            {r.source_count ?? 0} {t('citações')}
            <ArrowUpRight size={16} />
          </span>
        </button>
      ))}
      {data && !data.runs.length && (
        <p>
          {t('Nenhuma coleta neste período. Próxima prevista:')}{' '}
          {formatMonitoringTime(prompt.next_run_at)}
          {t('(Brasília).')}
        </p>
      )}
      {(page > 0 || (data?.runs.length ?? 0) > 5 || data?.nextCursor) && (
        <div className="table-pagination">
          <Button
            variant="outline"
            disabled={!page && !part}
            onClick={() => {
              if (part) setPart(part - 1);
              else {
                setPage(page - 1);
                setPart(4);
              }
            }}
          >
            {t('Anterior')}
          </Button>
          <span>
            {t('Página')} {page * 5 + part + 1}
          </span>
          <Button
            variant="outline"
            disabled={
              !data?.nextCursor && (part + 1) * 5 >= (data?.runs.length ?? 0)
            }
            onClick={() => {
              if ((part + 1) * 5 < (data?.runs.length ?? 0)) {
                setPart(part + 1);
                return;
              }
              setPart(0);
              setCursors((c) => [
                ...c.slice(0, page + 1),
                data?.nextCursor ?? null,
              ]);
              setPage((p) => p + 1);
            }}
          >
            {t('Próxima')}
          </Button>
        </div>
      )}
    </div>
  );
}
