import { responseCacheExpiry, type requestJson } from './client.ts';

const TTL = 30_000;
// Each mounted application owns its request transport and session generation.
// Demo state never shares this cache with the authenticated application.
export function createAnalyticsRequest(
  transport: typeof requestJson,
  clock = Date.now,
) {
  let generation = 0,
    bytes = 0;
  const cache = new Map<
    string,
    { data: unknown; at: number; expires: number; bytes: number }
  >();
  const listeners = new Set<(path: string, data: unknown) => void>();
  const pending = new Map<string, Promise<unknown>>();
  const invalidate = () => {
    generation++;
    cache.clear();
    pending.clear();
    bytes = 0;
  };
  const read = (path: string) => {
    const entry = cache.get(path);
    return entry && clock() < entry.expires ? entry : undefined;
  };
  const load = (path: string, background = false) => {
    const existing = pending.get(path);
    if (existing) return existing;
    const version = generation;
    const promise = transport(path)
      .then((data) => {
        if (generation !== version)
          throw new DOMException('Aborted', 'AbortError');
        if (generation === version) {
          const size = new TextEncoder().encode(
            JSON.stringify(data),
          ).byteLength;
          if (size <= 4 * 1024 * 1024) {
            bytes -= cache.get(path)?.bytes ?? 0;
            cache.delete(path);
            const expires =
              data && typeof data === 'object'
                ? responseCacheExpiry.get(data)
                : undefined;
            cache.set(path, {
              data,
              at: clock(),
              expires: Math.min(clock() + TTL, expires ?? Infinity),
              bytes: size,
            });
            bytes += size;
            while (cache.size > 60 || bytes > 8 * 1024 * 1024) {
              const oldest = cache.keys().next().value!;
              bytes -= cache.get(oldest)!.bytes;
              cache.delete(oldest);
            }
          }
          if (background)
            for (const listener of listeners) listener(path, data);
        }
        return data;
      })
      .finally(() => {
        if (pending.get(path) === promise) pending.delete(path);
      });
    pending.set(path, promise);
    return promise;
  };
  const request: typeof requestJson = async <T>(
    path: string,
    method = 'GET',
    data?: unknown,
    signal?: AbortSignal,
  ): Promise<T> => {
    if (method !== 'GET') {
      const result = await transport<T>(path, method, data, signal);
      invalidate();
      return result;
    }
    // Auth endpoints must always revalidate permissions with the server.
    if (
      !/\/workspace(?:\?|$)|\/reports\?|\/semantic(?:\?|$)|\/runs\//.test(path)
    )
      return transport<T>(path, method, data, signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const entry = read(path);
    const promise = entry ? Promise.resolve(entry.data) : load(path);
    // Refresh a still-valid result in the background on the next navigation.
    if (entry && clock() - entry.at >= TTL / 2)
      void load(path, true).catch(() => {});
    if (!signal) return promise as Promise<T>;
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      promise
        .then((value) => {
          if (!signal.aborted) resolve(value as T);
        }, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });
  };
  return {
    request,
    peek<T>(path: string) { return read(path)?.data as T | undefined; },
    invalidate,
    subscribe(listener: (path: string, data: unknown) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get generation() {
      return generation;
    },
  };
}
