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
import { useState } from 'react';
import { cutBrandRanking } from './brand-ranking-cut.ts';

/**
 * The most brands a chart draws before the person turns any on in its legend: the project's brand and nine more
 * (defaultShownSeries). Every brand chart uses it (trends, the radar, score bars); the legend still offers the rest.
 */
export const CHART_SERIES_COUNT = 10;
/**
 * Distinct brand colours, `--chart-1` to `--chart-12` in tokens.css: the project's brand and 11 competitors, so every
 * monitored brand (MAX_COMPETITORS is 10) has its own on every chart, radar included.
 */
export const CHART_PALETTE_SIZE = 12;
/** The most brands a chart's legend offers (the project's own always among them). */
export const CHART_LEGEND_LIMIT = 25;
const COMPETITOR_SLOTS = CHART_PALETTE_SIZE - 1;
type ChartToken = `chart-${number}`;

/** A competitor's slot in the canonical roster and how many times the palette went round before it. */
function competitorSlot(playerName: string, competitorRoster: readonly string[]) {
  const index = Math.max(0, competitorRoster.indexOf(playerName));
  return { slot: index % COMPETITOR_SLOTS, round: Math.floor(index / COMPETITOR_SLOTS) };
}

/**
 * A brand's colour, the same on every chart (keyed by its place in the canonical roster). Past the palette (a discovered brand
 * beyond the 11 competitor colours) a slot comes back as a shade toward the text colour: darker on the light theme, lighter on
 * the dark one, so it stays legible on the card and is never an exact repeat.
 */
export function seriesColorVar(
  playerName: string,
  brandName: string,
  competitorRoster: readonly string[],
): string {
  if (playerName === brandName) return 'var(--chart-1)';
  const { slot, round } = competitorSlot(playerName, competitorRoster);
  const color = `var(--chart-${slot + 2})`;
  return round ? `color-mix(in srgb, ${color} ${round === 1 ? 55 : 35}%, var(--foreground))` : color;
}

/** The palette token of a brand (its shade past the palette is seriesColorVar's). */
export function seriesColorToken(
  playerName: string,
  brandName: string,
  competitorRoster: readonly string[],
): ChartToken {
  if (playerName === brandName) return 'chart-1';
  return `chart-${competitorSlot(playerName, competitorRoster).slot + 2}`;
}

/**
 * Single ordering rule for every multi-series chart (legend, drawing order and
 * tooltip): biggest period total first. Series without a total (no data in the
 * period) go last, ties keep the order they came in.
 *
 * `direction: 'asc'` is for metrics where a lower value is better (average
 * position): the best series still comes first.
 */
/**
 * The series a chart draws before the person turns any on or off in its legend: the primary ones and, of the others, the
 * `others` with the biggest totals (the project's brand and nine more, CHART_SERIES_COUNT).
 */
export function defaultShownSeries<T extends { id: string; primary: boolean }>(
  series: readonly T[],
  total: (item: T) => number,
  others = CHART_SERIES_COUNT - 1,
): Set<string> {
  return new Set([
    ...series.filter((item) => item.primary).map((item) => item.id),
    ...orderSeriesByTotal(series.filter((item) => !item.primary), total)
      .slice(0, others)
      .map((item) => item.id),
  ]);
}

/**
 * A legend's on and off state: the series the person turned on or off, the rest as `defaultShownSeries` draws them (the
 * primary ones and the biggest totals). `hidden` feeds the legend, `visible` the chart; `folded` are the hidden ones the
 * person never touched, which the legend keeps behind its "+N" (ChartLegend).
 */
export function useSeriesToggle<T extends { id: string; primary?: boolean }>(series: readonly T[], total: (item: T) => number = () => 0) {
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const shown = defaultShownSeries(series.map((item) => ({ ...item, primary: !!item.primary })), (item) => total(item as unknown as T));
  const hidden = series.filter((item) => !(choices[item.id] ?? shown.has(item.id))).map((item) => item.id);
  return {
    hidden,
    folded: hidden.filter((id) => !(id in choices)),
    visible: series.filter((item) => !hidden.includes(item.id)),
    toggle: (id: string) => setChoices((current) => ({ ...current, [id]: hidden.includes(id) })),
  };
}

/**
 * The brands a chart's legend offers, best positioned first for the chart's metric (orderSeriesByTotal): the top
 * `limit`, the project's own (`primary`) always among them, in its place or last when it is outside.
 */
export function legendSeries<T extends { primary: boolean }>(
  series: readonly T[],
  total: (item: T) => number | null | undefined,
  direction: 'desc' | 'asc' = 'desc',
  limit = CHART_LEGEND_LIMIT,
): T[] {
  return cutBrandRanking(orderSeriesByTotal(series, total, direction), (item) => item.primary, limit).map(({ row }) => row);
}

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
