/** Distinct, identity-stable colors for visibility series.
 *
 * Visual source (2026-09-09): Peec AI product shot
 * `https://framerusercontent.com/images/DpXLw8DpKw64eO3kjQgLPOa5rk.webp`
 * (official peec.ai homepage/product art). The graph uses solid lines in
 * separate hues per brand — gray, green, orange, red, blue, magenta, cyan —
 * not a monochrome ramp. Lastfind keeps Conversion blue `#1649FF` for the
 * tracked brand and maps competitors onto the remaining Peec-like hues.
 *
 * Color is keyed by the player's place in the canonical competitor roster,
 * never by ranking or filter order. Hiding or sorting series must not recolor
 * a remaining player. Docs: https://docs.peec.ai/identifying-your-competitors
 * (per-brand color on graphs) and
 * https://docs.peec.ai/understanding-your-performance (one line per brand).
 */
export const CHART_SERIES_COUNT = 6;
const COMPETITOR_SLOTS = CHART_SERIES_COUNT - 1;

function competitorSlot(playerName: string, competitorRoster: readonly string[]): number {
  const index = competitorRoster.indexOf(playerName);
  return (index >= 0 ? index : 0) % COMPETITOR_SLOTS;
}

export function seriesColorVar(
  playerName: string,
  brandName: string,
  competitorRoster: readonly string[],
): string {
  if (playerName === brandName) return 'var(--chart-1)';
  return `var(--chart-${competitorSlot(playerName, competitorRoster) + 2})`;
}

export function seriesColorToken(
  playerName: string,
  brandName: string,
  competitorRoster: readonly string[],
): `chart-${1 | 2 | 3 | 4 | 5 | 6}` {
  if (playerName === brandName) return 'chart-1';
  return `chart-${(competitorSlot(playerName, competitorRoster) + 2) as 2 | 3 | 4 | 5 | 6}`;
}

/**
 * Single ordering rule for every multi-series chart (legend, drawing order and
 * tooltip): biggest period total first. Series without a total (no data in the
 * period) go last, ties keep the order they came in.
 *
 * `direction: 'asc'` is for metrics where a lower value is better (average
 * position): the best series still comes first.
 */
export function orderSeriesByTotal<T>(
  series: readonly T[],
  total: (item: T) => number | null | undefined,
  direction: 'desc' | 'asc' = 'desc',
): T[] {
  const sign = direction === 'desc' ? -1 : 1;
  return series
    .map((item, index) => {
      const value = total(item);
      return {
        item,
        index,
        value: typeof value === 'number' && Number.isFinite(value) ? value : null,
      };
    })
    .sort((a, b) => {
      if (a.value === null || b.value === null)
        return a.value === b.value ? a.index - b.index : a.value === null ? 1 : -1;
      return sign * (a.value - b.value) || a.index - b.index;
    })
    .map((entry) => entry.item);
}
