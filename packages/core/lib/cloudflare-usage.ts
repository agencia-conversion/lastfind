// Admin > Usage and costs, Cloudflare section: what this Cloudflare account used this month (Workers, D1, Durable Objects,
// R2) and what it costs at Cloudflare's published prices. Read from the GraphQL Analytics API, one dataset per request so a
// dataset Cloudflare renames or refuses blanks only its own lines. No import here: the server module (lib/server/
// cloudflare-usage.ts) adds the credentials and the hourly cache, the tests feed recorded answers.

/**
 * Cloudflare's published Workers Paid prices, checked on 10 Nov 2026 (developers.cloudflare.com: Workers, D1, Durable
 * Objects, R2 and Browser Run pricing pages). The only place these numbers live: when Cloudflare changes a price, change it
 * here and the date with it. `included` is the monthly allowance of the plan, `usd` the price of one unit past it.
 */
export const CLOUDFLARE_PRICES = {
  checkedOn: '2026-11-10',
  source: 'https://developers.cloudflare.com/workers/platform/pricing/',
  planUsd: 5,
  meters: {
    workersRequests: { product: 'workers', included: 10_000_000, usd: 0.3 / 1e6 },
    workersCpuMs: { product: 'workers', included: 30_000_000, usd: 0.02 / 1e6 },
    d1RowsRead: { product: 'd1', included: 25_000_000_000, usd: 0.001 / 1e6 },
    d1RowsWritten: { product: 'd1', included: 50_000_000, usd: 1 / 1e6 },
    d1StorageGb: { product: 'd1', included: 5, usd: 0.75 },
    doRequests: { product: 'durableObjects', included: 1_000_000, usd: 0.15 / 1e6 },
    doDurationGbS: { product: 'durableObjects', included: 400_000, usd: 12.5 / 1e6 },
    doRowsRead: { product: 'durableObjects', included: 25_000_000_000, usd: 0.001 / 1e6 },
    doRowsWritten: { product: 'durableObjects', included: 50_000_000, usd: 1 / 1e6 },
    doStorageGb: { product: 'durableObjects', included: 5, usd: 0.2 },
    r2ClassA: { product: 'r2', included: 1_000_000, usd: 4.5 / 1e6 },
    r2ClassB: { product: 'r2', included: 10_000_000, usd: 0.36 / 1e6 },
    r2StorageGb: { product: 'r2', included: 10, usd: 0.015 },
    // Browser Run has no analytics dataset: kept for the note that says so (10 hours a month, then per hour).
    browserHours: { product: 'browserRun', included: 10, usd: 0.09 },
  },
} as const;
export type Meter = Exclude<keyof typeof CLOUDFLARE_PRICES.meters, 'browserHours'>;
/** Measured per day (the trend); the storage meters are a level, read once. */
const FLOW_METERS = ['workersRequests', 'workersCpuMs', 'd1RowsRead', 'd1RowsWritten', 'doRequests', 'doDurationGbS', 'doRowsRead', 'doRowsWritten', 'r2ClassA', 'r2ClassB'] as const;
type FlowMeter = (typeof FLOW_METERS)[number];
const STORAGE_METERS = ['d1StorageGb', 'doStorageGb', 'r2StorageGb'] as const;

// R2 operation classes (R2 pricing page). An operation not listed as class B or free counts as class A, the dearer one.
const R2_CLASS_B = new Set(['HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary', 'GetBucketEncryption', 'GetBucketLocation', 'GetBucketCors', 'GetBucketLifecycleConfiguration']);
const R2_FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload']);
/** A Durable Object is billed for 128 MB while active: active microseconds to GB-seconds. */
const DO_GB_S_PER_MICROSECOND = 0.128 / 1e6;
const GB = 1e9;

type Row = { dimensions?: Record<string, string>; sum?: Record<string, number>; max?: Record<string, number> };
type Dataset = {
  id: string;
  dataset: string;
  fields: string;
  dimensions: string;
  /** `period`: every day of the window; `recent`: the last two days (a storage level, the newest wins). */
  window: 'period' | 'recent';
  read: (rows: Row[], out: Collected) => void;
};
type Collected = { days: Map<string, Partial<Record<FlowMeter, number>>>; storage: Partial<Record<(typeof STORAGE_METERS)[number], number>>; r2Objects?: number };

const add = (out: Collected, date: string | undefined, meter: FlowMeter, value: unknown) => {
  if (!date || typeof value !== 'number' || !Number.isFinite(value)) return;
  const day = out.days.get(date) ?? {};
  day[meter] = (day[meter] ?? 0) + value;
  out.days.set(date, day);
};
/** The newest day's value of each key (a database, a bucket), summed: storage is a level, not a flow. */
function latest(rows: Row[], key: string, value: (row: Row) => number) {
  const newest = new Map<string, { date: string; value: number }>();
  for (const row of rows) {
    const id = row.dimensions?.[key] ?? '';
    const date = row.dimensions?.date ?? '';
    const current = newest.get(id);
    if (!current || date > current.date) newest.set(id, { date, value: value(row) || 0 });
  }
  return [...newest.values()].reduce((total, item) => total + item.value, 0);
}

/** Field names as Cloudflare's GraphQL schema has them (checked by introspection on 10 Nov 2026). */
export const DATASETS: Dataset[] = [
  {
    id: 'workers',
    dataset: 'workersInvocationsAdaptive',
    fields: 'sum { requests cpuTimeUs }',
    dimensions: 'date',
    window: 'period',
    read: (rows, out) => rows.forEach((row) => {
      add(out, row.dimensions?.date, 'workersRequests', row.sum?.requests);
      add(out, row.dimensions?.date, 'workersCpuMs', (row.sum?.cpuTimeUs ?? NaN) / 1000);
    }),
  },
  {
    id: 'd1',
    dataset: 'd1AnalyticsAdaptiveGroups',
    fields: 'sum { rowsRead rowsWritten }',
    dimensions: 'date',
    window: 'period',
    read: (rows, out) => rows.forEach((row) => {
      add(out, row.dimensions?.date, 'd1RowsRead', row.sum?.rowsRead);
      add(out, row.dimensions?.date, 'd1RowsWritten', row.sum?.rowsWritten);
    }),
  },
  {
    id: 'd1Storage',
    dataset: 'd1StorageAdaptiveGroups',
    fields: 'max { databaseSizeBytes }',
    dimensions: 'date databaseId',
    window: 'recent',
    read: (rows, out) => void (out.storage.d1StorageGb = latest(rows, 'databaseId', (row) => row.max?.databaseSizeBytes ?? 0) / GB),
  },
  {
    id: 'doRequests',
    dataset: 'durableObjectsInvocationsAdaptiveGroups',
    fields: 'sum { requests }',
    dimensions: 'date',
    window: 'period',
    read: (rows, out) => rows.forEach((row) => add(out, row.dimensions?.date, 'doRequests', row.sum?.requests)),
  },
  {
    id: 'doDuration',
    dataset: 'durableObjectsPeriodicGroups',
    fields: 'sum { activeTime }',
    dimensions: 'date',
    window: 'period',
    read: (rows, out) => rows.forEach((row) => add(out, row.dimensions?.date, 'doDurationGbS', (row.sum?.activeTime ?? NaN) * DO_GB_S_PER_MICROSECOND)),
  },
  {
    id: 'doRows',
    dataset: 'durableObjectsPeriodicGroups',
    fields: 'sum { rowsRead rowsWritten }',
    dimensions: 'date',
    window: 'period',
    read: (rows, out) => rows.forEach((row) => {
      add(out, row.dimensions?.date, 'doRowsRead', row.sum?.rowsRead);
      add(out, row.dimensions?.date, 'doRowsWritten', row.sum?.rowsWritten);
    }),
  },
  {
    id: 'doStorage',
    // Lastfind's Durable Objects are SQLite-backed: their stored bytes are in the SQL storage dataset, not the key-value one.
    dataset: 'durableObjectsSqlStorageGroups',
    fields: 'max { storedBytes }',
    dimensions: 'date',
    window: 'recent',
    read: (rows, out) => void (out.storage.doStorageGb = latest(rows, '', (row) => row.max?.storedBytes ?? 0) / GB),
  },
  {
    id: 'r2Operations',
    dataset: 'r2OperationsAdaptiveGroups',
    fields: 'sum { requests }',
    dimensions: 'date actionType',
    window: 'period',
    read: (rows, out) => rows.forEach((row) => {
      const action = row.dimensions?.actionType ?? '';
      if (!R2_FREE.has(action)) add(out, row.dimensions?.date, R2_CLASS_B.has(action) ? 'r2ClassB' : 'r2ClassA', row.sum?.requests);
    }),
  },
  {
    id: 'r2Storage',
    dataset: 'r2StorageAdaptiveGroups',
    fields: 'max { payloadSize metadataSize objectCount }',
    dimensions: 'date bucketName',
    window: 'recent',
    read: (rows, out) => {
      out.storage.r2StorageGb = latest(rows, 'bucketName', (row) => (row.max?.payloadSize ?? 0) + (row.max?.metadataSize ?? 0)) / GB;
      out.r2Objects = latest(rows, 'bucketName', (row) => row.max?.objectCount ?? 0);
    },
  },
];

export const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
export function datasetQuery(dataset: Dataset) {
  return `query($account: string!, $start: Date!, $end: Date!) { viewer { accounts(filter: { accountTag: $account }) { rows: ${dataset.dataset}(limit: 10000, filter: { date_geq: $start, date_leq: $end }) { ${dataset.fields} dimensions { ${dataset.dimensions} } } } } }`;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, days: number) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000));
/**
 * The window read: this month (UTC) to today, and at least the last 31 days for the trend. The Analytics API answers up
 * to 31 days per request.
 */
export function usageWindow(today: Date) {
  const end = isoDay(today);
  const monthStart = `${end.slice(0, 7)}-01`;
  const start = addDays(end, -30) < monthStart ? addDays(end, -30) : monthStart;
  return { start, end, monthStart, recent: addDays(end, -1) };
}

export type CloudflareLine = { meter: Meter; product: string; used: number; included: number; billable: number; usd: number };
export type CloudflareUsage = {
  configured: true;
  readAt: string;
  month: string;
  /** Days of the month elapsed (today counts), for the month-end projection. */
  elapsedDays: number;
  monthDays: number;
  days: ({ date: string } & Partial<Record<FlowMeter, number>>)[];
  lines: CloudflareLine[];
  storageGb: number;
  r2Objects: number | null;
  planUsd: number;
  estimateUsd: number;
  projectedUsd: number;
  /** Datasets Cloudflare did not answer (their lines are left out, never counted as zero). */
  failed: { id: string; message: string }[];
  prices: { checkedOn: string; source: string };
};

const lineFor = (meter: Meter, used: number): CloudflareLine => {
  const price = CLOUDFLARE_PRICES.meters[meter];
  const billable = Math.max(0, used - price.included);
  return { meter, product: price.product, used, included: price.included, billable, usd: billable * price.usd };
};
const datasetOf = (meter: Meter) =>
  ({ workersRequests: 'workers', workersCpuMs: 'workers', d1RowsRead: 'd1', d1RowsWritten: 'd1', d1StorageGb: 'd1Storage', doRequests: 'doRequests', doDurationGbS: 'doDuration', doRowsRead: 'doRows', doRowsWritten: 'doRows', doStorageGb: 'doStorage', r2ClassA: 'r2Operations', r2ClassB: 'r2Operations', r2StorageGb: 'r2Storage' })[meter];

/** The month's lines and estimate from what each dataset answered (pure: the tests give it recorded answers). */
export function summarize(answers: Record<string, { rows: Row[] } | { error: string }>, today: Date): CloudflareUsage {
  const window = usageWindow(today);
  const out: Collected = { days: new Map(), storage: {} };
  const failed: CloudflareUsage['failed'] = [];
  for (const dataset of DATASETS) {
    const answer = answers[dataset.id];
    if (!answer || 'error' in answer) failed.push({ id: dataset.id, message: answer && 'error' in answer ? answer.error : 'No answer.' });
    else dataset.read(answer.rows, out);
  }
  const ok = (meter: Meter) => !failed.some((item) => item.id === datasetOf(meter));
  const days = [...out.days.entries()].filter(([date]) => date >= window.start && date <= window.end).sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, ...values }));
  const monthDays = days.filter((day) => day.date >= window.monthStart);
  const total = (meter: FlowMeter, scale = 1) => monthDays.reduce((sum, day) => sum + (day[meter] ?? 0), 0) * scale;
  const elapsedDays = Number(window.end.slice(8, 10));
  const lastDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  const flows = FLOW_METERS.filter(ok);
  const storage = STORAGE_METERS.filter(ok);
  const lines = [...flows.map((meter) => lineFor(meter, total(meter))), ...storage.map((meter) => lineFor(meter, out.storage[meter] ?? 0))];
  // Storage is billed by the month's average level; today's level stands in for it.
  const projected = [...flows.map((meter) => lineFor(meter, total(meter, lastDay / elapsedDays))), ...storage.map((meter) => lineFor(meter, out.storage[meter] ?? 0))];
  const sum = (items: CloudflareLine[]) => CLOUDFLARE_PRICES.planUsd + items.reduce((value, line) => value + line.usd, 0);
  return {
    configured: true,
    readAt: today.toISOString(),
    month: window.monthStart.slice(0, 7),
    elapsedDays,
    monthDays: lastDay,
    days,
    lines,
    storageGb: storage.reduce((value, meter) => value + (out.storage[meter] ?? 0), 0),
    r2Objects: ok('r2StorageGb') ? (out.r2Objects ?? 0) : null,
    planUsd: CLOUDFLARE_PRICES.planUsd,
    estimateUsd: sum(lines),
    projectedUsd: sum(projected),
    failed,
    prices: { checkedOn: CLOUDFLARE_PRICES.checkedOn, source: CLOUDFLARE_PRICES.source },
  };
}

/** Ask every dataset at once; a refusal (HTTP, GraphQL error, unexpected shape) is that dataset's alone. */
export async function readCloudflareUsage({ account, token, today = new Date(), fetchImpl = fetch }: { account: string; token: string; today?: Date; fetchImpl?: typeof fetch }) {
  const window = usageWindow(today);
  const entries = await Promise.all(
    DATASETS.map(async (dataset) => {
      try {
        const response = await fetchImpl(GRAPHQL_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ query: datasetQuery(dataset), variables: { account, start: dataset.window === 'recent' ? window.recent : window.start, end: window.end } }),
          signal: AbortSignal.timeout(15_000),
        });
        const body = (await response.json().catch(() => null)) as { data?: { viewer?: { accounts?: { rows?: Row[] }[] } }; errors?: { message?: string }[] | null } | null;
        if (body?.errors?.length) return [dataset.id, { error: body.errors.map((error) => error.message ?? '').join(' ').slice(0, 300) }] as const;
        const rows = body?.data?.viewer?.accounts?.[0]?.rows;
        if (!response.ok || !Array.isArray(rows)) return [dataset.id, { error: `HTTP ${response.status}` }] as const;
        return [dataset.id, { rows }] as const;
      } catch (error) {
        return [dataset.id, { error: error instanceof Error ? error.message : String(error) }] as const;
      }
    }),
  );
  return summarize(Object.fromEntries(entries), today);
}
