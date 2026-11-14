// What a project store costs (docs/costs.md): Durable Objects SQLite bills the rows it reads and writes. These tests count them
// in Cloudflare's current runtime (store-meter.mjs) and keep the fixes of 11/11/2026: a request's own bookkeeping reads a few
// rows whatever the project's size, a repeated screen is served from what the store kept (the same result), and the first
// screens are recomputed once the data settles, not after every batch of a collection.
import assert from 'node:assert/strict';
import test from 'node:test';
import { meteredStore, meter, publish, runRow, screenReads, reports } from './store-meter.mjs';

const strip = (value) => JSON.parse(JSON.stringify(value), (key, item) => (['currentStart', 'previousStart', 'previousEnd', 'end'].includes(key) ? undefined : item));

test('a store request reads a few rows whatever the project size, and a repeated screen is the kept result', async () => {
  const overhead = [];
  for (const size of [{ units: 3, days: 20 }, { units: 12, days: 90 }]) {
    const store = await meteredStore(size, `overhead-${size.units}`);
    try {
      const { rpc } = store;
      await meter(rpc);
      await rpc({ action: 'status' });
      const status = await meter(rpc);
      // Before 11/11/2026 every request read the whole ranks table (one row per answer) to look for rows of an old format.
      assert.ok(status.read < 40, `a status reads ${status.read} rows for ${store.runs.length} answers`);
      overhead.push(status.read);
      const [legacy] = await rpc({ action: 'query', statements: [{ sql: "SELECT value FROM store_meta WHERE key='positions_legacy'", params: [] }] });
      assert.equal(legacy.results[0]?.value, 'done', 'the old ranks are looked for once per store');
      if (size.units < 12) continue;
      // The default screens: computed once, then served from what the store kept for this data, with the same numbers.
      await meter(rpc);
      const first = await screenReads('days=28');
      const cold = await meter(rpc);
      const again = await screenReads('days=28');
      const kept = await meter(rpc);
      assert.deepEqual(strip(again), strip(first));
      assert.ok(cold.read > store.runs.length, `the first read computes (${cold.read} rows)`);
      assert.ok(kept.read < 2000, `the repeated screens read ${kept.read} rows (the first, ${cold.read})`);
      // The live read (nothing kept) gives the same numbers.
      const live = globalThis.metered.rpc;
      globalThis.metered.rpc = (message) => live(message.action === 'query' ? { ...message, report: undefined } : message);
      const q = new URLSearchParams('project=fixture&days=28');
      assert.deepEqual(strip(await reports.summaryReport(await reports.reportContext('owner', q))), strip(first.summary));
      globalThis.metered.rpc = live;
    } finally {
      await store.close();
    }
  }
  assert.ok(Math.abs(overhead[1] - overhead[0]) < 10, `the same few rows at ${overhead.join(' and ')}`);
});

test('after a change the first screens wait for the data to settle before they are recomputed', async () => {
  const store = await meteredStore({ units: 3, days: 10 }, 'settle');
  try {
    const { rpc } = store;
    const before = Date.now();
    await publish(rpc, [{ entity: 'runs', data: runRow(8_000_001, store.prompts[0], new Date().toISOString()) }], 5_000_000);
    const status = await rpc({ action: 'status' });
    assert.equal(status.settling, true, 'data changed a moment ago');
    const [after] = await rpc({ action: 'query', statements: [{ sql: "SELECT value FROM store_meta WHERE key='warm_after'", params: [] }] });
    // A collection publishes on every 5-minute tick: the recomputation waits ten minutes after the last change, not 20 s.
    assert.ok(Number(after.results[0].value) - before >= 9.5 * 60_000, 'recomputed ten minutes after the last change');
    // Read on demand meanwhile: a screen still gets the new data, computed and kept for the next read.
    const read = await screenReads('days=7');
    assert.ok(read.summary.metrics.responses > 0);
  } finally {
    await store.close();
  }
});
