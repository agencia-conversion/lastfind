import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_PALETTE_SIZE,
  CHART_SERIES_COUNT,
  defaultShownSeries,
  legendSeries,
  seriesColorToken,
  seriesColorVar,
} from '../lib/chart-series.ts';

const brand = 'Acme Studio';
const roster = ['Northwind', 'Globex', 'Initech', 'Umbrella', 'Stark'];

await test('tracked brand always uses Lastfind blue slot', () => {
  assert.equal(seriesColorVar(brand, brand, roster), 'var(--chart-1)');
  assert.equal(seriesColorToken(brand, brand, roster), 'chart-1');
});

await test('each canonical competitor gets a distinct slot', () => {
  const tokens = roster.map((name) => seriesColorToken(name, brand, roster));
  assert.deepEqual(tokens, [
    'chart-2',
    'chart-3',
    'chart-4',
    'chart-5',
    'chart-6',
  ]);
  assert.equal(new Set(tokens).size, tokens.length);
});

await test('visible reorder or subset still reads color from the canonical roster', () => {
  const visible = [roster[4], roster[2], roster[0]];
  assert.deepEqual(
    visible.map((name) => seriesColorToken(name, brand, roster)),
    ['chart-6', 'chart-4', 'chart-2'],
  );
  assert.equal(seriesColorVar('Globex', brand, roster), 'var(--chart-3)');
  assert.notEqual(
    seriesColorVar('Globex', brand, roster),
    seriesColorVar('Northwind', brand, roster),
  );
});

await test('the brand and 11 competitors get 12 distinct colours; past them a shade, never an exact repeat', () => {
  const many = Array.from({ length: 13 }, (_, index) => `Brand ${index}`);
  const colors = [brand, ...many].map((name) => seriesColorVar(name, brand, many));
  assert.deepEqual(colors.slice(0, 12), Array.from({ length: 12 }, (_, index) => `var(--chart-${index + 1})`));
  assert.equal(new Set(colors).size, colors.length);
  assert.equal(colors[12], 'color-mix(in srgb, var(--chart-2) 55%, var(--foreground))');
  assert.equal(seriesColorToken(many[11], brand, many), 'chart-2');
  assert.equal(CHART_PALETTE_SIZE, 12);
});

await test('unknown player falls back without colliding with the brand slot', () => {
  assert.equal(seriesColorVar('Missing Co', brand, roster), 'var(--chart-2)');
  assert.notEqual(seriesColorVar('Missing Co', brand, roster), 'var(--chart-1)');
});

test('a chart shows at most 10 brands by default: the primary series and the nine others with the biggest totals', () => {
  assert.equal(CHART_SERIES_COUNT, 10);
  // The project's brand and its 10 monitored competitors (MAX_COMPETITORS) are 11: one stays in the legend only.
  const series = ['own', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id, index) => ({ id, primary: index === 0, total: [1, 5, 9, 2, 7, 0, 8, 3, 4, 6, 10][index] }));
  assert.deepEqual([...defaultShownSeries(series, (item) => item.total)].sort(), ['own', 'a', 'b', 'c', 'd', 'f', 'g', 'h', 'i', 'j'].sort());
  assert.equal(defaultShownSeries(series.slice(0, 3), (item) => item.total).size, 3);
});

test('a legend offers the 25 best positioned brands for the metric, always with the project brand', () => {
  // 30 competitors valued 30..1 and the project brand valued 0: the worst of all for a higher-is-better metric.
  const series = [{ id: 'own', primary: true, value: 0 }, ...Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, primary: false, value: 30 - index }))];
  const legend = legendSeries(series, (item) => item.value);
  assert.equal(legend.length, 25);
  assert.deepEqual(legend.slice(0, 3).map((item) => item.id), ['c0', 'c1', 'c2'], 'best first');
  assert.equal(legend.at(-1)?.id, 'own', 'the project brand outside the top 25 still comes, last');
  // Average position: lower is better, so the project brand (0) leads and the cut keeps the 24 lowest others.
  const byPosition = legendSeries(series, (item) => item.value, 'asc');
  assert.deepEqual(byPosition.slice(0, 3).map((item) => item.id), ['own', 'c29', 'c28']);
  assert.equal(byPosition.length, 25);
  assert.ok(!byPosition.some((item) => item.id === 'c0'), 'the worst positioned are cut');
  // A brand without a value goes after every measured one; a short list is kept whole.
  const short = legendSeries([{ id: 'own', primary: true, value: null }, { id: 'a', primary: false, value: 2 }], (item) => item.value);
  assert.deepEqual(short.map((item) => item.id), ['a', 'own']);
});
