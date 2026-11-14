'use client';
import { useEffect, useState } from 'react';
import { requestJson } from '@/lib/client';
import { useReport } from '@/hooks/use-report';

/**
 * `useReport` whose last answer stays in this tab's session storage under `storageKey`: on a later visit (another screen
 * and back, a reload) it paints at once and the new read replaces it. `storageKey` null keeps nothing (the public demo).
 * An answer the server kept from an earlier read (`cachedAt`) also paints at once and is read again with `fresh`. A failed read
 * returns no data, so the screen shows its error state.
 */
export function useKeptReport<T>(
  url: string | null,
  storageKey: string | null,
  refresh: number | string = 0,
  request: typeof requestJson = requestJson,
) {
  const [fresh, setFresh] = useState<string | null>(null);
  const remote = useReport<T>(url && fresh === url ? `${url}${url.includes('?') ? '&' : '?'}fresh=1` : url, refresh, request);
  if (url && fresh !== url && (remote.data as { cachedAt?: string } | undefined)?.cachedAt) setFresh(url);
  const [kept, setKept] = useState<{ key: string; data: T } | undefined>(() => {
    if (!storageKey || typeof window === 'undefined') return undefined;
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      return saved ? { key: storageKey, data: JSON.parse(saved) as T } : undefined;
    } catch {
      return undefined;
    }
  });
  if (remote.data && storageKey && remote.data !== kept?.data) setKept({ key: storageKey, data: remote.data });
  useEffect(() => {
    if (!storageKey || !remote.data) return;
    try {
      const value = JSON.stringify(remote.data);
      if (value.length < 2_000_000) window.sessionStorage.setItem(storageKey, value);
    } catch {
      /* A full or blocked storage only costs the instant paint. */
    }
  }, [storageKey, remote.data]);
  // Another project's or filter's copy is never shown as this one, and a read that failed shows its error, never the copy it
  // was replacing (up to a day old).
  const saved = kept?.key === storageKey && !remote.error ? kept.data : undefined;
  return { ...remote, data: remote.error ? undefined : remote.data ?? saved, loading: remote.loading && !saved };
}
