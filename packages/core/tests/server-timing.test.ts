import assert from 'node:assert/strict';
import test from 'node:test';
import { collectingServerTiming, timed, withServerTiming } from '../lib/server/server-timing.ts';

test('timed adds the time of overlapping calls per name and the header lists them', async () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const response = await withServerTiming(async () => {
    assert.equal(collectingServerTiming(), true);
    await Promise.all([timed('store-query', () => wait(20)), timed('store-query', () => wait(20)), timed('d1', () => wait(5))]);
    return Response.json({});
  });
  const header = response.headers.get('Server-Timing') ?? '';
  assert.match(header, /^total;dur=\d+, /);
  assert.match(header, /store-query;dur=(3\d|4\d|5\d);desc="2 calls"/);
  assert.match(header, /d1;dur=\d+;desc="1 calls"/);
});

test('outside a timed route the work just runs and a failure still propagates', async () => {
  assert.equal(collectingServerTiming(), false);
  assert.equal(await timed('d1', async () => 7), 7);
  await assert.rejects(() => withServerTiming(() => timed('d1', () => Promise.reject(new Error('boom'))) as Promise<Response>), /boom/);
});
