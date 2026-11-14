import type { ReactNode } from 'react';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-body font-(--weight-label) whitespace-nowrap transition-all select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The primary action, the site's CTA blue (docs/design/shell.md section 11): one per header, dialog footer or composer.
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover hover:shadow-[var(--action-glow)]',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        // A toggle (aria-pressed: the chat beside an artifact, a content's tabs) shows pressed in the sidebar's active fill.
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-sidebar-accent aria-pressed:text-sidebar-accent-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30',
        link: 'text-primary underline-offset-4 hover:underline',
        // The chat's send and stop (docs/design/shell.md section 11): ink, black on the light canvas and white on the dark one.
        ink: 'bg-foreground text-background hover:bg-foreground/85',
        // A quiet action inside a table cell (Brands: "Monitor to measure"): grey text, a faint underline, no border.
        quiet:
          'h-auto px-0 font-normal text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground hover:decoration-foreground',
      },
      // One control height (docs/design/shell.md section 3): `default` and `icon`, at --control-height. `xs` and `icon-xs`
      // are the row actions of a table or list. `sm`, `lg`, `icon-sm` and `icon-lg` are the old names of `default` and
      // `icon`, kept until their call sites move.
      size: {
        default:
          'h-(--control-height) gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-6 gap-1 px-2 text-caption in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        icon: 'size-(--control-height)',
        'icon-xs': "size-6 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
      },
      // An action of a table row that shows while the row is hovered or holds focus (with a mouse); touch screens always show
      // it. It keeps its room, so the row never moves (Brands: Monitor on a discovered brand).
      reveal: {
        row: 'pointer-fine:[tr:not(:hover):not(:focus-within)_&]:opacity-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  reveal,
  pending = false,
  pendingLabel,
  children,
  disabled,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Spinner + disable; width stays the max of idle and pending labels. */
    pending?: boolean;
    pendingLabel?: ReactNode;
  }) {
  // Idle path keeps the pre-pending DOM (FilterTrigger children stay as-is).
  if (!pending) {
    return (
      <ButtonPrimitive
        data-slot="button"
        data-size={size}
        disabled={disabled}
        className={cn(buttonVariants({ variant, size, reveal, className }))}
        {...props}
      >
        {children}
      </ButtonPrimitive>
    );
  }

  return (
    <ButtonPrimitive
      data-slot="button"
      data-size={size}
      data-pending=""
      aria-busy
      disabled
      className={cn(buttonVariants({ variant, size, reveal, className }))}
      {...props}
    >
      <span className="inline-grid [grid-template-areas:'stack'] [&>*]:[grid-area:stack] [&>*]:inline-flex [&>*]:items-center [&>*]:justify-center [&>*]:gap-1.5">
        <span className="invisible">{children}</span>
        <span>
          <Spinner className="size-3.5" />
          {pendingLabel ?? children}
        </span>
      </span>
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
