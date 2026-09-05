'use client';

import { useState } from 'react';
import { ArrowUpRight, Info } from 'lucide-react';
import { useReport } from '@/hooks/use-report';
import { useI18n } from '@/lib/i18n';
import type {
  AnalysisReport,
  AnalysisRow,
  ReportDrilldown,
} from '@/lib/report-types';
import type { Engine } from '@/lib/engines';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EngineIcon } from './identity-icons';

/** Lazy aggregate view: no answer bodies and no external provider requests. */
export function AdvancedReport({
  reportBase,
  refresh,
  onDrilldown,
}: {
  reportBase: string;
  refresh: number | string;
  onDrilldown: (filters: ReportDrilldown) => void;
}) {
  const { locale } = useI18n();
  const pt = locale === 'pt-BR';
  const text = (en: string, br: string) => (pt ? br : en);
  const [group, setGroup] = useState('channels');
  const { data, error, loading } = useReport<AnalysisReport>(
    `${reportBase}&view=analysis`,
    refresh,
  );
  const rows: AnalysisRow[] =
    data?.[group as 'channels' | 'topics' | 'prompts'] || [];
  const hasMore =
    group === 'topics'
      ? data?.hasMoreTopics
      : group === 'prompts'
        ? data?.hasMorePrompts
        : false;
  const percent = (value: number) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`;
  const drilldown = (row: AnalysisRow): ReportDrilldown =>
    group === 'channels'
      ? { engine: row.key as Engine }
      : group === 'topics'
        ? { topic: row.key }
        : { prompt: row.key };
  return (
    <Card className="lf-advanced-report gap-0 overflow-hidden py-0 ring-1 ring-border/70">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">
            {text('Explore performance', 'Explorar desempenho')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {text(
              'Open a row to inspect the original answers.',
              'Abra uma linha para investigar as respostas originais.',
            )}
          </p>
        </div>
        <Tabs value={group} onValueChange={(value) => setGroup(String(value))}>
          <TabsList>
            <TabsTrigger value="channels">
              {text('Channels', 'Canais')}
            </TabsTrigger>
            <TabsTrigger value="topics">
              {text('Topics', 'Tópicos')}
            </TabsTrigger>
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {error ? (
        <p role="alert" className="p-5 text-sm text-destructive">
          {error}
        </p>
      ) : loading ? (
        <Skeleton className="m-5 h-48" />
      ) : rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">
                {group === 'channels'
                  ? text('Channel', 'Canal')
                  : group === 'topics'
                    ? text('Topic', 'Tópico')
                    : 'Prompt'}
              </TableHead>
              <TableHead className="text-right">
                {text('Answers', 'Respostas')}
              </TableHead>
              <TableHead className="text-right">
                {text('Visibility', 'Visibilidade')}
              </TableHead>
              <TableHead
                className="text-right"
                title={text(
                  'Answers mentioning another tracked brand but omitting yours.',
                  'Respostas que mencionam outra marca monitorada, mas omitem a sua.',
                )}
              >
                {text('Gaps', 'Oportunidades')}
              </TableHead>
              <TableHead
                className="text-right"
                title={text(
                  'Share of answers containing at least one citation.',
                  'Parcela de respostas com pelo menos uma citação.',
                )}
              >
                {text('With citations', 'Com citações')}
              </TableHead>
              <TableHead
                className="pr-5 text-right"
                title={text(
                  'Share of answers where the provider supplied consulted-source data, including an explicitly empty list.',
                  'Parcela de respostas em que o provedor informou dados de fontes consultadas, inclusive uma lista explicitamente vazia.',
                )}
              >
                {text('Consulted data', 'Dados de consulta')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="max-w-96 py-3 pl-5">
                  <button
                    type="button"
                    disabled={!row.attempts}
                    onClick={() => onDrilldown(drilldown(row))}
                    className="group flex w-full items-center gap-2 text-left disabled:cursor-default disabled:opacity-60"
                  >
                    {group === 'channels' && (
                      <EngineIcon engine={row.key as Engine} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {row.label || text('General', 'Geral')}
                      </span>
                      {(row.pending > 0 ||
                        row.failed > 0 ||
                        row.noAnswer > 0) && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {[
                            row.pending
                              ? `${row.pending} ${text('pending', 'pendentes')}`
                              : '',
                            row.failed
                              ? `${row.failed} ${text('failed / unknown', 'falhas / incertas')}`
                              : '',
                            row.noAnswer
                              ? `${row.noAnswer} ${text('without AI answer', 'sem resposta de IA')}`
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                    {!!row.attempts && (
                      <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                    )}
                  </button>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.responses.toLocaleString(locale)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.responses ? percent(row.visibility) : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.opportunities ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 tabular-nums"
                      onClick={() =>
                        onDrilldown({
                          ...drilldown(row),
                          gap: 'competitor-only',
                        })
                      }
                    >
                      {row.opportunities.toLocaleString(locale)}{' '}
                      <ArrowUpRight className="size-3" />
                    </Button>
                  ) : row.responses ? (
                    '0'
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.responses ? percent(row.citationCoverage) : '—'}
                </TableCell>
                <TableCell className="pr-5 text-right tabular-nums">
                  {row.responses ? percent(row.consultedCoverage) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          {text(
            'No answers match these filters yet.',
            'Ainda não há respostas para estes filtros.',
          )}
        </p>
      )}
      <div className="flex items-start gap-2 border-t bg-muted/20 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          {text(
            'Visibility uses completed AI answers. Gaps highlight answers that mention a competitor but omit your brand. Missing AI Overviews and failed tasks do not count as answers.',
            'A visibilidade usa respostas de IA concluídas. Oportunidades destacam respostas que mencionam um concorrente, mas omitem sua marca. AI Overviews ausentes e tarefas com falha não contam como respostas.',
          )}
          {hasMore &&
            ` ${text('Showing the 50 groups with the most gaps. Narrow the filters to explore more.', 'Exibindo os 50 grupos com mais oportunidades. Refine os filtros para explorar mais.')}`}
        </p>
      </div>
    </Card>
  );
}
