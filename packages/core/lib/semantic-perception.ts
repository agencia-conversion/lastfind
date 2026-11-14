// The overall Semantic Branding score and its evolution, from the query panel (see semantic-panel.ts).
// Pure functions over readings (0-100 each, one per brand, attribute and AI). A reading that is missing is not a zero:
// it is simply not here, and what it leaves missing is reported (units, reliable, null), never filled.
import type { Engine } from './types';
import { PANEL_MIN_ENGINES, SCORE_BANDS, type PanelFrequency } from './semantic-panel.ts';

/** AIs an attribute needs before its mean is shown as a score: one. With one there is no margin; with few the confidence is low. */
export const MIN_UNITS = PANEL_MIN_ENGINES;
/** Share of the configured attributes that must be reliable for an overall score. */
export const MIN_ATTRIBUTE_SHARE = 0.6;

export type PerceptionReading = {
  /** First day of the period (day, week or month) the query belongs to. */
  day: string;
  /** The sampling unit: the AI that gave the score. Its readings in one period (several runs) average into one value first. */
  unit: Engine;
  brand: string;
  attribute: string;
  score: number;
  /** Its weight in a smoothed score (smoothedReadings): 1 for the period's own readings, less for older ones. */
  weight?: number;
};
export type Estimate = {
  score: number | null;
  /** Readings behind the score. */
  samples: number;
  /** AIs those readings come from: the sampling unit of the margin. */
  units: number;
  /** Half width of the 95% interval, in points; null while it cannot be estimated. */
  margin: number | null;
  reliable: boolean;
  /** The standard error and its degrees of freedom are kept to compare two periods. */
  error: number | null;
  df: number | null;
};
export type BrandScore = Estimate & {
  brand: string;
  attributes: Array<Estimate & { attribute: string; engines: Partial<Record<Engine, { score: number; samples: number }>> }>;
  reliableAttributes: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
/** The mean of readings by their weights (1 each when they have none). */
const weighted = (items: Pick<PerceptionReading, 'score' | 'weight'>[]) =>
  items.reduce((sum, item) => sum + item.score * (item.weight ?? 1), 0) / items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
const variance = (values: number[]) => {
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
};

// Student's t for 3-6 AIs is far from the normal 1.96 (3.18 with 3 degrees of freedom), so the margin uses it. Index = degrees of freedom - 1.
const T_TWO_SIDED_95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];
const T_ONE_SIDED_95 = [6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812];
const t = (table: number[], z: number, df: number) => table[df - 1] ?? z;

/**
 * Mean of one group of readings with its standard error. The sampling unit is the AI: a model's answers
 * across runs average into one value first and the error comes from those values (needs at least two AIs).
 */
export function estimate(group: Pick<PerceptionReading, 'unit' | 'score' | 'weight'>[], minUnits = MIN_UNITS): Estimate {
  if (!group.length) return { score: null, samples: 0, units: 0, margin: null, reliable: false, error: null, df: null };
  const byUnit = new Map<string, Pick<PerceptionReading, 'score' | 'weight'>[]>();
  for (const item of group) byUnit.set(item.unit, [...(byUnit.get(item.unit) ?? []), item]);
  const means = [...byUnit.values()].map(weighted);
  const error = means.length > 1 ? Math.sqrt(variance(means) / means.length) : null;
  const df = means.length > 1 ? means.length - 1 : null;
  return {
    score: mean(means),
    samples: group.length,
    units: means.length,
    // One AI: a mean, no margin (the margin needs the disagreement of two or more).
    margin: error === null ? null : t(T_TWO_SIDED_95, 1.96, df!) * error,
    reliable: means.length >= minUnits,
    error,
    df,
  };
}

/**
 * Overall score of one brand: the mean of its attribute means, every configured attribute weighing the same, over the
 * attributes that are reliable. Pooling all readings instead would let the attribute the AIs mention most decide the score.
 * It needs MIN_ATTRIBUTE_SHARE of the attributes; below that there is no score.
 * The errors of the attribute means add in quadrature (independent attributes assumed; the attributes of one answer are
 * correlated, so the margin is a lower bound: ponytail: bootstrap by AI when the margin has to be exact).
 */
export function scoreBrand(readings: PerceptionReading[], attributeIds: string[], brand: string, minUnits = MIN_UNITS): BrandScore {
  const own = readings.filter((reading) => reading.brand === brand);
  const attributes = attributeIds.map((attribute) => {
    const group = own.filter((reading) => reading.attribute === attribute);
    const engines: BrandScore['attributes'][number]['engines'] = {};
    for (const engine of new Set(group.map((reading) => reading.unit))) {
      const values = group.filter((reading) => reading.unit === engine);
      engines[engine] = { score: weighted(values), samples: values.length };
    }
    return { attribute, ...estimate(group, minUnits), engines };
  });
  const used = attributes.filter((attribute) => attribute.reliable);
  const enough = used.length >= Math.max(1, Math.ceil(attributeIds.length * MIN_ATTRIBUTE_SHARE));
  const score = enough ? mean(used.map((attribute) => attribute.score!)) : null;
  const errors = used.map((attribute) => attribute.error);
  const error = enough && errors.every((value) => value !== null)
    ? Math.sqrt(errors.reduce((sum, value) => sum + value! ** 2, 0)) / used.length
    : null;
  const df = error === null ? null : Math.min(...used.map((attribute) => attribute.df!));
  const margin = error === null ? null : t(T_TWO_SIDED_95, 1.96, df!) * error;
  // Without a score the AIs that did answer are still counted, so the reader sees how far it is from the minimum (never "0 AIs").
  // AIs that rated different attributes still count once each, so it is the distinct AIs of the brand, not the best attribute.
  const units = enough ? Math.min(...used.map((attribute) => attribute.units)) : new Set(own.map((reading) => reading.unit)).size;
  return {
    brand,
    score,
    samples: own.length,
    units,
    margin,
    reliable: enough,
    error,
    df,
    attributes,
    reliableAttributes: used.length,
    confidence: score === null ? 'none'
      : used.length === attributeIds.length && units >= 4 && margin !== null && margin <= 5 ? 'high'
        : units >= 4 && margin !== null && margin <= 10 ? 'medium' : 'low',
  };
}

/** Change against the previous period, and whether it clears the noise of both periods (one-sided 95%). */
export function compare(current: Pick<Estimate, 'score' | 'error' | 'df'>, previous: Pick<Estimate, 'score' | 'error' | 'df'>) {
  if (current.score === null || previous.score === null) return null;
  const delta = current.score - previous.score;
  const noise = current.error === null || previous.error === null ? null : Math.hypot(current.error, previous.error);
  const df = Math.min(current.df ?? 0, previous.df ?? 0);
  return { delta, significant: noise !== null && df > 0 && Math.abs(delta) > t(T_ONE_SIDED_95, 1.645, df) * noise };
}

/**
 * One point per period that has readings of the brand. A period without readings is a gap (null), never a zero or a carried value;
 * a brand whose readings are too few for an overall score is a gap too.
 */
export function trend(readings: PerceptionReading[], attributeIds: string[], brands: string[], periods: string[], minUnits = MIN_UNITS, history?: { periods: string[]; frequency: PanelFrequency }) {
  return periods.map((day) => {
    const point: Record<string, number | string | null> = { date: day };
    for (const brand of brands) point[brand] = (history ? smoothedScore(readings, attributeIds, brand, day, history.periods, history.frequency, minUnits) : scoreBrand(readings.filter((reading) => reading.day === day), attributeIds, brand, minUnits)).score;
    return point;
  });
}

/**
 * The shown score is steadied over the round history (13/11/2026: "the scores are very unstable from day to day"). Measured on the
 * three production projects (10-13/11/2026), one AI's note of a brand and attribute moved 7 to 10 points a day on average (a third to two
 * thirds of it a note capped at 59 for a missing fact one day and not the next), and a brand's overall score 1.8 to 4.5 points, with no change
 * in what the AIs say. An exponentially weighted mean of each AI's notes over the latest `window` periods, each period weighing half as much
 * every `halfLife` periods, cuts that day-to-day movement 2 to 4 times at no cost (no AI is asked more). A real change still shows: about a
 * third of it the next day, half after `halfLife` periods, four fifths after twice that. Weekly periods are few and far apart: a short window;
 * monthly ones are not smoothed. The period's own notes (`daily` on the screen, the justifications) are never rewritten.
 * Not chosen: counting a note without evidence only when no note of the window has one; it steadied a little more but raised the scores 2 to
 * 7 points, undoing the anchor of 10/11/2026 (no fact, no note above 59).
 */
export const SMOOTHING: Record<PanelFrequency, { window: number; halfLife: number }> = {
  daily: { window: 7, halfLife: 2 },
  weekly: { window: 3, halfLife: 1 },
  monthly: { window: 1, halfLife: 1 },
};

/** The readings that make the smoothed score of period `at`: those of the `window` periods up to it (`periods`, oldest first), weighted by age, all dated `at`. */
export function smoothedReadings(readings: PerceptionReading[], periods: string[], at: string, frequency: PanelFrequency): PerceptionReading[] {
  const { window, halfLife } = SMOOTHING[frequency];
  const end = periods.indexOf(at);
  if (end < 0) return readings.filter((reading) => reading.day === at);
  const age = new Map(periods.slice(Math.max(0, end - window + 1), end + 1).map((day, index, kept) => [day, kept.length - 1 - index]));
  return readings.flatMap((reading) => {
    const old = age.get(reading.day);
    return old === undefined ? [] : [{ ...reading, day: at, weight: (reading.weight ?? 1) * 0.5 ** (old / halfLife) }];
  });
}

/**
 * A brand's smoothed score in period `at` (smoothedReadings). A brand without a reading of its own in that period has no score (a gap,
 * never a value carried from before); the window only steadies a score the period has.
 */
export function smoothedScore(readings: PerceptionReading[], attributeIds: string[], brand: string, at: string, periods: string[], frequency: PanelFrequency, minUnits = MIN_UNITS) {
  const own = readings.filter((reading) => reading.day === at);
  if (!own.some((reading) => reading.brand === brand)) return scoreBrand(own, attributeIds, brand, minUnits);
  return scoreBrand(smoothedReadings(readings, periods, at, frequency), attributeIds, brand, minUnits);
}

/**
 * The overall score of a brand inside ONE AI (one column of "Score by AI"): the mean of its attribute notes there (the runs of that AI
 * averaged first), every attribute weighing the same, when at least MIN_ATTRIBUTE_SHARE of the attributes have a note; else null.
 * One AI has no spread to measure, so there is no margin.
 */
export function assistantScore(readings: Pick<PerceptionReading, 'brand' | 'attribute' | 'score' | 'weight'>[], attributeIds: string[], brand: string) {
  const notes = attributeIds.flatMap((attribute) => {
    const values = readings.filter((reading) => reading.brand === brand && reading.attribute === attribute);
    return values.length ? [weighted(values)] : [];
  });
  return notes.length && notes.length >= Math.max(1, Math.ceil(attributeIds.length * MIN_ATTRIBUTE_SHARE)) ? mean(notes) : null;
}

/**
 * The brands of an answer that it leaves without a score in its AI (13/11/2026): notes on fewer than MIN_ATTRIBUTE_SHARE of the attributes,
 * as Score by AI reads them. An AI asked to score answers every brand it was given; one that leaves some out came back cut (Gemini, Netflix
 * 12/11/2026: the notes of the first brand alone, 4 of 36), and the round asks it again.
 */
export function unscoredBrands(readings: Pick<PerceptionReading, 'brand' | 'attribute'>[], brands: string[], attributeIds: string[]) {
  const enough = Math.max(1, Math.ceil(attributeIds.length * MIN_ATTRIBUTE_SHARE));
  return brands.filter((brand) => new Set(readings.filter((reading) => reading.brand === brand).map((reading) => reading.attribute)).size < enough);
}

/**
 * The effect of a brand's place in the list (31/10/2026: each AI and mode is asked twice, the second time with the order reversed). For every
 * brand, attribute, AI and mode with a note in both runs, the note where the brand came earlier minus the note where it came later; the
 * mean of those differences, in points (positive: being listed earlier helps), and how many pairs it rests on. A brand in the middle keeps
 * its place in both runs and gives no pair.
 */
export function orderEffect(readings: { pair: string; run: number; position: number; score: number }[]) {
  const runs = new Map<string, Map<number, { position: number; score: number }>>();
  for (const reading of readings) {
    const byRun = runs.get(reading.pair) ?? new Map();
    byRun.set(reading.run, { position: reading.position, score: reading.score });
    runs.set(reading.pair, byRun);
  }
  const differences = [...runs.values()].flatMap((byRun) => {
    const [first, second] = [byRun.get(0), byRun.get(1)];
    if (!first || !second || first.position === second.position) return [];
    return [first.position < second.position ? first.score - second.score : second.score - first.score];
  });
  return { points: differences.length ? mean(differences) : null, pairs: differences.length };
}

/**
 * An AI answer as plain text for an excerpt: Markdown links keep their label (citation marks like [[1]](url) and labels that are only a domain go),
 * bare URLs go, and percent-encoded runs left by cut-up URLs ("a%20b") are decoded.
 */
export function plainAnswer(raw: string) {
  return raw
    .replace(/\[\[\d+\]\]\((?:[^()\s]|\([^()]*\))*\)/g, '')
    // A link whose label is just a domain is a citation, not a word of the answer.
    .replace(/\[([^[\]]*)\]\((?:[^()\s]|\([^()]*\))*\)/g, (_, label: string) => (/^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+\S*$/.test(label) ? '' : label))
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => { try { return decodeURIComponent(run); } catch { return run; } })
    .replace(/\\(.)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/^#{1,6}\s+/gm, '').replace(/\s#{1,6}\s+(?=\d|\w)/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');
}

/**
 * The heatmap bands, fixed (not relative to the screen): the bands of the scale the AIs are given (SCORE_BANDS, 8/11/2026: 0–59, 60–79,
 * 80–89, 90–100), in the pastel tokens of tokens.css (`--heat-low|mid|high|top`, a light and a dark tint each), with their labels.
 */
const HEAT_TOKENS = ['var(--heat-low)', 'var(--heat-mid)', 'var(--heat-high)', 'var(--heat-top)'] as const;
export const HEAT_BANDS = SCORE_BANDS.map((band, at) => ({ min: band.min, label: `${band.min}–${band.max}`, name: band.label, color: HEAT_TOKENS[at]! }));
/** A heatmap's scale: each band from its `min`, its legend label and name, and its tint. */
export type HeatBand = { min: number; label: string; name: { en: string; pt: string }; color: string };
/**
 * Comparison's win rate (12/11/2026), 0–100 % of the answers that name a brand the clear winner, on the same four tints: a brand
 * among four options wins a quarter of the answers by chance, so the bands are quarters.
 */
export const WIN_RATE_BANDS: HeatBand[] = [
  { min: 0, label: '0–24%', name: { en: 'Rarely wins', pt: 'Raramente vence' }, color: HEAT_TOKENS[0] },
  { min: 25, label: '25–49%', name: { en: 'Sometimes wins', pt: 'Às vezes vence' }, color: HEAT_TOKENS[1] },
  { min: 50, label: '50–74%', name: { en: 'Often wins', pt: 'Vence com frequência' }, color: HEAT_TOKENS[2] },
  { min: 75, label: '75–100%', name: { en: 'Usually wins', pt: 'Quase sempre vence' }, color: HEAT_TOKENS[3] },
];
/** The band of a note (a mean is rounded first, as it is shown): what the number means on the scale the AIs are given. */
export const scoreBand = (value: number) => SCORE_BANDS.find((band) => Math.round(value) <= band.max) ?? SCORE_BANDS.at(-1)!;
const blend = (value: number, edge: number, from: string, to: string) =>
  `color-mix(in srgb, ${to} ${Math.round(((value - edge + 4) / 8) * 100)}%, ${from})`;
/** Color of a cell on a scale (HEAT_BANDS by default): the band of its value, blending into the next band only within 4 points of each boundary (59.5, 79.5 and 89.5). */
function bandColor(value: number, bands: readonly Pick<HeatBand, 'min' | 'color'>[]): string {
  for (let at = 1; at < bands.length; at++) {
    const edge = bands[at]!.min - 0.5;
    if (value < edge - 4) return bands[at - 1]!.color;
    if (value < edge + 4) return blend(value, edge, bands[at - 1]!.color, bands[at]!.color);
  }
  return bands.at(-1)!.color;
}
export const heatColor = (value: number) => bandColor(value, HEAT_BANDS);
/**
 * The margin of error of a card's change (a change in percentage points, of a 0–100 score, or of average position): a change less
 * than this is a tie, shown neutral (`--state-neutral`), never green or red (`Change`, `ScoreChange`). Only on cards (10/11/2026):
 * a table colours every difference (its `Change` passes `margin={0}`, its heat cells keep their bands). `margin`: 0 for a count too.
 */
export const MARGIN_OF_ERROR = 5;
export const withinMargin = (difference: number, margin = MARGIN_OF_ERROR) => Math.abs(difference) < margin;
/** The style of a heat cell: its band's tint (Semantic Branding's notes, or another scale such as WIN_RATE_BANDS), with the text token that reads on every band in its theme. */
export const heatCell = (value: number, bands: readonly Pick<HeatBand, 'min' | 'color'>[] = HEAT_BANDS) => ({ backgroundColor: bandColor(value, bands), color: 'var(--heat-foreground)' });
