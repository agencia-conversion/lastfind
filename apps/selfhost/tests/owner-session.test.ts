import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import {
  accessKeyHash,
  createOwnerSession,
  verifyOwnerSession,
} from '../lib/owner-session.ts';
void test('owner session is scoped to installation, key version and signed expiry', async () => {
  const secret = crypto.randomUUID() + crypto.randomUUID(),
    hash = await accessKeyHash(crypto.randomUUID() + crypto.randomUUID()),
    origin = 'https://owner.example';
  const token = await createOwnerSession(secret, hash, origin);
  assert.equal(await verifyOwnerSession(token, secret, hash, origin), true);
  assert.equal(
    await verifyOwnerSession(token, secret, hash, 'https://another.example'),
    false,
  );
  assert.equal(
    await verifyOwnerSession(token, secret, '0'.repeat(64), origin),
    false,
  );
  assert.equal(
    await verifyOwnerSession(token + 'broken', secret, hash, origin),
    false,
  );
  assert.equal(await verifyOwnerSession(token, 'short', hash, origin), false);
  const expired = await new SignJWT({ credential: hash })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('owner:local')
    .setIssuer(origin)
    .setAudience('lastfind-owner')
    .setExpirationTime(1)
    .sign(new TextEncoder().encode(secret));
  assert.equal(await verifyOwnerSession(expired, secret, hash, origin), false);
});
