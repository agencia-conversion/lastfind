export type FanoutNavigation = {
  search: string;
  kind: string;
  page: number;
  selected: string | null;
  /** A word of the searches whose series replaces the per-AI chart. */
  term: string | null;
};

export function readFanoutNavigation(
  params: URLSearchParams,
): FanoutNavigation {
  const page = Number(params.get('fpage'));
  const kind = params.get('fkind');
  return {
    search: params.get('fsearch') || '',
    kind: kind === 'site' || kind === 'search' ? kind : 'all',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    selected: params.get('fq') || null,
    term: params.get('fterm') || null,
  };
}

export function writeFanoutNavigation(
  params: URLSearchParams,
  state: FanoutNavigation | null,
) {
  for (const [key, value] of [
    ['fq', state?.selected],
    ['fterm', state?.term],
    ['fsearch', state?.search],
    ['fkind', state?.kind === 'all' ? '' : state?.kind],
    ['fpage', state && state.page > 1 ? String(state.page) : ''],
  ] as const) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
}
