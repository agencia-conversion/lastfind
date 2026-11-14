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
  // A share starts at 0% (10/11/2026: a prompt at 97% drew its dips to 75% as falls to the floor); a position zooms in.
  const span = metric === 'position' ? Math.max(1, max - min) : Math.max(10, max);
  const step =
    metric === 'position'
      ? Math.max(0.5, Math.ceil((span / 4) * 2) / 2)
      : Math.max(5, Math.ceil(span / 4 / 5) * 5);
  const low = metric === 'position' ? Math.max(1, Math.floor((min - span * 0.1) / step) * step) : 0;
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

/** The chart point a UTC day falls in: the day, its Monday or the first of its month. */
export function trendBucket(day: string, resolution: TrendResolution) {
  const date = new Date(`${day}T00:00:00Z`);
  if (resolution === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  if (resolution === 'month') date.setUTCDate(1);
  return date.toISOString().slice(0, 10);
}

/**
 * Share of voice's numerator for a mentions field (`mentions`, `mentionsC0`, ...): the same over the answers the brand
 * analysis read (`voiceMentions`, `voiceMentionsC0`, run-rows voiceSql), or the field itself in a report kept before they existed.
 */
export function voiceField(rows: Record<string, unknown>[], field: string) {
  return rows.some((row) => row.analysed != null) ? `voice${field[0]!.toUpperCase()}${field.slice(1)}` : field;
}

/** UTC Monday weeks/calendar months; partial buckets use only the selected report cohort. */
export function summaryTrend(
  report: SummaryReport,
  resolution: TrendResolution,
  competitors: number,
  /** Discovered brands: answers per UTC day mentioning each; charted as visibility (`key`) and share of voice (`sov:key`), whose total counts them too. */
  extras: { key: string; days: Record<string, number> }[] = [],
) {
  const start = Date.parse(report.comparison.currentStart),
    end = Date.parse(report.comparison.end);
  const buckets = new Map<string, Record<string, string | number | null>>();
  // Share of voice and a discovered brand's visibility count only the answers the brand analysis read (run-rows voiceSql);
  // a report kept before they were sent has none of these fields and falls back to every answer.
  const voiced = report.daily.some((row) => row.analysed != null);
  const voice = (field: string) => (voiced ? `voice${field[0]!.toUpperCase()}${field.slice(1)}` : field);
  const analysed = voiced ? 'analysed' : 'responses';
  const counts = [
    'responses',
    'mentions',
    'totalMentions',
    ...(voiced ? ['voiceMentions', 'analysed'] : []),
    'positionSum',
    'positionSamples',
    ...Array.from({ length: competitors }, (_, index) => [
      `mentionsC${index}`,
      ...(voiced ? [`voiceMentionsC${index}`] : []),
      `positionSumC${index}`,
      `positionSamplesC${index}`,
    ]).flat(),
  ];
  for (const row of report.daily) {
    const day = String(row.date), stamp = Date.parse(`${day}T00:00:00Z`);
    if (stamp < Math.floor(start / 86400000) * 86400000 || stamp >= end || Number(row.responses) === 0) continue;
    const key = trendBucket(day, resolution),
      bucket = buckets.get(key) ?? { date: key };
    for (const count of counts)
      bucket[count] = Number(bucket[count] ?? 0) + Number(row?.[count] ?? 0);
    for (const extra of extras)
      bucket[`x:${extra.key}`] = Number(bucket[`x:${extra.key}`] ?? 0) + (extra.days[day] ?? 0);

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
      sov: ratio(voice('mentions'), 'totalMentions', true),
      position: ratio('positionSum', 'positionSamples'),
      ...Object.fromEntries(
        extras.flatMap((extra) => {
          const share = ratio(`x:${extra.key}`, analysed, true);
          const voice = ratio(`x:${extra.key}`, 'totalMentions', true);
          return [
            [extra.key, share == null ? null : Math.min(100, share)],
            [`sov:${extra.key}`, voice == null ? null : Math.min(100, voice)],
          ];
        }),
      ),
      ...Object.fromEntries(
        Array.from({ length: competitors }, (_, index) => [
          [`c${index}`, ratio(`mentionsC${index}`, 'responses', true)],
          [`sovC${index}`, ratio(voice(`mentionsC${index}`), 'totalMentions', true)],
          [
            `positionC${index}`,
            ratio(`positionSumC${index}`, `positionSamplesC${index}`),
          ],
        ]).flat(),
      ),
    };
  });
}

/**
 * Period visibility of a discovered brand, in the same unit as the tracked brands' (0–1): its answers ÷ all answers in the
 * trend; with `voice`, its share of voice: its mentions ÷ the mentions of every identified brand.
 */
export function extraPeriodShare(trend: Record<string, unknown>[], key: string, voice = false) {
  const sum = (field: string) => trend.reduce((total, row) => total + Number(row[field] ?? 0), 0);
  // A discovered brand is known only in the answers the brand analysis read (`analysed`, absent in a report kept before it).
  const total = sum(voice ? 'totalMentions' : trend.some((row) => row.analysed != null) ? 'analysed' : 'responses');
  return total ? sum(`x:${key}`) / total : null;
}

/**
 * A discovered brand in the report's own window, in the units of the monitored brands: the window's answers that mention it
 * (its daily counts) and their share (0–100) of the window's answers. Null without a report, answers or daily counts (a rejected
 * brand the analysis no longer lists has only its old total). Only meaningful with no model, topic, tag or text filter: its
 * counts are of every answer of a day.
 */
export function discoveredInPeriod(report: SummaryReport | null | undefined, days: Record<string, number>) {
  const trend = report && Object.keys(days).length ? summaryTrend(report, 'day', 0, [{ key: 'd', days }]) : [];
  const share = extraPeriodShare(trend, 'd');
  return share == null
    ? { mentions: null, visibility: null }
    : { mentions: trend.reduce((total, row) => total + Number(row['x:d'] ?? 0), 0), visibility: Math.min(100, share * 100) };
}

/** The days a chart point covers, both included (drill down): the day, its week (Monday to Sunday) or its month, never past today. */
export function trendRange(date: string, resolution: TrendResolution, today = new Date().toISOString().slice(0, 10)) {
  const end = new Date(`${date}T00:00:00.000Z`);
  if (resolution === 'week') end.setUTCDate(end.getUTCDate() + 6);
  else if (resolution === 'month') end.setUTCMonth(end.getUTCMonth() + 1, 0);
  const last = end.toISOString().slice(0, 10);
  return { start: date, end: last < today ? last : today };
}
