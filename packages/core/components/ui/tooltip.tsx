'use client';

import type * as React from 'react';
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';

import { cn } from '@/lib/utils';

/** The one balloon surface (dark, light text, in both themes): this tooltip, InfoHint and the chart tooltips use it. */
export const tooltipSurface = 'bg-tooltip text-tooltip-foreground';

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  );
}

/**
 * Every balloon opens where the pointer is, its arrow on it (docs/design/shell.md section 11, tooltips), and follows it across
 * the element; from the keyboard it sits on the element. It never takes the pointer itself (`disableHoverablePopup`): a balloon
 * is text, and one under the pointer would flip the cursor. The one exception is a name beside an icon column (`beside`).
 */
function Tooltip({ trackCursorAxis = 'both', disableHoverablePopup = true, ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" trackCursorAxis={trackCursorAxis} disableHoverablePopup={disableHoverablePopup} {...props} />;
}

/**
 * A collapsed sidebar's names (its rows, the project switcher, the account, a folded rail's buttons) sit beside the icon,
 * outside the column: a balloon at the pointer would cover the icon it names. `trackCursorAxis="none"` and this offset
 * (the column's 8px gutter and 4px more) put it past the sidebar's edge.
 */
const besideOffset = 12;

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset'
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            tooltipSurface,
            'z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md px-3 py-1.5 text-xs has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-tooltip fill-tooltip data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

/**
 * The app's replacement for a native `title` (every balloon is the dark one above): `children`, one element, shows `text`
 * on hover and on focus when it takes focus, and keeps it as the element's accessible description, as `title` did. Without
 * text the balloon stays off. Other props (a menu or popover trigger's, when a Hint is its `render`) pass on to the element,
 * which keeps its own `data-slot`. `text` keeps line breaks (`\n`).
 */
function Hint({
  text,
  children,
  side,
  align,
  beside = false,
  ...props
}: {
  text?: React.ReactNode;
  children: React.ReactElement;
  /** Beside the element, outside it (an icon column's name), never following the pointer over it. */
  beside?: boolean;
} & Pick<TooltipPrimitive.Positioner.Props, 'align' | 'side'> &
  Omit<TooltipPrimitive.Trigger.Props, 'render' | 'children'>) {
  return (
    <Tooltip disabled={text == null || text === ''} trackCursorAxis={beside ? 'none' : undefined}>
      <TooltipPrimitive.Trigger aria-description={typeof text === 'string' && text ? text : undefined} {...props} render={children} />
      <TooltipContent side={side ?? (beside ? 'right' : undefined)} sideOffset={beside ? besideOffset : undefined} align={align} className="whitespace-pre-line">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Hint, besideOffset };
