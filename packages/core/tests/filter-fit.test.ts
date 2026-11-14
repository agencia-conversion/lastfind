import test from 'node:test';
import assert from 'node:assert/strict';
import { filtersThatFit } from '../lib/filter-fit.ts';

test('the top bar keeps the filters that fit and folds the rest into the Filters button, never clipping one', () => {
  assert.equal(filtersThatFit([100, 100, 100], 8, 316, 90), 3, 'the row fits exactly');
  assert.equal(filtersThatFit([100, 100, 100], 8, 315, 90), 2, 'one pixel short: the last one folds, the button takes its place');
  assert.equal(filtersThatFit([100, 100, 100], 8, 150, 90), 0, 'only the button fits');
  assert.equal(filtersThatFit([], 8, 0, 90), 0);
});
