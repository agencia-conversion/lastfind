import { responseCacheExpiry, type requestJson } from './client.ts';

const TTL = 30_000;
/** GET reads the cache answers (and keeps for the tab): never auth, admin or settings reads. */
const CACHED_PATHS = /\/workspace(?:\?|$)|\/reports\?|\/semantic(?:\?|$)|\/brand-research\?|\/runs\/|\/brands\?top=/;
/**
 * The reads kept for a later visit: the screens' reports, the workspace and the most mentioned discoveries (the header's Brands
 * menu opens with them at once); answers' text stays in memory only.
 */
const KEPT_PATHS = /\/workspace(?:\?|$)|\/reports\?|\/semantic(?:\?|$)|\/brand-research\?|\/brands\?top=/;

/** Project ids named in a path (`/projects/:id` or `?project=`). */
export function analyticsProjectRefs(path: string): string[] {
  const refs: string[] = [];
  for (const match of path.matchAll(/\/projects\/([^/?#]+)/g))
    refs.push(decodeURIComponent(match[1]));
  try {
    const project = new URL(path, 'https://local.invalid').searchParams.get(
      'project',
    );
    if (project) refs.push(project);
  } catch {
    /* Relative paths without a query are fine. */
  }
  return refs;
}

/**
 * Whether a cached GET should be dropped after a write.
 * Same project (or writes without a project in the URL) only — other projects stay.
 */
export function analyticsMutationTouches(
  mutationPath: string,
  cachedPath: string,
): boolean {
  const targets = analyticsProjectRefs(mutationPath);
  const cached = analyticsProjectRefs(cachedPath);
  if (targets.length && cached.length)
    return cached.some((id) => targets.includes(id));
  if (targets.length) {
    // Shared surfaces that do not name a project still belong to the session.
    return /\/workspace(?:\?|$)|\/semantic(?:\?|$)|\/runs\//.test(cachedPath);
  }
  // Prompt/topic/auth writes: drop analytics surfaces, keep unrelated projects out
  // only when they are explicitly scoped (handled above when both have refs).
  return /\/workspace(?:\?|$)|\/reports\?|\/semantic(?:\?|$)|\/runs\/|\/projects\/|\/brand|\/source-types|\/prompts|\/topics|\/demo\//.test(
    cachedPath,
  );
}

/** Session storage prefix of the kept reads; the account follows it, so another account never reads them. */
const KEPT_PREFIX = 'lastfind:analytics:';
/** A kept read larger than this is not kept (session storage holds about 5 MB per site). */
const KEPT_MAX_CHARS = 1_000_000;
export type AnalyticsCacheOptions = {
  /**
   * The signed-in account: its reads are kept in this tab's session storage, so a reload or a later visit in the tab paints
   * the last answer at once while a fresh read replaces it. Absent (the public demo) keeps nothing.
   */
  scope?: string | null;
  /**
   * A read already under way for a path (the page's first workspace, sent by the server with the page), and `reads`: the
   * screen's first reports the server started once it knew the project (route-page.tsx), each adopted like the workspace
   * (null: not sent, the browser asks).
   */
  seed?: { path: string; data: Promise<unknown>; reads?: Promise<{ path: string; data: Promise<unknown> }[]> } | null;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | null;
};
function sessionArea(): AnalyticsCacheOptions['storage'] {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
/** Removes the kept reads (every account's, or every one but `keep`'s). */
function forgetKept(area: NonNullable<AnalyticsCacheOptions['storage']>, keep?: string) {
  try {
    const doomed: string[] = [];
    for (let index = 0; index < area.length; index++) {
      const key = area.key(index);
      if (key?.startsWith(KEPT_PREFIX) && !(keep && key.startsWith(keep))) doomed.push(key);
    }
    for (const key of doomed) area.removeItem(key);
  } catch {
    /* A blocked storage keeps nothing anyway. */
  }
}

// Each mounted application owns its request transport and session generation.
// Demo state never shares this cache with the authenticated application.
export function createAnalyticsRequest(
  transport: typeof requestJson,
  clock = Date.now,
  { scope = null, seed = null, storage = scope ? sessionArea() : null }: AnalyticsCacheOptions = {},
) {
  const area = scope ? storage : null;
  const prefix = `${KEPT_PREFIX}${scope}:`;
  // Another account's reads never stay in this tab.
  if (area) forgetKept(area, prefix);
  const keep = (path: string, data: unknown) => {
    if (!area) return;
    try {
      const value = JSON.stringify(data);
      if (value.length > KEPT_MAX_CHARS) return;
      try {
        area.setItem(prefix + path, value);
      } catch {
        // Full: start over with this read only.
        forgetKept(area);
        area.setItem(prefix + path, value);
      }
    } catch {
      /* Keeping is only a faster next paint. */
    }
  };
  const forget = (path: string) => {
    try {
      area?.removeItem(prefix + path);
    } catch {
      /* Nothing kept. */
    }
  };
  let generation = 0,
    bytes = 0;
  const cache = new Map<
    string,
    { data: unknown; at: number; expires: number; bytes: number }
  >();
  const listeners = new Set<(path: string, data: unknown) => void>();
  const pending = new Map<string, Promise<unknown>>();
  const drop = (path: string) => {
    const entry = cache.get(path);
    if (entry) {
      bytes -= entry.bytes;
      cache.delete(path);
    }
    pending.delete(path);
    forget(path);
  };
  const invalidate = () => {
    generation++;
    cache.clear();
    pending.clear();
    bytes = 0;
    if (area) forgetKept(area);
  };
  const invalidateRelated = (mutationPath: string) => {
    generation++;
    const doomed: string[] = [];
    for (const path of cache.keys()) {
      if (analyticsMutationTouches(mutationPath, path)) doomed.push(path);
    }
    for (const path of pending.keys()) {
      if (analyticsMutationTouches(mutationPath, path)) doomed.push(path);
    }
    for (const path of doomed) drop(path);
  };
  const read = (path: string) => {
    const entry = cache.get(path);
    if (entry) return clock() < entry.expires ? entry : undefined;
    if (!area || !KEPT_PATHS.test(path)) return undefined;
    // A read kept by an earlier visit of this tab: shown at once, and old enough that the next request refreshes it.
    try {
      const value = area.getItem(prefix + path);
      if (value == null) return undefined;
      const kept = { data: JSON.parse(value) as unknown, at: -Infinity, expires: clock() + TTL, bytes: value.length };
      cache.set(path, kept);
      bytes += kept.bytes;
      return kept;
    } catch {
      return undefined;
    }
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
            if (KEPT_PATHS.test(path)) keep(path, data);
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
  const fetchThrough: typeof requestJson = async <T>(
    path: string,
    method = 'GET',
    data?: unknown,
    signal?: AbortSignal,
  ): Promise<T> => {
    if (method !== 'GET') {
      const result = await transport<T>(path, method, data, signal);
      invalidateRelated(path);
      return result;
    }
    // Auth endpoints must always revalidate permissions with the server.
    if (!CACHED_PATHS.test(path)) return transport<T>(path, method, data, signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const entry = read(path);
    // A write landed while this read was under way (invalidate): its answer may predate the write, so it is read again
    // instead of failing the screen with "Aborted" (a screen does not ask again for a read that already settled).
    const fresh = () =>
      load(path).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError' && !signal?.aborted) return load(path);
        throw error;
      });
    const promise = entry ? Promise.resolve(entry.data) : fresh();
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
  // A read already under way on the server (the page's first workspace, then the screen's first reports): the first request
  // for its path waits for it. React hands a server promise over as a bare thenable: adopted into a real promise, and only in
  // the browser.
  const adopt = (path: string, data: Promise<unknown>) => {
    if (!CACHED_PATHS.test(path) || pending.has(path) || (cache.get(path)?.at ?? -Infinity) > -Infinity) return;
    const version = generation;
    const promise = Promise.resolve(data)
      .then((data) => {
        if (generation !== version) throw new DOMException('Aborted', 'AbortError');
        // The server did not send it (failed, or too slow to wait for): the browser asks.
        if (data == null) throw new Error('Not sent with the page.');
        // A screen already painted from a kept copy hears about the fresh one.
        const shownKept = cache.get(path)?.at === -Infinity;
        const expires = data && typeof data === 'object' ? responseCacheExpiry.get(data) : undefined;
        cache.set(path, { data, at: clock(), expires: Math.min(clock() + TTL, expires ?? Infinity), bytes: 0 });
        if (KEPT_PATHS.test(path)) keep(path, data);
        if (shownKept) for (const listener of listeners) listener(path, data);
        return data;
      })
      // A failed server read is asked again by the browser (once: a later request finds that answer).
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return Promise.reject(error);
        if (pending.get(path) === promise) pending.delete(path);
        return load(path);
      })
      .finally(() => {
        if (pending.get(path) === promise) pending.delete(path);
      });
    promise.catch(() => {});
    pending.set(path, promise);
  };
  if (seed && typeof window !== 'undefined') {
    adopt(seed.path, seed.data);
    void Promise.resolve(seed.reads)
      .then((reads) => {
        for (const read of reads ?? []) adopt(read.path, read.data);
      })
      .catch(() => {});
  }
  /**
   * Reads again, in the background, every path read so far: a screen showing one gets the new answer in place, never a skeleton (a new
   * project's first collection, 13/11/2026).
   */
  const revalidate = () => {
    for (const path of cache.keys()) void load(path, true).catch(() => {});
  };
  const subscribe = (listener: (path: string, data: unknown) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  // `useReport` listens through the request it is given, so a screen painted from a kept or expiring read gets the fresh one.
  const request = Object.assign(fetchThrough, { subscribe }) as typeof requestJson & { subscribe: typeof subscribe };
  return {
    request,
    peek<T>(path: string) {
      return read(path)?.data as T | undefined;
    },
    invalidate,
    invalidateRelated,
    revalidate,
    subscribe,
    get generation() {
      return generation;
    },
  };
}
