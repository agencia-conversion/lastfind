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
/**
 * How long the provider has to finish a run, from when it was sent: past it the run fails and stops holding its prompt (a
 * prompt with a run in flight gets no new one, so a lost task used to block the next day's collection for 24 hours). Measured over 7 days and ~1,560 answers: the slowest took 4.6 hours (Gemini), Google AI Mode at most 42 minutes; Claude
 * keeps its longer window.
 */
export const providerWindowMs = (engine: Engine) => (engine === 'claude' ? 74 : 6) * 3600000;
export function boundedBatch(value: string, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}
