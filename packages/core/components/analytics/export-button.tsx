'use client';
import { Download, Loader2 } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type ExportProps = {
  href: string;
  label: string;
  busy?: boolean;
  /** The public demo builds the file in the browser instead of downloading from the API. */
  onExport?: () => void;
};

function runExport({ href, onExport }: Pick<ExportProps, 'href' | 'onExport'>) {
  if (onExport) {
    onExport();
    return;
  }
  const link = document.createElement('a');
  link.href = href;
  link.download = '';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Header action: exports the filtered report as CSV. Icon only, so the label lives in the tooltip and accessible name. */
export function ExportButton({ href, label, busy, onExport }: ExportProps) {
  return (
    <Hint text={label} side="bottom">
      <a
        href={href}
        download
        data-slot="button"
        aria-label={label}
        aria-busy={busy || undefined}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'export-button', busy && 'pointer-events-none opacity-60')}
        onClick={
          onExport
            ? (event) => {
                event.preventDefault();
                onExport();
              }
            : undefined
        }
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
      </a>
    </Hint>
  );
}

/** Same export as `ExportButton`, as a dropdown row (top-bar ⋮ menu). */
export function ExportMenuItem({ href, label, busy, onExport }: ExportProps) {
  return (
    <DropdownMenuItem
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => runExport({ href, onExport })}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
      {label}
    </DropdownMenuItem>
  );
}
