import { cn } from '@/lib/utils';
import { Loader2Icon } from 'lucide-react';

/**
 * Loading. `activity`: a thin 12px arc in the activity colour, for something under way beside a row (a conversation still
 * answering); under `prefers-reduced-motion` it stays a still arc.
 */
function Spinner({ className, variant = 'default', ...props }: React.ComponentProps<'svg'> & { variant?: 'default' | 'activity' }) {
  if (variant === 'activity')
    return (
      <svg
        data-slot="spinner"
        data-variant="activity"
        role="status"
        aria-label="Loading"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className={cn('size-3 shrink-0 text-(--activity-mark) motion-safe:animate-spin', className)}
        {...props}
      >
        <circle cx="6" cy="6" r="5" strokeOpacity="0.25" />
        <path d="M6 1a5 5 0 0 1 5 5" />
      </svg>
    );
  return <Loader2Icon data-slot="spinner" role="status" aria-label="Loading" className={cn('size-4 animate-spin', className)} {...props} />;
}

export { Spinner };
