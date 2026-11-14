import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import {
  accessKeyHash,
  createOwnerSession,
  ownerKeyHash,
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
void test('a one-click deploy signs in with the key itself; the installer hash wins when both exist', async () => {
  const key = 'k'.repeat(40);
  const values: Record<string, string> = { OWNER_ACCESS_KEY: key };
  const read = (name: string) => values[name] ?? '';
  assert.equal(await ownerKeyHash(read), await accessKeyHash(key));
  values.OWNER_ACCESS_KEY_HASH = 'a'.repeat(64);
  assert.equal(await ownerKeyHash(read), 'a'.repeat(64));
  assert.equal(await ownerKeyHash((name) => (name === 'OWNER_ACCESS_KEY' ? 'too-short' : '')), '');
});

import { DatabaseSync } from 'node:sqlite';
import { LOGIN_ATTEMPTS_PER_MINUTE, reserveLoginAttempt } from '../lib/owner-session.ts';

// The control database as the route sees it (D1's prepare/bind/first/run), over the selfhost `system_state` table.
function controlDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE system_state (key text PRIMARY KEY NOT NULL, value text NOT NULL)');
  const prepare = (sql: string, params: (string | number)[] = []) => ({
    bind: (...values: (string | number)[]) => prepare(sql, values),
    first: async <T>() => (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    run: async () => sqlite.prepare(sql).run(...params),
  });
  return { prepare, rows: () => sqlite.prepare('SELECT key FROM system_state').all().length };
}

void test('owner key tries are counted per client address and minute; a stale window is dropped', async () => {
  const database = controlDb();
  const minute = 60_000;
  for (let i = 0; i < LOGIN_ATTEMPTS_PER_MINUTE; i++) assert.equal(await reserveLoginAttempt(database, '203.0.113.7', 10 * minute + i), true, `try ${i + 1}`);
  assert.equal(await reserveLoginAttempt(database, '203.0.113.7', 10 * minute + 59_999), false, 'the eleventh try in the minute is refused');
  assert.equal(await reserveLoginAttempt(database, '203.0.113.8', 10 * minute + 59_999), true, 'another address has its own count');
  assert.equal(await reserveLoginAttempt(database, '203.0.113.7', 11 * minute), true, 'the next minute starts again');
  // The row holds a hash of the address, and the other address's stale window is gone with the new minute.
  assert.equal(database.rows(), 1);
});
