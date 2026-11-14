import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsRequest } from '../lib/analytics-cache.ts';
import { cachedAnalyticsQuery, shareFlight, type Flight } from '../lib/server/analytics-query-cache.ts';

const keep = () => {};
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
await test('a write or a session/demo reset never lets an in-flight GET answer stale: it is read again', async () => {
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
  const tick = () => new Promise((done) => setImmediate(done));
  const old = cache.request('/api/workspace?project=a');
  await cache.request('/api/prompts/a', 'PATCH', { text: 'Edited question' });
  resolve({ private: 'stale' });
  await tick();
  // The screen that asked before the write gets the answer read after it, not "Aborted" (it would not ask again).
  const fresh = cache.request('/api/workspace?project=a');
  resolve({ private: 'fresh' });
  assert.deepEqual(await old, { private: 'fresh' });
  assert.deepEqual(await fresh, { private: 'fresh' });
  assert.equal(calls, 3);
  const inflight = cache.request('/api/reports?project=a&view=summary');
  cache.invalidate();
  resolve({ old: true });
  await tick();
  resolve({ fresh: true });
  assert.deepEqual(await inflight, { fresh: true });
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
  assert.deepEqual(await cachedAnalyticsQuery(key, load, { keep, clock: () => now }), { id: 1 });
  assert.deepEqual(await cachedAnalyticsQuery(key, load, { keep, clock: () => now }), { id: 1 });
  for (const index of [0, 1, 2, 3, 4, 5, 6]) {
    const next = [...base];
    next[index] = 'changed';
    await cachedAnalyticsQuery(JSON.stringify(next), load, { keep, clock: () => now });
  }
  assert.equal(calls, 8);
  now = 30_000;
  await cachedAnalyticsQuery(key, load, { keep, clock: () => now });
  assert.equal(calls, 9);
  let failures = 0;
  const fail = () => {
    failures++;
    return Promise.reject(Error('offline'));
  };
  await assert.rejects(cachedAnalyticsQuery('failure-test', fail, { keep }));
  await assert.rejects(cachedAnalyticsQuery('failure-test', fail, { keep }));
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

await test('a write invalidates only the same project; other projects keep their last GET', async () => {
  let calls = 0;
  const cache = createAnalyticsRequest((async (path, method = 'GET') => {
    if (method !== 'GET') return { ok: true };
    calls++;
    return { path };
  }) as typeof requestJson);
  const a = '/api/reports?project=a&view=summary';
  const b = '/api/reports?project=b&view=summary';
  const brands = '/api/projects/a/brands';
  assert.deepEqual(await cache.request(a), { path: a });
  assert.deepEqual(await cache.request(b), { path: b });
  assert.equal(calls, 2);
  await cache.request(brands, 'POST', { action: 'reject' });
  assert.deepEqual(await cache.request(b), { path: b });
  assert.equal(calls, 2, 'project b stayed warm');
  assert.deepEqual(await cache.request(a), { path: a });
  assert.equal(calls, 3, 'project a was dropped');
});
await test('a brand write sent outside the cache can drop its project workspace before the refresh', async () => {
  let calls = 0;
  const cache = createAnalyticsRequest((async () => ({ revision: ++calls })) as typeof requestJson);
  const a = '/api/workspace?project=a';
  const b = '/api/workspace?project=b';
  await cache.request(a);
  await cache.request(b);
  cache.invalidateRelated('/api/projects/a/brands');
  assert.deepEqual(await cache.request(a), { revision: 3 }, 'undo reads a fresh workspace');
  assert.deepEqual(await cache.request(b), { revision: 2 }, 'project b stayed warm');
});
await test('sentiment (brand research) reads are shared by the screens; a write to the project drops them', async () => {
  let calls = 0;
  const cache = createAnalyticsRequest((async () => ({ revision: ++calls })) as typeof requestJson);
  const path = '/api/projects/a/brand-research?days=30';
  assert.deepEqual(await cache.request(path), await cache.request(path));
  assert.equal(calls, 1);
  await cache.request('/api/projects/a/brands', 'POST', {});
  await cache.request(path);
  assert.equal(calls, 3);
});

/** A Storage stand-in (session storage) for the kept reads. */
function memoryArea() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() {
      return items.size;
    },
  };
}

await test('a later visit in the tab paints the kept read at once, then hears the fresh one; other accounts and resets keep nothing', async () => {
  const storage = memoryArea();
  let calls = 0;
  const transport = (async () => ({ revision: ++calls })) as typeof requestJson;
  const path = '/api/reports?project=a&view=summary';
  const first = createAnalyticsRequest(transport, Date.now, { scope: 'owner-1', storage });
  await first.request(path);
  await first.request('/api/runs/r1');
  assert.deepEqual([...storage.items.keys()], [`lastfind:analytics:owner-1:${path}`], 'answers text is never kept');
  // Reload: a new cache for the same account.
  const second = createAnalyticsRequest(transport, Date.now, { scope: 'owner-1', storage });
  const heard: unknown[] = [];
  second.subscribe((_path, data) => heard.push(data));
  assert.deepEqual(second.peek(path), { revision: 1 });
  assert.deepEqual(await second.request(path), { revision: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(heard, [{ revision: 3 }]);
  assert.deepEqual(second.peek(path), { revision: 3 });
  assert.equal(JSON.parse(storage.items.get(`lastfind:analytics:owner-1:${path}`)!).revision, 3);
  // A write drops the kept copy with the cached one.
  await second.request('/api/projects/a', 'PATCH', {});
  assert.equal(storage.items.size, 0);
  await second.request(path);
  second.invalidate();
  assert.equal(storage.items.size, 0);
  // Another account in the same tab never reads it.
  await second.request(path);
  const other = createAnalyticsRequest(transport, Date.now, { scope: 'owner-2', storage });
  assert.equal(other.peek(path), undefined);
  assert.equal(storage.items.size, 0);
  // No account (the demo): nothing kept.
  const demo = createAnalyticsRequest(transport, Date.now, { storage });
  await demo.request(path);
  assert.equal(storage.items.size, 0);
});

await test('the first workspace sent with the page answers its path (a bare thenable, browser only); a failed one is asked again', async () => {
  // React's server promise arrives as an object with `then` only (no `catch`).
  // eslint-disable-next-line unicorn/no-thenable
  const thenable = (value: unknown) => ({ then: (resolve: (data: unknown) => void) => resolve(value) }) as unknown as Promise<unknown>;
  // On the server render nothing is seeded.
  const onServer = createAnalyticsRequest((async () => ({ from: 'browser' })) as typeof requestJson, Date.now, { seed: { path: '/api/workspace', data: thenable({ from: 'server' }) } });
  assert.deepEqual(await onServer.request('/api/workspace'), { from: 'browser' });
  (globalThis as { window?: unknown }).window = {};
  let calls = 0;
  const transport = (async () => ({ from: 'browser', call: ++calls })) as typeof requestJson;
  const path = '/api/workspace?project=acme';
  const seeded = createAnalyticsRequest(transport, Date.now, { scope: 'owner-1', storage: memoryArea(), seed: { path, data: thenable({ from: 'server' }) } });
  assert.deepEqual(await seeded.request(path), { from: 'server' });
  assert.deepEqual(await seeded.request(path), { from: 'server' });
  assert.equal(calls, 0);
  const failed = createAnalyticsRequest(transport, Date.now, { seed: { path, data: Promise.reject(new Error('server read failed')) } });
  assert.deepEqual(await failed.request(path), { from: 'browser', call: 1 });
  delete (globalThis as { window?: unknown }).window;
});

await test('the screen reads sent with the page answer their paths; a failed or unsent one is asked once by the browser', async () => {
  // eslint-disable-next-line unicorn/no-thenable
  const thenable = (value: unknown) => ({ then: (resolve: (data: unknown) => void) => resolve(value) }) as unknown as Promise<unknown>;
  (globalThis as { window?: unknown }).window = {};
  const asked: string[] = [];
  const transport = (async (path: string) => {
    asked.push(path);
    return { from: 'browser' };
  }) as typeof requestJson;
  const summary = '/api/reports?project=acme&days=28&view=summary';
  const research = '/api/projects/acme/brand-research?project=acme&days=28';
  const history = '/api/reports?project=acme&days=28&view=history';
  const reads = thenable([
    { path: summary, data: thenable({ from: 'server', view: 'summary' }) },
    { path: research, data: Promise.reject(new Error('server read failed')) },
    // Too slow for the page: not sent.
    { path: history, data: thenable(null) },
  ]) as Promise<{ path: string; data: Promise<unknown> }[]>;
  const cache = createAnalyticsRequest(transport, Date.now, { scope: 'owner-1', storage: memoryArea(), seed: { path: '/api/workspace?project=acme', data: thenable({}), reads } });
  // The screen asks once the workspace has rendered, well after the list arrived.
  await new Promise((done) => setTimeout(done, 0));
  assert.deepEqual(await cache.request(summary), { from: 'server', view: 'summary' });
  assert.deepEqual(await cache.request(research), { from: 'browser' });
  assert.deepEqual(await cache.request(history), { from: 'browser' });
  assert.deepEqual(asked, [research, history]);
  delete (globalThis as { window?: unknown }).window;
});

await test('a shared read whose request went away never blocks the requests after it', async () => {
  // In a Worker, a read belongs to the request that started it: once that request ends (the page stopped waiting at 2 s, the
  // browser aborted it), its I/O is cancelled and the promise never settles. Before, every later request of the key joined
  // it and waited forever (a card loading for good) and the key stayed taken in the isolate.
  let now = 0,
    loads = 0;
  const kept: Promise<unknown>[] = [];
  const keepAlive = (work: Promise<unknown>) => void kept.push(work);
  const abandoned = () => {
    loads++;
    return new Promise<never>(() => {});
  };
  const answer = async () => {
    loads++;
    return { rows: 1 };
  };
  void cachedAnalyticsQuery('abandoned-read', abandoned, { keep: keepAlive, clock: () => now });
  assert.equal(kept.length, 1, 'the read that others may join is kept alive past its request (waitUntil)');
  now = 31_000;
  assert.deepEqual(await cachedAnalyticsQuery('abandoned-read', answer, { keep: keepAlive, clock: () => now }), { rows: 1 });
  assert.equal(loads, 2);

  // A request that joined while the read was young stops waiting when the join window ends, and computes its own.
  const flights = new Map<string, Flight<string>>();
  void shareFlight(flights, 'k', () => new Promise<never>(() => {}), keep, { joinMs: 30 });
  const started = Date.now();
  assert.equal(await shareFlight(flights, 'k', async () => 'own', keep, { joinMs: 30 }), 'own');
  assert.ok(Date.now() - started < 1000);
  // A live read is joined: one computation for both.
  let computations = 0;
  let finish: (value: string) => void = () => {};
  const first = shareFlight(flights, 'live', () => {
    computations++;
    return new Promise<string>((done) => (finish = done));
  }, keep);
  const second = shareFlight(flights, 'live', async () => {
    computations++;
    return 'second';
  }, keep);
  finish('shared');
  assert.deepEqual(await Promise.all([first, second]), ['shared', 'shared']);
  assert.equal(computations, 1);
  assert.equal(flights.size, 0, 'a settled read leaves the map');
});

await test('a read the server never answers ends in an error the screen shows, not a placeholder forever', async () => {
  const realFetch = globalThis.fetch;
  try {
    let signal: AbortSignal | undefined;
    globalThis.fetch = (async (_path: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as typeof fetch;
    const { requestJson } = await import('../lib/client.ts');
    await assert.rejects(requestJson('/api/reports?view=summary'), /did not respond/);
    assert.ok(signal, 'every read carries a deadline');
    // The screen's own abort (a filter changed) stays an abort, which screens ignore.
    globalThis.fetch = (async () => {
      throw new DOMException('Aborted', 'AbortError');
    }) as typeof fetch;
    await assert.rejects(requestJson('/api/reports?view=summary', 'GET', undefined, new AbortController().signal), { name: 'AbortError' });
  } finally {
    globalThis.fetch = realFetch;
  }
});
