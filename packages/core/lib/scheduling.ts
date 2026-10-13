// The product's single daily collection window is 04:00 America/Sao_Paulo.
// Brasília currently observes UTC-03 all year; no browser timezone is used.
export const INTERVALS = [24] as const;
export const SCHEDULE_TIMEZONE = 'America/Sao_Paulo';
export function nextRunTime(from: string, _hours = 24): string {
  const date = new Date(from);
  const next = new Date(date);
  next.setUTCHours(7, 0, 0, 0);
  if (next.getTime() <= date.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}
export function nextWeeklyRunTime(from: string): string {
  const next = new Date(from);
  next.setUTCHours(7, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + ((8 - next.getUTCDay()) % 7));
  if (next.getTime() <= Date.parse(from)) next.setUTCDate(next.getUTCDate() + 7);
  return next.toISOString();
}
export function weeklyWindow(from: string): string {
  const start = new Date(from);
  start.setUTCHours(7, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (start.getTime() > Date.parse(from)) start.setUTCDate(start.getUTCDate() - 7);
  return start.toISOString();
}
export function scheduleWindow(from: string): string {
  const current = new Date(from);
  current.setUTCHours(7, 0, 0, 0);
  if (current.getTime() > Date.parse(from))
    current.setUTCDate(current.getUTCDate() - 1);
  return current.toISOString();
}
export function positiveLimit(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
