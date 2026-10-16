import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsRequest } from '../lib/analytics-cache.ts';
import { cachedAnalyticsQuery } from '../lib/server/analytics-query-cache.ts';
import { responseCacheExpiry, type requestJson } from '../lib/client.ts';

await test('client cache isolates transports and every query; single flight, hard TTL and visible background refresh', async () => {
  let now = 0,
    calls = 0,
    refreshed = 0;
  const transport = (async () => ({ revision: ++calls })) as typeof requestJson;
  const cache = createAnalyticsRequest(transport, () => now);
  cache.subscribe(() => refreshed++);
  const path = '/api/reports?project=a&view=summary&engine=chat_gpt&page=1';
  const [a, b] = await Promise.all([cache.request(path), cache.request(path)]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.deepEqual(await cache.request(path), a);
  for (const suffix of [
    '&topic=other',
    '&page=2',
    '&cursor=next',
    '&kind=consulted',
    '&project=b',
  ])
    await cache.request(path + suffix);
  assert.equal(calls, 6);
  const other = createAnalyticsRequest(transport, () => now);
  await other.request(path);
  assert.equal(calls, 7);
  now = 15_000;
  assert.deepEqual(await cache.request(path), a);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 8);
  assert.equal(refreshed, 1);
  assert.deepEqual(await cache.request(path), { revision: 8 });
  now = 45_000;
  assert.deepEqual(await cache.request(path), { revision: 9 });
  await cache.request('/api/auth/session');
  await cache.request('/api/auth/session');
  assert.equal(calls, 11);
});
await test('mutation and session/demo reset reject old in-flight GETs and require a fresh workspace', async () => {
  let resolve: (data: unknown) => void = () => {},
    calls = 0;
  const transport = (async (_path, method = 'GET') => {
    calls++;
    return method === 'GET'
      ? new Promise<unknown>((done) => {
          resolve = done;
        })
      : { ok: true };
  }) as typeof requestJson;
  const cache = createAnalyticsRequest(transport);
  const old = cache.request('/api/workspace?project=a');
  const rejected = assert.rejects(old, { name: 'AbortError' });
  await cache.request('/api/prompts/a', 'PATCH', { text: 'Edited question' });
  resolve({ private: 'stale' });
  await rejected;
  const fresh = cache.request('/api/workspace?project=a');
  resolve({ private: 'fresh' });
  assert.deepEqual(await fresh, { private: 'fresh' });
  assert.equal(calls, 3);
  const inflight = cache.request('/api/reports?project=a&view=summary');
  const discarded = assert.rejects(inflight, { name: 'AbortError' });
  cache.invalidate();
  resolve({ old: true });
  await discarded;
  const demo = createAnalyticsRequest(transport);
  const demoRead = demo.request('/api/demo/workspace');
  resolve({ demo: true });
  await demoRead;
  const session = cache.request('/api/workspace?project=a');
  resolve({ newSession: true });
  assert.deepEqual(await session, { newSession: true });
});
await test('abort belongs to one caller; failures never populate the client cache', async () => {
  let resolve: (data: unknown) => void = () => {},
    calls = 0;
  const cache = createAnalyticsRequest((async () => {
    calls++;
    return new Promise<unknown>((done) => (resolve = done));
  }) as typeof requestJson);
  const controller = new AbortController(),
    path = '/api/reports?project=abort&view=summary';
  const a = cache.request(path, 'GET', undefined, controller.signal),
    b = cache.request(path);
  controller.abort();
  resolve({ ok: true });
  await assert.rejects(a, { name: 'AbortError' });
  assert.deepEqual(await b, { ok: true });
  assert.equal(calls, 1);
  let failures = 0;
  const failed = createAnalyticsRequest((async () => {
    failures++;
    throw Error('Denied');
  }) as typeof requestJson);
  await assert.rejects(failed.request(path));
  await assert.rejects(failed.request(path));
  assert.equal(failures, 2);
});
await test('server cache separates owner, generation, publication and analysis revisions and never caches failures', async () => {
  let calls = 0,
    now = 0;
  const load = async () => ({ id: ++calls });
  const base = [
    'cache-test-owner-a',
    'project-a',
    'generation-a',
    1,
    1,
    'analysis-a',
    1,
  ];
  const key = JSON.stringify(base);
  assert.deepEqual(await cachedAnalyticsQuery(key, load, () => now), { id: 1 });
  assert.deepEqual(await cachedAnalyticsQuery(key, load, () => now), { id: 1 });
  for (const index of [0, 1, 2, 3, 4, 5, 6]) {
    const next = [...base];
    next[index] = 'changed';
    await cachedAnalyticsQuery(JSON.stringify(next), load, () => now);
  }
  assert.equal(calls, 8);
  now = 30_000;
  await cachedAnalyticsQuery(key, load, () => now);
  assert.equal(calls, 9);
  let failures = 0;
  const fail = () => {
    failures++;
    return Promise.reject(Error('offline'));
  };
  await assert.rejects(cachedAnalyticsQuery('failure-test', fail));
  await assert.rejects(cachedAnalyticsQuery('failure-test', fail));
  assert.equal(failures, 2);
});

await test('server freshness expires in the client without extending the original thirty seconds', async () => {
  let now = 20_000,
    calls = 0;
  const cache = createAnalyticsRequest(
    (async () => {
      const result = { id: ++calls };
      responseCacheExpiry.set(result, 30_000);
      return result;
    }) as typeof requestJson,
    () => now,
  );
  await cache.request('/api/reports?project=expiry&view=summary');
  now = 29_999;
  await cache.request('/api/reports?project=expiry&view=summary');
  assert.equal(calls, 1);
  now = 30_000;
  await cache.request('/api/reports?project=expiry&view=summary');
  assert.equal(calls, 2);
});
