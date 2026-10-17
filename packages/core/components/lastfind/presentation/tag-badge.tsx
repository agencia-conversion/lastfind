'use client';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type TagTone = 'neutral' | 'primary' | 'danger' | 'quiet' | 'muted';

const tones: Record<TagTone, string> = {
  neutral: 'border-border bg-background text-foreground',
  primary: 'border-transparent bg-sidebar-accent text-primary',
  danger: 'border-transparent bg-destructive/10 text-destructive',
  quiet: 'border-dashed border-border bg-background text-muted-foreground',
  muted: 'border-border bg-background text-muted-foreground',
};

// The only badge/chip: 12px, weight 500, optional colour dot. The label always
// names the state; colour alone never carries meaning. Built on the shadcn Badge.
export function TagBadge({
  children,
  tone = 'neutral',
  dotColor,
  title,
  className,
}: {
  children: ReactNode;
  tone?: TagTone;
  dotColor?: string;
  title?: string;
  className?: string;
}) {
  return (
    <Badge variant="outline" title={title} className={cn('text-caption font-medium', tones[tone], className)}>
      {dotColor && <i className="size-2 shrink-0 rounded-full" style={{ background: dotColor }} aria-hidden="true" />}
      {children}
    </Badge>
  );
}
