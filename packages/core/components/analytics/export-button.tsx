'use client';
import { Download, Loader2 } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Header action: exports the filtered report as CSV. Icon only, so the label lives in the tooltip and accessible name. */
export function ExportButton({
  href,
  label,
  busy,
  onExport,
}: {
  href: string;
  label: string;
  busy?: boolean;
  /** The public demo builds the file in the browser instead of downloading from the API. */
  onExport?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            download
            data-slot="button"
            aria-label={label}
            aria-busy={busy || undefined}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'export-button', busy && 'pointer-events-none opacity-60')}
            onClick={
              onExport
                ? (event) => {
                    event.preventDefault();
                    onExport();
                  }
                : undefined
            }
          />
        }
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
