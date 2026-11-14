import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLOUDFLARE_PRICES, DATASETS, GRAPHQL_URL, readCloudflareUsage, usageWindow } from '../lib/cloudflare-usage.ts';

// Answers in the shape Cloudflare's GraphQL Analytics API gives them, one per dataset, with the field names its schema has
// (introspection, 10 Nov 2026). No network: the fetch below serves the fixture; `refuse` answers one dataset with an error.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/cloudflare-graphql.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const today = new Date('2026-11-10T12:00:00Z');
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

// Every field each dataset may be asked for, as the schema lists them.
const SCHEMA: Record<string, string[]> = {
  workersInvocationsAdaptive: ['requests', 'cpuTimeUs'],
  d1AnalyticsAdaptiveGroups: ['queryBatchResponseBytes', 'readQueries', 'rowsRead', 'rowsWritten', 'writeQueries'],
  d1StorageAdaptiveGroups: ['databaseSizeBytes'],
  durableObjectsInvocationsAdaptiveGroups: ['requests'],
  durableObjectsPeriodicGroups: ['activeTime', 'cpuTime', 'duration', 'exceededCpuErrors', 'exceededMemoryErrors', 'fatalInternalErrors', 'inboundWebsocketMsgCount', 'outboundWebsocketMsgCount', 'rowsRead', 'rowsWritten', 'storageDeletes', 'storageReadUnits', 'storageWriteUnits', 'subrequests'],
  durableObjectsSqlStorageGroups: ['storedBytes'],
  r2OperationsAdaptiveGroups: ['requests'],
  r2StorageAdaptiveGroups: ['payloadSize', 'metadataSize', 'objectCount'],
};
const refusal = { data: null, errors: [{ message: 'unknown field "rowsRead"', path: ['viewer', 'accounts', 0, 'rows'] }] };

function recorded(calls: { url: string; auth: string; query: string; variables: Record<string, string> }[], refuse?: string) {
  return (async (url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body));
    calls.push({ url, auth: new Headers(init.headers).get('authorization') ?? '', query, variables });
    const dataset = DATASETS.find((item) => query.includes(`rows: ${item.dataset}(`) && query.includes(item.fields))!;
    return new Response(JSON.stringify(dataset.id === refuse ? refusal : fixture[dataset.id]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

void test('the window is this month and at least the last 31 days', () => {
  assert.deepEqual(usageWindow(today), { start: '2026-10-11', end: '2026-11-10', monthStart: '2026-11-01', recent: '2026-11-09' });
  assert.equal(usageWindow(new Date('2026-12-31T08:00:00Z')).start, '2026-12-01');
});

void test('every query asks only fields its dataset has', () => {
  for (const dataset of DATASETS) {
    const allowed = SCHEMA[dataset.dataset];
    assert.ok(allowed, `${dataset.dataset} is a known dataset`);
    const fields = dataset.fields.replace(/^\w+ \{|\}$/g, '').trim().split(/\s+/);
    for (const field of fields) assert.ok(allowed.includes(field), `${dataset.dataset} has ${field}`);
  }
});

void test('every dataset is asked once, with the account, the token and its window', async () => {
  const calls: Parameters<typeof recorded>[0] = [];
  await readCloudflareUsage({ account: 'account-tag', token: 'read-only-token', today, fetchImpl: recorded(calls) });
  assert.equal(calls.length, DATASETS.length);
  for (const call of calls) {
    assert.equal(call.url, GRAPHQL_URL);
    assert.equal(call.auth, 'Bearer read-only-token');
    assert.equal(call.variables.account, 'account-tag');
    assert.equal(call.variables.end, '2026-11-10');
    assert.match(call.query, /accounts\(filter: \{ accountTag: \$account \}\)/);
  }
  assert.equal(calls.find((call) => call.query.includes('r2StorageAdaptiveGroups'))!.variables.start, '2026-11-09');
  assert.equal(calls.find((call) => call.query.includes('workersInvocationsAdaptive'))!.variables.start, '2026-10-11');
});

void test('month totals, storage levels and the estimate at the published prices', async () => {
  const usage = await readCloudflareUsage({ account: 'a', token: 't', today, fetchImpl: recorded([]) });
  const line = (meter: string) => usage.lines.find((item) => item.meter === meter);
  assert.equal(usage.month, '2026-11');
  assert.equal(usage.days.length, 31);
  // Only this month counts: 1 to 10 November.
  near(line('workersRequests')!.used, 14_550_000);
  near(line('workersRequests')!.usd, 4_550_000 * (0.3 / 1e6));
  near(line('workersCpuMs')!.used, 52_750_000);
  near(line('d1RowsRead')!.usd, 0);
  // Storage is the newest level of each database or bucket, summed.
  near(line('d1StorageGb')!.used, 2.54);
  near(line('doStorageGb')!.used, 7.2);
  near(line('r2StorageGb')!.used, 30.01);
  near(line('doDurationGbS')!.used, 512_000);
  // R2: PutObject is class A, GetObject class B, DeleteObject free.
  near(line('r2ClassA')!.used, 400_000);
  near(line('r2ClassB')!.used, 900_000);
  near(usage.estimateUsd, 5 + 1.365 + 0.455 + 0.3 + 1.4 + 0.44 + 0.30015);
  assert.ok(usage.projectedUsd > usage.estimateUsd);
  assert.equal(usage.r2Objects, 1_250_000);
  assert.equal(usage.prices.checkedOn, CLOUDFLARE_PRICES.checkedOn);
});

void test('a refused dataset leaves its lines out and is named, never counted as zero', async () => {
  const whole = await readCloudflareUsage({ account: 'a', token: 't', today, fetchImpl: recorded([]) });
  assert.deepEqual(whole.failed, []);
  const doRowsRead = whole.lines.find((item) => item.meter === 'doRowsRead');
  assert.ok(doRowsRead && Math.abs(doRowsRead.used - 10_000_000_000) < 1e-6);
  const usage = await readCloudflareUsage({ account: 'a', token: 't', today, fetchImpl: recorded([], 'doRows') });
  assert.deepEqual(usage.failed.map((item) => item.id), ['doRows']);
  assert.match(usage.failed[0].message, /rowsRead/);
  assert.equal(usage.lines.some((item) => item.meter === 'doRowsRead' || item.meter === 'doRowsWritten'), false);
});

void test('a token Cloudflare refuses fails every dataset without throwing', async () => {
  const refused = (async () => new Response(JSON.stringify({ data: null, errors: [{ message: 'not authorized for that account' }] }), { status: 200 })) as unknown as typeof fetch;
  const usage = await readCloudflareUsage({ account: 'a', token: 'wrong', today, fetchImpl: refused });
  assert.equal(usage.failed.length, DATASETS.length);
  assert.equal(usage.lines.length, 0);
  const offline = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  assert.equal((await readCloudflareUsage({ account: 'a', token: 't', today, fetchImpl: offline })).failed.length, DATASETS.length);
});
