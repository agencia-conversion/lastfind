'use client';
import { useEffect, useState } from 'react';
import { requestJson } from '@/lib/client';

// A report is fetched only when its surface is visible. Abort stale project or
// filter requests; never render another project's retained response as current.
export function useReport<T>(url: string | null, refresh: number | string = 0) {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>(
    { key: '' },
  );
  const key = url ? `${url}\0${refresh}` : '';
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      requestJson<T>(url, 'GET', undefined, controller.signal)
        .then((data) => setState({ key, data }))
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({ key, error: error.message });
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, key]);
  return {
    data: state.key === key ? state.data : undefined,
    error: state.key === key ? state.error : undefined,
    loading: !!url && (state.key !== key || (!state.data && !state.error)),
  };
}
