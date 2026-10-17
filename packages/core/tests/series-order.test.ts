import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderSeriesByTotal } from '../lib/chart-series.ts';

const names = (list: { name: string }[]) => list.map((item) => item.name);
const total = (item: { total: number | null }) => item.total;

test('series are ordered from the biggest to the smallest period total', () => {
  const series = [
    { name: 'Own', total: 50 },
    { name: 'Big', total: 90 },
    { name: 'Small', total: 10 },
  ];
  assert.deepEqual(names(orderSeriesByTotal(series, total)), ['Big', 'Own', 'Small']);
});

test('ties keep their original order (stable)', () => {
  const series = [
    { name: 'Zeta', total: 60 },
    { name: 'Alpha', total: 60 },
    { name: 'Mid', total: 60 },
    { name: 'Top', total: 70 },
  ];
  assert.deepEqual(names(orderSeriesByTotal(series, total)), ['Top', 'Zeta', 'Alpha', 'Mid']);
});

test('series without data go last and a zero total is still data', () => {
  const series = [
    { name: 'Missing', total: null },
    { name: 'Zero', total: 0 },
    { name: 'Some', total: 5 },
    { name: 'Missing too', total: null },
  ];
  assert.deepEqual(names(orderSeriesByTotal(series, total)), ['Some', 'Zero', 'Missing', 'Missing too']);
});

test('lower-is-better metrics order ascending, best first', () => {
  const series = [
    { name: 'Third', total: 3.2 },
    { name: 'First', total: 1.1 },
    { name: 'None', total: null },
    { name: 'Second', total: 2 },
  ];
  assert.deepEqual(names(orderSeriesByTotal(series, total, 'asc')), ['First', 'Second', 'Third', 'None']);
});

test('does not mutate the input', () => {
  const series = [{ name: 'A', total: 1 }, { name: 'B', total: 2 }];
  orderSeriesByTotal(series, total);
  assert.deepEqual(names(series), ['A', 'B']);
});
