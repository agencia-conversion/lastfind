'use client';

import * as ResizablePrimitive from 'react-resizable-panels';

import { cn } from '@/lib/utils';

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        'flex h-full w-full aria-[orientation=vertical]:flex-col',
        className,
      )}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

/**
 * The one resize line between panes (docs/design/shell.md section 4): 1px in --border, a wider hit area; under the pointer,
 * while dragged and on keyboard focus it turns a 2px --border-strong line, never an outline (an outline around a 1px line
 * draws two bars).
 */
function ResizableHandle({ className, onPointerDown, ...props }: ResizablePrimitive.SeparatorProps) {
  return (
    <ResizablePrimitive.Separator
      // The library focuses the line when a drag starts, which reads as keyboard focus: let it go when the drag ends, so the
      // line rests after a mouse drag and still shows for the keyboard.
      onPointerDown={(event) => {
        onPointerDown?.(event);
        const line = event.currentTarget;
        document.addEventListener('pointerup', () => line.blur(), { once: true });
      }}
      data-slot="resizable-handle"
      className={cn(
        'relative flex w-px items-center justify-center bg-border outline-none focus-visible:outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 before:absolute before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:bg-transparent before:transition-colors data-[separator=hover]:before:bg-(--border-strong) data-[separator=active]:before:bg-(--border-strong) focus-visible:before:bg-(--border-strong) aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-2 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 aria-[orientation=horizontal]:before:left-0 aria-[orientation=horizontal]:before:h-0.5 aria-[orientation=horizontal]:before:w-full aria-[orientation=horizontal]:before:translate-x-0 aria-[orientation=horizontal]:before:-translate-y-1/2 motion-reduce:before:transition-none',
        className,
      )}
      {...props}
    />
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
