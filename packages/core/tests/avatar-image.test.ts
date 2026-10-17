import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  avatarImage,
  avatarResponse,
  resetAvatarImageCache,
} from '../lib/server/avatar-image.ts';

await test('avatar lookup hashes normalized email on the server and caches image bytes', async () => {
  resetAvatarImageCache();
  const seen: string[] = [];
  const fetcher = (async (url: string) => {
    seen.push(url);
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'image/png' },
    });
  }) as typeof fetch;
  const avatar = await avatarImage('  Person@Example.COM  ', fetcher, 1000);
  assert.deepEqual(Array.from(avatar!.image), [1, 2, 3]);
  assert.equal(avatar!.type, 'image/png');
  assert.equal(seen.length, 1);
  assert.ok(
    seen[0].includes(
      createHash('sha256').update('person@example.com').digest('hex'),
    ),
  );
  assert.ok(seen[0].includes('d=404'));
  assert.ok(!seen[0].includes('person@example.com'));
  assert.deepEqual(
    await avatarImage('person@example.com', fetcher, 1001),
    avatar,
  );
  assert.equal(seen.length, 1);
});

await test('missing, oversized and offline images fall back without repeated lookups', async () => {
  for (const response of [
    new Response(null, { status: 404 }),
    new Response('unsafe', { headers: { 'Content-Type': 'image/svg+xml' } }),
    new Response(new Uint8Array(512_001), {
      headers: { 'Content-Type': 'image/png' },
    }),
  ]) {
    resetAvatarImageCache();
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return response;
    }) as typeof fetch;
    assert.equal(await avatarImage('offline@example.com', fetcher, 0), null);
    assert.equal(await avatarImage('offline@example.com', fetcher, 1000), null);
    assert.equal(calls, 1);
  }
  resetAvatarImageCache();
  assert.equal(
    await avatarImage('offline@example.com', (async () => {
      throw new Error('offline');
    }) as typeof fetch),
    null,
  );
});

await test('the proxy authenticates before lookup and never caches identity in the browser', async () => {
  resetAvatarImageCache();
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(new Uint8Array([1]), {
      headers: { 'Content-Type': 'image/png' },
    });
  }) as typeof fetch;
  const anonymous = await avatarResponse(async () => null, fetcher);
  assert.equal(anonymous.status, 401);
  assert.equal(calls, 0);
  const signedIn = await avatarResponse(
    async () => ({ email: 'private@example.com' }),
    fetcher,
  );
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(signedIn.headers.get('Vary'), 'Cookie');
  assert.equal(signedIn.headers.get('Content-Type'), 'image/png');
  assert.equal(calls, 1);
  assert.ok(
    ![...signedIn.headers].flat().join(' ').includes('private@example.com'),
  );
});
