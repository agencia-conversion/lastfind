'use client';
import type { ReactNode, Ref } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** Numbers and rates align to the end; text to the start. */
  align?: 'start' | 'end';
  /** Narrow screens: hide the column, or use it as the card title / full-width line. */
  mobile?: 'hide' | 'title' | 'wide' | 'check' | 'actions';
  /** Label shown before the value when rows stack on narrow screens. */
  label?: string;
  width?: string | number;
  headerClassName?: string;
  cellClassName?: string;
  title?: string;
};

// The only data table: header 12px muted 500, cells 14px regular (never bold,
// including domains, brands and names), numbers tabular and end-aligned, rows
// stacked as cards on narrow screens. Links inside cells underline on hover only.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  className,
  ariaLabel,
  stackColumns,
  tableRef,
  headerOnly,
  hideHeader,
  rowState,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
  ariaLabel?: string;
  /** Number of leading columns kept on the first line when stacked. */
  stackColumns?: number | string;
  tableRef?: Ref<HTMLTableElement>;
  /** Header row only: a sticky copy of the header that shares the column widths. */
  headerOnly?: boolean;
  /** Keep the header for assistive technology while the sticky copy shows it. */
  hideHeader?: boolean;
  rowState?: (row: T) => string | undefined;
}) {
  return (
    <Table
      ref={tableRef}
      className={cn('analytics-table', !headerOnly && 'responsive-table', className)}
      data-stack-cols={stackColumns}
      aria-label={ariaLabel}
    >
      {columns.some((column) => column.width !== undefined) && (
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={column.width !== undefined ? { width: column.width } : undefined} />
          ))}
        </colgroup>
      )}
      <TableHeader className={hideHeader ? 'sr-only' : undefined}>
        <TableRow>
          {columns.map((column) => (
            <TableHead
              key={column.key}
              data-mobile={column.mobile === 'hide' ? 'hide' : undefined}
              title={column.title}
              className={cn(column.align === 'end' && 'text-right', column.headerClassName)}
            >
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {!headerOnly && (
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={rowKey(row, index)} className={rowClassName?.(row)} data-state={rowState?.(row)}>
            {columns.map((column) => (
              <TableCell
                key={column.key}
                data-mobile={column.mobile}
                data-label={column.label}
                className={cn(column.align === 'end' && 'text-right tabular-nums', column.cellClassName)}
              >
                {column.cell(row, index)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      )}
    </Table>
  );
}
