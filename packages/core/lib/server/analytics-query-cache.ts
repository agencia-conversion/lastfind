/** A computation under way in this isolate, and when it started. */
export type Flight<T> = { promise: Promise<T>; at: number };
/** How long after it started a computation is joined by another request; past it, the request computes its own. */
export const FLIGHT_JOIN_MS = 30_000;
const LATE = Symbol('late');
/**
 * The computation for `key` another request of this isolate already started, or a new one. In a Worker a computation belongs
 * to the request that started it: when that request ends (a page that stopped waiting, a browser that aborted it), the runtime
 * cancels its I/O and the promise never settles, so a request joining it would wait forever and so would every later one
 * (the key stays taken). `keep` (the runtime's `waitUntil`) lets it finish after its request; whatever outlives even that
 * is joined for `joinMs` at most from its start, then the request computes its own.
 */
export function shareFlight<K, T>(
  flights: Map<K, Flight<T>>,
  key: K,
  start: () => Promise<T>,
  keep: (work: Promise<unknown>) => void,
  { clock = Date.now, joinMs = FLIGHT_JOIN_MS }: { clock?: () => number; joinMs?: number } = {},
): Promise<T> {
  const own = () => {
    const promise = start().finally(() => {
      if (flights.get(key)?.promise === promise) flights.delete(key);
    });
    flights.set(key, { promise, at: clock() });
    keep(promise.catch(() => {}));
    return promise;
  };
  const flight = flights.get(key);
  const left = flight ? flight.at + joinMs - clock() : 0;
  if (!flight || left <= 0) return own();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((done) => {
    timer = setTimeout(() => done(LATE), left);
  });
  return Promise.race([flight.promise, late])
    .then((value) => (value === LATE ? (flights.get(key) === flight ? own() : shareFlight(flights, key, start, keep, { clock, joinMs })) : value))
    .finally(() => clearTimeout(timer));
}

// Cache only successful, bounded analytical reads after ownership and registry checks.
const entries = new Map<
  string,
  { data: unknown; expires: number; bytes: number }
>();
const pending = new Map<string, Flight<unknown>>();
let bytes = 0;
const MAX_BYTES = 8 * 1024 * 1024;
/** `keep`: the runtime's `waitUntil`, so a read another request joins finishes even if the request that started it ends. */
export async function cachedAnalyticsQuery<T>(
  key: string,
  load: () => Promise<T>,
  {
    keep,
    clock = Date.now,
    onExpiry,
  }: { keep: (work: Promise<unknown>) => void; clock?: () => number; onExpiry?: (expires: number) => void },
): Promise<T> {
  const entry = entries.get(key);
  if (entry && entry.expires > clock()) {
    onExpiry?.(entry.expires);
    return entry.data as T;
  }
  if (entry) {
    entries.delete(key);
    bytes -= entry.bytes;
  }
  if (pending.size >= 128 && !pending.has(key)) return load();
  const promise = shareFlight(pending, key, () => load()
    .then((data) => {
      const size = new TextEncoder().encode(JSON.stringify(data)).byteLength;
      if (size <= MAX_BYTES / 2) {
        entries.set(key, { data, expires: clock() + 30_000, bytes: size });
        bytes += size;
        while (entries.size > 128 || bytes > MAX_BYTES) {
          const oldest = entries.keys().next().value!;
          bytes -= entries.get(oldest)!.bytes;
          entries.delete(oldest);
        }
      }
      return data;
    }), keep, { clock });
  return promise.then((data) => {
    onExpiry?.(entries.get(key)?.expires ?? clock());
    return data as T;
  });
}

/**
 * `load()` shared by every isolate of a location through the Worker Cache, under `origin/prefix/version/sha256(key)`.
 * The key must name everything the result depends on; the worker version keeps a result from outliving the code that
 * shaped it (Worker Cache survives deployments). Without a cache, a version or an origin the result is simply computed.
 */
export async function sharedQuery<T>(
  key: string,
  load: () => Promise<T>,
  {
    origin,
    prefix,
    version,
    ttlSeconds,
    cache = (globalThis.caches as (CacheStorage & { default?: Cache }) | undefined)?.default,
    timed = (_name, work) => work(),
  }: {
    origin: string;
    prefix: string;
    version: string | undefined;
    ttlSeconds: number;
    cache?: Pick<Cache, 'match' | 'put'>;
    /** Server-Timing of the cache calls (`timed` of ./server-timing), passed in so this module stays dependency-free. */
    timed?: <R>(name: string, work: () => Promise<R>) => Promise<R>;
  },
): Promise<T> {
  if (!cache || !version || !origin) return load();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const request = new Request(`${origin}/${prefix}/${version}/${hash}`);
  const hit = await timed('shared-cache', () => cache.match(request));
  if (hit) return (await hit.json()) as T;
  const data = await load();
  await timed('shared-cache', () =>
    cache.put(request, Response.json(data, { headers: { 'Cache-Control': `public, max-age=${ttlSeconds}` } })),
  );
  return data;
}
