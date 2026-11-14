'use client';
import { useCallback, useEffect, useState } from 'react';
import { requestJson } from '@/lib/client';

/**
 * Every table the account saved, read once per page and shared by all the tables on it (four or five tables used to ask one
 * request each on every screen). A failed read is asked again by the next table that mounts. A save updates the shared copy.
 */
let saved: Promise<Record<string, string[]>> | null = null;
function savedTables() {
  saved ??= requestJson<{ tables: Record<string, string[]> }>('/api/preferences/table-columns').then(
    (data) => data.tables ?? {},
    (error) => {
      saved = null;
      throw error;
    },
  );
  return saved;
}

/**
 * Hidden optional columns for one table, remembered on the account (demo: memory only).
 * `tableKey` is stable across locales (e.g. `brands`, `sources-domain`).
 * `defaultHidden` applies until prefs load, and when the account has never saved this table.
 */
export function useTableColumns(
  tableKey: string,
  demo = false,
  defaultHidden: string[] = [],
) {
  const [hidden, setHidden] = useState<string[]>(defaultHidden);
  const [ready, setReady] = useState(demo);
  const defaults = defaultHidden.join('\0');

  useEffect(() => {
    if (demo) return;
    const initial = defaults ? defaults.split('\0') : [];
    let cancelled = false;
    savedTables()
      .then((tables) => {
        if (cancelled) return;
        const value = tables[tableKey];
        setHidden(Array.isArray(value) ? value : initial);
      })
      .catch(() => {
        if (!cancelled) setHidden(initial);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [demo, tableKey, defaults]);

  const save = useCallback(
    (next: string[]) => {
      setHidden(next);
      if (demo) return;
      void saved?.then((tables) => {
        tables[tableKey] = next;
      }, () => {});
      void requestJson('/api/preferences/table-columns', 'PUT', {
        table: tableKey,
        hidden: next,
      }).catch(() => {
        /* Keep the local choice; next visit reloads from the server. */
      });
    },
    [demo, tableKey],
  );

  return { hidden, setHidden: save, ready };
}

export function visibleColumns<T extends { key: string }>(columns: T[], hidden: string[], required: string[] = []): T[] {
  const locked = new Set(required);
  return columns.filter((column) => locked.has(column.key) || !hidden.includes(column.key));
}
