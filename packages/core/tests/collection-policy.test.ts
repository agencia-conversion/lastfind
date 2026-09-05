import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPollTime, boundedBatch } from '../lib/collection-policy.ts';
void test('provider polling backs off without delaying explicit callbacks', () => {
  const now = Date.parse('2026-09-05T07:00:00.000Z');
  assert.equal(nextPollTime('chat_gpt', 0, now), '2026-09-05T07:01:00.000Z');
  assert.equal(nextPollTime('chat_gpt', 4, now), '2026-09-05T07:30:00.000Z');
  assert.equal(nextPollTime('claude', 0, now), '2026-09-05T07:15:00.000Z');
  assert.equal(nextPollTime('claude', 100, now), '2026-09-05T09:00:00.000Z');
  assert.equal(boundedBatch('', 40, 100), 40);
  assert.equal(boundedBatch('9000', 40, 100), 100);
  assert.equal(boundedBatch('NaN', 40, 100), 40);
});
