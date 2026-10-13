'use client';

import { useState } from 'react';
import { ChevronLeft, ArrowUpRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Run, Prompt } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { ResponseTable } from './presentation/response-table';

type DrilldownLevel = 'prompts' | 'responses';

type PromptMetric = {
  promptId: string;
  promptText: string;
  responses: number;
  mentions: number;
  visibility: number;
};

export function VisibilityDrilldown({
  open,
  onClose,
  prompts,
  runs,
  onOpenRun,
}: {
  open: boolean;
  onClose: () => void;
  prompts: Prompt[];
  runs: Run[];
  onOpenRun: (run: Run) => void;
}) {
  const { t, locale } = useI18n();
  const [level, setLevel] = useState<DrilldownLevel>('prompts');
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);

  // Calculate visibility metrics per prompt from runs
  // Match canonical calculation: only count complete runs with available responses
  const promptMetrics: PromptMetric[] = prompts.map((prompt) => {
    const promptRuns = runs.filter(
      (r) => r.prompt_id === prompt.id && r.status === 'complete' && r.response_available !== false,
    );
    // Count only runs where the own brand is mentioned (matches summarize() logic)
    const mentions = promptRuns.filter(
      (r) => r.mentions && r.mentions[r.brand_name],
    ).length;
    const responses = promptRuns.length;
    const visibility = responses > 0 ? (mentions / responses) * 100 : 0;

    return {
      promptId: prompt.id,
      promptText: prompt.text,
      responses,
      mentions,
      visibility,
    };
  }).filter((m) => m.responses > 0)
    .sort((a, b) => b.visibility - a.visibility);

  const selectedPromptRuns = selectedPromptId
    ? runs.filter(
        (r) => r.prompt_id === selectedPromptId && r.status === 'complete' && r.response_available !== false,
      )
    : [];

  const selectedPromptText = selectedPromptId
    ? prompts.find((p) => p.id === selectedPromptId)?.text ?? ''
    : '';

  const handleBack = () => {
    if (level === 'responses') {
      setLevel('prompts');
      setSelectedPromptId(null);
    } else {
      onClose();
    }
  };

  const handlePromptClick = (promptId: string) => {
    setSelectedPromptId(promptId);
    setLevel('responses');
  };

  const handleRunOpen = (run: Run) => {
    // Close the drilldown sheet before opening the response detail
    // to avoid overlapping modals
    handleOpenChange(false);
    onOpenRun(run);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset to prompts level when closing
      setLevel('prompts');
      setSelectedPromptId(null);
      onClose();
    }
  };

  const fmt = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="visibility-drilldown-sheet">
        <div className="visibility-drilldown-header">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleBack}
            aria-label={t('Voltar')}
            className="visibility-drilldown-back"
          >
            <ChevronLeft />
          </Button>
          <div>
            <SheetTitle>
              {level === 'prompts'
                ? t('Visibilidade por prompt')
                : selectedPromptText}
            </SheetTitle>
            <SheetDescription>
              {level === 'prompts'
                ? t('Prompts que compõem a métrica de visibilidade')
                : t('Respostas coletadas para este prompt')}
            </SheetDescription>
          </div>
        </div>

        {level === 'prompts' && (
          <div className="visibility-drilldown-content">
            {promptMetrics.length === 0 ? (
              <div className="visibility-drilldown-empty">
                <p>{t('Ainda não há respostas para calcular visibilidade.')}</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('PROMPT')}</TableHead>
                    <TableHead className="text-right">
                      {t('RESPOSTAS')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('MENÇÕES')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('VISIBILIDADE')}
                    </TableHead>
                    <TableHead>
                      <span className="sr-only">{t('Abrir')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {promptMetrics.map((metric) => (
                    <TableRow key={metric.promptId}>
                      <TableCell className="prompt-cell">
                        <Button
                          type="button"
                          variant="ghost"
                          className="prompt-question h-auto rounded-none p-0 whitespace-normal text-left"
                          onClick={() => handlePromptClick(metric.promptId)}
                        >
                          {metric.promptText}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {metric.responses.toLocaleString(locale)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {metric.mentions.toLocaleString(locale)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(metric.visibility)}%
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('Ver respostas')}
                          onClick={() => handlePromptClick(metric.promptId)}
                        >
                          <ArrowUpRight />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        {level === 'responses' && (
          <div className="visibility-drilldown-content">
            {selectedPromptRuns.length === 0 ? (
              <div className="visibility-drilldown-empty">
                <p>{t('Nenhuma resposta coletada para este prompt.')}</p>
              </div>
            ) : (
              <ResponseTable runs={selectedPromptRuns} onOpen={handleRunOpen} />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
