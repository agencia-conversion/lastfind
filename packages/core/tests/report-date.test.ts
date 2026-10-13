import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomDateRange } from '../lib/report-date.ts';

await test('custom report dates use an inclusive 1–90 day range', () => {
  const sameDay = parseCustomDateRange('2026-09-07', '2026-09-07');
  assert.equal(sameDay.valid, true);
  assert.equal(sameDay.end - sameDay.start, 86400000);
  assert.equal(
    parseCustomDateRange('2026-01-01', '2026-03-31').valid,
    true,
  );
  assert.equal(
    parseCustomDateRange('2026-01-01', '2026-04-01').error,
    'range',
  );
  assert.equal(
    parseCustomDateRange('2026-04-01', '2026-01-01').error,
    'order',
  );
  assert.equal(
    parseCustomDateRange('2026-02-30', '2026-03-01').error,
    'invalid',
  );
});
