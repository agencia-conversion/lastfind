import { AsyncLocalStorage } from 'node:async_hooks';

// Where a request spends its time, in production: only the routes that wrap themselves in `withServerTiming` collect (the
// demo's reports, Brands and brand research; the header carries step names and durations, nothing private); everywhere
// else `timed` just runs the work.
const active = new AsyncLocalStorage<{ start: number; totals: Map<string, { ms: number; calls: number }> }>();

/** Awaits `work`, adding its time to `name`. Calls that overlap add up, so a name can exceed the request's `total`. */
export function timed<T>(name: string, work: () => Promise<T>): Promise<T> {
  const collector = active.getStore();
  if (!collector) return work();
  const start = Date.now();
  return work().finally(() => {
    const entry = collector.totals.get(name) ?? { ms: 0, calls: 0 };
    entry.ms += Date.now() - start;
    entry.calls++;
    collector.totals.set(name, entry);
  });
}

export const collectingServerTiming = () => !!active.getStore();

/** Runs a route and puts the time per `timed` name on its response as a `Server-Timing` header. */
export async function withServerTiming(run: () => Promise<Response>): Promise<Response> {
  const collector = { start: Date.now(), totals: new Map<string, { ms: number; calls: number }>() };
  const response = await active.run(collector, run);
  const parts = [...collector.totals].map(([name, { ms, calls }]) => `${name};dur=${ms};desc="${calls} calls"`);
  response.headers.set('Server-Timing', [`total;dur=${Date.now() - collector.start}`, ...parts].join(', '));
  return response;
}
