import type { Engine } from './engines.ts';

// Polling task_get is free at DataForSEO, but each poll still uses Worker/D1
// resources. Provider callbacks can wake a task before this fallback deadline.
export function nextPollTime(
  engine: Engine,
  attempt: number,
  time = Date.now(),
) {
  const delays = engine === 'claude' ? [15, 30, 60, 120] : [1, 2, 5, 15, 30];
  return new Date(
    time + delays[Math.min(Math.max(0, attempt), delays.length - 1)] * 60000,
  ).toISOString();
}
export function boundedBatch(value: string, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}
