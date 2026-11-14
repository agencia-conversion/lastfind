import test from 'node:test';
import assert from 'node:assert/strict';
import { HEAT_BANDS, MARGIN_OF_ERROR, WIN_RATE_BANDS, MIN_UNITS, SMOOTHING, assistantScore, withinMargin, compare, estimate, heatCell, heatColor, orderEffect, plainAnswer, scoreBrand, smoothedReadings, smoothedScore, trend, type PerceptionReading } from '../lib/semantic-perception.ts';
import type { Engine } from '../lib/types.ts';

const attributes = ['a', 'b', 'c', 'd', 'e'];
const AIS: Engine[] = ['chat_gpt', 'claude', 'perplexity', 'google_ai_mode'];
const reading = (day: string, attribute: string, score: number, unit: Engine, brand = 'Own'): PerceptionReading => ({ day, unit, brand, attribute, score });
// One note per AI, in the order of AIS.
const notes = (attribute: string, scores: number[], day = '2026-10-12') => scores.map((score, index) => reading(day, attribute, score, AIS[index]));

test('one AI is enough for a score (no minimum of three); it has no margin, and absence is not zero', () => {
  assert.equal(estimate([]).score, null);
  assert.equal(estimate([]).reliable, false);
  const one = estimate(notes('a', [90]));
  assert.deepEqual([one.score, one.reliable, one.units, one.margin], [90, true, 1, null]);
  const two = estimate(notes('a', [80, 100]));
  // Two AIs: a margin from their disagreement, wide (t(1) 12.706): sd 14.14, se 10.
  assert.ok(Math.abs(two.margin! - 12.706 * 10) < 1e-9);
  assert.equal(MIN_UNITS, 1);
});

test('the AI is the sampling unit: its runs average into one value and do not narrow the margin', () => {
  const once = estimate(notes('a', [60, 70, 80]));
  // The same three AIs again, a day later with the same notes: six readings, still three samples.
  const twice = estimate([...notes('a', [60, 70, 80]), ...notes('a', [60, 70, 80], '2026-10-13')]);
  assert.equal(twice.samples, 6);
  assert.equal(twice.units, 3);
  assert.equal(twice.score, once.score);
  assert.equal(twice.margin, once.margin);
});

test('the margin uses Student t: three AIs give a far wider interval than the normal 1.96', () => {
  const result = estimate(notes('a', [60, 70, 80]));
  // sd 10, se 5.77, t(2) 4.303.
  assert.ok(Math.abs(result.margin! - 4.303 * (10 / Math.sqrt(3))) < 1e-9);
});

test('the overall score is the mean of the reliable attribute means, not of all readings', () => {
  const readings = [...notes('a', [100, 100, 100, 100]), ...notes('b', [0, 0, 0]), ...notes('c', [50, 50, 50])];
  const result = scoreBrand(readings, attributes, 'Own');
  // 3 of 5 attributes are reliable (60%): (100 + 0 + 50) / 3. "d" and "e" have no AI: both stay out, neither is a zero.
  assert.equal(result.score, 50);
  assert.equal(result.reliableAttributes, 3);
  assert.equal(result.units, 3);
  // Three AIs cap the confidence at low.
  assert.equal(result.confidence, 'low');
});

test('one AI on every attribute gives a score without a margin, at low confidence', () => {
  const result = scoreBrand(attributes.flatMap((attribute) => notes(attribute, [80])), attributes, 'Own');
  assert.deepEqual([result.score, result.units, result.margin, result.confidence], [80, 1, null, 'low']);
});

test('AIs that rated different attributes each count once', () => {
  const result = scoreBrand([reading('2026-10-12', 'a', 80, 'chat_gpt'), reading('2026-10-12', 'b', 70, 'claude')], attributes, 'Own');
  // Two of five attributes (40%) are under the 60% an overall score needs; the two AIs are still counted.
  assert.deepEqual([result.score, result.units], [null, 2]);
});

test('four AIs on every attribute with a narrow margin give high confidence', () => {
  const readings = attributes.flatMap((attribute) => notes(attribute, [80, 82, 78, 80]));
  const result = scoreBrand(readings, attributes, 'Own');
  assert.equal(result.confidence, 'high');
  assert.ok(result.margin! < 5);
});

test('fewer than 60% of the attributes reliable means no overall score', () => {
  const result = scoreBrand([...notes('a', [75, 75, 75]), ...notes('b', [75])], attributes, 'Own');
  assert.equal(result.score, null);
  assert.equal(result.confidence, 'none');
  assert.equal(result.attributes.find((item) => item.attribute === 'b')!.score, 75);
  assert.equal(scoreBrand([], attributes, 'Own').score, null);
});

test('a change is only a rise or fall when it clears the noise of both periods', () => {
  const quiet = { score: 70, error: 1, df: 3 };
  assert.equal(compare(quiet, { score: null, error: null, df: null }), null);
  assert.deepEqual(compare({ score: 80, error: 1, df: 3 }, quiet), { delta: 10, significant: true });
  assert.equal(compare({ score: 71, error: 3, df: 3 }, { score: 70, error: 3, df: 3 })!.significant, false);
  assert.equal(compare({ score: 80, error: null, df: null }, quiet)!.significant, false);
  // With few AIs the bar is higher: 5 points clear it at 20 degrees of freedom, not at 2.
  assert.equal(compare({ score: 75, error: 1.5, df: 20 }, { score: 70, error: 1.5, df: 20 })!.significant, true);
  assert.equal(compare({ score: 75, error: 1.5, df: 2 }, { score: 70, error: 1.5, df: 2 })!.significant, false);
});

test('the evolution has a point per period and a gap for a period without enough notes', () => {
  const readings = attributes.flatMap((attribute) => [
    ...notes(attribute, [100, 100, 100, 100], '2026-10-12'),
    ...notes(attribute, [0, 0], '2026-10-19'),
  ]);
  const points = trend(readings, attributes, ['Own', 'Other'], ['2026-10-12', '2026-10-19', '2026-10-26']);
  assert.deepEqual(points.map((point) => point.Own), [100, 0, null]);
  assert.deepEqual(points.map((point) => point.Other), [null, null, null]);
});

test('an excerpt keeps the words: links lose their URL, citation marks go and encoded runs are decoded', () => {
  assert.equal(plainAnswer('Netflix has **profiles**.[[1]](https://www.youtube.com/watch?v=x) See [the guide](https://a.com/b_(c)) now.'), 'Netflix has profiles. See the guide now.');
  assert.equal(plainAnswer('first pick [www.cordcutterpro.com](https://www.cordcutterpro.com/x)[reviews.org](https://reviews.org) wins'), 'first pick wins');
  assert.equal(plainAnswer('bundle%20also%20include%20Hulu%2C%20which%20is%2012.99%2Fmonth'), 'bundle also include Hulu, which is 12.99/month');
  assert.equal(plainAnswer('100% sure and %ZZ stays'), '100% sure and %ZZ stays');
});

test('the heatmap bands are the scale the AIs are given: 0–59, 60–79, 80–89, 90–100, blending only within 4 points of a boundary', () => {
  assert.deepEqual(HEAT_BANDS.map((band) => [band.label, band.name.en]), [['0–59', 'Weakly perceived'], ['60–79', 'Well perceived'], ['80–89', 'Fully perceived'], ['90–100', 'Excellence zone']]);
  const [red, yellow, green, top] = HEAT_BANDS.map((band) => band.color.replace(/[()]/g, '\\$&'));
  const raw = HEAT_BANDS.map((band) => band.color);
  assert.deepEqual([0, 55].map(heatColor), [raw[0], raw[0]]);
  assert.deepEqual([84, 85].map(heatColor), [raw[2], raw[2]]);
  assert.deepEqual([94, 100].map(heatColor), [raw[3], raw[3]]);
  assert.deepEqual([64, 75].map(heatColor), [raw[1], raw[1]]);
  // Inside a blend the color mixes the two neighbouring bands, more of the next one the closer to its side.
  assert.match(heatColor(59), new RegExp(`${yellow} \\d+%, ${red}`));
  assert.match(heatColor(63), new RegExp(`${yellow} \\d+%, ${red}`));
  assert.match(heatColor(79), new RegExp(`${green} \\d+%, ${yellow}`));
  assert.match(heatColor(80), new RegExp(`${green} \\d+%, ${yellow}`));
  assert.match(heatColor(90), new RegExp(`${top} \\d+%, ${green}`));
  const share = (value: number) => Number(/ (\d+)%/.exec(heatColor(value))![1]);
  assert.ok(share(59) < 50 && share(60) > 50 && share(63) > share(60));
});

test('the heatmap bands are tokens with a light and a dark tint, and the score reads on each at AA', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../app/tokens.css', import.meta.url), 'utf8');
  const dark = css.slice(css.indexOf('.dark {'));
  const light = css.slice(0, css.indexOf('.dark {'));
  const value = (block: string, name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block)?.[1];
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
  for (const block of [light, dark]) {
    const ink = value(block, 'heat-foreground')!;
    for (const band of ['heat-low', 'heat-mid', 'heat-high', 'heat-top']) assert.ok(contrast(value(block, band)!, ink) >= 4.5, band);
  }
  assert.deepEqual(heatCell(70), { backgroundColor: 'var(--heat-mid)', color: 'var(--heat-foreground)' });
});

test('the margin of error is for cards only: a table cell keeps its band however close to your brand', () => {
  assert.equal(MARGIN_OF_ERROR, 5);
  assert.equal(heatCell(74).backgroundColor, 'var(--heat-mid)');
  assert.equal(heatCell(84).backgroundColor, 'var(--heat-high)');
  assert.ok(withinMargin(-4.9) && !withinMargin(5) && !withinMargin(1, 0));
});

test("Comparison's win rate uses the same tints in quarters (heatCell's scale)", () => {
  assert.deepEqual([10, 30, 60, 90].map((value) => heatCell(value, WIN_RATE_BANDS).backgroundColor), ['var(--heat-low)', 'var(--heat-mid)', 'var(--heat-high)', 'var(--heat-top)']);
  assert.match(heatCell(50, WIN_RATE_BANDS).backgroundColor, /color-mix/);
});

test('a header filter on one AI shows its mean without a margin; two AIs show a margin', () => {
  const two = attributes.flatMap((attribute) => notes(attribute, [70, 80]));
  const both = scoreBrand(two, attributes, 'Own');
  assert.equal(both.score, 75);
  assert.ok(both.margin !== null && both.margin > 0);
  const one = scoreBrand(attributes.flatMap((attribute) => notes(attribute, [60])), attributes, 'Own');
  assert.deepEqual([one.score, one.margin], [60, null]);
});

test("a brand's score inside one AI is the mean of its attribute notes, with the runs averaged, and needs 60% of the attributes", () => {
  const rows = [
    { brand: 'Own', attribute: 'a', score: 60 }, { brand: 'Own', attribute: 'a', score: 80 },
    { brand: 'Own', attribute: 'b', score: 50 }, { brand: 'Own', attribute: 'c', score: 90 },
    { brand: 'Rival', attribute: 'a', score: 10 },
  ];
  assert.equal(assistantScore(rows, ['a', 'b', 'c', 'd', 'e'], 'Own'), (70 + 50 + 90) / 3);
  assert.equal(assistantScore(rows, ['a', 'b', 'c', 'd', 'e'], 'Rival'), null);
  assert.equal(assistantScore(rows, ['a', 'b', 'c', 'd', 'e'], 'Nobody'), null);
});

test('the order effect compares the note where a brand came earlier with the one where it came later', () => {
  const effect = orderEffect([
    // First in run 0 (80), last in run 1 (70): +10. Last in run 0 (60), first in run 1 (66): +6. The middle brand gives no pair.
    { pair: 'A', run: 0, position: 0, score: 80 }, { pair: 'A', run: 1, position: 2, score: 70 },
    { pair: 'B', run: 0, position: 2, score: 60 }, { pair: 'B', run: 1, position: 0, score: 66 },
    { pair: 'C', run: 0, position: 1, score: 50 }, { pair: 'C', run: 1, position: 1, score: 90 },
    { pair: 'D', run: 0, position: 0, score: 50 },
  ]);
  assert.deepEqual(effect, { points: 8, pairs: 2 });
  assert.deepEqual(orderEffect([]), { points: null, pairs: 0 });
});

// The shown score smoothed over the round history (13/11/2026). The fixture replicates what production measured on 10-13/11/2026:
// each AI's note of a brand and attribute around its own level with a day-to-day noise of about 5.5 points (sd), a share of the notes
// capped at 59 for want of a fact on the day (12% of Netflix's, 14% of Apple's, 35% of Conversion's), and a few missing notes.
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};
function productionLike(capped: number, seed = 7, days = 30) {
  const random = seeded(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const units: Engine[] = ['chat_gpt', 'gemini', 'google_ai_mode', 'google_ai_overviews'];
  const brands = ['A', 'B', 'C', 'D', 'E', 'F'];
  const periods = Array.from({ length: days }, (_, at) => `2026-10-${String(at + 1).padStart(2, '0')}`);
  const readings: PerceptionReading[] = [];
  for (const brand of brands) for (const attribute of attributes) for (const unit of units) {
    const level = 62 + random() * 28;
    for (const day of periods) {
      if (random() < 0.03) continue;
      const score = Math.max(0, Math.min(100, Math.round(level + 5.5 * gauss())));
      readings.push({ day, unit, brand, attribute, score: score >= 60 && random() < capped ? 59 : score });
    }
  }
  return { readings, periods, brands };
}
const dayToDay = (series: (number | null)[][]) => {
  const changes = series.flatMap((points) => points.slice(1).flatMap((value, at) => (value === null || points[at] === null ? [] : [Math.abs(value - points[at]!)])));
  return changes.reduce((sum, value) => sum + value, 0) / changes.length;
};

test('the shown score is smoothed over the latest periods: a reading weighs half as much every half-life, and older than the window not at all', () => {
  const periods = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
  const kept = smoothedReadings(periods.map((day, at) => reading(day, 'a', 60 + at * 10, 'chat_gpt')), periods, '2026-11-03', 'daily');
  assert.deepEqual(kept.map((item) => [item.score, item.weight]), [[60, 0.5], [70, 0.5 ** 0.5], [80, 1]]);
  assert.ok(kept.every((item) => item.day === '2026-11-03'));
  // A window of 7 daily periods: the eighth back is out.
  const long = Array.from({ length: 9 }, (_, at) => `2026-11-${String(at + 1).padStart(2, '0')}`);
  assert.equal(smoothedReadings(long.map((day) => reading(day, 'a', 70, 'chat_gpt')), long, '2026-11-09', 'daily').length, SMOOTHING.daily.window);
  // Monthly periods are not smoothed.
  assert.equal(smoothedReadings(['2026-09-01', '2026-10-01'].map((day) => reading(day, 'a', 70, 'chat_gpt')), ['2026-09-01', '2026-10-01'], '2026-10-01', 'monthly').length, 1);
  // The weighted mean: (60*0.5 + 70*0.707 + 80*1) / 2.207.
  const score = scoreBrand(kept, ['a'], 'Own').score!;
  assert.ok(Math.abs(score - (60 * 0.5 + 70 * 0.5 ** 0.5 + 80) / (1.5 + 0.5 ** 0.5)) < 1e-9);
});

test('a brand with no reading of its own in the period has no smoothed score: the window steadies a score, it never carries one', () => {
  const periods = ['2026-11-01', '2026-11-02'];
  const readings = [...attributes.map((attribute) => reading('2026-11-01', attribute, 80, 'chat_gpt')), ...attributes.map((attribute) => reading('2026-11-02', attribute, 70, 'chat_gpt', 'Rival'))];
  assert.equal(smoothedScore(readings, attributes, 'Own', '2026-11-02', periods, 'daily').score, null);
  assert.equal(smoothedScore(readings, attributes, 'Own', '2026-11-01', periods, 'daily').score, 80);
  const points = trend(readings, attributes, ['Own', 'Rival'], periods, MIN_UNITS, { periods, frequency: 'daily' });
  assert.deepEqual(points.map((point) => [point.Own, point.Rival]), [[80, null], [null, 70]]);
});

test('on readings shaped like production, smoothing cuts the day-to-day movement of the overall and per-AI scores at least twice, without moving their level', () => {
  for (const capped of [0.12, 0.14, 0.35]) {
    const { readings, periods, brands } = productionLike(capped);
    const shown = periods.slice(SMOOTHING.daily.window);
    const raw = brands.map((brand) => shown.map((day) => scoreBrand(readings.filter((item) => item.day === day), attributes, brand).score));
    const smooth = brands.map((brand) => shown.map((day) => smoothedScore(readings, attributes, brand, day, periods, 'daily').score));
    const perAi = (smoothed: boolean) => brands.flatMap((brand) => (['chat_gpt', 'gemini'] as Engine[]).map((unit) => shown.map((day) => {
      const own = readings.filter((item) => item.unit === unit);
      return assistantScore(smoothed ? smoothedReadings(own, periods, day, 'daily') : own.filter((item) => item.day === day), attributes, brand);
    })));
    const [before, after] = [dayToDay(raw), dayToDay(smooth)];
    const [aiBefore, aiAfter] = [dayToDay(perAi(false)), dayToDay(perAi(true))];
    console.log(`capped ${capped}: overall ${before.toFixed(2)} -> ${after.toFixed(2)}, per AI ${aiBefore.toFixed(2)} -> ${aiAfter.toFixed(2)}`);
    assert.ok(after * 2 <= before, `overall: ${before.toFixed(2)} -> ${after.toFixed(2)} (capped ${capped})`);
    assert.ok(aiAfter * 2 <= aiBefore, `per AI: ${aiBefore.toFixed(2)} -> ${aiAfter.toFixed(2)} (capped ${capped})`);
    const level = (series: (number | null)[][]) => series.flat().reduce((sum: number, value) => sum + value!, 0) / series.flat().length;
    assert.ok(Math.abs(level(raw) - level(smooth)) < 0.5, `level ${level(raw).toFixed(1)} vs ${level(smooth).toFixed(1)}`);
  }
});
