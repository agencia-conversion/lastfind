// Data retention in the project store (lib/retention.ts, ProjectStore.purgeAnswerText): the text of the answers older than the
// cutoff goes, a batch at a time; every number a report counts stays, the answers at and after the cutoff keep their text, and
// a dry run counts exactly what a run removes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY, meteredStore, reports } from './store-meter.mjs';

const strip = (value) => JSON.parse(JSON.stringify(value), (key, item) => (['currentStart', 'previousStart', 'previousEnd', 'end'].includes(key) ? undefined : item));
const views = async (q) => {
  const query = new URLSearchParams(`project=fixture&${q}`);
  const context = async () => reports.reportContext('owner', query);
  return {
    summary: strip(await reports.summaryReport(await context())),
    prompts: strip(await reports.promptReport(await context(), true)),
    sources: strip(await reports.sourcesReport(await context(), new URLSearchParams(`${query}&kind=all&evidence=1&group=domain`))),
  };
};

test('retention removes the text of older answers only, keeps every number, and its dry run counts what it removes', async () => {
  const store = await meteredStore({ units: 6, days: 40 }, 'retention');
  try {
    const { rpc, runs, now } = store;
    const before = new Date(now - 20 * DAY).toISOString();
    const sql = async (text, ...params) => (await rpc({ action: 'query', statements: [{ sql: text, params }] }))[0].results;
    // An answer exactly at the cutoff keeps its text (only answers before it go).
    const edge = runs.find((run) => run.created_at >= before);
    await rpc({ action: 'apply', changes: [{ entity: 'runs', id: edge.id, revision: 9_000_000, data: { ...edge, created_at: before, completed_at: before } }] });
    for (let cursor = '', done = false; !done; ) ({ cursor, done } = await rpc({ action: 'positions-fill', cursor }));
    const older = runs.filter((run) => run.id !== edge.id && run.created_at < before).length;
    const whole = await views('days=40');
    const size = (await rpc({ action: 'size' })).bytes;

    const dry = await rpc({ action: 'retention-purge', before, dryRun: true });
    assert.equal(dry.answers, older, 'the dry run counts every older answer that holds text');
    assert.equal((await rpc({ action: 'retention-purge', before, dryRun: true })).answers, older, 'and changes nothing');

    let removed = 0;
    for (let more = true, calls = 0; more; calls++) {
      assert.ok(calls < 100);
      const batch = await rpc({ action: 'retention-purge', before, limit: 50 });
      removed += batch.answers;
      more = batch.more;
    }
    assert.equal(removed, older, 'a run removes what the dry run counted');
    assert.equal((await rpc({ action: 'retention-purge', before, dryRun: true })).answers, 0);
    assert.equal((await rpc({ action: 'retention-purge', before, limit: 50 })).answers, 0, 'idempotent');

    const [kept] = await sql('SELECT COUNT(*) n FROM runs WHERE created_at<? AND answer IS NOT NULL', before);
    assert.equal(kept.n, 0, 'no older answer keeps its text');
    const [after] = await sql('SELECT COUNT(*) n FROM runs WHERE created_at>=? AND answer IS NULL', before);
    assert.equal(after.n, 0, 'every answer at or after the cutoff keeps its text');
    const [rows] = await sql('SELECT COUNT(*) n FROM run_rows');
    assert.equal(rows.n, runs.length, 'every answer row stays');
    // Every number a report counts over the whole period, on both sides of the cutoff, is the same.
    assert.deepEqual(await views('days=40'), whole);
    const freed = size - (await rpc({ action: 'size' })).bytes;
    if (process.env.METER_DETAIL) console.log(`store: ${Math.round(size / runs.length)} bytes an answer before, ${Math.round(freed / older)} freed per answer purged`);
    // A longer retention (an earlier cutoff) removes nothing more.
    assert.equal((await rpc({ action: 'retention-purge', before: new Date(now - 30 * DAY).toISOString(), limit: 50 })).answers, 0);
  } finally {
    await store.close();
  }
});
