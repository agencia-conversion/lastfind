'use client';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Something under way, said in words (docs/design/shell.md section 4, "Agent states"): "Thinking…", "Searching the web…",
 * "Editing the artifact…". The words shimmer slowly from the muted to the foreground text (live-label.css) and a discreet
 * timer counts from `since` (ms), shown from the first second. Under `prefers-reduced-motion` the words stand still in the
 * line's colour and the timer keeps counting: the time is information, not motion. The timer is `aria-hidden`, so a live
 * region never reads it every second.
 */
function LiveLabel({ since, className, children, ...props }: React.ComponentProps<'span'> & { since?: number }) {
  return (
    <span data-slot="live-label" className={cn('inline-flex min-w-0 max-w-full items-baseline gap-2', className)} {...props}>
      <span className="live-label-text min-w-0 truncate">{children}</span>
      {since !== undefined && <LiveTimer since={since} />}
    </span>
  );
}

function LiveTimer({ since }: { since: number }) {
  // Read on the client only (the server's clock would differ at hydration), then once a second.
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  const seconds = now === null ? 0 : Math.floor((now - since) / 1000);
  if (seconds < 1) return null;
  return (
    <span data-slot="live-label-timer" aria-hidden="true" className="shrink-0 text-muted-foreground tabular-nums">
      {formatElapsed(seconds * 1000)}
    </span>
  );
}

/** A duration as the agent's states say it: "4 s", "1 min 05 s" (the same in English and Portuguese); never "0 s". */
function formatElapsed(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}

/** A fixed dot in the activity colour: something new not seen yet (an answer that ended in another conversation). */
function LiveDot({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="live-dot" className={cn('inline-block size-1.5 shrink-0 rounded-full bg-(--activity-mark)', className)} {...props} />;
}

export { LiveDot, LiveLabel, formatElapsed };
