'use client';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { InfoHint } from './info-hint';

// The only header of a section/card/panel: section title (16/24, 600), optional
// info icon with the conceptual explanation, optional one-line description and
// an action on the right. Replaces the hand-written `.panel-title` and
// `.panel-heading` blocks.
export function SectionHeader({
  title,
  description,
  info,
  action,
  as: Heading = 'h2',
  titleId,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Plain-text explanation in a tooltip; keeps the card free of legend lines. */
  info?: string;
  action?: ReactNode;
  as?: 'h2' | 'h3';
  titleId?: string;
  className?: string;
}) {
  return (
    <div data-slot="section-header" className={cn('flex flex-wrap justify-between gap-x-3 gap-y-2 px-5 py-4', description ? 'items-start' : 'items-center', className)}>
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex items-center gap-2">
          <Heading id={titleId} data-slot="section-heading" className="text-section">{title}</Heading>
          {info && <InfoHint text={info} />}
        </div>
        {description && <p className="mt-1 text-body text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="max-w-full">{action}</div>}
    </div>
  );
}
