export type CustomDateRange = {
  valid: boolean;
  error: '' | 'incomplete' | 'invalid' | 'order' | 'range';
  start: number;
  end: number;
};

/** Parses the date-input format using the same inclusive 1–90 day rule as reports. */
export function parseCustomDateRange(
  startDate: string,
  endDate: string,
): CustomDateRange {
  if (!startDate && !endDate)
    return { valid: false, error: '', start: Number.NaN, end: Number.NaN };
  if (!startDate || !endDate)
    return {
      valid: false,
      error: 'incomplete',
      start: Number.NaN,
      end: Number.NaN,
    };
  const isCalendarDay = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = Date.parse(`${value}T00:00:00.000Z`);
    if (
      !Number.isFinite(date) ||
      new Date(date).toISOString().slice(0, 10) !== value
    )
      return null;
    return date;
  };
  const start = isCalendarDay(startDate);
  const endDateMs = isCalendarDay(endDate);
  if (start == null || endDateMs == null)
    return {
      valid: false,
      error: 'invalid',
      start: start ?? Number.NaN,
      end: (endDateMs ?? Number.NaN) + 86400000,
    };
  const inclusiveDays = Math.round((endDateMs - start) / 86400000) + 1;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(endDateMs) ||
    inclusiveDays < 1
  )
    return { valid: false, error: 'order', start, end: endDateMs + 86400000 };
  if (inclusiveDays > 90)
    return { valid: false, error: 'range', start, end: endDateMs + 86400000 };
  return { valid: true, error: '', start, end: endDateMs + 86400000 };
}
