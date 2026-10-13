'use client';
import { useI18n } from '@/lib/i18n';
import { ArrowUpRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { EngineBadge } from '../identity-icons';
import { StatusBadge } from './status-badge';
import type { Run } from '@/lib/types';

// Dense investigative response history table shared by Overview's "Recent
// responses" panel and the full Responses tab. Extracted from
// workspace-app.tsx's inline `ResponseTable` helper.
export function ResponseTable({
  runs,
  onOpen,
}: {
  runs: Run[];
  onOpen: (r: Run) => void;
}) {
  const { t, locale } = useI18n();
  const dateTime = (date: string) =>
    new Date(date).toLocaleString(locale, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }) + ' BRT';
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>PROMPT</TableHead>
          <TableHead>{t('MOTOR')}</TableHead>
          <TableHead>{t('SUA MARCA')}</TableHead>
          <TableHead>{t('COLETA')}</TableHead>
          <TableHead>{t('DATA')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('Abrir')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="prompt-cell">
              <Button
                type="button"
                variant="ghost"
                className="prompt-question response-open h-auto rounded-none p-0 whitespace-normal text-left"
                onClick={() => onOpen(r)}
              >
                {r.prompt_text}
              </Button>
            </TableCell>
            <TableCell>
              <EngineBadge engine={r.engine} />
            </TableCell>
            <TableCell>
              {r.status === 'complete' ? (
                <span
                  className={`mention-tag ${r.mentions[r.brand_name] ? 'mentioned' : ''}`}
                >
                  {r.mentions[r.brand_name] ? <Check size={12} /> : null}
                  {r.mentions[r.brand_name]
                    ? t('Mencionada')
                    : t('Não mencionada')}
                </span>
              ) : (
                <span className="muted">—</span>
              )}
            </TableCell>
            <TableCell>
              <StatusBadge status={r.status} />
            </TableCell>
            <TableCell className="date-cell">{dateTime(r.created_at)}</TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('Ver resposta')}
                onClick={() => onOpen(r)}
              >
                <ArrowUpRight />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
