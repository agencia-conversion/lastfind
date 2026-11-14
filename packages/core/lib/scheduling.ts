// Each project collects once a day, or once a week on a chosen day, at an hour a workspace admin chooses, both
// in the WORKSPACE's time zone (`accounts.time_zone`, the browser's at creation; none stored is America/Sao_Paulo, where every
// workspace collected before). Default: Monday 04:00 local. `projects.collection_hour` is that local hour and
// `projects.collection_day` the weekday (0 Sunday to 6 Saturday); the migration that added the day moved the hours stored in UTC
// to São Paulo's. A weekly-only plan is always weekly.
export const INTERVALS = [24, 168] as const;
export const DAILY = 24;
export const WEEKLY = 168;
export const DEFAULT_COLLECTION_HOUR = 4;
export const DEFAULT_COLLECTION_DAY = 1;
export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
export type CollectionSchedule = { weekly: boolean; day: number; hour: number; zone: string };
export const validHour = (value: unknown) =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 23;
export const validDay = (value: unknown) =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6;
/** An IANA time zone this runtime knows (`Intl` throws on any other). */
export function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
/** The schedule a project row runs on, in its workspace's zone: a weekly-only plan (`free`) is weekly whatever the row says. */
export function scheduleOf(
  project: { interval_hours?: unknown; collection_hour?: unknown; collection_day?: unknown },
  free = false,
  zone?: string | null,
): CollectionSchedule {
  const hour = Number(project.collection_hour);
  const day = Number(project.collection_day ?? DEFAULT_COLLECTION_DAY);
  return {
    weekly: free || Number(project.interval_hours) === WEEKLY,
    day: validDay(day) ? day : DEFAULT_COLLECTION_DAY,
    hour: validHour(hour) ? hour : DEFAULT_COLLECTION_HOUR,
    zone: validTimeZone(zone) ? zone : DEFAULT_TIME_ZONE,
  };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The local calendar date (as a UTC midnight) and weekday of an instant in `zone`. */
function localDate(at: number, zone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}
/** How far `zone`'s wall clock is ahead of UTC at an instant. */
function offset(at: number, zone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return wall - Math.floor(at / 60_000) * 60_000;
}
/** The instant of `hour`:00 on a local date (a UTC midnight) in `zone`; an hour a clock change skips runs an hour later. */
function slotOn(date: number, hour: number, zone: string) {
  const wall = date + hour * HOUR;
  const at = wall - offset(wall - offset(wall, zone), zone);
  if (at + offset(at, zone) === wall) return at;
  // Inside a skipped hour: the offset before the change, which lands just after it.
  return Math.max(wall - offset(at - 3 * HOUR, zone), wall - offset(at + 3 * HOUR, zone));
}
/** The project's slots around `from`, oldest first: every local day (daily) or its weekday (weekly), from 8 days before to 8 after. */
function slots(from: string, schedule: CollectionSchedule) {
  const today = localDate(Date.parse(from), schedule.zone);
  const list: number[] = [];
  for (let shift = -8; shift <= 8; shift++) {
    const date = today + shift * DAY;
    if (!schedule.weekly || new Date(date).getUTCDay() === schedule.day) list.push(slotOn(date, schedule.hour, schedule.zone));
  }
  return list;
}
/** The next collection strictly after `from`. */
export function nextCollection(from: string, schedule: CollectionSchedule): string {
  const at = Date.parse(from);
  return new Date(slots(from, schedule).find((slot) => slot > at)!).toISOString();
}
/** The next collection after now, as Settings > Monitoring shows it ("Mon, 9 Nov, 04:00 GMT-3"), in the schedule's zone. */
export function formatNextCollection(schedule: CollectionSchedule, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'pt-BR' ? 'pt-BR' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: schedule.zone, timeZoneName: 'short' })
    .format(new Date(nextCollection(new Date().toISOString(), schedule)));
}
/** The latest collection at or before `from`: the slot a prompt due now belongs to. */
export function lastCollection(from: string, schedule: CollectionSchedule): string {
  const at = Date.parse(from);
  return new Date(slots(from, schedule).findLast((slot) => slot <= at)!).toISOString();
}
/**
 * The run's request key: the LOCAL date of the slot due at `from`. A prompt is collected at most once per slot date, even when an
 * admin moves the hour within the same day, and a clock change cannot give two slots one date.
 */
export function slotKey(from: string, schedule: CollectionSchedule): string {
  return new Date(localDate(Date.parse(lastCollection(from, schedule)), schedule.zone)).toISOString().slice(0, 10);
}
/**
 * The weekly quota's week: Monday 00:00 in the workspace's zone, fixed for every project. Never the chosen day or hour: a window that
 * moved with them would let a mid-week change open a second week. They only pick when, inside it, the run happens.
 */
export function quotaWeek(from: string, zone = DEFAULT_TIME_ZONE): string {
  const today = localDate(Date.parse(from), zone);
  return new Date(slotOn(today - ((new Date(today).getUTCDay() + 6) % 7) * DAY, 0, zone)).toISOString();
}
/**
 * Semantic Branding's day (lib/server/semantic-panel*.ts): the latest `hour`:00 UTC at or before `from`, by default 07:00 UTC
 * (04:00 Brasília). Not the collection's schedule.
 */
export function scheduleWindow(from: string, hour = 7): string {
  const current = new Date(from);
  current.setUTCHours(hour, 0, 0, 0);
  if (current.getTime() > Date.parse(from))
    current.setUTCDate(current.getUTCDate() - 1);
  return current.toISOString();
}
export function positiveLimit(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
