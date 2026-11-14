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

export function relativeReportDate(
  value: string,
  locale: string,
  clock = Date.now(),
) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return '—';
  const minutes = Math.round((stamp - clock) / 60_000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  if (Math.abs(minutes) < 1440)
    return formatter.format(Math.round(minutes / 60), 'hour');
  if (Math.abs(minutes) < 10_080)
    return formatter.format(Math.round(minutes / 1440), 'day');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(stamp),
  );
}

/**
 * When a document was last edited, Google Drive style (docs/design/shell.md section 4): a short caption that reads from now
 * ("Edited 5 minutes ago", "Última edição ontem", "Edited Oct 28") and the full date for its tooltip ("Edited by the agent
 * on Nov 2, 2026, 10:07 AM"). Days count by the calendar of the browser; a moment ahead of the clock is "just now".
 * Null when there is no date to read: a Lastfind skill the workspace never changed has none.
 */
export function editedAt(value: string | null | undefined, locale: string, byAgent: boolean, clock = Date.now()) {
  const pt = locale === 'pt-BR';
  const stamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(stamp)) return null;
  const at = new Date(stamp);
  const now = new Date(clock);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'long' });
  const seconds = (clock - stamp) / 1000;
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / 86_400_000);
  const when =
    seconds < 60
      ? pt
        ? 'há instantes'
        : 'just now'
      : seconds < 3600
        ? relative.format(-Math.floor(seconds / 60), 'minute')
        : days === 0
          ? relative.format(-Math.floor(seconds / 3600), 'hour')
          : days === 1
            ? relative.format(-1, 'day')
            : `${pt ? 'em ' : ''}${new Intl.DateTimeFormat(locale, at.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' }).format(at)}`;
  const full = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
  return {
    caption: `${pt ? 'Última edição' : 'Edited'} ${when}`,
    full: pt ? `Última edição${byAgent ? ' pelo agente' : ''} em ${full}` : `Edited${byAgent ? ' by the agent' : ''} on ${full}`,
  };
}
