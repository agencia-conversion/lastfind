export const DEMO_TODAY = '2026-09-10';
export const DEMO_LAST_DATE = '2026-09-09';
export const DEMO_FIRST_DATE = '2026-07-16';

const DAY_MS = 86_400_000;
export type DateRangeBounds = { lastDate: string; firstDate: string; maxDays: number };
const demoBounds: DateRangeBounds = { lastDate: DEMO_LAST_DATE, firstDate: '2000-01-01', maxDays: 366 };

/** Parses an actual calendar date at midnight UTC, without rollover. */
export function parseISODate(
  value: string | null | undefined,
): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && dateKey(date) === value
    ? date
    : undefined;
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isValidDateRange(
  from: string | null | undefined,
  to: string | null | undefined,
  bounds: DateRangeBounds = demoBounds,
): boolean {
  const start = parseISODate(from);
  const end = parseISODate(to);
  if (!start || !end || !from || !to) return false;
  const span = (end.getTime() - start.getTime()) / DAY_MS + 1;
  return (
    from >= bounds.firstDate && to <= bounds.lastDate && span >= 1 && span <= bounds.maxDays
  );
}

export function getDateRange(filters: {
  days: string;
  from?: string;
  to?: string;
}, bounds: DateRangeBounds = demoBounds): { from: string; to: string; start: number; end: number; days: number } {
  if (isValidDateRange(filters.from, filters.to, bounds)) {
    const start = parseISODate(filters.from)!.getTime();
    const end = parseISODate(filters.to)!.getTime() + DAY_MS;
    return {
      from: filters.from!,
      to: filters.to!,
      start,
      end,
      days: (end - start) / DAY_MS,
    };
  }
  const requestedDays = Number(filters.days);
  const days = Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= bounds.maxDays ? requestedDays : Math.min(28, bounds.maxDays);
  const end = parseISODate(bounds.lastDate)!.getTime() + DAY_MS;
  const start = end - days * DAY_MS;
  return {
    from: dateKey(new Date(start)),
    to: bounds.lastDate,
    start,
    end,
    days,
  };
}

/**
 * What the reports compare the period with: the period of the same length right before it (default), nothing, or chosen
 * dates (both included). In the address as `compare=none` or `compareStart` + `compareEnd`; the default is omitted.
 */
export type Comparison = { mode: 'previous' } | { mode: 'none' } | { mode: 'custom'; from: string; to: string };

export function readComparison(params: URLSearchParams): Comparison {
  if (params.get('compare') === 'none') return { mode: 'none' };
  const from = params.get('compareStart'), to = params.get('compareEnd');
  return from && to && parseISODate(from) && parseISODate(to) && from <= to ? { mode: 'custom', from, to } : { mode: 'previous' };
}

export function writeComparison(params: URLSearchParams, value: Comparison) {
  for (const key of ['compare', 'compareStart', 'compareEnd']) params.delete(key);
  if (value.mode === 'none') params.set('compare', 'none');
  else if (value.mode === 'custom') {
    params.set('compareStart', value.from);
    params.set('compareEnd', value.to);
  }
}

const shiftDays = (key: string, days: number) => dateKey(new Date(parseISODate(key)!.getTime() + days * DAY_MS));

/** Chosen dates fit a period when they end before it starts and last 1 to `maxDays` days. */
export function isValidComparison(period: { from: string }, from: string | undefined, to: string | undefined, maxDays: number) {
  const start = parseISODate(from), end = parseISODate(to);
  return !!start && !!end && from! <= to! && to! < period.from && (end.getTime() - start.getTime()) / DAY_MS + 1 <= maxDays;
}

/**
 * The comparison dates of a period (both included), or null when there is none. Chosen dates that no longer fit the period
 * fall back to the period right before, so the reports never mix the two.
 */
export function comparisonRange(period: { from: string; days: number }, value: Comparison, maxDays: number) {
  if (value.mode === 'none') return null;
  if (value.mode === 'custom' && isValidComparison(period, value.from, value.to, maxDays))
    return { from: value.from, to: value.to, custom: true };
  return { from: shiftDays(period.from, -period.days), to: shiftDays(period.from, -1), custom: false };
}
