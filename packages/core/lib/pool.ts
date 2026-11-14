/**
 * Cloudflare opens at most six outbound connections at once per Worker invocation (fetch, R2, KV, Cache); a seventh waits in
 * a queue, where its timeout already runs. Paid calls therefore go at most this many at a time per invocation, so a request
 * never times out (and turns `unknown`) before it left. More throughput comes from more invocations, not a bigger pool.
 * D1, Durable Object and service-binding calls do not count.
 */
export const OUTBOUND_CONNECTIONS = 6;

/**
 * Runs `work` over `items` with at most `limit` in flight, in order; `work` stops the pool by returning `false` (what is
 * already in flight finishes), and so does an error, rethrown once every started item settled.
 */
export async function inPool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<boolean | void>) {
  let next = 0;
  let stopped = false;
  const lanes = Array.from({ length: Math.max(1, Math.min(Math.floor(limit) || 1, items.length)) }, async () => {
    while (!stopped && next < items.length)
      try {
        if ((await work(items[next++]!)) === false) stopped = true;
      } catch (error) {
        stopped = true;
        throw error;
      }
  });
  const failure = (await Promise.allSettled(lanes)).find((lane) => lane.status === 'rejected');
  if (failure) throw (failure as PromiseRejectedResult).reason;
}
