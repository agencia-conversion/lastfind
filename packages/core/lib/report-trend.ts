import type { SummaryReport } from './report-types';
export type TrendResolution = 'day' | 'week' | 'month';
export type TrendMetric = 'visibility' | 'shareOfVoice' | 'position';

export function rankTrendSeries(
  series: { key: string; name: string; value: number | null }[],
) {
  return series
    .filter((item) => item.value !== null && Number.isFinite(item.value))
    .sort((a, b) => b.value! - a.value! || a.name.localeCompare(b.name))
    .map((item, index) => [item.key, index] as const);
}

export function getTrendScale<T>(
  points: T[],
  brands: string[],
  metric: TrendMetric,
) {
  const values = points
    .flatMap((point) =>
      brands.map((brand) => (point as Record<string, unknown>)[brand]),
    )
    .filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );
  if (!values.length)
    return {
      domain: [0, metric === 'position' ? 6 : 100],
      ticks: metric === 'position' ? [0, 2, 4, 6] : [0, 25, 50, 75, 100],
    };
  const min = Math.min(...values),
    max = Math.max(...values);
  const span = Math.max(metric === 'position' ? 1 : 10, max - min);
  const step =
    metric === 'position'
      ? Math.max(0.5, Math.ceil((span / 4) * 2) / 2)
      : Math.max(5, Math.ceil(span / 4 / 5) * 5);
  const low = Math.max(
    metric === 'position' ? 1 : 0,
    Math.floor((min - span * 0.1) / step) * step,
  );
  const high =
    metric === 'position'
      ? Math.ceil((max + span * 0.1) / step) * step
      : Math.min(100, Math.ceil((max + span * 0.1) / step) * step);
  const ticks = [low];
  for (
    let tick = Math.ceil((low + 0.001) / step) * step;
    tick < high;
    tick += step
  )
    ticks.push(tick);
  ticks.push(high);
  return { domain: [low, high], ticks };
}

/** UTC Monday weeks/calendar months; partial buckets use only the selected report cohort. */
export function summaryTrend(
  report: SummaryReport,
  resolution: TrendResolution,
  competitors: number,
) {
  const start = Date.parse(report.comparison.currentStart),
    end = Date.parse(report.comparison.end);
  const buckets = new Map<string, Record<string, string | number | null>>();
  const counts = [
    'responses',
    'mentions',
    'totalMentions',
    'positionSum',
    'positionSamples',
    ...Array.from({ length: competitors }, (_, index) => [
      `mentionsC${index}`,
      `positionSumC${index}`,
      `positionSamplesC${index}`,
    ]).flat(),
  ];
  for (const row of report.daily) {
    const day = String(row.date), stamp = Date.parse(`${day}T00:00:00Z`);
    if (stamp < Math.floor(start / 86400000) * 86400000 || stamp >= end || Number(row.responses) === 0) continue;
    const date = new Date(stamp);
    if (resolution === 'week')
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    if (resolution === 'month') date.setUTCDate(1);
    const key = date.toISOString().slice(0, 10),
      bucket = buckets.get(key) ?? { date: key };
    for (const count of counts)
      bucket[count] = Number(bucket[count] ?? 0) + Number(row?.[count] ?? 0);

    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((bucket) => {
    const ratio = (numerator: string, denominator: string, percent = false) =>
      Number(bucket[denominator])
        ? (Number(bucket[numerator]) / Number(bucket[denominator])) *
          (percent ? 100 : 1)
        : null;
    const legacyDay = report.daily.find(
      (row) => String(row.date) === String(bucket.date),
    );
    if (
      legacyDay &&
      legacyDay.responses === undefined &&
      resolution === 'day'
    )
      return { ...bucket, ...legacyDay };
    return {
      ...bucket,
      date: String(bucket.date),
      brand: ratio('mentions', 'responses', true),
      sov: ratio('mentions', 'totalMentions', true),
      position: ratio('positionSum', 'positionSamples'),
      ...Object.fromEntries(
        Array.from({ length: competitors }, (_, index) => [
          [`c${index}`, ratio(`mentionsC${index}`, 'responses', true)],
          [`sovC${index}`, ratio(`mentionsC${index}`, 'totalMentions', true)],
          [
            `positionC${index}`,
            ratio(`positionSumC${index}`, `positionSamplesC${index}`),
          ],
        ]).flat(),
      ),
    };
  });
}
