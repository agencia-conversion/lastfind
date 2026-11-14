'use client';

import { Progress } from '@/components/ui/progress';
import { useI18n } from '@/lib/i18n';
import { creditsFormat, usageMeter } from '@/lib/usage-meter';

export type UsageRow = {
  key: string;
  label: string;
  used: number | undefined;
  // null is unlimited; undefined is unknown/loading.
  limit: number | null | undefined;
  /** How used and limit are written (default: plain numbers); money for a budget. */
  format?: (value: number) => string;
  /** AI credits: whole numbers (left rounded down, used rounded up), however many decimals the ledger keeps. */
  credits?: boolean;
  /** Says what is left of the limit (a balance) instead of what was used. */
  left?: boolean;
};

export function UsageMeterRow({ row }: { row: UsageRow }) {
  const { locale } = useI18n();
  const left = !!row.left && row.limit !== null;
  const meter = usageMeter(row.used, row.limit, locale, row.format ?? (row.credits ? creditsFormat(locale, left ? 'left' : 'used') : undefined), { left });
  const color =
    meter.state === 'reached'
      ? '[&_[data-slot=progress-indicator]]:bg-destructive'
      : meter.state === 'warning'
        ? '[&_[data-slot=progress-indicator]]:bg-warning'
        : '';
  return (
    <div className="grid min-w-0 gap-1.5" data-usage-state={meter.state}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
        <span>{row.label}</span>
        <span className="ml-auto whitespace-nowrap tabular-nums">
          {meter.text}
        </span>
      </div>
      {meter.value !== undefined && (
        <Progress
          aria-label={`${row.label}: ${meter.text.replace(' / ', locale === 'pt-BR' ? ' de ' : ' of ')}`}
          value={meter.value}
          className={color}
        />
      )}
      {meter.state === 'unlimited' && (
        <div aria-hidden="true" className="h-1 rounded-full bg-muted" />
      )}
    </div>
  );
}
