import test from 'node:test';
import assert from 'node:assert/strict';
import { DECISION_SAMPLING, DECISIONS_URL, sendDecisions } from '../lib/decisions-transport.ts';

test('every decision call asks for deterministic sampling, and drops it once if the endpoint refuses it', async () => {
  const realFetch = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  let refuse: (body: Record<string, unknown>) => number = () => 200;
  let said = '{}';
  globalThis.fetch = async (url, init) => {
    assert.equal(url, DECISIONS_URL);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer isolated-not-a-key');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return new Response(said, { status: refuse(body) });
  };
  const send = (payload: unknown) => sendDecisions(payload, { key: 'isolated-not-a-key', waits: [0] });
  try {
    assert.equal((await send({ model: 'm', questions: {} })).status, 200);
    assert.deepEqual(bodies.pop(), { model: 'm', questions: {}, ...DECISION_SAMPLING });
    assert.deepEqual(DECISION_SAMPLING, { temperature: 0, seed: 20261029 });
    // A 400 for another reason comes back as it is, sent once, and the sampling stays asked.
    refuse = () => 400;
    said = '{"error":{"message":"Unknown model"}}';
    const refused = await send({ model: 'm' });
    assert.deepEqual([refused.status, await refused.text()], [400, said]);
    assert.deepEqual(bodies.splice(0), [{ model: 'm', ...DECISION_SAMPLING }]);
    // A 429 is sent again after the wait.
    let busy = 1;
    refuse = () => (busy-- > 0 ? 429 : 200);
    assert.equal((await send({ model: 'm' })).status, 200);
    assert.equal(bodies.splice(0).length, 2);
    // An endpoint that refuses the sampling fields: asked again without them, once, and they are not sent again.
    refuse = (body) => ('temperature' in body ? 400 : 200);
    said = '{"error":{"message":"Unrecognized key: temperature"}}';
    assert.equal((await send({ model: 'm' })).status, 200);
    assert.deepEqual(bodies.splice(0), [{ model: 'm', ...DECISION_SAMPLING }, { model: 'm' }]);
    assert.equal((await send({ model: 'm' })).status, 200);
    assert.deepEqual(bodies.splice(0), [{ model: 'm' }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
