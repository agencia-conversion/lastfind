import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
        secondary:
          'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
        destructive:
          'bg-destructive/10 text-destructive dark:bg-destructive/20 [a]:hover:bg-destructive/20',
        outline:
          'border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground',
        ghost:
          'hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      // The discreet tones of TagBadge: a light fill of the tone and its text mixed toward --badge-ink (black, white in dark
      // mode) just enough for AA, no border, caption size. The label always names the state; colour alone never carries meaning.
      tone: {
        neutral: '[--tone:var(--foreground)]',
        primary: '[--tone:var(--primary)]',
        danger: '[--tone:var(--destructive)]',
        success: '[--tone:var(--state-good)]',
        warning: '[--tone:var(--warning)]',
        muted: '[--tone:var(--muted-foreground)]',
        // "Not classified": dashed, no fill.
        quiet: 'border-dashed border-border! bg-transparent! text-muted-foreground!',
        // A figure on a tinted surface (a note in a justification row): the card's background and a hairline, like a cell.
        outline: 'border-border! bg-card! text-foreground! tabular-nums',
      },
    },
    compoundVariants: [
      {
        tone: ['neutral', 'primary', 'danger', 'success', 'warning', 'muted', 'quiet', 'outline'],
        className:
          'h-auto min-h-[1.1em] px-1.5 py-0 border-transparent bg-[color-mix(in_srgb,var(--tone)_6%,var(--background))] text-[color-mix(in_srgb,var(--tone)_68%,var(--badge-ink))] text-caption leading-[1.3] font-(--weight-label)',
      },
    ],
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  tone,
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant, tone }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'badge',
      variant,
      tone,
    },
  });
}

export { Badge, badgeVariants };
