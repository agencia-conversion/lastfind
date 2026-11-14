import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  avatarImage,
  avatarKey,
  avatarResponse,
  avatarType,
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

await test('an uploaded photo is typed by its bytes and drawn before Gravatar', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(avatarType(png), 'image/png');
  assert.equal(avatarType(jpeg), 'image/jpeg');
  assert.equal(avatarType(webp), 'image/webp');
  for (const unsafe of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '<html>', 'GIF89a', ''])
    assert.equal(avatarType(new TextEncoder().encode(unsafe)), null, unsafe);
  assert.equal(avatarKey('owner:local'), 'avatars/v1/owner%3Alocal');

  resetAvatarImageCache();
  let lookups = 0;
  const fetcher = (async () => {
    lookups++;
    return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } });
  }) as typeof fetch;
  const asked: string[] = [];
  const own = await avatarResponse(async () => ({ id: 'u1', email: 'a@example.com' }), fetcher, async (id) => {
    asked.push(id);
    return { image: webp, type: 'image/webp' };
  });
  assert.equal(own.headers.get('Content-Type'), 'image/webp');
  assert.deepEqual(asked, ['u1']);
  assert.equal(lookups, 0);
  const none = await avatarResponse(async () => ({ id: 'u2', email: 'b@example.com' }), fetcher, async () => null);
  assert.equal(none.headers.get('Content-Type'), 'image/png');
  assert.equal(lookups, 1);
});
