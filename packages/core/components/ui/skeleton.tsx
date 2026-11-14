import { cn } from '@/lib/utils';

/** `inline`: a span, for placeholders inside text (a label, a line under a value, a table cell). */
function Skeleton({ className, inline, ...props }: React.ComponentProps<'div'> & { inline?: boolean }) {
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', inline && 'inline-block align-middle', className)}
      {...props}
    />
  );
}

export { Skeleton };
