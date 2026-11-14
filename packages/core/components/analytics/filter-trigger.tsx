'use client';
import { Children, type ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/tooltip';

/**
 * Dropdowns and popovers share one visible, non-shrinking affordance.
 * `reserve` is the longest label the filter normally shows: the trigger is sized
 * for it, so choosing a value never widens it or moves its neighbours (a longer
 * label truncates; pass `title` with the full value).
 */
export function FilterTrigger({
  children,
  reserve,
  title,
  ...props
}: ComponentProps<typeof Button> & { reserve?: string }) {
  const content = Children.map(children, (child) =>
    typeof child === 'string' || typeof child === 'number' ? (
      <span className="truncate">{child}</span>
    ) : (
      child
    ),
  );
  // The full value shows in the catalog's dark balloon, never the browser's `title`.
  return (
    <Hint text={title}>
    <Button variant="outline" {...props}>
      {reserve ? (
        <span className="filter-trigger-label">
          <span className="flex items-center gap-2 overflow-hidden">{content}</span>
          <span className="filter-trigger-reserve" aria-hidden="true">
            {reserve}
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">{content}</span>
      )}
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="ml-auto shrink-0 text-muted-foreground"
      />
    </Button>
    </Hint>
  );
}
