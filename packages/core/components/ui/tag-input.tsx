'use client';
import { useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Badge } from './badge';
import { cn } from '@/lib/utils';
import { addTags, tagSeparator } from '@/lib/tags';
import { useCellEditing } from './input';

const tagInputVariants = cva(
  'flex w-full min-w-0 flex-wrap items-center gap-1 transition-colors aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
  {
    variants: {
      variant: {
        // The field of a form: the catalog Input's box.
        default: 'min-h-8 rounded-lg border border-input px-1.5 py-1 focus-within:border-ring dark:bg-input/30',
        // A table cell edited in place (Input variant="cell"): no box; its size, padding and fill are the cell's (data-table.css).
        cell: 'border border-transparent',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/**
 * A list typed as badges (13/11/2026: a competitor's domains, a brand's aliases). Each value is a grey Badge with its remove button;
 * typing a separator (comma, Enter, and space when `spaces` is set) or pasting a list adds them, Backspace on the empty field
 * removes the last one, and leaving the field keeps what was typed. `normalize` cleans a value, or refuses it with null: the text
 * then stays in the field, marked invalid. Repeats (case ignored) are dropped. The order is kept: the first value can mean something
 * (a competitor's main domain).
 */
function TagInput({
  value,
  onChange,
  normalize = (text) => text.trim() || null,
  spaces = false,
  removeLabel,
  variant,
  className,
  placeholder,
  'aria-invalid': invalid,
  ...input
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  normalize?: (text: string) => string | null;
  /** A space separates values too (domains); never for names, which have spaces. */
  spaces?: boolean;
  /** The accessible name of a value's remove button. */
  removeLabel: (tag: string) => string;
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'defaultValue'> & VariantProps<typeof tagInputVariants>) {
  const [draft, setText] = useState('');
  // What an add left in the field (a value `normalize` refused) is marked invalid until it is edited.
  const [refused, setRefused] = useState(false);
  const setDraft = (text: string, left = false) => {
    setText(text);
    setRefused(left && !!text);
  };
  const field = useRef<HTMLInputElement>(null);
  const editing = useCellEditing<HTMLDivElement>(variant === 'cell');
  const separator = tagSeparator(spaces);
  // Adds every value of `text`; returns what cannot be added, which stays in the field.
  const add = (text: string) => {
    const { next, left } = addTags(value, text, normalize, spaces);
    if (next.length !== value.length) onChange(next);
    return left;
  };
  const bad = invalid || refused ? true : undefined;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter on an empty field is left to the form (a dialog's submit).
    if ((event.key === 'Enter' && draft.trim()) || event.key === ',' || (spaces && event.key === ' ')) {
      event.preventDefault();
      setDraft(add(draft), true);
    } else if (event.key === 'Backspace' && !draft && value.length) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div
      data-slot="tag-input"
      data-variant={variant ?? 'default'}
      aria-invalid={bad}
      className={cn(tagInputVariants({ variant }), className)}
      {...editing}
      // A click on the field's empty room types in it.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          field.current?.focus();
        }
      }}
    >
      {value.map((tag, index) => (
        <Badge key={tag} variant="outline" tone="neutral" className="h-6 max-w-full gap-0.5 pe-0.5">
          <span className="truncate">{tag}</span>
          <button
            type="button"
            aria-label={removeLabel(tag)}
            className="relative grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground after:absolute after:-inset-2.5 hover:bg-muted-foreground/15 hover:text-foreground"
            onClick={() => {
              onChange(value.filter((_, at) => at !== index));
              field.current?.focus();
            }}
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </Badge>
      ))}
      {/* The typing field takes what is left of the last line, so a full line of badges never leaves an empty one below it;
          focused, it asks for room of its own. */}
      <input
        ref={field}
        data-slot="input"
        className="h-6 w-0! min-w-0 grow basis-0 rounded-none! focus:basis-16 border-0! bg-transparent! p-0! text-base outline-none placeholder:text-muted-foreground md:text-body"
        placeholder={value.length ? undefined : placeholder}
        aria-invalid={bad}
        value={draft}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          // A separator that arrives without a key event (a phone's keyboard) adds what came before it.
          const parts = event.target.value.split(separator);
          const tail = parts.pop() ?? '';
          const left = parts.length ? add(parts.join(',')) : '';
          setDraft([left, tail].filter(Boolean).join(' '), !!left);
        }}
        onPaste={(event) => {
          // A pasted list: a line break always separates, as does whatever separates while typing.
          const text = event.clipboardData.getData('text').trim().replace(/\r?\n/g, ',');
          if (!separator.test(text)) return;
          event.preventDefault();
          setDraft(add(`${draft}${text}`), true);
        }}
        onBlur={() => draft && setDraft(add(draft), true)}
        {...input}
      />
    </div>
  );
}

export { TagInput, tagInputVariants };
