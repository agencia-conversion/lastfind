'use client';
import type { ReactNode } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionHeader } from './section-header';

/** `padded` insets the body like the header (text and lists); `none` lets a table or chart go edge to edge. */
const sectionBodyVariants = cva('', { variants: { inset: { none: '', padded: 'px-5 pb-5' } }, defaultVariants: { inset: 'none' } });

// The only panel shell of the app (docs/design/shell.md section 7): a bordered card with a SectionHeader and the content
// (chart, table, list). Every screen composes this instead of re-declaring the border, radius and header spacing.
export function SectionCard({
  id,
  title,
  description,
  info,
  action,
  titleId,
  className,
  inset,
  loading = false,
  lines = 3,
  children,
}: {
  /** Anchor of the card, for a link that lands on it. */
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  info?: string;
  action?: ReactNode;
  /** Id of the title, so the section is a named landmark. */
  titleId?: string;
  className?: string;
  inset?: 'none' | 'padded';
  /** The data is on its way: the same card, its title (or a placeholder) and `lines` placeholders in the body. */
  loading?: boolean;
  lines?: number;
  children?: ReactNode;
}) {
  const body = inset ?? (loading ? 'padded' : 'none');
  const content = loading ? (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => <Skeleton key={index} className={index % 2 ? 'h-(--control-height) w-full' : 'h-4 w-2/3'} />)}
    </div>
  ) : (
    children
  );
  const heading = title ?? (loading ? <Skeleton inline className="h-lh w-40 max-w-full align-top" /> : undefined);
  return (
    <section id={id} className={cn('analytics-panel', className)} aria-labelledby={title ? titleId : undefined} aria-busy={loading || undefined}>
      {(heading || description || action) && (
        <SectionHeader title={heading} description={description} info={info} action={action} titleId={titleId} />
      )}
      {body === 'padded' ? <div className={sectionBodyVariants({ inset: body })}>{content}</div> : content}
    </section>
  );
}
