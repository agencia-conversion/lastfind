'use client';
import { useEffect, useState } from 'react';
import { requestJson } from '@/lib/client';

// A report is fetched only when its surface is visible. Abort stale project or
// filter requests; never render another project's retained response as current.
export function useReport<T>(
  url: string | null,
  refresh: number | string = 0,
  request: typeof requestJson = requestJson,
) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>(
    { key: '' },
  );
  const key = url ? `${url}\0${refresh}` : '';
  // Nothing read yet (the screen's first read), and this read already answered (nothing to ask).
  const idle = !state.key, settled = state.key === key;
  // A cached request (analytics-cache) tells when a newer answer for this URL arrives in the background.
  const subscribe = (request as { subscribe?: (listener: (path: string, data: unknown) => void) => () => void }).subscribe;
  useEffect(() => {
    if (!url) return;
    const unsubscribe = subscribe?.((path, data) => {
      if (path === url) setState({ key, data: data as T });
    });
    if (settled) return unsubscribe;
    const controller = new AbortController();
    // The pause only folds quick successive changes (filters, back and forth) into one request; the screen's first read
    // has nothing to fold and leaves at once.
    const timer = setTimeout(() => {
      request<T>(url, 'GET', undefined, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setState({ key, data });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({ key, error: error.message });
        });
    }, idle ? 0 : 180);
    return () => {
      unsubscribe?.();
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, key, request, subscribe, idle, settled]);
  // A refresh of the same URL keeps the previous data on screen while it reloads (no blank/reflow after an action).
  const current = state.key === key || (!!url && state.key.startsWith(`${url}\0`));
  return {
    data: current ? state.data : undefined,
    error: state.key === key ? state.error : undefined,
    loading: !!url && (state.key !== key || (!state.data && !state.error)),
  };
}
