'use client';
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { cellField, useCellEditing } from './input';

const textareaVariants = cva(
  'flex field-sizing-content w-full rounded-lg border bg-transparent transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
  {
    variants: {
      variant: {
        default: 'min-h-16 border-input px-2.5 py-2 text-base md:text-sm dark:bg-input/30',
        // A long text edited in place in a table cell (a prompt): the cell's text, wrapping and growing with it, no box.
        cell: cn(cellField, 'resize-none'),
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Textarea({ className, variant, onFocus, onBlur, ...props }: React.ComponentProps<'textarea'> & VariantProps<typeof textareaVariants>) {
  const editing = useCellEditing<HTMLTextAreaElement>(variant === 'cell', { onFocus, onBlur });
  return <textarea data-slot="textarea" data-variant={variant ?? 'default'} className={cn(textareaVariants({ variant }), className)} {...props} {...editing} />;
}

export { Textarea, textareaVariants };
