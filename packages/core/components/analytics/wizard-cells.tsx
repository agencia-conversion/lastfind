'use client';
// The New project wizard's editable tables (new-project-wizard.tsx and its Comparison step): the cell is the field, a row is removed by
// its own button and selected by the app's selection column. One definition for every step.
import type { KeyboardEvent, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DataColumn } from '@/components/lastfind/presentation/data-table';

/** Skeleton rows of a table whose first suggestions are on their way. */
export const LOADING_ROWS = 3;

/**
 * A one-line value edited in its cell: the catalog's `Textarea variant="cell"`, so a long domain or name wraps whole in a phone's
 * stacked card instead of being cut mid-word (an input never wraps); Enter adds no line, a pasted line break becomes a space (`line`).
 */
export const oneLine = {
  variant: 'cell',
  rows: 1,
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter') event.preventDefault();
  },
} as const;
export const line = (value: string) => value.replace(/\s*[\r\n]+\s*/g, ' ');

/** A row's remove button, its accessible name from `name`. */
export const removeColumn = <T,>(label: string, name: (row: T, index: number) => string, remove: (index: number) => void): DataColumn<T> => ({
  key: 'remove',
  header: <span className="sr-only">{label}</span>,
  mobile: 'actions',
  align: 'end',
  width: 48,
  cell: (row, index) => (
    <Button variant="ghost" size="icon" aria-label={name(row, index)} onClick={() => remove(index)}>
      <X aria-hidden="true" />
    </Button>
  ),
});

/** The app's selection column (Prompts' table): the checkbox at the row's start. */
export const selectColumn = <T,>(header: ReactNode, cell: (row: T, index: number) => ReactNode): DataColumn<T> => ({ key: 'select', width: 44, mobile: 'check', headerClassName: 'w-10 pl-4', cellClassName: 'pl-4', header, cell });
