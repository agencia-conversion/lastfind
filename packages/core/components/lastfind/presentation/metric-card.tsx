'use client';
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// One metric: label (with icon and definition tooltip), value (24/32, 600),
// a one-line explanation and, when comparable, the change against the previous
// period. A missing value is the caller's `—`, never a zero.
export function MetricCard({
  label,
  value,
  icon,
  definition,
  description,
  change,
  highlight,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  /** Plain-text definition, shown in a tooltip and read by screen readers. */
  definition?: string;
  description?: ReactNode;
  change?: ReactNode;
  highlight?: boolean;
}) {
  return (
    <article className={cn('metric-summary', highlight && 'metric-summary-highlight')}>
      <div className="metric-label">
        {icon}
        <span>{label}</span>
        {definition && (
          <Tooltip>
            <TooltipTrigger render={<button type="button" aria-label={definition} className="metric-help" />}>
              <Info size={12} />
            </TooltipTrigger>
            <TooltipContent className="max-w-60">{definition}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="metric-number">{value}</div>
      {description && <p>{description}</p>}
      {change && <p className="metric-change-note">{change}</p>}
    </article>
  );
}

// Continuous strip of metrics divided by internal borders (stacked on narrow screens).
export function MetricGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="metric-strip" role={label ? 'group' : undefined} aria-label={label}>
      {children}
    </div>
  );
}
