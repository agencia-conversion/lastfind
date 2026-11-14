'use client';

import * as React from 'react';
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type Locale,
} from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from 'lucide-react';

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'label',
  buttonVariant = 'ghost',
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>['variant'];
}) {
  const defaultClassNames = getDefaultClassNames();
  // The same components on every render: new ones would remount the whole grid, and a click that lands while it is
  // replaced (a hover that re-renders the parent) would be lost.
  const parts = React.useMemo<React.ComponentProps<typeof DayPicker>['components']>(
    () => ({
      Root: ({ className, rootRef, ...props }) => {
        return (
          <div
            data-slot="calendar"
            ref={rootRef}
            className={cn(className)}
            {...props}
          />
        );
      },
      Chevron: ({ className, orientation, ...props }) => {
        if (orientation === 'left') {
          return (
            <ChevronLeftIcon
              className={cn('cn-rtl-flip size-4', className)}
              {...props}
            />
          );
        }

        if (orientation === 'right') {
          return (
            <ChevronRightIcon
              className={cn('cn-rtl-flip size-4', className)}
              {...props}
            />
          );
        }

        return (
          <ChevronDownIcon className={cn('size-4', className)} {...props} />
        );
      },
      DayButton: ({ ...props }) => (
        <CalendarDayButton locale={locale} {...props} />
      ),
      WeekNumber: ({ children, ...props }) => {
        return (
          <td {...props}>
            <div className="flex size-(--cell-size) items-center justify-center text-center">
              {children}
            </div>
          </td>
        );
      },
      ...components,
    }),
    [locale, components],
  );

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        'p-2 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(7)] group/calendar bg-background in-data-[slot=card-content]:bg-transparent in-data-[slot=popover-content]:bg-transparent',
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className,
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(locale?.code, { month: 'short' }),
        ...formatters,
      }}
      classNames={{
        root: cn('w-fit', defaultClassNames.root),
        months: cn(
          'relative flex flex-col gap-4 md:flex-row',
          defaultClassNames.months,
        ),
        month: cn('flex w-full flex-col gap-4', defaultClassNames.month),
        nav: cn(
          'absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1',
          defaultClassNames.nav,
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-(--cell-size) p-0 select-none aria-disabled:opacity-50',
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          'size-(--cell-size) p-0 select-none aria-disabled:opacity-50',
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          'flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)',
          defaultClassNames.month_caption,
        ),
        dropdowns: cn(
          'flex h-(--cell-size) w-full items-center justify-center gap-1.5 text-menu font-medium',
          defaultClassNames.dropdowns,
        ),
        dropdown_root: cn(
          'cn-calendar-dropdown-root relative rounded-(--cell-radius)',
          defaultClassNames.dropdown_root,
        ),
        dropdown: cn(
          'absolute inset-0 bg-popover opacity-0',
          defaultClassNames.dropdown,
        ),
        caption_label: cn(
          'font-medium select-none',
          captionLayout === 'label'
            ? 'cn-calendar-caption text-menu'
            : 'cn-calendar-caption-label flex items-center gap-1 rounded-(--cell-radius) text-menu [&>svg]:size-3.5 [&>svg]:text-muted-foreground',
          defaultClassNames.caption_label,
        ),
        month_grid: cn('w-full border-collapse', defaultClassNames.month_grid),
        weekdays: cn('flex', defaultClassNames.weekdays),
        weekday: cn(
          'flex-1 rounded-(--cell-radius) text-caption font-normal text-muted-foreground select-none',
          defaultClassNames.weekday,
        ),
        week: cn('mt-2 flex w-full', defaultClassNames.week),
        week_number_header: cn(
          'w-(--cell-size) select-none',
          defaultClassNames.week_number_header,
        ),
        week_number: cn(
          'text-caption text-muted-foreground select-none',
          defaultClassNames.week_number,
        ),
        day: cn(
          // The focused day sits above its neighbours (z-20), so its ring is never painted over by the next cell or clipped by
          // a range end's own stacking context.
          // A seventh of the week, never a share of the cells drawn: the grid stops at the last allowed month (endMonth), so its
          // last week can hold fewer than seven days, which would stretch across the row.
          'group/day relative aspect-square h-full w-1/7 flex-none rounded-(--cell-radius) p-0 text-center select-none data-[focused=true]:z-20 [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)',
          props.showWeekNumber
            ? '[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)'
            : '[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)',
          defaultClassNames.day,
        ),
        range_start: cn(
          'relative isolate z-0 rounded-l-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-muted',
          defaultClassNames.range_start,
        ),
        range_middle: cn('rounded-none', defaultClassNames.range_middle),
        range_end: cn(
          'relative isolate z-0 rounded-r-(--cell-radius) bg-muted after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-muted',
          defaultClassNames.range_end,
        ),
        today: cn(
          'rounded-(--cell-radius) bg-muted text-foreground data-[selected=true]:rounded-none',
          defaultClassNames.today,
        ),
        outside: cn(
          'text-muted-foreground aria-selected:text-muted-foreground',
          defaultClassNames.outside,
        ),
        disabled: cn(
          'text-muted-foreground opacity-50',
          defaultClassNames.disabled,
        ),
        hidden: cn('invisible', defaultClassNames.hidden),
        ...classNames,
      }}
      components={parts}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        // Hover is a soft fill over whatever is under the day (a range's band stays whole), never a border; the ring is the
        // keyboard's only, offset so it shows on a filled day too (with a UX review).
        'hover:bg-transparent dark:hover:bg-transparent before:absolute before:inset-0 before:-z-10 before:rounded-(--cell-radius) hover:before:bg-foreground/5',
        'relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 text-menu leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-muted data-[range-middle=true]:text-foreground data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground dark:hover:text-foreground dark:hover:data-[range-start=true]:bg-primary dark:hover:data-[range-end=true]:bg-primary dark:hover:data-[selected-single=true]:bg-primary [&>span]:text-xs [&>span]:opacity-70',
        defaultClassNames.day,
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
