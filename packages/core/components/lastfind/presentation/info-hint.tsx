'use client';
import { useState } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { tooltipSurface } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// The only information icon: the conceptual explanation of a metric or section
// lives in its popover (and in the button's name for screen readers), never as
// a line of text on the card. A popover, not a tooltip: it opens on hover and
// focus, and also on tap and Enter/Space (touch has no hover). It wears the tooltip's dark balloon, like every other one.
// With a mouse a click never pins it: it follows the pointer (opens on enter, closes on leave), also after a tap on a touch
// screen with a mouse; a tap keeps it open until a tap elsewhere. It opens below the icon without sliding over the title.
export function InfoHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        // A mouse click only opens (before the hover delay a quick click opened nothing); leaving the icon closes it.
        if (!next && details?.reason === 'trigger-press' && (details.event as PointerEvent | undefined)?.pointerType === 'mouse') return;
        setOpen(next);
      }}
    >
      <PopoverTrigger
        openOnHover
        render={<button type="button" aria-label={text} className="metric-help" onPointerLeave={(event) => { if (event.pointerType === 'mouse') setOpen(false); }} />}
      >
        <Info size={12} />
      </PopoverTrigger>
      <PopoverContent className={cn(tooltipSurface, 'w-auto max-w-60 text-caption ring-0 data-open:zoom-in-100 data-[side=bottom]:slide-in-from-top-0 data-[side=top]:slide-in-from-bottom-0 data-[side=left]:slide-in-from-right-0 data-[side=right]:slide-in-from-left-0')} sideOffset={16}>{text}</PopoverContent>
    </Popover>
  );
}
