'use client';
import type { ComponentProps, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Hint } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import './tag-badge.css';

export type TagTone = 'neutral' | 'primary' | 'danger' | 'success' | 'warning' | 'quiet' | 'muted' | 'outline';

// The only badge/chip of the screens: the catalog Badge in one of its `tone`s (ui/badge.tsx), with an optional colour dot
// and its `title` in the dark balloon (Hint). tag-badge.css only adds the pressed and touch states of a button badge.
export function TagBadge({
  children,
  tone = 'neutral',
  dotColor,
  title,
  className,
  render,
  touch,
}: {
  children: ReactNode;
  tone?: TagTone;
  dotColor?: string;
  title?: string;
  className?: string;
  render?: ComponentProps<typeof Badge>['render'];
  /**
   * A button badge in a dense row (a single-line table cell): its touch target reaches 40 px without growing the row. Keep it
   * out of a parent that clips (overflow hidden), which would cut the target and the focus ring.
   */
  touch?: boolean;
}) {
  const badge = (
    <Badge render={render} variant="outline" tone={tone} data-tone={tone} data-touch={touch || undefined} className={cn('tag-badge', className)}>
      {dotColor && <i className="size-2 shrink-0 rounded-full" style={{ background: dotColor }} aria-hidden="true" />}
      {children}
    </Badge>
  );
  return title ? <Hint text={title}>{badge}</Hint> : badge;
}
