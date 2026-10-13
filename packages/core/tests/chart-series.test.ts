import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_SERIES_COUNT,
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
  assert.equal(tokens.length + 1, CHART_SERIES_COUNT);
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

await test('unknown player falls back without colliding with the brand slot', () => {
  assert.equal(seriesColorVar('Missing Co', brand, roster), 'var(--chart-2)');
  assert.notEqual(seriesColorVar('Missing Co', brand, roster), 'var(--chart-1)');
});
