'use client';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

// The only note/legend: a short line under a table, chart or list, with the
// card's own inset (never flush against the border), an optional icon and one
// action. `tone="danger"` is for a failed read and announces itself.
export function Note({
  children,
  icon,
  action,
  tone = 'muted',
  status,
  className,
  ...rest
}: {
  children: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: 'muted' | 'danger';
  /** A progress or result message the page announces politely (renders an `output`). */
  status?: boolean;
  className?: string;
} & Pick<ComponentProps<'div'>, 'aria-busy'> & { 'data-testid'?: string }) {
  const Root = status ? 'output' : 'div';
  return (
    <Root
      role={status ? undefined : tone === 'danger' ? 'alert' : 'note'}
      data-slot="note"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 text-body',
        tone === 'danger' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
      {...rest}
    >
      {icon && <span className="flex-none" aria-hidden="true">{icon}</span>}
      <p className="min-w-0 flex-1 basis-56">{children}</p>
      {action}
    </Root>
  );
}
