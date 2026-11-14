'use client';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import type { ComponentProps, CSSProperties, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3 } from 'lucide-react';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SelectField } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Hint } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { InfoHint } from './info-hint';
import './data-table.css';

export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** Numbers and rates align to the end; rank (`#`) to the center; text to the start. */
  align?: 'start' | 'center' | 'end';
  /** Narrow screens: hide the column, or use it as the card title / full-width line. */
  mobile?: 'hide' | 'title' | 'wide' | 'check' | 'actions';
  /** Label shown before the value when rows stack on narrow screens. */
  label?: string;
  /** Column width; for a `shrinkTo` column, the most it takes. */
  width?: string | number;
  /**
   * Text column that gives up width first (wide screens): the table stays inside its container, the column
   * shrinks from `width` down to this floor (e.g. `'12rem'`) and truncates, the other headers wrap in two lines.
   */
  shrinkTo?: string;
  /**
   * The most a text column takes (docs/design/shell.md section 8: at most `20rem`; the name column uses `shrinkTo` between
   * `12rem` and `28rem`): the cell truncates past it, its full text in `hint`.
   */
  maxWidth?: string;
  /** Balloon of a `shrinkTo` or `maxWidth` cell cut short: its full content as text (a text cell shows its own text without it). */
  hint?: (row: T) => string | undefined;
  headerClassName?: string;
  cellClassName?: string;
  /** Heatmaps colour the complete cell, including its padding. */
  cellStyle?: (row: T) => CSSProperties | undefined;
  rowHeader?: boolean;
  title?: string;
  /** What the column measures, in the information icon next to its header. */
  info?: string;
  /** Makes the column sortable: the value rows are ordered by (empty values go last). */
  sortValue?: (row: T) => string | number | null | undefined;
};

export type DataSort = { key: string; direction: 'asc' | 'desc' };
/** Where a row leads, in the shape of the app's `link()` (an address and a click handler). */
export type RowLink = { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };

function compareValues(left: string | number | null | undefined, right: string | number | null | undefined) {
  if (left == null || left === '') return right == null || right === '' ? 0 : 1;
  if (right == null || right === '') return -1;
  return typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Orders rows by the sort's column (`sortValue`). Callers that paginate sort the whole
 * list with this before slicing the page and pass `sort`/`onSortChange` to `DataTable`.
 */
export function sortRows<T>(rows: T[], columns: Pick<DataColumn<T>, 'key' | 'sortValue'>[], sort: DataSort | undefined): T[] {
  const column = sort && columns.find((item) => item.key === sort.key);
  if (!sort || !column?.sortValue) return rows;
  const value = column.sortValue;
  const sign = sort.direction === 'asc' ? 1 : -1;
  // Empty values stay last in both directions; the sort is stable, so ties keep their order.
  return [...rows].sort((a, b) => {
    const left = value(a), right = value(b);
    const empty = (item: typeof left) => item == null || item === '';
    return empty(left) || empty(right) ? compareValues(left, right) : sign * compareValues(left, right);
  });
}

/** Placeholder columns for a loading table whose columns are not known yet (first is the title). Prefer the screen's own columns with `DataTable loading`. */
export function skeletonColumns(count: number): DataColumn<number>[] {
  return Array.from({ length: count }, (_, index) => ({
    key: String(index),
    header: <Skeleton inline className={index === 0 ? 'h-4 w-24' : 'h-4 w-16'} />,
    cell: () => null,
    mobile: index === 0 ? ('title' as const) : undefined,
    align: index === 0 ? undefined : ('end' as const),
    width: index === 0 ? undefined : '7rem',
  }));
}

/**
 * The one table toolbar in the app: search/filters on the left, optional actions
 * (column picker, menus) on the right. Global filters stay in the top bar.
 */
export function DataTableToolbar({
  children,
  label,
  actions,
  className,
}: {
  children?: ReactNode;
  label: string;
  actions?: ReactNode;
  className?: string;
}) {
  const revealFocusedControl = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const container = event.currentTarget;
    const bounds = container.getBoundingClientRect();
    const focused = target.getBoundingClientRect();
    if (focused.left < bounds.left) container.scrollLeft += focused.left - bounds.left;
    else if (focused.right > bounds.right) container.scrollLeft += focused.right - bounds.right;
  };
  return (
    <div role="toolbar" aria-label={label} className={cn('data-table-toolbar filter-main', className)}>
      <div onFocusCapture={revealFocusedControl} className="data-table-toolbar-controls">
        {children}
      </div>
      {actions ? <div className="data-table-toolbar-actions">{actions}</div> : null}
    </div>
  );
}

/**
 * A table list screen: optional metric cards on top, then one panel whose table fills the rest of the
 * height and scrolls inside (toolbar and `DataTable fill` go in `children`). `fill={false}` is the same
 * content as a plain panel, for the detail view of the same screen. `view` names the table on screen
 * (the active tab): switching it while the cards are scrolled away keeps them away, with the new table at its top.
 */
export function DataTableScreen({
  cards,
  fill = true,
  busy,
  view,
  className,
  children,
}: {
  cards?: ReactNode;
  fill?: boolean;
  /** The table on screen is being replaced (page, sort): dims it without moving anything. */
  busy?: boolean;
  view?: string;
  className?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = panel.current;
    const screen = element?.parentElement;
    if (!element || !screen) return;
    // Wide screens scroll the screen itself; narrow ones scroll the page under the sticky top bar.
    const own = getComputedStyle(screen).overflowY !== 'visible';
    const scroller = own ? screen : document.scrollingElement;
    const top = own ? screen.getBoundingClientRect().top : Math.max(0, document.querySelector('.analytics-topbar')?.getBoundingClientRect().bottom ?? 0);
    const offset = element.getBoundingClientRect().top - top;
    if (scroller && offset < 0) scroller.scrollTop += offset;
  }, [view]);
  if (!fill) {
    return (
      <div className={cn('analytics-panel', className)}>
        {cards}
        {children}
      </div>
    );
  }
  return (
    <div className={cn('live-table-fill', className)}>
      {cards ? <div className="live-table-fill-cards">{cards}</div> : null}
      <div ref={panel} className="analytics-panel live-table-fill-panel" aria-busy={busy || undefined}>
        {children}
      </div>
    </div>
  );
}

/** Checkbox list of optional columns; required keys stay always on. */
export function ColumnPicker({
  label,
  columns,
  hidden,
  onChange,
  required = [],
}: {
  label: string;
  columns: { key: string; label: string }[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  required?: string[];
}) {
  const locked = new Set(required);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" aria-label={label} className="shrink-0 gap-1.5" />
        }
      >
        <Columns3 size={14} aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {columns.map((column) => {
          const always = locked.has(column.key);
          const visible = always || !hidden.includes(column.key);
          return (
            <DropdownMenuCheckboxItem
              key={column.key}
              checked={visible}
              disabled={always}
              closeOnClick={false}
              onCheckedChange={(checked) => {
                if (always) return;
                onChange(checked ? hidden.filter((key) => key !== column.key) : [...hidden, column.key]);
              }}
            >
              {column.label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Body cell of a `shrinkTo` column: takes no width of its own (the column's `width` and floor decide), truncates, full text on hover.
// With `maxWidth` (a column that is not the shrinking one): at most that wide, truncated past it.
// `text`: a text column of a fit table (see `widthOf`), at most two lines, cut with an ellipsis past them.
function ShrinkCell({ children, hint, maxWidth, text }: { children: ReactNode; hint?: string; maxWidth?: string; text?: boolean }) {
  return (
    <Hint text={hint ?? (typeof children === 'string' ? children : undefined)}>
      <div className={maxWidth ? 'data-table-clip' : text ? 'data-table-text' : 'data-table-shrink'} style={maxWidth ? ({ '--clip-width': maxWidth } as CSSProperties) : undefined}>
        {children}
      </div>
    </Hint>
  );
}

// A click on a link, button or field inside the row belongs to that control, not to the row.
const interactive = 'a, button, input, select, textarea, label, [role="button"], [role="link"]';

// The only data table: header and cells share one size, weight and colour
// (white header; cells never bold, including domains, brands and
// names), numbers tabular and end-aligned, rows stacked as cards on narrow
// screens (`singleLine` keeps a real table instead, except on a list screen).
// Columns with `sortValue` sort on a click on the header (arrow shows the
// direction; on narrow screens the headers stay as a row of sort buttons above
// the stacked cards). Paginated lists control the sort (`sort`, `onSortChange`)
// and order the whole list with `sortRows` before slicing the page. With `rowLink` the whole row is the link: pointer, hover, focus
// and Enter, Ctrl/⌘-click opens a new tab; links inside cells stay plain text.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  className,
  ariaLabel,
  style,
  containerProps,
  stackColumns,
  singleLine,
  compact,
  lines,
  minWidth,
  fill,
  tableRef,
  headerOnly,
  hideHeader,
  rowState,
  rowLink,
  defaultSort,
  sort: controlledSort,
  onSortChange,
  caption,
  summary,
  summaryAside,
  loading,
  expanded,
  onExpand,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  containerProps?: ComponentProps<'div'>;
  /** Number of leading columns kept on the first line when stacked. */
  stackColumns?: number | string;
  /**
   * Keep each cell on one line (truncate inside) in a real table that scrolls sideways on narrow screens. `'wide'`: one line
   * from a tablet-wide pane up, and the stacked cards in a phone-wide one (lists whose first column is long text). A list
   * screen's table (`fill`) is always `'wide'`. In a phone-wide pane a single-line table drops its `mobile: 'hide'` columns.
   */
  singleLine?: boolean | 'wide';
  /** Compact desktop cells and action buttons while keeping mobile cards. */
  compact?: boolean;
  /** `'rows'`: only the lines between rows, no column lines (a file list, as Agent > Artifacts and Contents). Default: the grid. */
  lines?: 'grid' | 'rows';
  /** Minimum width of the desktop table; stacked cards still fit the viewport. `0`: a table inside a card, fixed layout, fits the card. */
  minWidth?: number;
  /**
   * Fill the parent height and scroll inside the table: sticky header (`top: 0`) and
   * sticky summary (`bottom: 0`). Parent must be a flex column with a bounded height.
   */
  fill?: boolean;
  tableRef?: Ref<HTMLTableElement>;
  /** Header row only: a sticky copy of the header that shares the column widths. */
  headerOnly?: boolean;
  /** Keep the header for assistive technology while the sticky copy shows it. */
  hideHeader?: boolean;
  rowState?: (row: T) => string | undefined;
  /** Makes each row (that returns a link) clickable as a whole. */
  rowLink?: (row: T) => RowLink | undefined;
  /** Sort applied before the reader chooses one; without it rows keep the order they arrive in. */
  defaultSort?: DataSort;
  /** Controlled sort: `rows` arrive already ordered (see `sortRows`); the table only shows the arrow and reports clicks. */
  sort?: DataSort;
  onSortChange?: (sort: DataSort) => void;
  /** Short footnote under the table (same padding as the cells). */
  caption?: ReactNode;
  /** Sticky footer row keyed by column (`prompt` cell usually holds the "Summary" label). */
  summary?: Partial<Record<string, ReactNode>>;
  /** Right side of the summary row (compact pagination). Absolute on wide screens; last block on cards. */
  summaryAside?: ReactNode;
  /**
   * Rows are on their way: the real header (or cards on narrow screens) with this many placeholder rows
   * (`true` = 8), so the table that arrives takes the same place. Use `skeletonColumns(n)` while the columns are unknown.
   */
  loading?: boolean | number;
  /**
   * Expandable rows: what a row shows under it, across every column, while it returns something (`undefined`: closed).
   * With `onExpand` the whole row (click, Enter or Space) toggles it and says `aria-expanded`; links inside the row and the
   * detail stay theirs. The detail is plain content (its own tables, links, actions).
   */
  expanded?: (row: T) => ReactNode;
  onExpand?: (row: T) => void;
}) {
  const [ownSort, setOwnSort] = useState<DataSort | undefined>(defaultSort);
  const { locale } = useI18n();
  const copy = (en: string, pt: string) => (locale === 'pt-BR' ? pt : en);
  const controlled = onSortChange !== undefined;
  const sort = controlled ? controlledSort : ownSort;
  const sorted = useMemo(() => (controlled ? rows : sortRows(rows, columns, sort)), [columns, controlled, rows, sort]);
  // Widths measured when the reader clicks a header, held while only the order changes (see `lockWidths`).
  const [locked, setLocked] = useState<{ widths: number[]; sort: DataSort; cols: string; order?: string }>();
  const cols = columns.map((column) => column.key).join();
  const order = sorted.map(rowKey).join('\n');
  const sameSort = locked && sort?.key === locked.sort.key && sort.direction === locked.sort.direction;
  // Release as soon as anything but the sort changes the rows or columns (page, filters); state adjusted while rendering.
  if (locked && locked.order === undefined && sameSort) setLocked({ ...locked, order });
  else if (locked && locked.order !== undefined && (!sameSort || locked.order !== order || locked.cols !== cols)) setLocked(undefined);
  useEffect(() => {
    if (!locked) return;
    const release = () => setLocked(undefined);
    window.addEventListener('resize', release);
    return () => window.removeEventListener('resize', release);
  }, [locked]);
  // With `table-layout: auto` column widths follow the visible rows, so sorting a paginated list would
  // move the columns. Pin the current widths at the click; tables already fixed or stacked as cards are left alone.
  const lockWidths = (next: DataSort, table: HTMLTableElement | null) => {
    if (locked) return setLocked({ ...locked, sort: next, order: undefined }); // a second click keeps the pinned widths
    const style = table && getComputedStyle(table);
    const head = table?.tHead?.rows[0];
    if (!style || !head || style.display !== 'table' || style.tableLayout === 'fixed' || head.cells.length !== columns.length) return setLocked(undefined);
    setLocked({ widths: Array.from(head.cells, (cell) => cell.getBoundingClientRect().width), sort: next, cols });
  };
  const sortBy = (column: DataColumn<T>, table: HTMLTableElement | null) => {
    // First click: text A→Z, numbers largest first; the next click reverses it.
    const next: DataSort = {
      key: column.key,
      direction: sort?.key === column.key ? (sort.direction === 'asc' ? 'desc' : 'asc') : column.align === 'end' ? 'desc' : 'asc',
    };
    lockWidths(next, table);
    if (onSortChange) onSortChange(next);
    else setOwnSort(next);
  };
  const openRow = (row: T, event: MouseEvent<HTMLTableRowElement>) => {
    const target = rowLink?.(row);
    if (!target || (event.target as HTMLElement).closest(interactive)?.closest('tr') === event.currentTarget) return;
    if (event.ctrlKey || event.metaKey) window.open(target.href, '_blank', 'noopener');
    else target.onClick(event as unknown as MouseEvent<HTMLAnchorElement>);
  };
  const summaryLabelKey = summary ? columns.find((column) => summary[column.key] != null)?.key : undefined;
  const fit = columns.some((column) => column.shrinkTo);
  // Column widths of a fit table in auto layout (docs/design/shell.md section 8): a column that sorts as text (Topic, Intent) is a
  // text column, with a floor and a share of the spare width; once one is there, a figure without a width of its own (aligned to
  // the end or centre, or sorting as a number: rates, counts, icons) takes just its header and value, so the spare width goes to
  // the text, never to a figure. Anything else (a status without a sort) keeps the table's own sizing.
  const sample = (column: DataColumn<T>) => {
    for (const row of rows) {
      const value = column.sortValue?.(row);
      if (value != null && value !== '') return value;
    }
  };
  const free = (column: DataColumn<T>) =>
    column.width === undefined && !column.shrinkTo && !column.maxWidth && column.mobile !== 'actions' && column.mobile !== 'check';
  const textKeys = new Set(fit && minWidth !== 0 ? columns.filter((column) => free(column) && typeof sample(column) === 'string').map((column) => column.key) : []);
  const widthOf = (column: DataColumn<T>) =>
    !textKeys.size || !free(column)
      ? undefined
      : textKeys.has(column.key)
        ? 'text'
        : column.align === 'end' || column.align === 'center' || typeof sample(column) === 'number'
          ? 'content'
          : undefined;
  // Fit tables: the label cell (with the pager) spans the empty summary cells after it, so a shrunk text column never clips the pager.
  const labelIndex = columns.findIndex((column) => column.key === summaryLabelKey);
  // A list screen's table (`fill`) stacks as cards in a phone-wide pane, as `'wide'` does: the name on top and every figure
  // under its label, never a table scrolled sideways past them (docs/design/shell.md section 8).
  // So does a single-line list in a card that does not fit the card (no `minWidth={0}`): its name column (`mobile: 'title'`)
  // says it was written for cards, and sideways it hid its figures and actions past the card's edge on a phone. A
  // matrix (no name column: Score by AI, the heatmap) keeps scrolling sideways.
  const oneLine = singleLine === true && (fill || (minWidth !== 0 && columns.some((column) => column.mobile === 'title'))) ? 'wide' : singleLine;
  // The label a stacked card shows before a value: the column's own, else (when the rows may stack) its header's plain text.
  const labelOf = (column: DataColumn<T>) =>
    column.label ?? (oneLine !== true && !headerOnly && !column.mobile && typeof column.header === 'string' ? column.header : undefined);
  let labelSpan = 1;
  while (fit && summary && labelIndex >= 0 && labelIndex + labelSpan < columns.length && summary[columns[labelIndex + labelSpan].key] == null) labelSpan++;
  const table = (
    <Table
      ref={tableRef}
      containerClassName={fill ? 'data-table-fill-scroll' : undefined}
      className={cn(
        'analytics-table',
        // singleLine keeps a real table (no card stack) so every row stays one line tall on narrow screens.
        !headerOnly && oneLine !== true && 'responsive-table',
        fill && 'data-table-fill',
        className,
      )}
      data-stack-cols={oneLine === true ? undefined : stackColumns}
      data-single-line={oneLine || undefined}
      data-compact={compact || undefined}
      data-lines={lines === 'rows' ? 'rows' : undefined}
      data-fill={fill || undefined}
      data-fit={fit || undefined}
      aria-label={ariaLabel}
      aria-busy={loading ? true : undefined}
      style={{ ...style, '--data-table-min-width': minWidth == null ? undefined : `${minWidth}px`, ...(locked || minWidth === 0 ? { tableLayout: 'fixed' } : {}) } as CSSProperties}
      containerProps={containerProps}
    >
      {(locked || columns.some((column) => column.width !== undefined)) && (
        <colgroup>
          {columns.map((column, index) => (
            <col key={column.key} data-mobile={column.mobile === 'hide' ? 'hide' : undefined} style={locked ? { width: locked.widths[index] } : column.width !== undefined ? { width: column.width } : undefined} />
          ))}
        </colgroup>
      )}
      <TableHeader className={hideHeader ? 'sr-only' : undefined}>
        <TableRow>
          {columns.map((column) => {
            const active = sort?.key === column.key ? sort.direction : undefined;
            const head = (
              <>
                {column.sortValue ? (
                  <button type="button" className="table-sort" data-active={active ? '' : undefined} onClick={(event) => sortBy(column, event.currentTarget.closest('table'))}>
                    {column.header}
                    {active === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : active === 'desc' ? <ArrowDown size={12} aria-hidden="true" /> : <ChevronsUpDown size={12} aria-hidden="true" />}
                  </button>
                ) : (
                  column.header
                )}
                {column.info && <InfoHint text={column.info} />}
              </>
            );
            return (
              <Hint key={column.key} text={column.title}>
              <TableHead
                data-mobile={column.mobile === 'hide' ? 'hide' : undefined}
                data-shrink={column.shrinkTo ? '' : undefined}
                data-width={widthOf(column)}
                style={column.shrinkTo ? ({ '--shrink-to': column.shrinkTo } as CSSProperties) : undefined}
                aria-sort={column.sortValue ? (active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none') : undefined}
                className={cn(
                  column.align === 'end' && 'text-right',
                  column.align === 'center' && 'text-center',
                  column.headerClassName,
                )}
              >
                {fit ? <div className="data-table-head" data-align={column.align}>{head}</div> : head}
              </TableHead>
              </Hint>
            );
          })}
        </TableRow>
      </TableHeader>
      {!headerOnly && loading ? (
        <TableBody>
          {Array.from({ length: loading === true ? 8 : loading }, (_, index) => (
            <TableRow key={index} data-skeleton="">
              {columns.map((column, at) => (
                <TableCell
                  key={column.key}
                  data-mobile={column.mobile}
                  data-label={labelOf(column)}
                  data-shrink={column.shrinkTo ? '' : undefined}
                  data-width={widthOf(column)}
                  style={column.shrinkTo ? ({ '--shrink-to': column.shrinkTo } as CSSProperties) : undefined}
                  className={cn(column.align === 'end' && 'text-right', column.align === 'center' && 'text-center')}
                >
                  <Skeleton
                    inline
                    className={cn(
                      'h-4 max-w-full',
                      column.mobile === 'actions' || column.mobile === 'check' ? 'w-4' : column.mobile === 'title' || column.shrinkTo ? (index + at) % 2 ? 'w-64' : 'w-44' : 'w-12',
                    )}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      ) : !headerOnly && (
      <TableBody>
        {sorted.map((row, index) => {
          const target = rowLink?.(row);
          const detail = expanded?.(row);
          const open = detail !== undefined && detail !== null && detail !== false;
          const toggle = onExpand
            ? (event: MouseEvent<HTMLTableRowElement>) => {
                if ((event.target as HTMLElement).closest(interactive)?.closest('tr') !== event.currentTarget) onExpand(row);
              }
            : undefined;
          return (
            <Fragment key={rowKey(row, index)}>
            <TableRow
              className={rowClassName?.(row)}
              data-state={rowState?.(row)}
              data-clickable={target || toggle ? '' : undefined}
              data-expanded={expanded ? (open ? 'open' : 'closed') : undefined}
              aria-expanded={toggle ? open : undefined}
              tabIndex={target || toggle ? 0 : undefined}
              onClick={toggle ?? (target ? (event) => openRow(row, event) : undefined)}
              onKeyDown={
                target || toggle
                  ? (event: KeyboardEvent<HTMLTableRowElement>) => {
                      if ((event.key === 'Enter' || (toggle && event.key === ' ')) && event.target === event.currentTarget) {
                        event.preventDefault();
                        event.currentTarget.click();
                      }
                    }
                  : undefined
              }
            >
              {columns.map((column) => {
                const Cell = column.rowHeader ? TableHead : TableCell;
                const cellStyle = column.cellStyle?.(row);
                return (
                  <Cell
                    scope={column.rowHeader ? 'row' : undefined}
                    style={column.shrinkTo ? ({ ...cellStyle, '--shrink-to': column.shrinkTo } as CSSProperties) : cellStyle}
                    key={column.key}
                    data-mobile={column.mobile}
                    data-label={labelOf(column)}
                    data-shrink={column.shrinkTo ? '' : undefined}
                    data-width={widthOf(column)}
                    className={cn(
                      column.align === 'end' && 'text-right tabular-nums',
                      column.align === 'center' && 'text-center tabular-nums',
                      column.cellClassName,
                    )}
                  >
                    {column.shrinkTo ? (
                      <ShrinkCell hint={column.hint?.(row)}>{column.cell(row, index)}</ShrinkCell>
                    ) : column.maxWidth ? (
                      <ShrinkCell hint={column.hint?.(row)} maxWidth={column.maxWidth}>{column.cell(row, index)}</ShrinkCell>
                    ) : textKeys.has(column.key) ? (
                      <ShrinkCell hint={column.hint?.(row)} text>{column.cell(row, index)}</ShrinkCell>
                    ) : (
                      column.cell(row, index)
                    )}
                  </Cell>
                );
              })}
            </TableRow>
            {open && (
              <TableRow data-detail="">
                <TableCell colSpan={columns.length} data-mobile="wide" className="data-table-detail">
                  {detail}
                </TableCell>
              </TableRow>
            )}
            </Fragment>
          );
        })}
      </TableBody>
      )}
      {!headerOnly && !loading && summary && (
        <TableFooter className="analytics-table-summary">
          <TableRow data-summary="">
            {columns.map((column, index) => {
              if (index > labelIndex && index < labelIndex + labelSpan) return null;
              return (
              <TableCell
                key={column.key}
                colSpan={index === labelIndex && labelSpan > 1 ? labelSpan : undefined}
                data-mobile={column.mobile === 'hide' ? 'hide' : column.mobile}
                data-label={labelOf(column)}
                className={cn(
                  column.align === 'end' && 'text-right tabular-nums',
                  column.align === 'center' && 'text-center tabular-nums',
                  column.cellClassName,
                )}
              >
                {/* The pager shares the label cell (the wide one), so it never covers a metric. */}
                {summaryAside && column.key === summaryLabelKey ? (
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 truncate">{summary[column.key]}</span>
                    {summaryAside}
                  </div>
                ) : (
                  summary[column.key] ?? null
                )}
              </TableCell>
              );
            })}
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
  // Where the rows stack as cards (a phone-wide pane), the headers give way to one "Sort by" choice and its direction; what each
  // column measures stays one info icon away (data-table.css shows the bar only there).
  const sortable = columns.filter((column) => column.sortValue);
  const nameOf = (column: DataColumn<T>) => labelOf(column) ?? (typeof column.header === 'string' ? column.header : column.key);
  const explained = columns.filter((column) => column.info);
  const phoneSort = !headerOnly && oneLine !== true && sortable.length > 0 && (
    <div className="data-table-sort">
      <span aria-hidden="true">{copy('Sort by', 'Ordenar por')}</span>
      <SelectField
        aria-label={copy('Sort by', 'Ordenar por')}
        value={sort?.key}
        placeholder={copy('Default order', 'Ordem padrão')}
        options={sortable.map((column) => ({ value: column.key, label: nameOf(column) }))}
        onValueChange={(key) => {
          const column = sortable.find((item) => item.key === key);
          if (column) sortBy(column, null);
        }}
      />
      <Button
        variant="outline"
        size="icon"
        disabled={!sort}
        aria-label={sort?.direction === 'asc' ? copy('Ascending, reverse the order', 'Crescente, inverter a ordem') : copy('Descending, reverse the order', 'Decrescente, inverter a ordem')}
        onClick={() => {
          const column = sort && sortable.find((item) => item.key === sort.key);
          if (column) sortBy(column, null);
        }}
      >
        {sort?.direction === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
      </Button>
      {explained.length > 0 && <InfoHint text={explained.map((column) => `${nameOf(column)}: ${column.info}`).join(' ')} />}
    </div>
  );
  if (headerOnly || (!caption && !phoneSort)) return table;
  return (
    <>
      {phoneSort}
      {table}
      {caption && <div className="analytics-table-caption">{caption}</div>}
    </>
  );
}
