'use client';
import { useState } from 'react';
import { requestJson } from '@/lib/client';
import { useReport } from '@/hooks/use-report';
import { BRANDS_DIGEST_MAX, type BrandRow } from '@/lib/brand-decisions';
import type { Project } from '@/lib/types';
import { toast } from '@/components/ui/toast';
import { DISCOVERED_SHOWN, discoveriesReadPath } from './screen-reads';

export type DiscoveredBrand = {
  key: string;
  name: string;
  domain: string;
  /** Saved answers of the last 90 days that mention it (the analysis count); the Overview measures its own window from `days`. */
  mentions: number | null;
  review: boolean;
  days: Record<string, number>;
  row: BrandRow;
};

/** Discovered names the Overview shows (the most mentioned): the rest wait in Brands, so the chart and ranking stay readable. */
export { DISCOVERED_SHOWN };

/** What the Overview reads of the Brands decisions API (`?top=`): the most mentioned discovered competitors, the rest counted. */
type DiscoveryOverview = { cachedAt?: string; rows: BrandRow[]; discovered?: number; analysis: { analyzed: number; status?: string; unavailable?: boolean } };

/** Discovered, not monitored brands (the Brands decisions API) for the Overview, with Reject and Undo in place. */
export function useBrandDiscoveries({
  project,
  enabled,
  refresh,
  request = requestJson,
  t,
  shown,
}: {
  project: Pick<Project, 'id'> | null | undefined;
  enabled: boolean;
  refresh: number | string;
  /**
   * The header's Brands filter: the discoveries it lists, before the most mentioned are taken, so a hidden one frees
   * its place; the ones it picks (among the 50 most mentioned the read brings) are all shown.
   */
  shown?: { brand: (key: string) => boolean; picked: boolean };
  /** The app's own transport: the demo answers from its client, not the network. */
  request?: typeof requestJson;
  t: (en: string, pt: string) => string;
}) {
  const [poll, setPoll] = useState(0);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  /** Keys removed optimistically until the overview refresh catches up. */
  const [hidden, setHidden] = useState<Record<string, true>>({});
  const base = project ? `/api/projects/${encodeURIComponent(project.id)}/brands` : null;
  // The first read may be the server's last list (`cachedAt`): it paints at once and is read again now, as every later one.
  const remote = useReport<DiscoveryOverview>(enabled && project ? `${discoveriesReadPath(project.id)}${poll ? '&fresh=1' : ''}` : null, `${refresh}:${poll}`, request);
  if (remote.data?.cachedAt && !poll) setPoll(1);
  // Keep the last answer while a refresh is in flight so the ranking never flashes.
  const [kept, setKept] = useState<DiscoveryOverview>();
  if (remote.data && remote.data !== kept) setKept(remote.data);
  const overview = remote.data ?? kept;
  // Why there may be nothing to show: the read failed, the store is unavailable, or the analysis is still running.
  const state: 'loading' | 'error' | 'unavailable' | 'analyzing' | 'ready' = !enabled
    ? 'ready'
    : !overview
      ? remote.error ? 'error' : 'loading'
      : overview.analysis.unavailable
        ? 'unavailable'
        : overview.analysis.status === 'pending' || overview.analysis.status === 'running'
          ? 'analyzing'
          : 'ready';
  const analyzed = overview?.analysis.analyzed ?? 0;
  const discovered = (overview?.rows ?? []).filter(
    (row) => row.status === 'discovered' && !hidden[row.key],
  );
  // Doubtful names and clients/suppliers are not competitors: they wait in Brands, never shown as ranked.
  const ranked = discovered
    .filter((row) => !row.review && row.role === 'competitor' && (!shown || shown.brand(row.key)))
    .sort((left, right) => (right.responses ?? 0) - (left.responses ?? 0))
    .slice(0, shown?.picked ? BRANDS_DIGEST_MAX : DISCOVERED_SHOWN);
  const brands: DiscoveredBrand[] = ranked.map((row) => ({
      key: row.key,
      name: row.name,
      domain: row.domain ?? '',
      mentions: row.responses,
      review: row.review,
      days: row.days,
      row,
    }));

  async function decide(body: Record<string, unknown>, message: string | null, undoable: boolean) {
    if (!base) return;
    const key = typeof body.key === 'string' ? body.key : '';
    setWorking(true);
    setError('');
    if (body.action === 'reject' && key) setHidden((current) => ({ ...current, [key]: true }));
    try {
      const result = await request<{ id: string }>(base, 'POST', body);
      setPoll((value) => value + 1);
      if (message) {
        const toastId = toast.add({
          title: message,
          type: 'success',
          timeout: 8_000,
          ...(undoable
            ? {
                actionProps: {
                  children: t('Undo', 'Desfazer'),
                  onClick: () => {
                    toast.close(toastId);
                    void decide({ action: 'undo', eventId: result.id, key }, null, false);
                  },
                },
              }
            : {}),
        });
      }
      if (body.action === 'undo' && key) {
        setHidden((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    } catch (cause) {
      if (body.action === 'reject' && key) {
        setHidden((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
      const text = cause instanceof Error ? cause.message : String(cause);
      setError(text);
      toast.add({ title: text, type: 'error' });
    } finally {
      setWorking(false);
    }
  }
  const reject = (brand: DiscoveredBrand) =>
    decide(
      {
        action: 'reject',
        name: brand.name,
        key: brand.key,
        domain: brand.domain || undefined,
        responses: brand.mentions,
        evidence: brand.row.evidence.map((item) => item.runId),
      },
      `${t('Rejected', 'Rejeitada')}: ${brand.name}`,
      true,
    );
  return {
    brands,
    /** Discovered names not shown here: to review, client or supplier, or beyond the most mentioned. */
    waiting: (overview?.discovered ?? (overview?.rows ?? []).filter((row) => row.status === 'discovered').length) -
      (overview?.rows ?? []).filter((row) => row.status === 'discovered' && hidden[row.key]).length - ranked.length,
    analyzed,
    loading: enabled && remote.loading && !overview,
    state,
    retry: () => setPoll((value) => value + 1),
    working,
    error,
    reject,
  };
}
