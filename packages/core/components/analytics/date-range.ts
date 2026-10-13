export const DEMO_TODAY = '2026-09-10';
export const DEMO_LAST_DATE = '2026-09-09';
export const DEMO_FIRST_DATE = '2026-07-16';

const DAY_MS = 86_400_000;
const PRESET_DAYS = ['1', '7', '14', '28', '30'];

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
): boolean {
  const start = parseISODate(from);
  const end = parseISODate(to);
  if (!start || !end || !from || !to) return false;
  const span = (end.getTime() - start.getTime()) / DAY_MS + 1;
  return (
    from >= '2000-01-01' && to <= DEMO_LAST_DATE && span >= 1 && span <= 366
  );
}

export function getDateRange(filters: {
  days: string;
  from?: string;
  to?: string;
}): { from: string; to: string; start: number; end: number; days: number } {
  if (isValidDateRange(filters.from, filters.to)) {
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
  const days = PRESET_DAYS.includes(filters.days) ? Number(filters.days) : 28;
  const end = parseISODate(DEMO_TODAY)!.getTime();
  const start = end - days * DAY_MS;
  return {
    from: dateKey(new Date(start)),
    to: DEMO_LAST_DATE,
    start,
    end,
    days,
  };
}
