'use client';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SectionHeader } from './section-header';

// The only panel shell of the app: a bordered card with a SectionHeader and
// the content (chart, table, list). Every screen composes this instead of
// re-declaring the border, radius and header spacing.
export function SectionCard({
  title,
  description,
  action,
  titleId,
  className,
  padded = false,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Id of the title, so the section is a named landmark. */
  titleId?: string;
  className?: string;
  /** Inset the content like the header, for text and lists (tables and charts go edge to edge). */
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn('analytics-panel', className)} aria-labelledby={title ? titleId : undefined}>
      {(title || description || action) && (
        <SectionHeader title={title} description={description} action={action} titleId={titleId} />
      )}
      {padded ? <div className="px-5 pb-5">{children}</div> : children}
    </section>
  );
}
