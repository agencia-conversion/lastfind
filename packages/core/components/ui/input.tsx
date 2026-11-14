'use client';
import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/** The in-place cell field, shared by `Input variant="cell"` and `Textarea variant="cell"`: no box; its size, padding and fill are the
 * cell's (data-table.css, Editable cells). */
export const cellField = 'rounded-none border-transparent bg-transparent text-base md:text-body focus-visible:border-transparent dark:bg-transparent';

/** How long an edited cell keeps its whole value after the edit ends: a click on a button below it (Next) lands before the row shrinks. */
const CELL_SETTLE_MS = 250;
/**
 * The editing state of a cell field (`data-editing`, data-table.css): set when focus enters it, cleared CELL_SETTLE_MS after it leaves (focus
 * moving inside it keeps it), the height animated over 150ms between one line and the whole value (none under reduced motion). Without
 * `enabled` it adds nothing. Focus and blur bubble, so a TagInput's wrapper follows its inner field.
 */
export function useCellEditing<T extends HTMLElement>(enabled: boolean, handlers: { onFocus?: React.FocusEventHandler<T>; onBlur?: React.FocusEventHandler<T> } = {}) {
  const [editing, setEditing] = React.useState(false);
  const field = React.useRef<T>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  const from = React.useRef<number | null>(null);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  React.useLayoutEffect(() => {
    const element = field.current;
    const start = from.current;
    from.current = null;
    if (!element || start === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const end = element.getBoundingClientRect().height;
    if (Math.abs(end - start) > 1) element.animate([{ height: `${start}px` }, { height: `${end}px` }], { duration: 150, easing: 'ease-out' });
  }, [editing]);
  const change = (next: boolean) => {
    if (next === editing) return;
    from.current = field.current?.getBoundingClientRect().height ?? null;
    setEditing(next);
  };
  if (!enabled) return { ...handlers };
  return {
    ref: field,
    'data-editing': editing || undefined,
    onFocus: (event: React.FocusEvent<T>) => {
      clearTimeout(timer.current);
      change(true);
      handlers.onFocus?.(event);
    },
    onBlur: (event: React.FocusEvent<T>) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => change(false), CELL_SETTLE_MS);
      handlers.onBlur?.(event);
    },
  };
}

const inputVariants = cva(
  'w-full min-w-0 rounded-lg border bg-transparent py-1 transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
  {
    variants: {
      variant: {
        default: 'h-8 border-input px-2.5 text-base md:text-sm dark:bg-input/30',
        // A title edited in place (an artifact's header), as in Google Docs: it reads as the header's title (body, label
        // weight), as wide as its text, until hovered (its edge) or focused (the ring colour on its edge, drawn inside the
        // header's row so nothing of it or of the glyphs is cut).
        title:
          'h-(--control-height) w-auto max-w-full min-w-24 border-transparent px-1.5 py-0 text-body font-(--weight-label) field-sizing-content hover:border-input focus-visible:ring-0',
        // A table cell edited in place (`EditableCell`'s field, the wizard's tables): it reads as the cell's text, no box, until
        // hovered or edited, when the cell takes a fill (selection by fill, never a ring). Its text starts where the column's does.
        cell: cellField,
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Input({ className, type, variant, onFocus, onBlur, ...props }: React.ComponentProps<'input'> & VariantProps<typeof inputVariants>) {
  const editing = useCellEditing<HTMLInputElement>(variant === 'cell', { onFocus, onBlur });
  return <InputPrimitive type={type} data-slot="input" data-variant={variant ?? 'default'} className={cn(inputVariants({ variant }), className)} {...props} {...editing} />;
}

export { Input, inputVariants };
