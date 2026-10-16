// Cache only successful, bounded analytical reads after ownership and registry checks.
const entries = new Map<
  string,
  { data: unknown; expires: number; bytes: number }
>();
const pending = new Map<string, Promise<unknown>>();
let bytes = 0;
const MAX_BYTES = 8 * 1024 * 1024;
export async function cachedAnalyticsQuery<T>(
  key: string,
  load: () => Promise<T>,
  clock = Date.now,
  onExpiry?: (expires: number) => void,
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
  const flight = pending.get(key);
  if (flight)
    return flight.then((data) => {
      onExpiry?.(entries.get(key)?.expires ?? clock());
      return data as T;
    });
  if (pending.size >= 128) return load();
  const promise = load()
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
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise.then((data) => {
    onExpiry?.(entries.get(key)?.expires ?? clock());
    return data;
  });
}
