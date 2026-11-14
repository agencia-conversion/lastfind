import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkspaceLinkToken, workspaceLinkToken } from '../lib/server/workspace-link-token.ts';

const SECRET = 'workspace-link-isolated-fixture-secret-not-production';
const now = Date.UTC(2026, 9, 28);

void test('only a link signed for this account, unchanged and unexpired, names a workspace', async () => {
  const token = await workspaceLinkToken(SECRET, 'member', 'owner-1', now);
  assert.equal(await readWorkspaceLinkToken(SECRET, 'member', token, now), 'owner-1', 'a valid link');
  assert.equal(await readWorkspaceLinkToken(SECRET, 'member', 'owner-1', now), null, 'unsigned');
  assert.equal(await readWorkspaceLinkToken(SECRET, 'other', token, now), null, 'signed for someone else');
  assert.equal(await readWorkspaceLinkToken(SECRET, 'member', token.replace('owner-1', 'owner-2'), now), null, 'another workspace');
  const [owner, expires, signature] = token.split('.');
  assert.equal(await readWorkspaceLinkToken(SECRET, 'member', `${owner}.${Number(expires) + 86400}.${signature}`, now), null, 'longer expiry');
  assert.equal(await readWorkspaceLinkToken(SECRET, 'member', `${owner}.${expires}.${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`, now), null, 'tampered signature');
  assert.equal(await readWorkspaceLinkToken('another-secret-that-is-long-enough-to-sign', 'member', token, now), null, 'another secret');
  assert.equal(await readWorkspaceLinkToken(SECRET, 'member', token, now + 31 * 86400_000), null, 'expired after 30 days');
  assert.equal(await readWorkspaceLinkToken(SECRET, 'member', token, now + 29 * 86400_000), 'owner-1');
});
