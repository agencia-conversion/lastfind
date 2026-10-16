import assert from 'node:assert/strict';
import test from 'node:test';
import { rankTrendSeries, summaryTrend } from '../lib/report-trend.ts';
import type { SummaryReport } from '../lib/report-types.ts';
const report = (
  daily: SummaryReport['daily'],
  start = '2026-09-28T12:00:00Z',
  end = '2026-10-03T12:00:00Z',
) => ({ daily, comparison: { currentStart: start, end } }) as SummaryReport;
const days = [
  {
    date: '2026-09-28',
    responses: 1,
    mentions: 1,
    totalMentions: 2,
    positionSum: 3,
    positionSamples: 1,
    mentionsC0: 1,
    positionSumC0: 1,
    positionSamplesC0: 1,
  },
  {
    date: '2026-09-29',
    responses: 9,
    mentions: 0,
    totalMentions: 9,
    positionSum: 0,
    positionSamples: 0,
    mentionsC0: 9,
    positionSumC0: 18,
    positionSamplesC0: 9,
  },
  {
    date: '2026-10-02',
    responses: 2,
    mentions: 0,
    totalMentions: 0,
    positionSum: 0,
    positionSamples: 0,
    mentionsC0: 0,
    positionSumC0: 0,
    positionSamplesC0: 0,
  },
];
await test('calendar aggregation weights observations, preserves measured zero and missing positions', () => {
  const week = summaryTrend(report(days), 'week', 1);
  assert.equal(week.length, 1);
  assert.equal(week[0].date, '2026-09-28');
  assert.ok(Math.abs(Number(week[0].brand) - 100 / 12) < 1e-12);
  assert.ok(Math.abs(Number(week[0].sov) - 100 / 11) < 1e-12);
  assert.equal(week[0].position, 3);
  assert.equal(week[0].positionC0, 19 / 10);
  assert.ok(Math.abs(Number(week[0].c0) - (100 * 10) / 12) < 1e-12);
  const month = summaryTrend(report(days), 'month', 1);
  assert.deepEqual(
    month.map((row) => row.date),
    ['2026-09-01', '2026-10-01'],
  );
  assert.equal(month[0].brand, 10);
  assert.equal(month[1].brand, 0);
  assert.equal(month[1].sov, null);
  assert.equal(month[1].position, null);
});
await test('only collected dates remain and partial calendar boundaries are included', () => {
  const day = summaryTrend(report(days), 'day', 1);
  assert.deepEqual(day.map((row) => row.date), ['2026-09-28', '2026-09-29', '2026-10-02']);
  assert.equal(day[0].brand, 100);
  assert.equal(day[2].brand, 0);
  assert.equal(day[2].sov, null);
  assert.deepEqual(
    summaryTrend(
      report([], '2026-10-04T23:00:00Z', '2026-10-06T00:00:00Z'),
      'week',
      0,
    ).map((row) => row.date),
    [],
  );
  assert.deepEqual(summaryTrend(report([]), 'day', 1), []);
});
await test('zero-response dates are omitted while a partially selected first date remains', () => {
  const sparse = report([
    { ...days[0], date: '2026-09-28' },
    { ...days[1], date: '2026-09-29', responses: 0 },
    { ...days[2], date: '2026-10-02' },
  ], '2026-09-28T12:00:00Z', '2026-10-03T00:00:00Z');
  assert.deepEqual(summaryTrend(sparse, 'day', 1).map((row) => row.date), ['2026-09-28', '2026-10-02']);
});
await test('legacy day-only contracts preserve published values without invented weighted buckets', () => {
  assert.equal(
    summaryTrend(
      report([{ date: '2026-09-28', brand: 50, sov: null }]),
      'day',
      0,
    )[0].brand,
    50,
  );
  assert.equal(
    summaryTrend(report([{ date: '2026-09-28', brand: 50 }]), 'week', 0)[0]
      .brand,
    null,
  );
});
await test('tooltip series rank by period aggregate, tie by name, and omit unavailable values', () => {
  assert.deepEqual(
    rankTrendSeries([
      { key: 'own', name: 'Own', value: 50 },
      { key: 'zeta', name: 'Zeta', value: 60 },
      { key: 'alpha', name: 'Alpha', value: 60 },
      { key: 'missing', name: 'Missing', value: null },
      { key: 'zero', name: 'Zero', value: 0 },
    ]),
    [['alpha', 0], ['zeta', 1], ['own', 2], ['zero', 3]],
  );
});
