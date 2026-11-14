'use client';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoHint } from './info-hint';

/** The value of a metric that is still loading: it holds the value line, so the card keeps its height. */
export function MetricValueSkeleton() {
  // Busy, so a print (qa:pr) waits for the figure instead of taking the placeholder for an unexplained blank.
  return <Skeleton aria-busy="true" className="h-lh w-16" />;
}

/**
 * A strip of `count` cards still loading, in the place and size of the strip that arrives
 * (`description`: those cards carry a line of text under the value).
 */
/** `description`: a description line under each value, or that many lines (a screen whose cards describe in two lines). */
export function MetricGridSkeleton({ count, label, description }: { count: number; label?: string; description?: boolean | number }) {
  return (
    <MetricGrid columns={count} mobilePairs label={label}>
      {Array.from({ length: count }, (_, index) => (
        <MetricCard
          key={index}
          label={<Skeleton inline className="h-lh w-28 max-w-full align-top" />}
          value={<MetricValueSkeleton />}
          description={description ? Array.from({ length: Number(description) }, (_, line) => <Skeleton key={line} inline className={`block h-lh max-w-full ${line ? 'w-24' : 'w-40'}`} />) : undefined}
        />
      ))}
    </MetricGrid>
  );
}

// One metric: label (with icon and the conceptual definition in an info
// tooltip), value (24/32) with its change against the previous period beside it
// (`delta`: just the figure, e.g. "+6.6 pp", never a sentence). `description`
// and `change` are the optional text lines of screens that still show them.
// `rows` breaks the value down (e.g. one line per model) under it. A missing
// value is the caller's `—`, never a zero.
export function MetricCard({
  label,
  value,
  icon,
  definition,
  delta,
  description,
  change,
  rows,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  /** Plain-text definition, shown in a tooltip and read by screen readers. */
  definition?: string;
  delta?: ReactNode;
  description?: ReactNode;
  change?: ReactNode;
  rows?: { key: string; icon?: ReactNode; label: string; value: ReactNode }[];
}) {
  return (
    <article className="metric-summary">
      <div className="metric-label">
        {icon}
        <span>{label}</span>
        {definition && <InfoHint text={definition} />}
      </div>
      <div className="metric-number">
        {value}
        {delta}
      </div>
      {description && <p>{description}</p>}
      {change && <p className="metric-change-note">{change}</p>}
      {rows?.length ? (
        <dl className="metric-rows">
          {rows.map((row) => (
            <div key={row.key}>
              <dt>
                {row.icon}
                {row.label}
              </dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

// Continuous strip of metrics divided by internal borders. `columns` is how
// many fit on one line (the number of cards). Narrow screens stack them,
// or with `mobilePairs` show two per row (an odd last card takes the full row).
export function MetricGrid({ children, label, columns = 3, mobilePairs }: { children: ReactNode; label?: string; columns?: number; mobilePairs?: boolean }) {
  return (
    <div
      className={cn('metric-strip', columns === 4 && 'metric-strip-four', mobilePairs && 'metric-strip-pairs')}
      style={columns === 3 || columns === 4 ? undefined : ({ '--metric-cols': columns } as CSSProperties)}
      data-columns={columns}
      role={label ? 'group' : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}
