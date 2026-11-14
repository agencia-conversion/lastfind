import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveredInPeriod, extraPeriodShare, getTrendScale, rankTrendSeries, summaryTrend, trendRange } from '../lib/report-trend.ts';
import { coveredPeriods } from '../lib/period-coverage.ts';
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

await test('discovered brands chart as visibility weighted by the report responses, and never above 100', () => {
  const extras = [{ key: 'disc:x', days: { '2026-09-28': 1, '2026-09-29': 3, '2026-10-02': 5 } }];
  const day = summaryTrend(report(days), 'day', 1, extras);
  const shares = day.map((row) => Number(row['disc:x']));
  assert.equal(shares[0], 100);
  assert.ok(Math.abs(shares[1]! - 100 / 3) < 1e-9);
  assert.equal(shares[2], 100);
  const week = summaryTrend(report(days), 'week', 1, extras);
  assert.equal(week.length, 1);
  assert.ok(Math.abs(Number(week[0]['disc:x']) - 900 / 12) < 1e-12);
  assert.equal(summaryTrend(report(days), 'day', 1)[0]!['disc:x'], undefined);
});

await test('discovered brands have a share of voice over every identified brand, and both shares are the same by day and by week', () => {
  // The day's total counts the discoveries too: 1 of 2 and 1 of 9 mentions; a day without mentions has none.
  const extras = [{ key: 'disc:x', days: { '2026-09-28': 1, '2026-09-29': 1 } }];
  const rows = summaryTrend(report(days), 'day', 1, extras);
  assert.equal(rows[0]!['sov:disc:x'], 50);
  assert.ok(Math.abs(Number(rows[1]!['sov:disc:x']) - 100 / 9) < 1e-9);
  assert.equal(rows[2]!['sov:disc:x'], null);
  const day = summaryTrend(report(days), 'day', 1, extras), week = summaryTrend(report(days), 'week', 1, extras);
  assert.equal(extraPeriodShare(day, 'disc:x'), extraPeriodShare(week, 'disc:x'));
  assert.equal(extraPeriodShare(day, 'disc:x', true), 2 / 11);
  assert.equal(extraPeriodShare(day, 'disc:x', true), extraPeriodShare(week, 'disc:x', true));
});

await test('discovered brands order by answers ÷ responses, the unit of the tracked brands', () => {
  // 10 of 70 answers vs 30 of 70 tracked mentions: the discovered brand must not rank above the tracked one.
  const trend = [{ responses: 70, 'x:disc:x': 10 }, { responses: 30, 'x:disc:x': 0 }];
  assert.equal(extraPeriodShare(trend, 'disc:x'), 0.1);
  assert.equal(extraPeriodShare([], 'disc:x'), null);
  assert.ok(extraPeriodShare(trend, 'disc:x')! < 30 / 100);
});

await test('a discovered brand in a table reads the visibility its chart line totals, over the report window only', () => {
  // Mentions before the window (90-day analysis) stay out; the share is of the window's answers, not of the analyzed ones.
  const mentions = { '2026-09-01': 40, '2026-09-28': 1, '2026-09-29': 3 };
  const row = discoveredInPeriod(report(days), mentions);
  assert.equal(row.mentions, 4);
  const chart = extraPeriodShare(summaryTrend(report(days), 'day', 1, [{ key: 'disc:x', days: mentions }]), 'disc:x');
  assert.ok(Math.abs(row.visibility! - chart! * 100) < 1e-9);
  const none = { mentions: null, visibility: null };
  assert.deepEqual(discoveredInPeriod(null, mentions), none);
  assert.deepEqual(discoveredInPeriod(report([]), mentions), none);
  assert.deepEqual(discoveredInPeriod(report(days), {}), none, 'no daily counts is unknown, not zero');
  assert.deepEqual(discoveredInPeriod(report(days), { '2026-09-01': 5 }), { mentions: 0, visibility: 0 }, 'counted days, none in the window');
});

await test('a chart point opens its day, week (Monday to Sunday) or month, never past today', () => {
  assert.deepEqual(trendRange('2026-10-12', 'day', '2026-10-30'), { start: '2026-10-12', end: '2026-10-12' });
  assert.deepEqual(trendRange('2026-10-12', 'week', '2026-10-30'), { start: '2026-10-12', end: '2026-10-18' });
  assert.deepEqual(trendRange('2026-02-01', 'month', '2026-10-30'), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(trendRange('2026-10-01', 'month', '2026-10-30'), { start: '2026-10-01', end: '2026-10-30' });
});

test('an earlier period is compared only with at least half the answers of the current one', () => {
  // Conversion, 10/11/2026: 140 answers against 3,464 showed "+5.4 pp".
  assert.equal(coveredPeriods(140, 3464), false);
  assert.equal(coveredPeriods(1732, 3464), true);
  assert.equal(coveredPeriods(0, 10), false, 'no answers then is no comparison, never a change from 0');
  assert.equal(coveredPeriods(undefined, 10), false);
  assert.equal(coveredPeriods(10, 0), false);
});

test('a share chart starts at 0%; a position zooms in', () => {
  // A prompt at 93 to 100% drew its dips from a 70% floor.
  const share = getTrendScale([{ v: 75 }, { v: 100 }, { v: 93 }], ['v'], 'visibility');
  assert.deepEqual(share.domain, [0, 100]);
  assert.deepEqual(share.ticks, [0, 25, 50, 75, 100]);
  assert.deepEqual(getTrendScale([{ v: 12 }, { v: 22 }], ['v'], 'shareOfVoice').ticks, [0, 10, 20, 30]);
  assert.equal(getTrendScale([{ v: 2 }, { v: 3 }], ['v'], 'position').domain[0], 1.5);
});

test('share of voice and a discovered brand count only the answers the brand analysis read', () => {
  // Netflix, 10/11/2026: answers newer than the analysis had no discoveries, and its share jumped from 19% to 30%.
  const read = [
    { date: '2026-09-28', responses: 10, analysed: 10, mentions: 5, voiceMentions: 5, totalMentions: 20, mentionsC0: 4, voiceMentionsC0: 4, positionSum: 0, positionSamples: 0 },
    { date: '2026-09-29', responses: 10, analysed: 2, mentions: 5, voiceMentions: 1, totalMentions: 4, mentionsC0: 4, voiceMentionsC0: 1, positionSum: 0, positionSamples: 0 },
  ];
  const [first, second] = summaryTrend(report(read), 'day', 1, [{ key: 'd', days: { '2026-09-28': 2, '2026-09-29': 1 } }]);
  assert.deepEqual([first!.sov, second!.sov, second!.sovC0], [25, 25, 25]);
  // Visibility of a monitored brand is over every answer; of a discovered one, over the answers the analysis read.
  assert.equal(second!.brand, 50);
  assert.equal(second!.d, 50);
  assert.equal(extraPeriodShare([first!, second!], 'd'), 3 / 12);
});
